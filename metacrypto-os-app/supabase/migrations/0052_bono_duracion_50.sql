-- ============================================================
-- MetaCrypto OS — Migración 0052: el bono de duración es un +50 %, en todos
--
-- Corrige la regla que las migraciones 0049 y 0050 dejaron en producción el
-- 25-ago. Berni, 26-ago por WhatsApp:
--   "No hay programa de 1800€: 2000, 3500 y 5000.
--    El bono de 50% más de tiempo es en todos.
--    El de 2000 que son 6 meses pasa a 9 meses.
--    Los otros dos que son de 1 año, pasan de 12 meses a 18."
--
-- Qué estaba mal y por qué importaba:
--   · El bono se activaba solo con `tier = '1800'`, un programa que dejó de
--     venderse el 30 de julio. En producción el gate era falso el 100 % de las
--     veces: cualquier venta del evento habría perdido el bono EN SILENCIO.
--   · Al QUITAR el bono, `editar_bonos` devolvía la duración a
--     `tiers.meses_default`, que estaba desactualizado. Una venta del tier 2000
--     habría hecho 6 → 9 → 4 y el cliente habría perdido dos meses pagados sin
--     que saltara nada; peor, `v_programa_activo` filtra por
--     `fecha_inicio + meses_duracion >= current_date`, así que el programa
--     habría caducado antes de tiempo y el cliente habría desaparecido de la
--     lista de activos con su cupo de consultorías detrás.
--
-- ⚠️ DEPENDE DE LA 0051, que corrige `tiers.meses_default`. El +50 % se calcula
-- sobre esa columna: sin la 0051 el cálculo sería correcto y el resultado
-- seguiría mal (6 y 12 en vez de 9 y 18).
--
-- La clave del bono se renombra `duracion_9m` → `duracion_50`, porque en el
-- 3500 y el 5000 el bono da 18 meses y el nombre viejo mentiría. Se puede
-- renombrar sin migrar datos porque las 200 filas de `programas` tienen `bonos`
-- vacío: no hay ni una venta con bonos todavía.
--
-- ⚠️ GEMELO EN TYPESCRIPT: `apps/inbox/lib/bonos.ts`. Si cambia la fórmula o el
-- catálogo de claves, cambian los dos. Tests en `lib/__tests__/bonos.test.ts`.
-- ============================================================

begin;

-- 1) La fórmula, una sola vez ---------------------------------------------------
-- Gemela de `mesesConBonoDuracion()` en lib/bonos.ts, redondeo incluido: hacia
-- ARRIBA, para no entregar de menos un bono prometido. Con las duraciones
-- reales (6 y 12) el redondeo nunca entra en juego.
create or replace function public.meses_con_bono_duracion(meses_base int)
returns int language sql immutable as $$
  select case
           when meses_base is null then null
           when meses_base <= 0    then meses_base
           else ceil(meses_base * 1.5)::int
         end;
$$;

comment on function public.meses_con_bono_duracion(int) is
  'Duración con el bono de +50 % del evento 26/08 (6→9, 12→18). Gemela de mesesConBonoDuracion() en apps/inbox/lib/bonos.ts.';

comment on column public.programas.bonos is
  'Bonos aplicados a esta venta. Claves en apps/inbox/lib/bonos.ts (evento 26/08: consultoria_berni, consultoria_manuel, duracion_50, discord_portafolio).';

-- 2) crear_venta: copia literal de la 0049 con el bloque de bonos corregido ------
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

revoke execute on function public.crear_venta(jsonb) from public, anon, authenticated;

-- 3) editar_bonos: copia literal de la 0050 con el bloque de bonos corregido -----
create or replace function public.editar_bonos(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

revoke execute on function public.editar_bonos(jsonb) from public, anon, authenticated;
revoke execute on function public.meses_con_bono_duracion(int) from public, anon;

commit;
