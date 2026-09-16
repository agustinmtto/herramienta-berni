-- 0015_crear_venta_dedupe.sql — Dedupe de persona en compra nueva + guard extendido
--
-- Problema que corrige (review final de feat/form-nueva-venta):
--   En 0014, `tipo_venta = 'nueva'` SIEMPRE hacía `insert into personas`. Si el
--   teléfono ya existía en la base, el insert reventaba contra el UNIQUE de
--   `personas.telefono_e164` con un error crudo de Postgres, y además el guard
--   anti doble-submit (persona+importe+fecha) nunca llegaba a protegerlo porque
--   la transacción moría antes.
--
-- Resolución:
--   1) Compra nueva CON teléfono → si ya existe una persona con ese teléfono, se
--      REUTILIZA (no se inserta). Si su estado era lead/reservado/ex_cliente se
--      promueve a 'cliente'. Se devuelve `persona_reutilizada: true`.
--   2) Compra nueva SIN teléfono → no hay llave natural para deduplicar, así que
--      se añade un guard anti doble-submit por nombre (trim + case-insensitive)
--      creado hace menos de 2 minutos, con mensaje legible.
--   3) El guard de pago (persona+importe+fecha <2 min) corre DESPUÉS de resolver
--      v_persona_id, así que ahora también cubre la compra nueva con teléfono
--      (porque la persona se reutiliza en vez de fallar).
--
-- La función se redefine ENTERA aquí (create or replace). 0014 queda como estaba.

create or replace function public.crear_venta(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  -- Corre DESPUÉS de resolver v_persona_id, así que cubre los 3 tipos de venta
  -- (incluida la compra nueva con teléfono, ahora que la persona se reutiliza).
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
                         fecha_inicio, meses_duracion, monto, divisa, origen, necesita_revision)
  values (v_persona_id, payload->>'tier', v_motivo, v_modo, v_prev,
          (payload->>'fecha_inicio')::date, nullif(payload->>'meses_duracion','')::int,
          (payload->>'valor_total')::numeric, 'EUR', 'form_os', false)
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
                            'persona_reutilizada', v_reutilizada);
end;
$$;

-- Solo el backend (service_role) puede ejecutarla
revoke execute on function public.crear_venta(jsonb) from public, anon, authenticated;
