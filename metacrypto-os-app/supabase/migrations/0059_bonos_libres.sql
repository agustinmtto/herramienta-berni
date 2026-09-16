-- ============================================================
-- MetaCrypto OS — Migración 0059: los bonos escritos a mano
--
-- Qué cambia: UNA línea en el saneo de bonos de `crear_venta` y de
-- `editar_bonos`. Las dos funciones filtran el array contra el catálogo de 4
-- claves y descartan el resto; ahora dejan pasar también las entradas que
-- empiezan por `libre:`.
--
-- Por qué hace falta:
--   (1) El closer puede escribir un bono que no está en el catálogo (el campo
--       "Otro bono" de la venta). Se guarda como `libre:<texto>` en la MISMA
--       columna `programas.bonos` y solo se imprime en el contrato: no suma
--       consultorías ni alarga el programa, por eso no entra al catálogo.
--   (2) Sin esto, `editar_bonos` BORRA ese bono en silencio. Hace
--       `set bonos = v_bonos` con el array ya saneado, así que la primera vez
--       que alguien corrige los bonos de esa venta desde la ficha, el texto
--       desaparece y no hay de dónde recuperarlo. Lo levantó la revisión del
--       8-sep-2026.
--
-- Con esta migración aplicada, `crearVenta` deja de necesitar la escritura
-- extra sobre `programas` que hoy repone el bono libre después del RPC —
-- se borra en el mismo commit que trae esta migración.
--
-- El resto del cuerpo de las dos funciones es EL MISMO de la 0052, copiado sin
-- tocar. Verificado el 8-sep-2026 contra `git grep`: ninguna migración
-- posterior (0053-0058) las redefine, así que la 0052 es la versión viva.
--
-- ⚠️ GEMELO EN TYPESCRIPT: `apps/inbox/lib/bonos.ts` (`PREFIJO_BONO_LIBRE`).
-- Si cambia el prefijo, cambian los dos.
-- ============================================================

begin;

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

commit;
