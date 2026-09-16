-- ============================================================
-- MetaCrypto OS — Migración 0037: escribir sesiones, con traza
--
-- Con este módulo el OS pasa a ser la ÚNICA fuente de verdad del servicio
-- (Airtable se congela con el despliegue, sin periodo en paralelo). Eso sube el
-- listón: si alguien registra una sesión en el cliente equivocado a las 23:00,
-- tiene que poder corregirse y tiene que quedar rastro de quién y qué había
-- antes.
--
-- Por qué funciones y no POST desde la aplicación:
--
--   1) ATOMICIDAD. La sesión y sus operaciones entran en una sola transacción.
--      Con dos POST desde la app, un fallo en el segundo dejaría media sesión
--      guardada que alguien tendría que compensar a mano.
--   2) LA TRAZA NO SE PUEDE OLVIDAR. Si el registro vive dentro de la función,
--      no hay forma de escribir una sesión sin dejar rastro en `auditoria`.
--
-- Mismo patrón que la 0016 (cuotas): payload jsonb, returns jsonb,
-- security definer, y `revoke` a todo el mundo salvo `service_role`.
--
-- Spec: docs/superpowers/specs/2026-08-12-sesiones-servicio-design.md
-- ============================================================
begin;

-- Helper: vuelca las operaciones de una sesión a jsonb, para las fotos de la
-- auditoría. Se usa en editar y en borrar, así que vive una sola vez.
create or replace function public.sesion_operaciones_json(p_sesion_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(o) order by o.orden), '[]'::jsonb)
    from public.sesion_operaciones o
   where o.sesion_id = p_sesion_id;
$$;

-- Helper: inserta la lista de operaciones de un payload. El `orden` sale de la
-- posición en el array, no del cliente: así no hay forma de mandar dos
-- operaciones con el mismo orden.
create or replace function public.sesion_guardar_operaciones(p_sesion_id uuid, p_ops jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_op    jsonb;
  v_i     int := 0;
  v_total int := 0;
begin
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then return 0; end if;

  for v_op in select * from jsonb_array_elements(p_ops) loop
    v_i := v_i + 1;

    -- Una operación sin dirección no es una operación. Se ignora en silencio
    -- en vez de reventar el registro entero: el formulario arranca con una
    -- fila vacía y sería absurdo que eso impidiera guardar la sesión.
    if nullif(v_op->>'direccion','') is null then continue; end if;

    insert into public.sesion_operaciones
      (sesion_id, orden, direccion, activo, capital, apalancamiento,
       zona_entrada, objetivo, estado)
    values
      (p_sesion_id, v_i,
       v_op->>'direccion',
       nullif(v_op->>'activo',''),
       nullif(v_op->>'capital','')::numeric,
       nullif(v_op->>'apalancamiento',''),
       nullif(v_op->>'zona_entrada',''),
       nullif(v_op->>'objetivo',''),
       nullif(v_op->>'estado',''));

    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

-- 1) registrar_sesion ---------------------------------------------------------
create or replace function public.registrar_sesion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_persona   uuid := nullif(payload->>'persona_id','')::uuid;
  v_coach     uuid := nullif(payload->>'coach_id','')::uuid;
  v_fecha     timestamptz := (payload->>'fecha')::timestamptz;
  v_estado    text := nullif(payload->>'estado_asistencia','');
  v_autor     uuid := nullif(payload->>'autor_id','')::uuid;
  v_sesion_id uuid;
  v_n_ops     int;
  v_numero    int;
begin
  if v_persona is null then raise exception 'Falta el cliente'; end if;
  if not exists (select 1 from public.personas where id = v_persona) then
    raise exception 'Ese cliente no existe';
  end if;
  if v_coach is null then raise exception 'Falta el coach'; end if;
  if v_fecha is null then raise exception 'Falta la fecha de la sesión'; end if;

  -- No se puede haber asistido a algo que todavía no ha pasado. Se deja
  -- registrar la sesión futura (viene de GHL o se adelanta el registro), pero
  -- sin marcarla como hecha.
  if v_estado = 'asistio' and v_fecha > now() then
    raise exception 'No se puede marcar como asistida una sesión que aún no ha ocurrido';
  end if;

  -- Anti doble-submit acotado a esta persona y esta fecha: protege del doble
  -- clic sin bloquear el caso legítimo de registrar dos sesiones del mismo
  -- cliente en días distintos seguidos.
  if exists (
    select 1 from public.sesiones
     where persona_id = v_persona
       and fecha = v_fecha
       and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'sesión duplicada: ya se registró esa misma sesión hace menos de 2 minutos';
  end if;

  insert into public.sesiones
    (persona_id, coach_id, tipo, fecha, estado_asistencia, notas, url_grabacion,
     duracion_min, capital_total, exchange, proximo_paso)
  values
    (v_persona, v_coach,
     coalesce(nullif(payload->>'tipo',''), 'consultoria_1a1'),
     v_fecha, v_estado,
     nullif(payload->>'notas',''),
     nullif(payload->>'url_grabacion',''),
     nullif(payload->>'duracion_min','')::int,
     nullif(payload->>'capital_total','')::numeric,
     nullif(payload->>'exchange',''),
     nullif(payload->>'proximo_paso',''))
  returning id into v_sesion_id;

  v_n_ops := public.sesion_guardar_operaciones(v_sesion_id, payload->'operaciones');

  -- El número no se guarda: se lee de la vista, que lo deriva. Se devuelve para
  -- que la confirmación de la UI pueda decir "ha quedado como su Sesión 3".
  select numero into v_numero from public.v_sesiones_cliente where id = v_sesion_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('sesion', v_sesion_id, 'alta', v_autor,
          jsonb_build_object(
            'antes',   null,
            'despues', jsonb_build_object(
                         'persona_id', v_persona, 'coach_id', v_coach,
                         'fecha', v_fecha, 'estado_asistencia', v_estado,
                         'numero', v_numero),
            'operaciones', v_n_ops));

  return jsonb_build_object('sesion_id', v_sesion_id, 'numero', v_numero,
                            'operaciones', v_n_ops);
end;
$$;

-- 2) editar_sesion ------------------------------------------------------------
-- Las operaciones se reemplazan en bloque (borrar + insertar) en vez de
-- intentar casarlas una a una: el formulario manda la lista completa y cualquier
-- intento de reconciliar por posición acabaría fusionando operaciones distintas
-- cuando el coach quita la del medio.
create or replace function public.editar_sesion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesion   public.sesiones%rowtype;
  v_autor    uuid := nullif(payload->>'autor_id','')::uuid;
  v_ops_antes jsonb;
  v_fecha    timestamptz;
  v_estado   text;
  v_n_ops    int;
begin
  select * into v_sesion from public.sesiones
    where id = (payload->>'sesion_id')::uuid for update;
  if not found then raise exception 'Esa sesión no existe'; end if;

  -- Lo que no venga en el payload se queda como estaba: la UI puede mandar
  -- sólo lo que cambió sin borrar el resto por omisión.
  v_fecha  := coalesce((payload->>'fecha')::timestamptz, v_sesion.fecha);
  v_estado := coalesce(nullif(payload->>'estado_asistencia',''), v_sesion.estado_asistencia);

  if v_estado = 'asistio' and v_fecha > now() then
    raise exception 'No se puede marcar como asistida una sesión que aún no ha ocurrido';
  end if;

  v_ops_antes := public.sesion_operaciones_json(v_sesion.id);

  update public.sesiones set
    persona_id        = coalesce(nullif(payload->>'persona_id','')::uuid, persona_id),
    coach_id          = coalesce(nullif(payload->>'coach_id','')::uuid, coach_id),
    fecha             = v_fecha,
    estado_asistencia = v_estado,
    notas             = case when payload ? 'notas'         then nullif(payload->>'notas','')         else notas end,
    url_grabacion     = case when payload ? 'url_grabacion' then nullif(payload->>'url_grabacion','') else url_grabacion end,
    duracion_min      = case when payload ? 'duracion_min'  then nullif(payload->>'duracion_min','')::int      else duracion_min end,
    capital_total     = case when payload ? 'capital_total' then nullif(payload->>'capital_total','')::numeric else capital_total end,
    exchange          = case when payload ? 'exchange'      then nullif(payload->>'exchange','')      else exchange end,
    proximo_paso      = case when payload ? 'proximo_paso'  then nullif(payload->>'proximo_paso','')  else proximo_paso end
  where id = v_sesion.id;

  if payload ? 'operaciones' then
    delete from public.sesion_operaciones where sesion_id = v_sesion.id;
    v_n_ops := public.sesion_guardar_operaciones(v_sesion.id, payload->'operaciones');
  else
    v_n_ops := jsonb_array_length(v_ops_antes);
  end if;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('sesion', v_sesion.id, 'edicion', v_autor,
          jsonb_build_object(
            'antes',   to_jsonb(v_sesion) || jsonb_build_object('operaciones', v_ops_antes),
            'despues', to_jsonb((select s from public.sesiones s where s.id = v_sesion.id))
                       || jsonb_build_object('operaciones', public.sesion_operaciones_json(v_sesion.id))));

  return jsonb_build_object('sesion_id', v_sesion.id, 'operaciones', v_n_ops);
end;
$$;

-- 3) borrar_sesion ------------------------------------------------------------
-- Borrado real: `on delete cascade` se lleva las operaciones. Pero la traza
-- guarda la fila entera y sus operaciones en `datos.antes`, así que lo borrado
-- se puede reconstruir. Un borrado sin rastro, con el OS como única fuente de
-- verdad, sería una forma silenciosa de perder trabajo del equipo.
create or replace function public.borrar_sesion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesion    public.sesiones%rowtype;
  v_autor     uuid := nullif(payload->>'autor_id','')::uuid;
  v_motivo    text := nullif(payload->>'motivo','');
  v_ops_antes jsonb;
begin
  select * into v_sesion from public.sesiones
    where id = (payload->>'sesion_id')::uuid for update;
  if not found then raise exception 'Esa sesión no existe'; end if;

  v_ops_antes := public.sesion_operaciones_json(v_sesion.id);

  -- La traza va ANTES del delete: `wa_mensajes.sesion_id` es `on delete set
  -- null`, así que tras borrar ya no habría forma de reconstruir a qué sesión
  -- pertenecían los recordatorios enviados.
  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('sesion', v_sesion.id, 'borrado', v_autor,
          jsonb_build_object(
            'antes',   to_jsonb(v_sesion) || jsonb_build_object('operaciones', v_ops_antes),
            'despues', null,
            'motivo',  v_motivo));

  delete from public.sesiones where id = v_sesion.id;

  return jsonb_build_object('sesion_id', v_sesion.id, 'borrada', true);
end;
$$;

-- 4) asignar_cliente_sesion ---------------------------------------------------
-- La acción de la bandeja: `sesiones.persona_id` es opcional desde la 0025
-- porque una cita de GHL cuyo contacto no cruza con `personas` se guarda igual
-- para no perderla. Hoy hay 2 así, y sin esta función no hay forma de rescatarlas.
create or replace function public.asignar_cliente_sesion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sesion  public.sesiones%rowtype;
  v_persona uuid := nullif(payload->>'persona_id','')::uuid;
  v_autor   uuid := nullif(payload->>'autor_id','')::uuid;
  v_numero  int;
begin
  select * into v_sesion from public.sesiones
    where id = (payload->>'sesion_id')::uuid for update;
  if not found then raise exception 'Esa sesión no existe'; end if;
  if v_persona is null then raise exception 'Falta el cliente'; end if;
  if not exists (select 1 from public.personas where id = v_persona) then
    raise exception 'Ese cliente no existe';
  end if;
  if v_sesion.persona_id is not null then
    raise exception 'Esa sesión ya tiene cliente asignado';
  end if;

  update public.sesiones set persona_id = v_persona where id = v_sesion.id;

  select numero into v_numero from public.v_sesiones_cliente where id = v_sesion.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('sesion', v_sesion.id, 'asignar_cliente', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('persona_id', null),
            'despues', jsonb_build_object('persona_id', v_persona, 'numero', v_numero)));

  return jsonb_build_object('sesion_id', v_sesion.id, 'persona_id', v_persona,
                            'numero', v_numero);
end;
$$;

-- 5) Permisos -----------------------------------------------------------------
-- Sólo `service_role`, igual que las funciones de cuotas: la app las llama con
-- la clave de servicio desde el servidor. Ningún cliente del navegador debe
-- poder invocarlas directamente.
revoke all on function public.sesion_operaciones_json(uuid)      from public, anon, authenticated;
revoke all on function public.sesion_guardar_operaciones(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.registrar_sesion(jsonb)            from public, anon, authenticated;
revoke all on function public.editar_sesion(jsonb)               from public, anon, authenticated;
revoke all on function public.borrar_sesion(jsonb)               from public, anon, authenticated;
revoke all on function public.asignar_cliente_sesion(jsonb)      from public, anon, authenticated;

grant execute on function public.sesion_operaciones_json(uuid)        to service_role;
grant execute on function public.sesion_guardar_operaciones(uuid, jsonb) to service_role;
grant execute on function public.registrar_sesion(jsonb)              to service_role;
grant execute on function public.editar_sesion(jsonb)                 to service_role;
grant execute on function public.borrar_sesion(jsonb)                 to service_role;
grant execute on function public.asignar_cliente_sesion(jsonb)        to service_role;

commit;
