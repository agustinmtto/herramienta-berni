-- ============================================================
-- 0046 — Registrar y deshacer una devolución.
-- Spec: docs/superpowers/specs/2026-08-21-devoluciones-design.md
--
-- LAS COMISIONES NO SE CALCULAN AQUÍ. Llegan ya calculadas en
-- payload->'ajuste_comision' desde el server action, que usa la lógica pura
-- de lib/comisiones.ts (con tests). Replicar las reglas de reparto en
-- PL/pgSQL crearía una segunda fuente de verdad: el día que Berni cambie un
-- porcentaje habría dos respuestas y nadie sabría cuál se pagó. Aquí solo se
-- ESCRIBEN, para que el recibo diga lo que se le comunicó a cada persona.
-- ============================================================
begin;

-- 1) Los efectos de una devolución total, en un solo sitio -------------------
-- La usan `registrar_devolucion` (cuando nace total) y `clasificar_devolucion`
-- (0047, cuando una `sin_clasificar` resulta serlo). Escrito una vez para que
-- las dos puertas no puedan divergir.
create or replace function public.aplicar_efectos_devolucion(
  p_devolucion_id uuid,
  p_autor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago         public.pagos%rowtype;
  v_cuota        public.cuotas_programadas%rowtype;
  v_estado_antes text;
  v_cuotas       int := 0;
begin
  select * into v_pago from public.pagos where id = p_devolucion_id;
  if not found then raise exception 'La devolución no existe'; end if;

  -- Cuotas pendientes o vencidas: dejan de reclamarse. Se ANULAN, no se
  -- borran, y con `anular_cuota` (0041) en vez de un update a mano — así la
  -- auditoría de cuotas sigue siendo una sola y `reactivar_cuota` puede
  -- deshacerlo.
  for v_cuota in
    select * from public.cuotas_programadas
     where programa_id = v_pago.programa_id and estado in ('pendiente','vencida')
     order by numero_cuota
  loop
    perform public.anular_cuota(jsonb_build_object(
      'cuota_id', v_cuota.id,
      'motivo',   'Devolución del ' || to_char(v_pago.fecha, 'DD/MM/YYYY'),
      'autor_id', p_autor));

    insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
    values ('devolucion', p_devolucion_id, 'cuota_anulada', p_autor,
            jsonb_build_object('cuota_id', v_cuota.id, 'numero_cuota', v_cuota.numero_cuota,
                               'monto', v_cuota.monto,
                               'fecha_vencimiento', v_cuota.fecha_vencimiento));
    v_cuotas := v_cuotas + 1;
  end loop;

  -- El cliente deja de contar como cliente. `ex_cliente` ya está en el check
  -- de personas (0001). Si ya lo estaba no se escribe traza: una fila que dice
  -- "de ex_cliente a ex_cliente" es ruido que ensucia el recibo.
  select estado into v_estado_antes from public.personas
   where id = v_pago.persona_id for update;
  if v_estado_antes is distinct from 'ex_cliente' then
    update public.personas set estado = 'ex_cliente' where id = v_pago.persona_id;
    insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
    values ('devolucion', p_devolucion_id, 'estado_persona', p_autor,
            jsonb_build_object('antes', v_estado_antes, 'despues', 'ex_cliente'));
  end if;

  return jsonb_build_object('cuotas_anuladas', v_cuotas, 'estado_antes', v_estado_antes);
end;
$$;

-- 2) registrar_devolucion -----------------------------------------------------
create or replace function public.registrar_devolucion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_persona     uuid := nullif(payload->>'persona_id','')::uuid;
  v_programa    uuid := nullif(payload->>'programa_id','')::uuid;
  v_alcance     text := payload->>'alcance';
  v_fecha       date := nullif(payload->>'fecha','')::date;
  v_eur         numeric(12,2) := round(coalesce((payload->>'eur')::numeric, 0), 2);
  v_usd         numeric(12,2) := round((payload->>'usd')::numeric, 2);
  v_motivo      text := nullif(btrim(payload->>'motivo'), '');
  v_revierte    uuid := nullif(payload->>'revierte_pago_id','')::uuid;
  v_autor       uuid := nullif(payload->>'autor_id','')::uuid;
  v_orig        public.pagos%rowtype;
  v_prog_orig   uuid;
  v_devuelto_ya numeric(12,2);
  v_pago_id     uuid;
  v_efectos     jsonb := '{}'::jsonb;
  v_linea       jsonb;
begin
  if v_alcance is null or v_alcance not in ('total','parcial') then
    raise exception 'Alcance no reconocido: usa «total» o «parcial»';
  end if;
  if v_motivo is null then
    raise exception 'Hace falta un motivo para registrar la devolución';
  end if;
  if v_fecha is null then raise exception 'Falta la fecha de la devolución'; end if;
  if v_usd is null or v_usd >= 0 then
    raise exception 'El USD devuelto tiene que ser negativo';
  end if;
  if v_eur > 0 then
    raise exception 'El importe en euros no puede ser positivo';
  end if;

  perform 1 from public.personas where id = v_persona;
  if not found then raise exception 'La persona no existe'; end if;

  perform 1 from public.programas where id = v_programa and persona_id = v_persona;
  if not found then raise exception 'El programa no es de esta persona'; end if;

  -- Anti doble-submit, mismo guard que crear_venta (0014): dos clics seguidos
  -- en un botón que resta dinero es el error más fácil de cometer y el más
  -- caro de descubrir.
  perform 1 from public.pagos
   where persona_id = v_persona and tipo = 'refund'
     and monto = v_eur and fecha = v_fecha
     and created_at > now() - interval '2 minutes';
  if found then
    raise exception 'Devolución duplicada — ya se registró una igual hace menos de dos minutos';
  end if;

  if v_alcance = 'parcial' then
    if v_revierte is null then
      raise exception 'Una devolución parcial tiene que decir qué cobro devuelve';
    end if;
    select * into v_orig from public.pagos where id = v_revierte;
    if not found then raise exception 'El cobro que se devuelve no existe'; end if;
    if v_orig.tipo = 'refund' then raise exception 'No se puede devolver una devolución'; end if;

    -- El programa del cobro puede venir directo o a través de su cuota.
    v_prog_orig := coalesce(v_orig.programa_id,
      (select programa_id from public.cuotas_programadas where id = v_orig.cuota_id));
    if v_prog_orig is distinct from v_programa then
      raise exception 'El cobro que se devuelve no es de este programa';
    end if;

    -- Devolver más de lo cobrado generaría una comisión negativa mayor que la
    -- que se pagó. El céntimo de holgura absorbe el redondeo, no un error.
    select coalesce(sum(-usd_recibido), 0) into v_devuelto_ya
      from public.pagos where revierte_pago_id = v_revierte and tipo = 'refund';
    if v_devuelto_ya + (-v_usd) > coalesce(v_orig.usd_recibido, 0) + 0.01 then
      raise exception 'No se puede devolver más de lo que se cobró en ese pago';
    end if;
  else
    v_revierte := null;
  end if;

  insert into public.pagos (persona_id, programa_id, tipo, monto, divisa, fecha,
                            usd_recibido, revierte_pago_id,
                            devolucion_alcance, devolucion_motivo)
  values (v_persona, v_programa, 'refund', v_eur, 'EUR', v_fecha,
          v_usd, v_revierte, v_alcance, v_motivo)
  returning id into v_pago_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('devolucion', v_pago_id, 'devolucion_registrada', v_autor,
          jsonb_build_object('alcance', v_alcance, 'eur', v_eur, 'usd', v_usd,
                             'motivo', v_motivo, 'fecha', v_fecha,
                             'revierte_pago_id', v_revierte,
                             'persona_id', v_persona, 'programa_id', v_programa));

  -- El mes del cash es el de la FECHA de la devolución. Escrito explícito en
  -- la auditoría porque es la promesa que se le hizo a Berni ("se resta en
  -- este") y tiene que poder leerse sin recalcular nada.
  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('devolucion', v_pago_id, 'cash_afectado', v_autor,
          jsonb_build_object('mes', to_char(v_fecha, 'YYYY-MM'), 'eur', v_eur, 'usd', v_usd));

  if v_alcance = 'total' then
    v_efectos := public.aplicar_efectos_devolucion(v_pago_id, v_autor);
  end if;

  for v_linea in
    select * from jsonb_array_elements(coalesce(payload->'ajuste_comision', '[]'::jsonb))
  loop
    insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
    values ('devolucion', v_pago_id, 'comision_revertida', v_autor, v_linea);
  end loop;

  return jsonb_build_object('devolucion_id', v_pago_id, 'efectos', v_efectos);
end;
$$;

-- 3) deshacer_devolucion ------------------------------------------------------
-- Deshacer también es un hecho: deja su propia traza, y las filas de auditoría
-- de la devolución SOBREVIVEN al borrado de la fila de `pagos` (no hay FK a
-- propósito). Que algo se registró y se deshizo es historia, no un error que
-- haya que esconder.
create or replace function public.deshacer_devolucion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := nullif(payload->>'devolucion_id','')::uuid;
  v_autor  uuid := nullif(payload->>'autor_id','')::uuid;
  v_pago   public.pagos%rowtype;
  v_row    record;
  v_estado text;
  v_n      int := 0;
begin
  select * into v_pago from public.pagos
   where id = v_id and tipo = 'refund' for update;
  if not found then raise exception 'La devolución no existe'; end if;

  for v_row in
    select (datos->>'cuota_id')::uuid as cuota_id
      from public.auditoria
     where entidad = 'devolucion' and entidad_id = v_id and accion = 'cuota_anulada'
  loop
    -- Si alguien ya la reactivó a mano, se salta en vez de reventar: el
    -- objetivo es dejar el mundo como estaba, y en esa cuota ya lo está.
    if exists (select 1 from public.cuotas_programadas
                where id = v_row.cuota_id and estado = 'anulada') then
      perform public.reactivar_cuota(jsonb_build_object(
        'cuota_id', v_row.cuota_id, 'autor_id', v_autor));
      v_n := v_n + 1;
    end if;
  end loop;

  select datos->>'antes' into v_estado from public.auditoria
   where entidad = 'devolucion' and entidad_id = v_id and accion = 'estado_persona'
   order by created_at limit 1;
  if v_estado is not null then
    update public.personas set estado = v_estado where id = v_pago.persona_id;
  end if;

  delete from public.pagos where id = v_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('devolucion', v_id, 'devolucion_deshecha', v_autor,
          jsonb_build_object('cuotas_reactivadas', v_n, 'estado_repuesto', v_estado,
                             'eur', v_pago.monto, 'usd', v_pago.usd_recibido,
                             'fecha', v_pago.fecha));

  return jsonb_build_object('devolucion_id', v_id, 'cuotas_reactivadas', v_n,
                            'estado_repuesto', v_estado);
end;
$$;

revoke all on function public.aplicar_efectos_devolucion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.registrar_devolucion(jsonb)            from public, anon, authenticated;
revoke all on function public.deshacer_devolucion(jsonb)             from public, anon, authenticated;
grant execute on function public.aplicar_efectos_devolucion(uuid, uuid) to service_role;
grant execute on function public.registrar_devolucion(jsonb)            to service_role;
grant execute on function public.deshacer_devolucion(jsonb)             to service_role;

commit;
