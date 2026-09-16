--
-- PostgreSQL database dump
--

\restrict pC7mMtczqqV9iLvatkzz5CjcAepbFfRZaA6qNgbXwda3BaMC1k8tdWgKwSGv65x

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: anular_cuota(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.anular_cuota(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cuota  public.cuotas_programadas%rowtype;
  v_motivo text := nullif(btrim(payload->>'motivo'), '');
  v_autor  uuid := nullif(payload->>'autor_id','')::uuid;
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;

  -- Una cuota ya cobrada no se anula: eso es deshacer un pago, que tiene su
  -- propia función (`deshacer_pago_cuota`) porque además hay que devolver el
  -- importe. Anularla aquí dejaría el pago vivo y la cuota fuera de las
  -- cuentas — dinero cobrado que no aparece en ningún sitio.
  if v_cuota.estado = 'pagada' then
    raise exception 'Esta cuota ya está cobrada — deshaz el pago antes de anularla';
  end if;
  if v_cuota.estado = 'anulada' then
    raise exception 'Esta cuota ya estaba anulada';
  end if;

  -- El motivo es OBLIGATORIO. Una deuda que desaparece sin explicación es
  -- exactamente lo que la auditoría existe para impedir: dentro de tres meses
  -- "¿por qué dejó de deber 2.000 €?" tiene que tener respuesta en el sistema
  -- y no en la memoria de quien le dio al botón.
  if v_motivo is null then
    raise exception 'Hace falta un motivo para anular la cuota';
  end if;

  update public.cuotas_programadas set estado = 'anulada' where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'anulada', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('estado', v_cuota.estado, 'monto', v_cuota.monto,
                                          'fecha_vencimiento', v_cuota.fecha_vencimiento),
            'despues', jsonb_build_object('estado', 'anulada', 'monto', v_cuota.monto,
                                          'fecha_vencimiento', v_cuota.fecha_vencimiento),
            'motivo',  v_motivo));

  return jsonb_build_object('cuota_id', v_cuota.id, 'estado', 'anulada');
end;
$$;


--
-- Name: aplicar_efectos_devolucion(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aplicar_efectos_devolucion(p_devolucion_id uuid, p_autor uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: asignar_cliente_sesion(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.asignar_cliente_sesion(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: bonos_extra_consultorias(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bonos_extra_consultorias(bonos text[]) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select cardinality(array(
    select b
    from unnest(coalesce(bonos, '{}'::text[])) as b
    where b in ('consultoria_berni', 'consultoria_manuel')
  ));
$$;


--
-- Name: borrar_sesion(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.borrar_sesion(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: clasificar_devolucion(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clasificar_devolucion(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id       uuid := nullif(payload->>'devolucion_id','')::uuid;
  v_alcance  text := payload->>'alcance';
  v_motivo   text := nullif(btrim(payload->>'motivo'), '');
  v_revierte uuid := nullif(payload->>'revierte_pago_id','')::uuid;
  v_autor    uuid := nullif(payload->>'autor_id','')::uuid;
  v_pago     public.pagos%rowtype;
  v_efectos  jsonb := '{}'::jsonb;
begin
  if v_alcance is null or v_alcance not in ('total','parcial') then
    raise exception 'Alcance no reconocido: usa «total» o «parcial»';
  end if;
  if v_motivo is null then
    raise exception 'Hace falta decir qué fue esta devolución';
  end if;

  select * into v_pago from public.pagos
   where id = v_id and tipo = 'refund' for update;
  if not found then raise exception 'La devolución no existe'; end if;
  if v_pago.devolucion_alcance <> 'sin_clasificar' then
    raise exception 'Esta devolución ya está clasificada como «%»', v_pago.devolucion_alcance;
  end if;

  -- Una parcial necesita saber qué cobro devuelve, igual que al registrarla:
  -- sin eso no hay forma de revertir la comisión correcta.
  if v_alcance = 'parcial' and coalesce(v_revierte, v_pago.revierte_pago_id) is null then
    raise exception 'Una devolución parcial tiene que decir qué cobro devuelve';
  end if;

  update public.pagos
     set devolucion_alcance = v_alcance,
         devolucion_motivo  = v_motivo,
         revierte_pago_id   = coalesce(v_revierte, revierte_pago_id)
   where id = v_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('devolucion', v_id, 'devolucion_clasificada', v_autor,
          jsonb_build_object('antes', 'sin_clasificar', 'despues', v_alcance,
                             'motivo', v_motivo));

  if v_alcance = 'total' then
    v_efectos := public.aplicar_efectos_devolucion(v_id, v_autor);
  end if;

  return jsonb_build_object('devolucion_id', v_id, 'alcance', v_alcance, 'efectos', v_efectos);
end;
$$;


--
-- Name: crear_cuota(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_cuota(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_programa public.programas%rowtype;
  v_monto    numeric(12,2) := round((payload->>'monto')::numeric, 2);
  v_fecha    date          := (payload->>'fecha_vencimiento')::date;
  v_autor    uuid          := nullif(payload->>'autor_id','')::uuid;
  v_num      int;
  v_id       uuid;
begin
  select * into v_programa from public.programas where id = (payload->>'programa_id')::uuid;
  if not found then raise exception 'El programa no existe'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'El importe debe ser mayor que 0'; end if;
  if v_fecha is null then raise exception 'La fecha de vencimiento es obligatoria'; end if;
  if v_fecha < current_date then raise exception 'La fecha de vencimiento no puede ser pasada'; end if;

  select coalesce(max(numero_cuota), 0) + 1 into v_num
    from public.cuotas_programadas where programa_id = v_programa.id;

  insert into public.cuotas_programadas (programa_id, numero_cuota, fecha_vencimiento,
                                         monto, divisa, estado, fecha_inferida)
  values (v_programa.id, v_num, v_fecha, v_monto, coalesce(v_programa.divisa,'EUR'),
          'pendiente', false)
  returning id into v_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_id, 'creacion', v_autor,
          jsonb_build_object('despues', jsonb_build_object(
            'programa_id', v_programa.id, 'numero_cuota', v_num,
            'monto', v_monto, 'fecha_vencimiento', v_fecha)));

  return jsonb_build_object('cuota_id', v_id, 'numero_cuota', v_num);
end;
$$;


--
-- Name: crear_estrategia(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_estrategia(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_persona uuid := nullif(payload->>'persona_id','')::uuid;
  v_autor   uuid := nullif(payload->>'autor_id','')::uuid;
  v_titulo  text := nullif(btrim(payload->>'titulo'), '');
  v_url     text := nullif(btrim(payload->>'url'), '');
  v_token   text := nullif(btrim(payload->>'token_nuevo'), '');
  v_id      uuid;
  v_tok     text;
begin
  if v_persona is null then raise exception 'Falta el cliente'; end if;
  if v_titulo  is null then raise exception 'La estrategia necesita un título'; end if;
  if v_url     is null then raise exception 'La estrategia necesita un enlace'; end if;
  if v_token   is null then raise exception 'Falta el token de acceso'; end if;

  if not exists (select 1 from public.personas where id = v_persona) then
    raise exception 'Ese cliente no existe';
  end if;

  insert into public.estrategias
    (persona_id, titulo, url, password, resumen, fecha_lanzamiento, visible, creado_por)
  values (
    v_persona, v_titulo, v_url,
    nullif(btrim(payload->>'password'), ''),
    nullif(btrim(payload->>'resumen'), ''),
    coalesce(nullif(payload->>'fecha_lanzamiento','')::date, current_date),
    coalesce((payload->>'visible')::boolean, true),
    v_autor
  )
  returning id into v_id;

  -- Get-or-create de la llave. El `do update` no toca el token: existe solo
  -- para que el `returning` devuelva la fila también cuando ya estaba.
  insert into public.portal_accesos (persona_id, token, creado_por)
  values (v_persona, v_token, v_autor)
  on conflict (persona_id) do update set persona_id = excluded.persona_id
  returning token into v_tok;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('estrategia', v_id, 'crear', v_autor,
          jsonb_build_object('persona_id', v_persona, 'titulo', v_titulo, 'url', v_url));

  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_tok);
end;
$$;


--
-- Name: crear_sesion_desde_llamada(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_sesion_desde_llamada(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_llamada_id uuid := nullif(payload->>'llamada_id','')::uuid;
  v_autor      uuid := nullif(payload->>'autor_id','')::uuid;
  v_ll         public.fathom_llamadas%rowtype;
  v_coach      uuid;
  v_cubre      uuid;
  v_fecha_otra timestamptz;
  v_res        jsonb;
  v_sesion_id  uuid;
begin
  if v_llamada_id is null then raise exception 'Falta la llamada'; end if;

  -- `for update`: dos clics simultáneos sobre la misma llamada se serializan, y
  -- el segundo ve el `sesion_id` que dejó el primero.
  select * into v_ll from public.fathom_llamadas where id = v_llamada_id for update;
  if not found then raise exception 'Esa llamada no existe'; end if;

  if v_ll.sesion_id is not null then
    raise exception 'Esta llamada ya tiene una sesión.';
  end if;
  if v_ll.persona_id is null then
    raise exception 'Primero hay que decir de qué cliente es.';
  end if;
  if v_ll.inicio is null then
    raise exception 'La llamada no tiene fecha.';
  end if;
  if v_ll.descartada_at is not null then
    raise exception 'Esta llamada está descartada. Deshaz el descarte antes de registrarla.';
  end if;
  -- Una llamada de venta no es una consultoría: registrarla como sesión le
  -- gastaría al cliente una consultoría que nadie le dio.
  if v_ll.tipo <> 'servicio' then
    raise exception 'Esto no es una consultoría (está clasificada como "%"), así que no se registra como sesión.', v_ll.tipo;
  end if;

  -- EL GUARDIA -----------------------------------------------------------------
  v_cubre := public.fathom_sesion_que_cubre(v_ll.persona_id, v_ll.inicio);
  if v_cubre is not null then
    select fecha into v_fecha_otra from public.sesiones where id = v_cubre;
    raise exception
      'Ese cliente ya tiene una sesión registrada el %. Si de verdad fueron dos reuniones distintas, regístrala desde Sesiones.',
      to_char(v_fecha_otra at time zone 'Europe/Madrid', 'DD/MM/YYYY');
  end if;

  -- El consultor sale de quién grabó en Fathom. Si esa persona no está en el
  -- equipo se corta: es preferible pedir el dato a colgarle la sesión —y su
  -- comisión— a quien no la hizo.
  select id into v_coach
    from public.team_members
   where lower(trim(email)) = lower(trim(coalesce(v_ll.grabado_por_email,'')))
     and coalesce(email,'') <> ''
   limit 1;
  if v_coach is null then
    raise exception 'Quien grabó (%) no está en el equipo del OS.', coalesce(v_ll.grabado_por_email, '?');
  end if;

  -- Se reutiliza `registrar_sesion` a propósito: el cupo, la auditoría y el
  -- número de sesión se comportan igual que en el alta manual, en vez de tener
  -- un segundo camino que se comporta parecido.
  v_res := public.registrar_sesion(jsonb_build_object(
    'autor_id',          v_autor,
    'persona_id',        v_ll.persona_id,
    'coach_id',          v_coach,
    'fecha',             v_ll.inicio,
    -- Fathom solo tiene la grabación si la llamada ocurrió: "asistió" es un
    -- hecho, no una suposición.
    'estado_asistencia', 'asistio',
    'duracion_min',      v_ll.duracion_min,
    'url_grabacion',     v_ll.url,
    'notas',             coalesce(payload->>'notas','')
    -- La landing y el capital NO se rellenan: son justo lo que Berni dijo que
    -- añade el consultor al revisar. Inventarlos sería peor que dejarlos vacíos.
  ));
  v_sesion_id := (v_res->>'sesion_id')::uuid;

  update public.fathom_llamadas
     set sesion_id = v_sesion_id, actualizado_at = now()
   where id = v_llamada_id;

  return v_res || jsonb_build_object('llamada_id', v_llamada_id);
end;
$$;


--
-- Name: FUNCTION crear_sesion_desde_llamada(payload jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.crear_sesion_desde_llamada(payload jsonb) IS 'Convierte una llamada de Fathom en sesión del servicio. Rechaza si el cliente ya tiene una sesión ese día: v_consultorias_cliente cuenta las asistidas sin deduplicar, así que un duplicado le quita una consultoría pagada. Todo lo que mueve cupo se lee de la fila; del que llama solo se acepta `notas`.';


--
-- Name: crear_venta(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crear_venta(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_tipo         text := payload->>'tipo_venta';
  v_persona_id   uuid;
  v_programa_id  uuid;
  v_pago_id      uuid;
  v_prev         uuid := nullif(payload->>'programa_previo_id','')::uuid;
  v_pago_monto   numeric := (payload->>'pago_monto')::numeric;
  v_pago_fecha   date := (payload->>'pago_fecha')::date;
  v_telefono     text := nullif(payload->>'telefono_e164','');
  v_nombre       text := coalesce(trim(payload->>'nombre'),'');
  v_estado_prev  text;
  v_reutilizada  boolean := false;
  v_motivo text; v_modo text; v_pago_tipo text; v_pago_detalle text;
  v_n_cuotas int := coalesce(jsonb_array_length(payload->'cuotas'), 0);
  v_bonos  text[];
  v_meses  int := nullif(payload->>'meses_duracion','')::int;
  v_meses_tier int;
  c jsonb; i int := 0;
begin
  if v_tipo not in ('nueva','ascension','extension') then
    raise exception 'tipo_venta inválido: %', coalesce(v_tipo,'(null)');
  end if;
  if v_pago_monto is null or v_pago_monto <= 0 then
    raise exception 'el importe del cobro de hoy debe ser mayor que 0';
  end if;
  if v_n_cuotas > 24 then
    raise exception 'máximo 24 cuotas';
  end if;
  if not exists (select 1 from tiers where id = payload->>'tier') then
    raise exception 'tier inexistente: %', payload->>'tier';
  end if;

  -- Bonos: sanear contra el catálogo -------------------------------------------
  v_bonos := array(
    select distinct b
    from jsonb_array_elements_text(coalesce(payload->'bonos','[]'::jsonb)) as b
    where b in ('consultoria_berni','consultoria_manuel','duracion_50','discord_portafolio')
       or b like 'libre:%'
  );

  -- La duración base sale del CATÁLOGO, jamás del payload. Es la diferencia
  -- entre que el bono funcione y que multiplique dos veces: el formulario ya
  -- manda los meses con el +50 % aplicado (9, 18), así que un ×1,5 sobre el
  -- payload daría 14 y 27. Aquí se recalcula desde cero sobre `meses_default`,
  -- que además hace la operación idempotente — repetirla da siempre lo mismo.
  select t.meses_default into v_meses_tier from tiers t where t.id = payload->>'tier';
  if v_meses_tier is null then
    -- Un programa sin duración (OG vitalicio) no tiene nada que alargar.
    v_bonos := array_remove(v_bonos, 'duracion_50');
  elsif 'duracion_50' = any(v_bonos) then
    v_meses := public.meses_con_bono_duracion(v_meses_tier);
  end if;

  -- Persona: reutilizar/crear (compra nueva) o validar (ascensión/extensión)
  if v_tipo = 'nueva' then
    if v_nombre = '' then
      raise exception 'nombre del cliente requerido';
    end if;

    if v_telefono is not null then
      -- Dedupe por teléfono (llave natural: personas.telefono_e164 es UNIQUE)
      select id, estado into v_persona_id, v_estado_prev
        from personas where telefono_e164 = v_telefono limit 1;
      if v_persona_id is not null then
        v_reutilizada := true;
        if v_estado_prev in ('lead','reservado','ex_cliente') then
          update personas set estado = 'cliente' where id = v_persona_id;
        end if;
      end if;
    else
      -- Sin teléfono no hay llave natural: guard anti doble-submit por nombre
      if exists (
        select 1 from personas
        where lower(trim(coalesce(nombre,''))) = lower(v_nombre)
          and created_at > now() - interval '2 minutes'
      ) then
        raise exception 'cliente idéntico creado hace menos de 2 minutos — posible doble envío';
      end if;
    end if;

    if v_persona_id is null then
      insert into personas (estado, nombre, telefono_e164, email, pais, divisa_preferida)
      values ('cliente', v_nombre, v_telefono,
              nullif(payload->>'email',''), nullif(payload->>'pais',''), 'EUR')
      returning id into v_persona_id;
    end if;
  else
    v_persona_id := (payload->>'persona_id')::uuid;
    if v_persona_id is null then raise exception 'persona_id requerido'; end if;
    if v_prev is null then raise exception 'programa_previo_id requerido en ascensión/extensión'; end if;
    if not exists (select 1 from programas where id = v_prev and persona_id = v_persona_id) then
      raise exception 'el programa de origen no pertenece al cliente';
    end if;
  end if;

  -- Anti doble-submit: pago idéntico (persona+importe+fecha) creado hace <2 min.
  if exists (
    select 1 from pagos
    where persona_id = v_persona_id and monto = v_pago_monto and fecha = v_pago_fecha
      and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'pago duplicado: mismo cliente, importe y fecha hace menos de 2 minutos';
  end if;

  -- Mapping por tipo (spec §3)
  if v_tipo = 'nueva' then
    v_motivo := 'nueva_venta'; v_modo := null; v_pago_tipo := 'nueva';
    v_pago_detalle := case when v_n_cuotas > 0 then 'Cuota 1' else 'Pago único' end;
  elsif v_tipo = 'ascension' then
    v_motivo := 'upsell'; v_modo := 'suma'; v_pago_tipo := 'upsell'; v_pago_detalle := 'Upsell';
  else
    v_motivo := 'renovacion'; v_modo := 'reemplaza'; v_pago_tipo := 'nueva'; v_pago_detalle := 'Renovación';
  end if;

  insert into programas (persona_id, tier, motivo, modo_transicion, programa_previo_id,
                         fecha_inicio, meses_duracion, monto, divisa, origen, necesita_revision,
                         bonos)
  values (v_persona_id, payload->>'tier', v_motivo, v_modo, v_prev,
          (payload->>'fecha_inicio')::date, v_meses,
          (payload->>'valor_total')::numeric, 'EUR', 'form_os', false,
          v_bonos)
  returning id into v_programa_id;

  insert into pagos (persona_id, tipo, tipo_detalle, monto, divisa, usd_recibido, fecha,
                     metodo_pago, comprobante_path)
  values (v_persona_id, v_pago_tipo, v_pago_detalle, v_pago_monto, 'EUR',
          nullif(payload->>'usd_recibido','')::numeric, v_pago_fecha,
          nullif(payload->>'metodo_pago',''), nullif(payload->>'comprobante_path',''))
  returning id into v_pago_id;

  -- Cuotas: el cobro de hoy es la "Cuota 1"; las programadas arrancan en 2
  for c in select * from jsonb_array_elements(coalesce(payload->'cuotas','[]'::jsonb)) loop
    i := i + 1;
    if (c->>'monto')::numeric <= 0 then raise exception 'cuota % con importe <= 0', i; end if;
    if (c->>'fecha')::date < current_date then raise exception 'cuota % con fecha pasada (%)', i, c->>'fecha'; end if;
    insert into cuotas_programadas (programa_id, numero_cuota, fecha_vencimiento, monto, divisa, estado, fecha_inferida)
    values (v_programa_id, i + 1, (c->>'fecha')::date, (c->>'monto')::numeric, 'EUR', 'pendiente', false);
  end loop;

  return jsonb_build_object('persona_id', v_persona_id, 'programa_id', v_programa_id,
                            'pago_id', v_pago_id, 'n_cuotas', v_n_cuotas,
                            'persona_reutilizada', v_reutilizada,
                            'bonos', to_jsonb(v_bonos));
end;
$$;


--
-- Name: descongelar_cupo_al_nuevo_programa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.descongelar_cupo_al_nuevo_programa() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.personas
     set consultorias_ajuste = null,
         consultorias_ajuste_motivo = null
   where id = new.persona_id
     and consultorias_ajuste is not null;
  return new;
end;
$$;


--
-- Name: deshacer_devolucion(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deshacer_devolucion(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: deshacer_pago_cuota(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deshacer_pago_cuota(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_pago   public.pagos%rowtype;
  v_cuota  public.cuotas_programadas%rowtype;
  v_autor  uuid := nullif(payload->>'autor_id','')::uuid;
  v_nuevo  numeric(12,2);
begin
  select * into v_pago from public.pagos where id = (payload->>'pago_id')::uuid for update;
  if not found then raise exception 'El pago no existe'; end if;
  if v_pago.tipo <> 'cuota' or v_pago.cuota_id is null then
    raise exception 'Ese pago no corresponde a una cuota';
  end if;

  select * into v_cuota from public.cuotas_programadas
    where id = v_pago.cuota_id for update;
  if not found then raise exception 'La cuota del pago no existe'; end if;

  -- Al cerrarse ('pagada'), la suma de los pagos activos de la cuota es
  -- exactamente el importe original (S = orig). Deshacer un pago P debe
  -- dejar pendiente orig - (S - P) = P — el importe de ESE pago concreto,
  -- sea el de cierre o uno anterior — y NO el `monto` actual de la cuota,
  -- que solo coincide con P cuando el pago deshecho es el que cerró la
  -- cuota. Si en cambio la cuota sigue 'pendiente', su `monto` ya es el
  -- saldo restante y basta sumarle el importe del pago que se deshace.
  v_nuevo := case when v_cuota.estado = 'pagada' then v_pago.monto
                  else v_cuota.monto + v_pago.monto end;

  delete from public.pagos where id = v_pago.id;
  update public.cuotas_programadas
     set estado = 'pendiente', monto = v_nuevo
   where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'deshacer_pago', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('monto', v_cuota.monto, 'estado', v_cuota.estado),
            'despues', jsonb_build_object('monto', v_nuevo, 'estado', 'pendiente'),
            'pago_revertido', jsonb_build_object('id', v_pago.id, 'importe', v_pago.monto,
                                                 'fecha', v_pago.fecha)));

  return jsonb_build_object('cuota_id', v_cuota.id, 'monto', v_nuevo, 'estado', 'pendiente');
end;
$$;


--
-- Name: editar_bonos(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.editar_bonos(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_programa_id uuid := (payload->>'programa_id')::uuid;
  v_autor       uuid := nullif(payload->>'autor_id','')::uuid;
  v_tier        text;
  v_antes       text[];
  v_meses_antes int;
  v_bonos       text[];
  v_meses       int;
  v_meses_tier  int;
begin
  if v_programa_id is null then
    raise exception 'programa_id requerido';
  end if;

  -- `for update`: dos personas corrigiendo la misma venta a la vez no se
  -- pisan a medias. Mismo criterio que editar_persona (0039).
  select tier, coalesce(bonos,'{}'), meses_duracion
    into v_tier, v_antes, v_meses_antes
  from programas where id = v_programa_id for update;

  if v_tier is null then
    raise exception 'ese programa no existe';
  end if;

  -- Mismo saneado que crear_venta: catálogo primero.
  v_bonos := array(
    select distinct b
    from jsonb_array_elements_text(coalesce(payload->'bonos','[]'::jsonb)) as b
    where b in ('consultoria_berni','consultoria_manuel','duracion_50','discord_portafolio')
       or b like 'libre:%'
  );

  select meses_default into v_meses_tier from tiers where id = v_tier;
  if v_meses_tier is null then
    v_bonos := array_remove(v_bonos, 'duracion_50');
  end if;

  -- La duración sigue al bono en los dos sentidos: ponerlo la sube un 50 %
  -- (6 → 9, 12 → 18), quitarlo la devuelve al default del tier. Los dos lados
  -- se calculan desde `tiers.meses_default` y NO desde la duración vigente:
  -- así corregir los bonos dos veces seguidas da el mismo número, en vez de
  -- componer 12 → 18 → 27. Si el bono no está en juego, no se toca lo que
  -- hubiera (puede ser una duración escrita a mano).
  v_meses := v_meses_antes;
  if 'duracion_50' = any(v_bonos) then
    v_meses := public.meses_con_bono_duracion(v_meses_tier);
  elsif 'duracion_50' = any(v_antes) then
    v_meses := v_meses_tier;
  end if;

  -- Los bonos escritos a mano SE CONSERVAN, vengan o no en el payload.
  --
  -- Sin esto la lista blanca de arriba no sirve de nada aquí: ninguna pantalla
  -- del OS sabe que existe un `libre:` —`BonosCliente` arma su array con
  -- `normalizarBonos`, que los quita—, así que el payload llega SIN ellos y el
  -- `set` de abajo los borraría igual. Ensanchar la puerta no evita el borrado:
  -- el que borra es el `set` con un array al que le falta el dato.
  --
  -- Va en el servidor y no en la pantalla a propósito: arregla a todos los
  -- llamadores de una vez en lugar de obligar a cada uno a arrastrar un campo
  -- que no muestra.
  --
  -- Lo que se resigna: desde esa pantalla no se puede QUITAR un bono libre.
  -- Es el lado correcto en el que equivocarse — hoy la alternativa es perderlo
  -- sin querer, y quitarlo no lo ha pedido nadie.
  v_bonos := v_bonos || array(select b from unnest(v_antes) as b where b like 'libre:%');

  update programas
     set bonos = v_bonos, meses_duracion = v_meses
   where id = v_programa_id;

  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('programa', v_programa_id, 'editar_bonos', v_autor,
          jsonb_build_object(
            'antes',  jsonb_build_object('bonos', to_jsonb(v_antes), 'meses_duracion', v_meses_antes),
            'despues', jsonb_build_object('bonos', to_jsonb(v_bonos), 'meses_duracion', v_meses)));

  return jsonb_build_object('programa_id', v_programa_id,
                            'bonos', to_jsonb(v_bonos),
                            'meses_duracion', v_meses);
end;
$$;


--
-- Name: editar_cuota(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.editar_cuota(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cuota   public.cuotas_programadas%rowtype;
  v_monto   numeric(12,2) := round(nullif(payload->>'monto','')::numeric, 2);
  v_fecha   date          := nullif(payload->>'fecha_vencimiento','')::date;
  v_autor   uuid          := nullif(payload->>'autor_id','')::uuid;
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;
  if v_cuota.estado <> 'pendiente' then
    raise exception 'No se puede editar una cuota ya pagada — deshaz el pago primero';
  end if;
  if v_monto is not null and v_monto <= 0 then
    raise exception 'El importe debe ser mayor que 0';
  end if;
  if v_monto is null and v_fecha is null then
    raise exception 'No hay nada que cambiar';
  end if;

  update public.cuotas_programadas
     set monto = coalesce(v_monto, monto),
         fecha_vencimiento = coalesce(v_fecha, fecha_vencimiento),
         -- si el operador fija la fecha a mano, deja de ser inferida
         fecha_inferida = case when v_fecha is not null then false else fecha_inferida end
   where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'edicion', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('monto', v_cuota.monto,
                                          'fecha_vencimiento', v_cuota.fecha_vencimiento),
            'despues', jsonb_build_object('monto', coalesce(v_monto, v_cuota.monto),
                                          'fecha_vencimiento', coalesce(v_fecha, v_cuota.fecha_vencimiento))));

  return jsonb_build_object('cuota_id', v_cuota.id,
                            'monto', coalesce(v_monto, v_cuota.monto),
                            'fecha_vencimiento', coalesce(v_fecha, v_cuota.fecha_vencimiento));
end;
$$;


--
-- Name: editar_estrategia(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.editar_estrategia(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id    uuid := nullif(payload->>'id','')::uuid;
  v_autor uuid := nullif(payload->>'autor_id','')::uuid;
  v_ant   public.estrategias%rowtype;
begin
  select * into v_ant from public.estrategias where id = v_id for update;
  if not found then raise exception 'Esa estrategia no existe'; end if;

  update public.estrategias set
    titulo            = coalesce(nullif(btrim(payload->>'titulo'), ''), titulo),
    url               = coalesce(nullif(btrim(payload->>'url'), ''), url),
    -- password y resumen SÍ se pueden vaciar: mandar "" los borra. Por eso
    -- miran a la clave del jsonb y no a coalesce, que nunca dejaría borrar.
    password          = case when payload ? 'password' then nullif(btrim(payload->>'password'), '') else password end,
    resumen           = case when payload ? 'resumen'  then nullif(btrim(payload->>'resumen'),  '') else resumen  end,
    fecha_lanzamiento = coalesce(nullif(payload->>'fecha_lanzamiento','')::date, fecha_lanzamiento)
  where id = v_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('estrategia', v_id, 'editar', v_autor,
          jsonb_build_object('antes', jsonb_build_object(
            'titulo', v_ant.titulo, 'url', v_ant.url, 'resumen', v_ant.resumen,
            'fecha_lanzamiento', v_ant.fecha_lanzamiento), 'cambios', payload - 'autor_id'));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;


--
-- Name: editar_persona(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.editar_persona(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_p        public.personas%rowtype;
  v_nombre   text := nullif(payload->>'nombre','');
  v_tel      text := nullif(payload->>'telefono_e164','');
  v_email    text := nullif(payload->>'email','');
  v_pais     text := nullif(payload->>'pais','');
  v_coach    uuid := nullif(payload->>'coach_id','')::uuid;
  v_estado   text := nullif(payload->>'estado','');
  v_autor    uuid := nullif(payload->>'autor_id','')::uuid;
  v_digitos  text;
  v_choque   text;
  v_adoptada uuid;
begin
  select * into v_p from public.personas
    where id = (payload->>'persona_id')::uuid for update;
  if not found then raise exception 'La persona no existe'; end if;

  if v_nombre is null and v_tel is null and v_email is null
     and v_pais is null and v_coach is null and v_estado is null then
    raise exception 'No hay nada que cambiar';
  end if;

  if v_estado is not null
     and v_estado not in ('lead','reservado','cliente','ex_cliente','archivado') then
    raise exception 'Estado no válido: %', v_estado;
  end if;

  -- El coach tiene que existir. Sin esto un id copiado a mano deja la ficha
  -- apuntando al vacío y el cliente sale "sin coach" sin que nadie lo note.
  if v_coach is not null
     and not exists (select 1 from public.team_members where id = v_coach) then
    raise exception 'El consultor indicado no existe';
  end if;

  if v_tel is not null then
    -- El teléfono llega ya canónico desde la server action (aE164): "+" y
    -- dígitos. Se revalida aquí porque el RPC es la última puerta antes del
    -- dato, y este campo es la llave de cruce de medio sistema.
    if v_tel !~ '^\+[0-9]{8,}$' then
      raise exception 'El teléfono debe ser internacional: + y al menos 8 dígitos';
    end if;
    v_digitos := regexp_replace(v_tel, '\D', '', 'g');

    -- Choque con otra persona. Robar el número en silencio significaría que
    -- el hilo de WhatsApp de una cliente empieza a caer en la ficha de otra.
    select nombre into v_choque from public.personas
     where id <> v_p.id
       and regexp_replace(coalesce(telefono_e164,''), '\D', '', 'g') = v_digitos
     limit 1;
    if v_choque is not null then
      raise exception 'Ese número ya es de %', v_choque;
    end if;
  end if;

  update public.personas
     set nombre        = coalesce(v_nombre, nombre),
         telefono_e164 = coalesce(v_tel,    telefono_e164),
         email         = coalesce(v_email,  email),
         pais          = coalesce(v_pais,   pais),
         coach_id      = coalesce(v_coach,  coach_id),
         estado        = coalesce(v_estado, estado)
   where id = v_p.id;

  -- Adopción del hilo huérfano. El caso que lo motiva es literalmente el de
  -- un cliente: le pones el número, le escribes, contesta — y sin esto la
  -- conversación queda suelta en vez de caer en su ficha.
  --
  -- OJO al formato: `wa_conversaciones.telefono_e164` guarda SOLO DÍGITOS
  -- desde la migración 0020, mientras `personas.telefono_e164` guarda E.164
  -- con "+". Cruzarlos por igualdad directa no encuentra nunca nada.
  --
  -- Solo hilos SIN persona: uno que ya pertenece a otra ficha no se toca.
  if v_tel is not null then
    update public.wa_conversaciones
       set persona_id = v_p.id
     where persona_id is null
       and regexp_replace(coalesce(telefono_e164,''), '\D', '', 'g') = v_digitos
    returning id into v_adoptada;
  end if;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', v_p.id,
          case when v_estado = 'archivado' and v_p.estado <> 'archivado'
               then 'archivado' else 'edicion' end,
          v_autor,
          jsonb_build_object(
            'antes', jsonb_build_object(
              'nombre', v_p.nombre, 'telefono_e164', v_p.telefono_e164,
              'email', v_p.email, 'pais', v_p.pais,
              'coach_id', v_p.coach_id, 'estado', v_p.estado),
            'despues', jsonb_build_object(
              'nombre', coalesce(v_nombre, v_p.nombre),
              'telefono_e164', coalesce(v_tel, v_p.telefono_e164),
              'email', coalesce(v_email, v_p.email),
              'pais', coalesce(v_pais, v_p.pais),
              'coach_id', coalesce(v_coach, v_p.coach_id),
              'estado', coalesce(v_estado, v_p.estado)),
            'conversacion_adoptada', v_adoptada));

  return jsonb_build_object(
    'persona_id', v_p.id,
    'conversacion_adoptada', v_adoptada);
end;
$_$;


--
-- Name: editar_sesion(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.editar_sesion(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: fathom_sesion_que_cubre(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fathom_sesion_que_cubre(p_persona_id uuid, p_inicio timestamp with time zone) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select s.id
    from public.sesiones s
   where p_persona_id is not null
     and p_inicio is not null
     and s.persona_id = p_persona_id
     and (s.fecha at time zone 'Europe/Madrid')::date
       = (p_inicio  at time zone 'Europe/Madrid')::date
   -- Si hubiera dos el mismo día, gana la que ya está registrada: es la que
   -- hace que convertir sea claramente redundante.
   order by (s.estado_asistencia is null), s.fecha
   limit 1;
$$;


--
-- Name: FUNCTION fathom_sesion_que_cubre(p_persona_id uuid, p_inicio timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fathom_sesion_que_cubre(p_persona_id uuid, p_inicio timestamp with time zone) IS 'La sesión que ya cubre una llamada de Fathom (mismo cliente, mismo día natural en Europe/Madrid), o null. Cruza por DÍA y no por ventana de horas porque 28 de 172 sesiones tienen la fecha sin hora (00:00 UTC).';


--
-- Name: meses_con_bono_duracion(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.meses_con_bono_duracion(meses_base integer) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
           when meses_base is null then null
           when meses_base <= 0    then meses_base
           else ceil(meses_base * 1.5)::int
         end;
$$;


--
-- Name: FUNCTION meses_con_bono_duracion(meses_base integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.meses_con_bono_duracion(meses_base integer) IS 'Duración con el bono de +50 % del evento 26/08 (6→9, 12→18). Gemela de mesesConBonoDuracion() en apps/inbox/lib/bonos.ts.';


--
-- Name: pagar_cuota(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pagar_cuota(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cuota      public.cuotas_programadas%rowtype;
  v_persona_id uuid;
  v_importe    numeric(12,2) := round((payload->>'importe')::numeric, 2);
  v_fecha      date          := (payload->>'fecha')::date;
  v_autor      uuid          := nullif(payload->>'autor_id','')::uuid;
  v_metodo     text          := nullif(payload->>'metodo_pago','');
  v_comprob    text          := nullif(payload->>'comprobante_path','');
  v_pago_id    uuid;
  v_parcial    boolean;
  v_saldo      numeric(12,2);
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;
  if v_cuota.estado <> 'pendiente' then
    raise exception 'Esa cuota ya está %', v_cuota.estado;
  end if;
  if v_importe is null or v_importe <= 0 then
    raise exception 'El importe debe ser mayor que 0';
  end if;
  if v_importe > v_cuota.monto then
    raise exception 'El importe (%) supera lo pendiente de la cuota (%)', v_importe, v_cuota.monto;
  end if;
  if v_fecha is null then raise exception 'La fecha del pago es obligatoria'; end if;
  if v_fecha > current_date then raise exception 'La fecha del pago no puede ser futura'; end if;

  select persona_id into v_persona_id from public.programas where id = v_cuota.programa_id;
  if v_persona_id is null then raise exception 'La cuota no tiene programa asociado'; end if;

  -- Anti doble-submit acotado a ESTA cuota: protege del doble clic sin bloquear
  -- que un cliente pague dos cuotas distintas del mismo importe el mismo día
  -- (caso legítimo que sí bloquearía el guard por persona+importe+fecha de crear_venta).
  if exists (
    select 1 from public.pagos
     where cuota_id = v_cuota.id and monto = v_importe
       and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'pago duplicado: ya se registró ese importe para esta cuota hace menos de 2 minutos';
  end if;

  v_parcial := v_importe < v_cuota.monto;
  v_saldo   := v_cuota.monto - v_importe;

  insert into public.pagos (persona_id, cuota_id, tipo, tipo_detalle, monto, divisa,
                            usd_recibido, fecha, metodo_pago, comprobante_path)
  values (v_persona_id, v_cuota.id, 'cuota',
          case when v_parcial then 'Abono cuota ' || v_cuota.numero_cuota
               else 'Cuota ' || v_cuota.numero_cuota end,
          v_importe, v_cuota.divisa, nullif(payload->>'usd_recibido','')::numeric,
          v_fecha, v_metodo, v_comprob)
  returning id into v_pago_id;

  if v_parcial then
    update public.cuotas_programadas set monto = v_saldo where id = v_cuota.id;
  else
    update public.cuotas_programadas set estado = 'pagada' where id = v_cuota.id;
  end if;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id,
          case when v_parcial then 'pago_parcial' else 'pago' end, v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('monto', v_cuota.monto, 'estado', v_cuota.estado),
            'despues', jsonb_build_object('monto', case when v_parcial then v_saldo else v_cuota.monto end,
                                          'estado', case when v_parcial then 'pendiente' else 'pagada' end),
            'pago_id', v_pago_id, 'importe', v_importe, 'metodo_pago', v_metodo));

  return jsonb_build_object('cuota_id', v_cuota.id, 'pago_id', v_pago_id,
                            'parcial', v_parcial, 'saldo', v_saldo,
                            'estado', case when v_parcial then 'pendiente' else 'pagada' end);
end;
$$;


--
-- Name: reactivar_cuota(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reactivar_cuota(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cuota public.cuotas_programadas%rowtype;
  v_autor uuid := nullif(payload->>'autor_id','')::uuid;
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;
  if v_cuota.estado <> 'anulada' then
    raise exception 'Esta cuota no está anulada';
  end if;

  -- Vuelve a 'pendiente', no al estado que tuviera antes: 'vencida' se
  -- deduce hoy de la fecha (ver clasificarCuota en lib/cuotas.ts), así que
  -- reponer un 'vencida' guardado sería resucitar un dato calculado y
  -- posiblemente ya falso.
  update public.cuotas_programadas set estado = 'pendiente' where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'reactivada', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('estado', 'anulada'),
            'despues', jsonb_build_object('estado', 'pendiente')));

  return jsonb_build_object('cuota_id', v_cuota.id, 'estado', 'pendiente');
end;
$$;


--
-- Name: registrar_devolucion(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_devolucion(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: registrar_sesion(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.registrar_sesion(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  if v_coach is null then raise exception 'Falta el consultor'; end if;
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


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: rotar_acceso_portal(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rotar_acceso_portal(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_persona uuid := nullif(payload->>'persona_id','')::uuid;
  v_autor   uuid := nullif(payload->>'autor_id','')::uuid;
  v_token   text := nullif(btrim(payload->>'token_nuevo'), '');
  v_antiguo text;
begin
  if v_persona is null then raise exception 'Falta el cliente'; end if;
  -- El token lo genera Node (randomBytes(24)), no Postgres, para no depender
  -- de que pgcrypto esté instalado. Mismo criterio que `crear_estrategia`.
  if v_token is null then raise exception 'Falta el token nuevo'; end if;

  select token into v_antiguo from public.portal_accesos
    where persona_id = v_persona for update;

  if not found then
    -- Un cliente sin llave todavía: dársela ahora es lo correcto, no un error.
    -- Pasa con quien tiene estrategias importadas pero nunca se le mandó nada.
    insert into public.portal_accesos (persona_id, token, creado_por)
    values (v_persona, v_token, v_autor);
  else
    update public.portal_accesos
       set token = v_token,
           creado_por = coalesce(v_autor, creado_por),
           created_at = now(),
           -- Se limpia la marca de acceso: es de la llave anterior y dejarla
           -- haría creer que el cliente ya entró con la nueva.
           ultimo_acceso_at = null,
           revocado_at = null
     where persona_id = v_persona;
  end if;

  -- El token viejo NO se guarda en la traza: es una credencial, y la auditoría
  -- la leen más ojos que la tabla. Basta con saber que se rotó y quién.
  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('portal_acceso', v_persona,
          case when v_antiguo is null then 'crear_enlace' else 'rotar_enlace' end,
          v_autor, jsonb_build_object('tenia_enlace', v_antiguo is not null));

  return jsonb_build_object('ok', true, 'token', v_token,
                            'era_nuevo', v_antiguo is null);
end;
$$;


--
-- Name: sesion_guardar_operaciones(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sesion_guardar_operaciones(p_sesion_id uuid, p_ops jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: sesion_operaciones_json(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sesion_operaciones_json(p_sesion_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(to_jsonb(o) order by o.orden), '[]'::jsonb)
    from public.sesion_operaciones o
   where o.sesion_id = p_sesion_id;
$$;


--
-- Name: visibilidad_estrategia(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.visibilidad_estrategia(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id      uuid    := nullif(payload->>'id','')::uuid;
  v_autor   uuid    := nullif(payload->>'autor_id','')::uuid;
  v_visible boolean := (payload->>'visible')::boolean;
begin
  if v_visible is null then raise exception 'Falta decir si se muestra o se oculta'; end if;
  update public.estrategias set visible = v_visible where id = v_id;
  if not found then raise exception 'Esa estrategia no existe'; end if;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('estrategia', v_id, case when v_visible then 'mostrar' else 'ocultar' end,
          v_autor, jsonb_build_object('visible', v_visible));

  return jsonb_build_object('ok', true, 'id', v_id, 'visible', v_visible);
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ajustes_os; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ajustes_os (
    clave text NOT NULL,
    valor text,
    actualizado_at timestamp with time zone DEFAULT now() NOT NULL,
    autor_id uuid
);


--
-- Name: TABLE ajustes_os; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ajustes_os IS 'Ajustes del OS que se cambian desde la pantalla, sin desplegar. Una fila por ajuste.';


--
-- Name: auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entidad text NOT NULL,
    entidad_id uuid NOT NULL,
    accion text NOT NULL,
    autor_id uuid,
    datos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contrato_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contrato_eventos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contrato_id uuid NOT NULL,
    tipo text NOT NULL,
    ocurrido_at timestamp with time zone DEFAULT now() NOT NULL,
    ip inet,
    user_agent text,
    geo text,
    datos jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT contrato_eventos_tipo_check CHECK ((tipo = ANY (ARRAY['enviado'::text, 'abierto'::text, 'firmado'::text, 'rechazado'::text, 'enlace_rotado'::text])))
);


--
-- Name: contratos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    programa_id uuid,
    fecha_firma date,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    url_documento text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pdf_path text,
    tipo text,
    recorregido_at timestamp with time zone,
    desactualizado_at timestamp with time zone,
    token text,
    token_expira_at timestamp with time zone,
    enviado_cliente_at timestamp with time zone,
    visto_at timestamp with time zone,
    firmado_at timestamp with time zone,
    firma_nombre text,
    firma_ip inet,
    firma_user_agent text,
    firma_geo text,
    hash_enviado text,
    hash_firmado text,
    pdf_firmado_path text,
    consentimiento text,
    consentimiento_v smallint,
    texto_generado text,
    texto_final text,
    texto_editado_por uuid,
    texto_editado_at timestamp with time zone,
    datos_bloque jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT contratos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'enviado'::text, 'error_envio'::text, 'enviado_cliente'::text, 'firmado'::text]))),
    CONSTRAINT contratos_tipo_check CHECK (((tipo IS NULL) OR (tipo = ANY (ARRAY['venta_nueva'::text, 'ampliacion'::text, 'venta_nueva_v2'::text]))))
);


--
-- Name: COLUMN contratos.estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos.estado IS 'pendiente = generado, sin mandar · enviado = al equipo (Resend aceptó) · error_envio = no salió a nadie · enviado_cliente = el enlace de firma salió al cliente · firmado = el cliente firmó (firmado_at, firma_nombre, hash_firmado).';


--
-- Name: COLUMN contratos.recorregido_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos.recorregido_at IS 'NULL = el PDF enviado es el original. Con fecha = se regeneró al menos una vez porque cambió un dato del contrato (bonos, duración) después del envío inicial — /contratos lo marca con la cinta dorada "Recorregido".';


--
-- Name: COLUMN contratos.desactualizado_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos.desactualizado_at IS 'NULL = el PDF que tiene el equipo sigue coincidiendo con la venta. Con fecha = se cambiaron los bonos después de emitirlo y hay que regenerarlo. La escribe editarBonos(); recorregirContrato() la vuelve a NULL al regenerar. Si está puesta, /contratos dibuja la cinta roja en vez de la dorada.';


--
-- Name: cuotas_programadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuotas_programadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programa_id uuid NOT NULL,
    numero_cuota integer NOT NULL,
    fecha_vencimiento date NOT NULL,
    monto numeric(12,2) NOT NULL,
    divisa text DEFAULT 'EUR'::text NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fecha_inferida boolean DEFAULT false NOT NULL,
    CONSTRAINT cuotas_programadas_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'pagada'::text, 'vencida'::text, 'anulada'::text])))
);


--
-- Name: emails_enviados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emails_enviados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid,
    sesion_id uuid,
    tipo text NOT NULL,
    destinatario text NOT NULL,
    idempotency_key text NOT NULL,
    resend_id text,
    estado text DEFAULT 'enviado'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_at timestamp with time zone,
    CONSTRAINT emails_enviados_estado_check CHECK ((estado = ANY (ARRAY['enviado'::text, 'entregado'::text, 'rebotado'::text, 'quejado'::text, 'rechazado'::text, 'sin_confirmar'::text]))),
    CONSTRAINT emails_enviados_tipo_check CHECK ((tipo = ANY (ARRAY['estrategia'::text, 'confirmacion_sesion'::text, 'recordatorio_1h'::text, 'invitacion_calendario'::text, 'aviso_venta_equipo'::text, 'contrato'::text, 'contrato_cliente'::text])))
);


--
-- Name: COLUMN emails_enviados.estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.emails_enviados.estado IS 'enviado = Resend lo aceptó, NO es una entrega. Solo last_event lo mueve a un estado final.';


--
-- Name: estrategias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estrategias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    titulo text NOT NULL,
    url text NOT NULL,
    password text,
    resumen text,
    fecha_lanzamiento date DEFAULT CURRENT_DATE NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    creado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fathom_llamadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fathom_llamadas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recording_id bigint NOT NULL,
    titulo text,
    url text,
    share_url text,
    grabado_por_email text,
    grabado_por_nombre text,
    grabado_por_equipo text,
    inicio timestamp with time zone,
    fin timestamp with time zone,
    duracion_min integer,
    tipo text DEFAULT 'interna'::text NOT NULL,
    persona_id uuid,
    emparejado_por text,
    invitados_externos jsonb DEFAULT '[]'::jsonb NOT NULL,
    resumen_md text,
    acciones jsonb DEFAULT '[]'::jsonb NOT NULL,
    idioma text,
    sesion_id uuid,
    descartada_at timestamp with time zone,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    actualizado_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fathom_llamadas_emparejado_por_check CHECK ((emparejado_por = ANY (ARRAY['correo'::text, 'titulo'::text, 'manual'::text]))),
    CONSTRAINT fathom_llamadas_tipo_check CHECK ((tipo = ANY (ARRAY['venta'::text, 'servicio'::text, 'interna'::text])))
);


--
-- Name: TABLE fathom_llamadas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fathom_llamadas IS 'Bandeja de llamadas grabadas en Fathom. La ingesta escribe aquí y NUNCA en `sesiones`: convertir una llamada en sesión es un paso con una persona delante, porque `sesiones` mueve cupo de consultorías y comisiones.';


--
-- Name: COLUMN fathom_llamadas.recording_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fathom_llamadas.recording_id IS 'Id de la grabación en Fathom. UNIQUE — es la clave del upsert que hace idempotente la ingesta.';


--
-- Name: COLUMN fathom_llamadas.tipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fathom_llamadas.tipo IS 'Derivado de team_members.rol de quien grabó: closer/setter -> venta, coach -> servicio. "interna" gana sobre las dos cuando no hubo ningún invitado externo.';


--
-- Name: COLUMN fathom_llamadas.emparejado_por; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fathom_llamadas.emparejado_por IS '"correo" = un invitado externo coincide con personas.email (fiable). "titulo" = el título contiene el nombre de un cliente (SUGERENCIA, confirmar a mano). "manual" = lo decidió una persona, y la ingesta no lo pisa.';


--
-- Name: fuentes_atribucion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fuentes_atribucion (
    source_id text NOT NULL,
    fuente text NOT NULL,
    setter_nombre text,
    setter_id uuid,
    nivel text NOT NULL,
    confirmado boolean DEFAULT false NOT NULL,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fuentes_atribucion_nivel_check CHECK ((nivel = ANY (ARRAY['setter'::text, 'canal'::text, 'contenido'::text, 'campana'::text])))
);


--
-- Name: TABLE fuentes_atribucion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fuentes_atribucion IS 'Traduce el Source_ID crudo de GHL a fuente canónica + setter. confirmado=false significa que la lectura es una interpretación pendiente de validar con Berni.';


--
-- Name: gastos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gastos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    concepto text NOT NULL,
    categoria text NOT NULL,
    monto numeric(12,2) NOT NULL,
    divisa text DEFAULT 'EUR'::text NOT NULL,
    fecha date NOT NULL,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tipo_gasto text,
    metodo_pago text,
    airtable_id text
);


--
-- Name: notificaciones_vistas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificaciones_vistas (
    team_member_id uuid NOT NULL,
    visto_hasta timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: onboarding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    accesos jsonb DEFAULT '{}'::jsonb NOT NULL,
    bienvenida_enviada boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pagos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    cuota_id uuid,
    tipo text NOT NULL,
    monto numeric(12,2) NOT NULL,
    divisa text DEFAULT 'EUR'::text NOT NULL,
    fx_rate numeric(12,6),
    fecha date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    usd_recibido numeric(12,2),
    tipo_detalle text,
    airtable_id text,
    comprobante_path text,
    metodo_pago text,
    programa_id uuid,
    revierte_pago_id uuid,
    devolucion_alcance text,
    devolucion_motivo text,
    CONSTRAINT pagos_devolucion_alcance_check CHECK ((((tipo = 'refund'::text) AND (devolucion_alcance IS NOT NULL) AND (devolucion_alcance = ANY (ARRAY['total'::text, 'parcial'::text, 'sin_clasificar'::text]))) OR ((tipo <> 'refund'::text) AND (devolucion_alcance IS NULL)))),
    CONSTRAINT pagos_devolucion_parcial_check CHECK (((devolucion_alcance IS DISTINCT FROM 'parcial'::text) OR (revierte_pago_id IS NOT NULL))),
    CONSTRAINT pagos_refund_usd_check CHECK (((tipo <> 'refund'::text) OR (COALESCE(usd_recibido, (0)::numeric) <= (0)::numeric))),
    CONSTRAINT pagos_tipo_check CHECK ((tipo = ANY (ARRAY['reserva'::text, 'cuota'::text, 'nueva'::text, 'upsell'::text, 'refund'::text])))
);


--
-- Name: COLUMN pagos.revierte_pago_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pagos.revierte_pago_id IS 'Qué cobro devuelve esta fila. Obligatorio en devoluciones parciales: sin él no se sabe qué comisión revertir.';


--
-- Name: COLUMN pagos.devolucion_alcance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pagos.devolucion_alcance IS 'total | parcial | sin_clasificar. Obligatorio en tipo=refund, prohibido en el resto.';


--
-- Name: COLUMN pagos.devolucion_motivo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pagos.devolucion_motivo IS 'Por qué se devolvió. Obligatorio al registrar o clasificar; null en las heredadas sin clasificar.';


--
-- Name: patrimonio_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patrimonio_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    valor_total numeric(18,2),
    divisa text DEFAULT 'USD'::text NOT NULL,
    fecha date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    estado text DEFAULT 'cliente'::text NOT NULL,
    nombre text,
    telefono_e164 text,
    email text,
    pais text,
    ghl_contact_id text,
    coach_id uuid,
    divisa_preferida text DEFAULT 'EUR'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    airtable_id text,
    consultorias_ajuste integer,
    consultorias_ajuste_motivo text,
    CONSTRAINT personas_consultorias_ajuste_motivo_check CHECK (((consultorias_ajuste IS NOT NULL) OR (consultorias_ajuste_motivo IS NULL))),
    CONSTRAINT personas_estado_check CHECK ((estado = ANY (ARRAY['lead'::text, 'reservado'::text, 'cliente'::text, 'ex_cliente'::text, 'archivado'::text])))
);


--
-- Name: COLUMN personas.consultorias_ajuste_motivo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.personas.consultorias_ajuste_motivo IS 'Por qué consultorias_ajuste tiene un valor. NULL = nadie lo tocó. El disparador trg_descongelar_cupo la borra junto con consultorias_ajuste al insertar un programa nuevo; el CHECK de la tabla impide que quede huérfana si alguien edita consultorias_ajuste a mano.';


--
-- Name: portal_accesos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_accesos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    token text NOT NULL,
    creado_por uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ultimo_acceso_at timestamp with time zone,
    revocado_at timestamp with time zone
);


--
-- Name: posiciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posiciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    activo text NOT NULL,
    cantidad numeric(24,8),
    precio_entrada numeric(18,2),
    fecha date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: programa_eventos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programa_eventos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    programa_id uuid NOT NULL,
    tipo text NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_fin date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programa_eventos_tipo_check CHECK ((tipo = 'freeze'::text))
);


--
-- Name: programas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid NOT NULL,
    tier text NOT NULL,
    motivo text NOT NULL,
    modo_transicion text,
    programa_previo_id uuid,
    fecha_inicio date NOT NULL,
    meses_duracion integer,
    monto numeric(12,2),
    divisa text DEFAULT 'EUR'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    necesita_revision boolean DEFAULT false NOT NULL,
    origen text,
    airtable_id text,
    source_id text,
    setter_id uuid,
    closer_id uuid,
    upsell_por_id uuid,
    ghl_appointment_id text,
    atribucion_at timestamp with time zone,
    bonos text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT programas_modo_transicion_check CHECK ((modo_transicion = ANY (ARRAY['suma'::text, 'reemplaza'::text]))),
    CONSTRAINT programas_motivo_check CHECK ((motivo = ANY (ARRAY['nueva_venta'::text, 'upsell'::text, 'renovacion'::text, 'downsell'::text, 'reactivacion'::text, 'cross_sell'::text])))
);


--
-- Name: COLUMN programas.bonos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.programas.bonos IS 'Bonos aplicados a esta venta. Claves en apps/inbox/lib/bonos.ts (evento 26/08: consultoria_berni, consultoria_manuel, duracion_50, discord_portafolio).';


--
-- Name: push_enviados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_enviados (
    mensaje_id uuid NOT NULL,
    team_member_id uuid NOT NULL,
    enviado_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: push_suscripciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_suscripciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_member_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    creada_at timestamp with time zone DEFAULT now() NOT NULL,
    ultimo_ok_at timestamp with time zone,
    fallos integer DEFAULT 0 NOT NULL
);


--
-- Name: sesion_operaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesion_operaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sesion_id uuid NOT NULL,
    orden integer DEFAULT 1 NOT NULL,
    direccion text NOT NULL,
    activo text,
    capital numeric(14,2),
    apalancamiento text,
    zona_entrada text,
    objetivo text,
    estado text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sesion_operaciones_direccion_check CHECK ((direccion = ANY (ARRAY['short'::text, 'long'::text, 'spot'::text, 'etfs'::text, 'esperar'::text]))),
    CONSTRAINT sesion_operaciones_estado_check CHECK ((estado = ANY (ARRAY['ejecutada'::text, 'ordenes_puestas'::text, 'planificada'::text])))
);


--
-- Name: sesiones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesiones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid,
    programa_id uuid,
    tipo text NOT NULL,
    coach_id uuid,
    fecha timestamp with time zone,
    notas text,
    url_grabacion text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ghl_appointment_id text,
    enlace text,
    estado text,
    estado_asistencia text,
    duracion_min integer,
    capital_total numeric(14,2),
    exchange text,
    proximo_paso text,
    recurrente_id uuid,
    CONSTRAINT sesiones_estado_asistencia_check CHECK ((estado_asistencia = ANY (ARRAY['asistio'::text, 'no_asistio'::text, 'reprogramada'::text]))),
    CONSTRAINT sesiones_tipo_check CHECK ((tipo = ANY (ARRAY['consultoria_1a1'::text, 'grupal'::text])))
);


--
-- Name: sesiones_recurrentes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesiones_recurrentes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dia_semana smallint NOT NULL,
    hora time without time zone,
    zona text DEFAULT 'Europe/Madrid'::text NOT NULL,
    coach_id uuid,
    enlace text,
    plantilla_nombre text DEFAULT 'recordatorio_1h_es'::text NOT NULL,
    audiencia text DEFAULT 'todos'::text NOT NULL,
    activa boolean DEFAULT false NOT NULL,
    duracion_min integer DEFAULT 60 NOT NULL,
    creada_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sesiones_recurrentes_dia_semana_check CHECK (((dia_semana >= 0) AND (dia_semana <= 6)))
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    rol text NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    username text,
    password_hash text,
    acceso_total boolean DEFAULT true NOT NULL,
    modulos text[],
    cobra_comision boolean DEFAULT true NOT NULL,
    push_alcance text DEFAULT 'ninguna'::text NOT NULL,
    email text,
    aviso_venta_alcance text DEFAULT 'todas'::text NOT NULL,
    CONSTRAINT team_members_aviso_venta_alcance_check CHECK ((aviso_venta_alcance = ANY (ARRAY['todas'::text, 'asignadas'::text]))),
    CONSTRAINT team_members_push_alcance_check CHECK ((push_alcance = ANY (ARRAY['todas'::text, 'asignadas'::text, 'ninguna'::text]))),
    CONSTRAINT team_members_rol_check CHECK ((rol = ANY (ARRAY['coach'::text, 'closer'::text, 'admin'::text, 'setter'::text])))
);


--
-- Name: COLUMN team_members.cobra_comision; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.team_members.cobra_comision IS 'Si esta persona devenga comisión. NO se deduce del rol: Berni y Manuel son ambos coach y solo Manuel cobra. Un false NO borra la línea del informe — la deja a tasa 0, para que la actividad comercial siga siendo visible.';


--
-- Name: COLUMN team_members.aviso_venta_alcance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.team_members.aviso_venta_alcance IS 'todas = se entera de todos los cierres · asignadas = solo de las ventas donde es el setter. No confundir con push_alcance, que es para el inbox.';


--
-- Name: tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tiers (
    id text NOT NULL,
    nombre text NOT NULL,
    meses_default integer,
    n_consultorias integer DEFAULT 0 NOT NULL,
    acceso_discord boolean DEFAULT false NOT NULL,
    acceso_comunidad boolean DEFAULT false NOT NULL,
    sesiones_directo boolean DEFAULT false NOT NULL,
    numero_berni boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    n_sesiones_berni integer DEFAULT 0 NOT NULL,
    acceso_vitalicio boolean DEFAULT true NOT NULL
);


--
-- Name: COLUMN tiers.n_sesiones_berni; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tiers.n_sesiones_berni IS 'Sesiones individuales 1 a 1 con Berni incluidas en el programa. La plantilla v2 del contrato lo imprime; el OS no lo aplica.';


--
-- Name: COLUMN tiers.acceso_vitalicio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tiers.acceso_vitalicio IS 'Si el acceso al contenido grabado es vitalicio. En false, la cláusula 1 del contrato promete el acceso durante los meses que dura el programa. Decidido el 16-sep-2026: el tier de 2.000 € no es vitalicio.';


--
-- Name: v_cash_collected; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_cash_collected WITH (security_invoker='true') AS
 SELECT (date_trunc('month'::text, (fecha)::timestamp with time zone))::date AS mes,
    divisa,
    sum(monto) AS cash_collected,
    count(*) AS n_pagos,
    sum(usd_recibido) AS cash_usd,
    count(*) FILTER (WHERE (usd_recibido IS NULL)) AS n_sin_usd
   FROM public.pagos
  GROUP BY ((date_trunc('month'::text, (fecha)::timestamp with time zone))::date), divisa
  ORDER BY ((date_trunc('month'::text, (fecha)::timestamp with time zone))::date), divisa;


--
-- Name: v_cash_to_be_collected; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_cash_to_be_collected WITH (security_invoker='true') AS
 SELECT divisa,
    sum(monto) AS cash_to_be_collected,
    count(*) AS n_cuotas
   FROM public.cuotas_programadas
  WHERE (estado = 'pendiente'::text)
  GROUP BY divisa;


--
-- Name: v_programa_activo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_programa_activo WITH (security_invoker='true') AS
 WITH fin AS (
         SELECT p.id,
            p.persona_id,
            p.tier,
            p.motivo,
            p.modo_transicion,
            p.programa_previo_id,
            p.fecha_inicio,
            p.meses_duracion,
            p.monto,
            p.divisa,
            p.created_at,
            p.necesita_revision,
            p.origen,
            p.airtable_id,
            (((p.fecha_inicio + make_interval(months => COALESCE(p.meses_duracion, 0))) + ((COALESCE(( SELECT sum((e.fecha_fin - e.fecha_inicio)) AS sum
                   FROM public.programa_eventos e
                  WHERE ((e.programa_id = p.id) AND (e.tipo = 'freeze'::text) AND (e.fecha_fin IS NOT NULL))), (0)::bigint))::double precision * '1 day'::interval)))::date AS fin_efectiva
           FROM public.programas p
        )
 SELECT DISTINCT ON (persona_id) persona_id,
    id AS programa_id,
    tier,
    motivo,
    fecha_inicio,
        CASE
            WHEN (meses_duracion IS NULL) THEN NULL::date
            ELSE fin_efectiva
        END AS fin_efectiva
   FROM fin
  WHERE ((meses_duracion IS NULL) OR (fin_efectiva >= CURRENT_DATE))
  ORDER BY persona_id, fecha_inicio DESC;


--
-- Name: v_consultorias_cliente; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_consultorias_cliente WITH (security_invoker='true') AS
 SELECT p.id AS persona_id,
    p.nombre AS cliente,
    pa.tier,
    t.n_consultorias AS incluidas_tier,
        CASE
            WHEN (pa.persona_id IS NULL) THEN NULL::integer
            ELSE (COALESCE(p.consultorias_ajuste, t.n_consultorias) + public.bonos_extra_consultorias(prog.bonos))
        END AS incluidas,
    (p.consultorias_ajuste IS NOT NULL) AS ajustado,
    count(s.id) FILTER (WHERE (s.estado_asistencia = 'asistio'::text)) AS hechas,
    count(s.id) FILTER (WHERE ((s.estado_asistencia IS NULL) AND (s.fecha < now()))) AS sin_registrar,
        CASE
            WHEN ((pa.persona_id IS NULL) OR (COALESCE(p.consultorias_ajuste, t.n_consultorias) IS NULL)) THEN NULL::bigint
            ELSE GREATEST((0)::bigint, ((COALESCE(p.consultorias_ajuste, t.n_consultorias) + public.bonos_extra_consultorias(prog.bonos)) - count(s.id) FILTER (WHERE (s.estado_asistencia = 'asistio'::text))))
        END AS pendientes,
    max(s.fecha) FILTER (WHERE (s.estado_asistencia = 'asistio'::text)) AS ultima,
    COALESCE(prog.bonos, '{}'::text[]) AS bonos,
    public.bonos_extra_consultorias(prog.bonos) AS extra_bonos,
    p.consultorias_ajuste_motivo AS ajuste_motivo
   FROM ((((public.personas p
     LEFT JOIN public.v_programa_activo pa ON ((pa.persona_id = p.id)))
     LEFT JOIN public.tiers t ON ((t.id = pa.tier)))
     LEFT JOIN public.programas prog ON ((prog.id = pa.programa_id)))
     LEFT JOIN public.sesiones s ON ((s.persona_id = p.id)))
  GROUP BY p.id, p.nombre, pa.persona_id, pa.tier, t.n_consultorias, p.consultorias_ajuste, p.consultorias_ajuste_motivo, prog.bonos;


--
-- Name: v_devoluciones; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_devoluciones WITH (security_invoker='true') AS
 SELECT p.id AS devolucion_id,
    p.fecha,
    p.monto,
    p.usd_recibido,
    p.devolucion_alcance AS alcance,
    p.devolucion_motivo AS motivo,
    p.revierte_pago_id,
    p.persona_id,
    pe.nombre AS persona_nombre,
    pe.estado AS persona_estado,
    p.programa_id,
    g.tier,
    g.monto AS programa_valor,
    ( SELECT count(*) AS count
           FROM public.auditoria a
          WHERE ((a.entidad = 'devolucion'::text) AND (a.entidad_id = p.id))) AS n_efectos,
    ( SELECT a.autor_id
           FROM public.auditoria a
          WHERE ((a.entidad = 'devolucion'::text) AND (a.entidad_id = p.id) AND (a.accion = 'devolucion_registrada'::text))
         LIMIT 1) AS autor_id
   FROM ((public.pagos p
     LEFT JOIN public.personas pe ON ((pe.id = p.persona_id)))
     LEFT JOIN public.programas g ON ((g.id = p.programa_id)))
  WHERE (p.tipo = 'refund'::text);


--
-- Name: v_fathom_bandeja; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_fathom_bandeja WITH (security_invoker='true') AS
 SELECT f.id,
    f.recording_id,
    f.titulo,
    f.url,
    f.share_url,
    f.grabado_por_nombre,
    f.grabado_por_email,
    f.inicio,
    f.duracion_min,
    f.tipo,
    f.persona_id,
    p.nombre AS cliente,
    f.emparejado_por,
    f.invitados_externos,
    f.resumen_md,
    f.acciones,
    f.sesion_id,
    f.descartada_at,
    f.actualizado_at,
    c.cubre AS sesion_existente_id,
    s.fecha AS sesion_existente_fecha,
    s.estado_asistencia AS sesion_existente_estado,
        CASE
            WHEN (f.persona_id IS NULL) THEN 'sin_cliente'::text
            WHEN (f.sesion_id IS NOT NULL) THEN 'convertida'::text
            WHEN (f.tipo <> 'servicio'::text) THEN 'no_es_consultoria'::text
            WHEN (c.cubre IS NULL) THEN 'sin_sesion'::text
            WHEN (s.estado_asistencia IS NOT NULL) THEN 'ya_registrada'::text
            ELSE 'sesion_sin_registrar'::text
        END AS estado
   FROM (((public.fathom_llamadas f
     LEFT JOIN public.personas p ON ((p.id = f.persona_id)))
     LEFT JOIN LATERAL ( SELECT public.fathom_sesion_que_cubre(f.persona_id, f.inicio) AS cubre) c ON (true))
     LEFT JOIN public.sesiones s ON ((s.id = c.cubre)));


--
-- Name: VIEW v_fathom_bandeja; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_fathom_bandeja IS 'Las llamadas de Fathom con su estado real frente a `sesiones`. `sin_sesion` es el único estado en el que convertir tiene sentido — y es lo único que debe contar el badge.';


--
-- Name: v_flujo_caja_futuro; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_flujo_caja_futuro WITH (security_invoker='true') AS
 SELECT (date_trunc('month'::text, (fecha_vencimiento)::timestamp with time zone))::date AS mes,
    divisa,
    sum(monto) AS por_cobrar,
    count(*) AS n_cuotas
   FROM public.cuotas_programadas
  WHERE ((estado = 'pendiente'::text) AND (fecha_vencimiento >= CURRENT_DATE))
  GROUP BY ((date_trunc('month'::text, (fecha_vencimiento)::timestamp with time zone))::date), divisa
  ORDER BY ((date_trunc('month'::text, (fecha_vencimiento)::timestamp with time zone))::date), divisa;


--
-- Name: v_pagos_atribuidos; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_pagos_atribuidos AS
 SELECT p.id AS pago_id,
    p.fecha,
    p.monto,
    p.divisa,
    p.persona_id,
    pe.nombre AS persona_nombre,
    COALESCE(p.programa_id, cu.programa_id) AS programa_id,
    g.motivo,
    g.tier,
    g.source_id,
    f.fuente,
    f.confirmado AS fuente_confirmada,
    g.setter_id,
    g.closer_id,
    g.upsell_por_id,
    (g.atribucion_at IS NOT NULL) AS atribuido,
    p.usd_recibido
   FROM ((((public.pagos p
     LEFT JOIN public.personas pe ON ((pe.id = p.persona_id)))
     LEFT JOIN public.cuotas_programadas cu ON ((cu.id = p.cuota_id)))
     LEFT JOIN public.programas g ON ((g.id = COALESCE(p.programa_id, cu.programa_id))))
     LEFT JOIN public.fuentes_atribucion f ON ((f.source_id = g.source_id)))
  WHERE (p.tipo IS DISTINCT FROM 'refund'::text);


--
-- Name: v_pnl_mensual; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_pnl_mensual WITH (security_invoker='true') AS
 WITH ing AS (
         SELECT (date_trunc('month'::text, (pagos.fecha)::timestamp with time zone))::date AS mes,
            sum(pagos.monto) AS ingresos
           FROM public.pagos
          GROUP BY ((date_trunc('month'::text, (pagos.fecha)::timestamp with time zone))::date)
        ), gas AS (
         SELECT (date_trunc('month'::text, (gastos.fecha)::timestamp with time zone))::date AS mes,
            sum(gastos.monto) AS gastos
           FROM public.gastos
          GROUP BY ((date_trunc('month'::text, (gastos.fecha)::timestamp with time zone))::date)
        )
 SELECT COALESCE(ing.mes, gas.mes) AS mes,
    COALESCE(ing.ingresos, (0)::numeric) AS ingresos,
    COALESCE(gas.gastos, (0)::numeric) AS gastos,
    (COALESCE(ing.ingresos, (0)::numeric) - COALESCE(gas.gastos, (0)::numeric)) AS profit
   FROM (ing
     FULL JOIN gas ON ((ing.mes = gas.mes)))
  ORDER BY COALESCE(ing.mes, gas.mes);


--
-- Name: v_sesiones_cliente; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sesiones_cliente WITH (security_invoker='true') AS
 SELECT s.id,
    s.persona_id,
    p.nombre AS cliente,
    s.coach_id,
    tm.nombre AS coach,
    s.fecha,
    ((s.fecha AT TIME ZONE 'Europe/Madrid'::text))::date AS dia,
    s.tipo,
    s.estado_asistencia,
    s.notas,
    s.url_grabacion,
    s.enlace,
    s.duracion_min,
    s.capital_total,
    s.exchange,
    s.proximo_paso,
    (s.ghl_appointment_id IS NOT NULL) AS de_ghl,
    pa.tier,
        CASE
            WHEN (s.persona_id IS NULL) THEN NULL::bigint
            WHEN (s.estado_asistencia IS DISTINCT FROM 'reprogramada'::text) THEN count(*) FILTER (WHERE (s.estado_asistencia IS DISTINCT FROM 'reprogramada'::text)) OVER (PARTITION BY s.persona_id ORDER BY s.fecha, s.created_at, s.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
            ELSE NULL::bigint
        END AS numero
   FROM (((public.sesiones s
     LEFT JOIN public.personas p ON ((p.id = s.persona_id)))
     LEFT JOIN public.team_members tm ON ((tm.id = s.coach_id)))
     LEFT JOIN public.v_programa_activo pa ON ((pa.persona_id = s.persona_id)));


--
-- Name: v_sesiones_por_coach; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sesiones_por_coach WITH (security_invoker='true') AS
 SELECT s.persona_id,
    s.coach_id,
    tm.nombre AS coach,
    count(*) FILTER (WHERE (s.estado_asistencia = 'asistio'::text)) AS hechas
   FROM (public.sesiones s
     LEFT JOIN public.team_members tm ON ((tm.id = s.coach_id)))
  WHERE (s.persona_id IS NOT NULL)
  GROUP BY s.persona_id, s.coach_id, tm.nombre;


--
-- Name: wa_conversaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_conversaciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona_id uuid,
    telefono_e164 text NOT NULL,
    kapso_conversation_id text,
    estado text DEFAULT 'active'::text NOT NULL,
    estado_atencion text DEFAULT 'pendiente'::text NOT NULL,
    coach_asignado uuid,
    tier text,
    ultimo_mensaje_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wa_conversaciones_estado_atencion_check CHECK ((estado_atencion = ANY (ARRAY['pendiente'::text, 'resuelto'::text]))),
    CONSTRAINT wa_conversaciones_estado_check CHECK ((estado = ANY (ARRAY['active'::text, 'ended'::text])))
);


--
-- Name: wa_mensajes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_mensajes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversacion_id uuid NOT NULL,
    kapso_message_id text,
    direction text NOT NULL,
    body text,
    tipo text,
    autor text,
    status text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    media_path text,
    media_kapso_url text,
    media_mime text,
    media_filename text,
    media_size bigint,
    media_status text DEFAULT 'none'::text NOT NULL,
    caption text,
    transcript text,
    reaccion_emoji text,
    plantilla_nombre text,
    sesion_id uuid,
    CONSTRAINT wa_mensajes_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT wa_mensajes_media_status_check CHECK ((media_status = ANY (ARRAY['none'::text, 'pending'::text, 'stored'::text, 'failed'::text])))
);


--
-- Name: v_timeline_cliente; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_timeline_cliente AS
 SELECT p.persona_id,
    ((p.fecha_inicio + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    p.fecha_inicio AS dia,
    'programa'::text AS tipo,
        CASE p.motivo
            WHEN 'nueva_venta'::text THEN 'Compra nueva'::text
            WHEN 'upsell'::text THEN 'Ascensión de programa'::text
            WHEN 'renovacion'::text THEN 'Renovación'::text
            WHEN 'downsell'::text THEN 'Bajada de programa'::text
            WHEN 'reactivacion'::text THEN 'Reactivación'::text
            WHEN 'cross_sell'::text THEN 'Venta cruzada'::text
            ELSE p.motivo
        END AS titulo,
    ('Tier '::text || p.tier) AS detalle,
    p.monto AS importe,
    p.id AS ref_id
   FROM public.programas p
UNION ALL
 SELECT pg.persona_id,
    ((pg.fecha + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    pg.fecha AS dia,
    'pago'::text AS tipo,
        CASE pg.tipo
            WHEN 'refund'::text THEN 'Reembolso'::text
            ELSE 'Cobro registrado'::text
        END AS titulo,
    COALESCE(pg.tipo_detalle, pg.tipo) AS detalle,
    pg.monto AS importe,
    pg.id AS ref_id
   FROM public.pagos pg
UNION ALL
 SELECT pr.persona_id,
    ((c.fecha_vencimiento + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    c.fecha_vencimiento AS dia,
    'cuota'::text AS tipo,
        CASE c.estado
            WHEN 'pagada'::text THEN 'Cuota cobrada'::text
            WHEN 'anulada'::text THEN 'Cuota anulada'::text
            ELSE 'Cuota pendiente'::text
        END AS titulo,
    ('Cuota '::text || c.numero_cuota) AS detalle,
    c.monto AS importe,
    c.id AS ref_id
   FROM (public.cuotas_programadas c
     JOIN public.programas pr ON ((pr.id = c.programa_id)))
UNION ALL
 SELECT vs.persona_id,
    vs.fecha,
    vs.dia,
    'sesion'::text AS tipo,
    (
        CASE vs.tipo
            WHEN 'consultoria_1a1'::text THEN 'Consultoría 1-a-1'::text
            ELSE 'Sesión grupal'::text
        END || COALESCE((' · Sesión '::text || vs.numero), ''::text)) AS titulo,
        CASE vs.estado_asistencia
            WHEN 'asistio'::text THEN 'asistió'::text
            WHEN 'no_asistio'::text THEN 'no asistió'::text
            WHEN 'reprogramada'::text THEN 'reprogramada'::text
            ELSE 'sin registrar'::text
        END AS detalle,
    NULL::numeric AS importe,
    vs.id AS ref_id
   FROM public.v_sesiones_cliente vs
UNION ALL
 SELECT pr.persona_id,
    ((e.fecha_inicio + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    e.fecha_inicio AS dia,
    'freeze'::text AS tipo,
    'Programa pausado'::text AS titulo,
        CASE
            WHEN (e.fecha_fin IS NULL) THEN 'sin fecha de fin'::text
            ELSE ('hasta '::text || to_char((e.fecha_fin)::timestamp with time zone, 'DD/MM/YYYY'::text))
        END AS detalle,
    NULL::numeric AS importe,
    e.id AS ref_id
   FROM (public.programa_eventos e
     JOIN public.programas pr ON ((pr.id = e.programa_id)))
  WHERE (e.tipo = 'freeze'::text)
UNION ALL
 SELECT cv.persona_id,
    m.sent_at AS fecha,
    ((m.sent_at AT TIME ZONE 'Europe/Madrid'::text))::date AS dia,
    'mensaje'::text AS tipo,
    'Plantilla enviada'::text AS titulo,
        CASE m.plantilla_nombre
            WHEN 'bienvenida_club_es'::text THEN 'Bienvenida'::text
            WHEN 'confirmacion_sesion_es'::text THEN 'Confirmación de sesión'::text
            WHEN 'recordatorio_sesion_es'::text THEN 'Recordatorio de sesión'::text
            WHEN 'recordatorio_1h_es'::text THEN 'Recordatorio (1 hora antes)'::text
            WHEN 'reengage_conversacion_es'::text THEN 'Reenganche'::text
            ELSE COALESCE(m.plantilla_nombre, 'Plantilla'::text)
        END AS detalle,
    NULL::numeric AS importe,
    m.id AS ref_id
   FROM (public.wa_mensajes m
     JOIN public.wa_conversaciones cv ON ((cv.id = m.conversacion_id)))
  WHERE ((m.tipo = 'template'::text) AND (cv.persona_id IS NOT NULL));


--
-- Name: ajustes_os ajustes_os_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ajustes_os
    ADD CONSTRAINT ajustes_os_pkey PRIMARY KEY (clave);


--
-- Name: auditoria auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);


--
-- Name: contrato_eventos contrato_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_eventos
    ADD CONSTRAINT contrato_eventos_pkey PRIMARY KEY (id);


--
-- Name: contratos contratos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_pkey PRIMARY KEY (id);


--
-- Name: contratos contratos_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_token_key UNIQUE (token);


--
-- Name: cuotas_programadas cuotas_programadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuotas_programadas
    ADD CONSTRAINT cuotas_programadas_pkey PRIMARY KEY (id);


--
-- Name: emails_enviados emails_enviados_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails_enviados
    ADD CONSTRAINT emails_enviados_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: emails_enviados emails_enviados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails_enviados
    ADD CONSTRAINT emails_enviados_pkey PRIMARY KEY (id);


--
-- Name: estrategias estrategias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estrategias
    ADD CONSTRAINT estrategias_pkey PRIMARY KEY (id);


--
-- Name: fathom_llamadas fathom_llamadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fathom_llamadas
    ADD CONSTRAINT fathom_llamadas_pkey PRIMARY KEY (id);


--
-- Name: fathom_llamadas fathom_llamadas_recording_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fathom_llamadas
    ADD CONSTRAINT fathom_llamadas_recording_id_key UNIQUE (recording_id);


--
-- Name: fuentes_atribucion fuentes_atribucion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuentes_atribucion
    ADD CONSTRAINT fuentes_atribucion_pkey PRIMARY KEY (source_id);


--
-- Name: gastos gastos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gastos
    ADD CONSTRAINT gastos_pkey PRIMARY KEY (id);


--
-- Name: notificaciones_vistas notificaciones_vistas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones_vistas
    ADD CONSTRAINT notificaciones_vistas_pkey PRIMARY KEY (team_member_id);


--
-- Name: onboarding onboarding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding
    ADD CONSTRAINT onboarding_pkey PRIMARY KEY (id);


--
-- Name: pagos pagos_airtable_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_airtable_id_key UNIQUE (airtable_id);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id);


--
-- Name: patrimonio_snapshots patrimonio_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrimonio_snapshots
    ADD CONSTRAINT patrimonio_snapshots_pkey PRIMARY KEY (id);


--
-- Name: personas personas_airtable_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_airtable_id_key UNIQUE (airtable_id);


--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (id);


--
-- Name: personas personas_telefono_e164_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_telefono_e164_key UNIQUE (telefono_e164);


--
-- Name: portal_accesos portal_accesos_persona_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accesos
    ADD CONSTRAINT portal_accesos_persona_id_key UNIQUE (persona_id);


--
-- Name: portal_accesos portal_accesos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accesos
    ADD CONSTRAINT portal_accesos_pkey PRIMARY KEY (id);


--
-- Name: portal_accesos portal_accesos_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accesos
    ADD CONSTRAINT portal_accesos_token_key UNIQUE (token);


--
-- Name: posiciones posiciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posiciones
    ADD CONSTRAINT posiciones_pkey PRIMARY KEY (id);


--
-- Name: programa_eventos programa_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programa_eventos
    ADD CONSTRAINT programa_eventos_pkey PRIMARY KEY (id);


--
-- Name: programas programas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_pkey PRIMARY KEY (id);


--
-- Name: push_enviados push_enviados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_enviados
    ADD CONSTRAINT push_enviados_pkey PRIMARY KEY (mensaje_id, team_member_id);


--
-- Name: push_suscripciones push_suscripciones_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_suscripciones
    ADD CONSTRAINT push_suscripciones_endpoint_key UNIQUE (endpoint);


--
-- Name: push_suscripciones push_suscripciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_suscripciones
    ADD CONSTRAINT push_suscripciones_pkey PRIMARY KEY (id);


--
-- Name: sesion_operaciones sesion_operaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion_operaciones
    ADD CONSTRAINT sesion_operaciones_pkey PRIMARY KEY (id);


--
-- Name: sesiones sesiones_ghl_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_ghl_appointment_id_key UNIQUE (ghl_appointment_id);


--
-- Name: sesiones sesiones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_pkey PRIMARY KEY (id);


--
-- Name: sesiones_recurrentes sesiones_recurrentes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_recurrentes
    ADD CONSTRAINT sesiones_recurrentes_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: tiers tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_pkey PRIMARY KEY (id);


--
-- Name: wa_conversaciones wa_conversaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_conversaciones
    ADD CONSTRAINT wa_conversaciones_pkey PRIMARY KEY (id);


--
-- Name: wa_conversaciones wa_conversaciones_telefono_e164_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_conversaciones
    ADD CONSTRAINT wa_conversaciones_telefono_e164_key UNIQUE (telefono_e164);


--
-- Name: wa_mensajes wa_mensajes_kapso_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_mensajes
    ADD CONSTRAINT wa_mensajes_kapso_message_id_key UNIQUE (kapso_message_id);


--
-- Name: wa_mensajes wa_mensajes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_mensajes
    ADD CONSTRAINT wa_mensajes_pkey PRIMARY KEY (id);


--
-- Name: emails_enviados_pendientes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_enviados_pendientes_idx ON public.emails_enviados USING btree (created_at) WHERE (estado = 'enviado'::text);


--
-- Name: emails_enviados_sesion_tipo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX emails_enviados_sesion_tipo_idx ON public.emails_enviados USING btree (sesion_id, tipo);


--
-- Name: estrategias_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estrategias_persona_idx ON public.estrategias USING btree (persona_id, fecha_lanzamiento DESC);


--
-- Name: estrategias_sin_publicar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estrategias_sin_publicar_idx ON public.estrategias USING btree (visible) WHERE (visible = false);


--
-- Name: idx_auditoria_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_created ON public.auditoria USING btree (created_at DESC);


--
-- Name: idx_auditoria_devolucion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_devolucion ON public.auditoria USING btree (entidad_id) WHERE (entidad = 'devolucion'::text);


--
-- Name: idx_auditoria_entidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_entidad ON public.auditoria USING btree (entidad, entidad_id, created_at DESC);


--
-- Name: idx_contrato_eventos_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contrato_eventos_contrato ON public.contrato_eventos USING btree (contrato_id, ocurrido_at);


--
-- Name: idx_contratos_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_persona ON public.contratos USING btree (persona_id);


--
-- Name: idx_cuotas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cuotas_estado ON public.cuotas_programadas USING btree (estado);


--
-- Name: idx_cuotas_programa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cuotas_programa ON public.cuotas_programadas USING btree (programa_id);


--
-- Name: idx_cuotas_venc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cuotas_venc ON public.cuotas_programadas USING btree (fecha_vencimiento);


--
-- Name: idx_fathom_inicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fathom_inicio ON public.fathom_llamadas USING btree (inicio DESC);


--
-- Name: idx_fathom_pendientes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fathom_pendientes ON public.fathom_llamadas USING btree (inicio DESC) WHERE ((sesion_id IS NULL) AND (descartada_at IS NULL) AND (tipo <> 'interna'::text));


--
-- Name: idx_fathom_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fathom_persona ON public.fathom_llamadas USING btree (persona_id) WHERE (persona_id IS NOT NULL);


--
-- Name: idx_gastos_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gastos_categoria ON public.gastos USING btree (categoria);


--
-- Name: idx_gastos_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gastos_fecha ON public.gastos USING btree (fecha);


--
-- Name: idx_onboarding_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_persona ON public.onboarding USING btree (persona_id);


--
-- Name: idx_pagos_cuota; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_cuota ON public.pagos USING btree (cuota_id);


--
-- Name: idx_pagos_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_fecha ON public.pagos USING btree (fecha);


--
-- Name: idx_pagos_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_persona ON public.pagos USING btree (persona_id);


--
-- Name: idx_pagos_revierte; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pagos_revierte ON public.pagos USING btree (revierte_pago_id);


--
-- Name: idx_patsnap_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_patsnap_persona ON public.patrimonio_snapshots USING btree (persona_id);


--
-- Name: idx_personas_coach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_coach ON public.personas USING btree (coach_id);


--
-- Name: idx_personas_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_estado ON public.personas USING btree (estado);


--
-- Name: idx_personas_ghl; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_ghl ON public.personas USING btree (ghl_contact_id);


--
-- Name: idx_personas_telefono; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_personas_telefono ON public.personas USING btree (telefono_e164);


--
-- Name: idx_posiciones_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posiciones_persona ON public.posiciones USING btree (persona_id);


--
-- Name: idx_prog_eventos_prog; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prog_eventos_prog ON public.programa_eventos USING btree (programa_id);


--
-- Name: idx_programas_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_programas_persona ON public.programas USING btree (persona_id);


--
-- Name: idx_programas_previo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_programas_previo ON public.programas USING btree (programa_previo_id);


--
-- Name: idx_programas_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_programas_tier ON public.programas USING btree (tier);


--
-- Name: idx_sesion_ops_sesion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesion_ops_sesion ON public.sesion_operaciones USING btree (sesion_id);


--
-- Name: idx_sesiones_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_persona ON public.sesiones USING btree (persona_id);


--
-- Name: idx_sesiones_programa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_programa ON public.sesiones USING btree (programa_id);


--
-- Name: idx_team_members_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_team_members_username ON public.team_members USING btree (lower(username));


--
-- Name: idx_waconv_atencion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waconv_atencion ON public.wa_conversaciones USING btree (estado_atencion);


--
-- Name: idx_waconv_coach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waconv_coach ON public.wa_conversaciones USING btree (coach_asignado);


--
-- Name: idx_waconv_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waconv_persona ON public.wa_conversaciones USING btree (persona_id);


--
-- Name: idx_waconv_telefono; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waconv_telefono ON public.wa_conversaciones USING btree (telefono_e164);


--
-- Name: idx_wamsg_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wamsg_conv ON public.wa_mensajes USING btree (conversacion_id);


--
-- Name: idx_wamsg_media_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wamsg_media_status ON public.wa_mensajes USING btree (media_status) WHERE (media_status = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: idx_wamsg_plantilla; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wamsg_plantilla ON public.wa_mensajes USING btree (plantilla_nombre) WHERE (plantilla_nombre IS NOT NULL);


--
-- Name: idx_wamsg_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wamsg_sent ON public.wa_mensajes USING btree (sent_at);


--
-- Name: pagos_programa_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pagos_programa_idx ON public.pagos USING btree (programa_id);


--
-- Name: programas_sin_atribuir_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX programas_sin_atribuir_idx ON public.programas USING btree (fecha_inicio) WHERE (atribucion_at IS NULL);


--
-- Name: push_suscripciones_miembro_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_suscripciones_miembro_idx ON public.push_suscripciones USING btree (team_member_id);


--
-- Name: sesiones_recurrente_ocurrencia_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sesiones_recurrente_ocurrencia_key ON public.sesiones USING btree (recurrente_id, fecha);


--
-- Name: uq_contratos_programa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_contratos_programa ON public.contratos USING btree (programa_id) WHERE (programa_id IS NOT NULL);


--
-- Name: uq_gastos_airtable_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_gastos_airtable_id ON public.gastos USING btree (airtable_id) WHERE (airtable_id IS NOT NULL);


--
-- Name: wa_mensajes_sesion_plantilla_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wa_mensajes_sesion_plantilla_idx ON public.wa_mensajes USING btree (sesion_id, plantilla_nombre) WHERE (sesion_id IS NOT NULL);


--
-- Name: programas trg_descongelar_cupo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_descongelar_cupo AFTER INSERT ON public.programas FOR EACH ROW EXECUTE FUNCTION public.descongelar_cupo_al_nuevo_programa();


--
-- Name: ajustes_os ajustes_os_autor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ajustes_os
    ADD CONSTRAINT ajustes_os_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES public.team_members(id);


--
-- Name: auditoria auditoria_autor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria
    ADD CONSTRAINT auditoria_autor_id_fkey FOREIGN KEY (autor_id) REFERENCES public.team_members(id);


--
-- Name: contrato_eventos contrato_eventos_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_eventos
    ADD CONSTRAINT contrato_eventos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: contratos contratos_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: contratos contratos_programa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_programa_id_fkey FOREIGN KEY (programa_id) REFERENCES public.programas(id);


--
-- Name: contratos contratos_texto_editado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_texto_editado_por_fkey FOREIGN KEY (texto_editado_por) REFERENCES public.team_members(id);


--
-- Name: cuotas_programadas cuotas_programadas_programa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuotas_programadas
    ADD CONSTRAINT cuotas_programadas_programa_id_fkey FOREIGN KEY (programa_id) REFERENCES public.programas(id);


--
-- Name: emails_enviados emails_enviados_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails_enviados
    ADD CONSTRAINT emails_enviados_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: emails_enviados emails_enviados_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emails_enviados
    ADD CONSTRAINT emails_enviados_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE SET NULL;


--
-- Name: estrategias estrategias_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estrategias
    ADD CONSTRAINT estrategias_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.team_members(id);


--
-- Name: estrategias estrategias_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estrategias
    ADD CONSTRAINT estrategias_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: fathom_llamadas fathom_llamadas_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fathom_llamadas
    ADD CONSTRAINT fathom_llamadas_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: fathom_llamadas fathom_llamadas_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fathom_llamadas
    ADD CONSTRAINT fathom_llamadas_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE SET NULL;


--
-- Name: fuentes_atribucion fuentes_atribucion_setter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fuentes_atribucion
    ADD CONSTRAINT fuentes_atribucion_setter_id_fkey FOREIGN KEY (setter_id) REFERENCES public.team_members(id);


--
-- Name: notificaciones_vistas notificaciones_vistas_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificaciones_vistas
    ADD CONSTRAINT notificaciones_vistas_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: onboarding onboarding_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding
    ADD CONSTRAINT onboarding_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: pagos pagos_cuota_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_cuota_id_fkey FOREIGN KEY (cuota_id) REFERENCES public.cuotas_programadas(id);


--
-- Name: pagos pagos_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: pagos pagos_programa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_programa_id_fkey FOREIGN KEY (programa_id) REFERENCES public.programas(id);


--
-- Name: pagos pagos_revierte_pago_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_revierte_pago_id_fkey FOREIGN KEY (revierte_pago_id) REFERENCES public.pagos(id);


--
-- Name: patrimonio_snapshots patrimonio_snapshots_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrimonio_snapshots
    ADD CONSTRAINT patrimonio_snapshots_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: personas personas_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.team_members(id);


--
-- Name: portal_accesos portal_accesos_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accesos
    ADD CONSTRAINT portal_accesos_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.team_members(id);


--
-- Name: portal_accesos portal_accesos_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_accesos
    ADD CONSTRAINT portal_accesos_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: posiciones posiciones_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posiciones
    ADD CONSTRAINT posiciones_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: programa_eventos programa_eventos_programa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programa_eventos
    ADD CONSTRAINT programa_eventos_programa_id_fkey FOREIGN KEY (programa_id) REFERENCES public.programas(id);


--
-- Name: programas programas_closer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_closer_id_fkey FOREIGN KEY (closer_id) REFERENCES public.team_members(id);


--
-- Name: programas programas_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: programas programas_programa_previo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_programa_previo_id_fkey FOREIGN KEY (programa_previo_id) REFERENCES public.programas(id);


--
-- Name: programas programas_setter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_setter_id_fkey FOREIGN KEY (setter_id) REFERENCES public.team_members(id);


--
-- Name: programas programas_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.fuentes_atribucion(source_id);


--
-- Name: programas programas_tier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_tier_fkey FOREIGN KEY (tier) REFERENCES public.tiers(id);


--
-- Name: programas programas_upsell_por_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programas
    ADD CONSTRAINT programas_upsell_por_id_fkey FOREIGN KEY (upsell_por_id) REFERENCES public.team_members(id);


--
-- Name: push_enviados push_enviados_mensaje_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_enviados
    ADD CONSTRAINT push_enviados_mensaje_id_fkey FOREIGN KEY (mensaje_id) REFERENCES public.wa_mensajes(id) ON DELETE CASCADE;


--
-- Name: push_enviados push_enviados_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_enviados
    ADD CONSTRAINT push_enviados_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: push_suscripciones push_suscripciones_team_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_suscripciones
    ADD CONSTRAINT push_suscripciones_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) ON DELETE CASCADE;


--
-- Name: sesion_operaciones sesion_operaciones_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion_operaciones
    ADD CONSTRAINT sesion_operaciones_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE CASCADE;


--
-- Name: sesiones sesiones_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.team_members(id);


--
-- Name: sesiones sesiones_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: sesiones sesiones_programa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_programa_id_fkey FOREIGN KEY (programa_id) REFERENCES public.programas(id);


--
-- Name: sesiones sesiones_recurrente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones
    ADD CONSTRAINT sesiones_recurrente_id_fkey FOREIGN KEY (recurrente_id) REFERENCES public.sesiones_recurrentes(id);


--
-- Name: sesiones_recurrentes sesiones_recurrentes_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_recurrentes
    ADD CONSTRAINT sesiones_recurrentes_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.team_members(id);


--
-- Name: wa_conversaciones wa_conversaciones_coach_asignado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_conversaciones
    ADD CONSTRAINT wa_conversaciones_coach_asignado_fkey FOREIGN KEY (coach_asignado) REFERENCES public.team_members(id);


--
-- Name: wa_conversaciones wa_conversaciones_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_conversaciones
    ADD CONSTRAINT wa_conversaciones_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: wa_conversaciones wa_conversaciones_tier_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_conversaciones
    ADD CONSTRAINT wa_conversaciones_tier_fkey FOREIGN KEY (tier) REFERENCES public.tiers(id);


--
-- Name: wa_mensajes wa_mensajes_conversacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_mensajes
    ADD CONSTRAINT wa_mensajes_conversacion_id_fkey FOREIGN KEY (conversacion_id) REFERENCES public.wa_conversaciones(id) ON DELETE CASCADE;


--
-- Name: wa_mensajes wa_mensajes_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_mensajes
    ADD CONSTRAINT wa_mensajes_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones(id) ON DELETE SET NULL;


--
-- Name: ajustes_os; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ajustes_os ENABLE ROW LEVEL SECURITY;

--
-- Name: auditoria; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;

--
-- Name: auditoria auth read auditoria; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read auditoria" ON public.auditoria FOR SELECT TO authenticated USING (true);


--
-- Name: contratos auth read contratos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read contratos" ON public.contratos FOR SELECT TO authenticated USING (true);


--
-- Name: cuotas_programadas auth read cuotas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read cuotas" ON public.cuotas_programadas FOR SELECT TO authenticated USING (true);


--
-- Name: gastos auth read gastos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read gastos" ON public.gastos FOR SELECT TO authenticated USING (true);


--
-- Name: onboarding auth read onboarding; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read onboarding" ON public.onboarding FOR SELECT TO authenticated USING (true);


--
-- Name: pagos auth read pagos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read pagos" ON public.pagos FOR SELECT TO authenticated USING (true);


--
-- Name: patrimonio_snapshots auth read patsnap; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read patsnap" ON public.patrimonio_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: personas auth read personas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read personas" ON public.personas FOR SELECT TO authenticated USING (true);


--
-- Name: posiciones auth read posiciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read posiciones" ON public.posiciones FOR SELECT TO authenticated USING (true);


--
-- Name: programa_eventos auth read programa_eventos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read programa_eventos" ON public.programa_eventos FOR SELECT TO authenticated USING (true);


--
-- Name: programas auth read programas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read programas" ON public.programas FOR SELECT TO authenticated USING (true);


--
-- Name: sesion_operaciones auth read sesion_operaciones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read sesion_operaciones" ON public.sesion_operaciones FOR SELECT TO authenticated USING (true);


--
-- Name: sesiones auth read sesiones; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read sesiones" ON public.sesiones FOR SELECT TO authenticated USING (true);


--
-- Name: team_members auth read team_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read team_members" ON public.team_members FOR SELECT TO authenticated USING (true);


--
-- Name: tiers auth read tiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read tiers" ON public.tiers FOR SELECT TO authenticated USING (true);


--
-- Name: wa_conversaciones auth read waconv; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read waconv" ON public.wa_conversaciones FOR SELECT TO authenticated USING (true);


--
-- Name: wa_mensajes auth read wamsg; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read wamsg" ON public.wa_mensajes FOR SELECT TO authenticated USING (true);


--
-- Name: wa_conversaciones auth write waconv; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth write waconv" ON public.wa_conversaciones FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: contrato_eventos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contrato_eventos ENABLE ROW LEVEL SECURITY;

--
-- Name: contratos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

--
-- Name: cuotas_programadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cuotas_programadas ENABLE ROW LEVEL SECURITY;

--
-- Name: emails_enviados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emails_enviados ENABLE ROW LEVEL SECURITY;

--
-- Name: estrategias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estrategias ENABLE ROW LEVEL SECURITY;

--
-- Name: fathom_llamadas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fathom_llamadas ENABLE ROW LEVEL SECURITY;

--
-- Name: fuentes_atribucion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fuentes_atribucion ENABLE ROW LEVEL SECURITY;

--
-- Name: gastos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gastos ENABLE ROW LEVEL SECURITY;

--
-- Name: notificaciones_vistas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notificaciones_vistas ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding ENABLE ROW LEVEL SECURITY;

--
-- Name: pagos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

--
-- Name: patrimonio_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patrimonio_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: personas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;

--
-- Name: portal_accesos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_accesos ENABLE ROW LEVEL SECURITY;

--
-- Name: posiciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.posiciones ENABLE ROW LEVEL SECURITY;

--
-- Name: programa_eventos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programa_eventos ENABLE ROW LEVEL SECURITY;

--
-- Name: programas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programas ENABLE ROW LEVEL SECURITY;

--
-- Name: push_enviados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_enviados ENABLE ROW LEVEL SECURITY;

--
-- Name: push_suscripciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_suscripciones ENABLE ROW LEVEL SECURITY;

--
-- Name: sesion_operaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sesion_operaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: sesiones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sesiones ENABLE ROW LEVEL SECURITY;

--
-- Name: sesiones_recurrentes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sesiones_recurrentes ENABLE ROW LEVEL SECURITY;

--
-- Name: team_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

--
-- Name: tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_conversaciones; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_conversaciones ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_mensajes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_mensajes ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict pC7mMtczqqV9iLvatkzz5CjcAepbFfRZaA6qNgbXwda3BaMC1k8tdWgKwSGv65x
