-- ============================================================
-- 0069 — Vinculación de leads: validación de teléfono, auditoría y rollback
-- (docs/11 §9.1–9.3)
--
-- Dos cambios sobre la vinculación de 0068, en la MISMA línea de seguridad:
--
-- 1) VALIDACIÓN DE TELÉFONO: vincular une mundos — el quiz (lead temporal) y
--    la venta (cliente definitivo con dinero real). Un clic equivocado puede
--    colgar el diagnóstico de la persona equivocada. Por eso el RPC compara el
--    teléfono capturado en el quiz con el del cliente: si difieren, rechaza
--    salvo confirmación explícita (`p_confirmar=true`) — los teléfonos cambian
--    legítimamente, así que el bloque es blando pero nunca silencioso, y la
--    confirmación queda auditada.
--
-- 2) ROLLBACK: cada vinculación escribe una fila en `auditoria` con los
--    `envio_ids` exactos que se movieron. `desvincular_lead` lee esa fila y
--    revierte: los envíos vuelven al temporal y el temporal vuelve a 'lead'.
--    Revertir exactamente lo que se movió — no "todo lo que apunte al
--    cliente", porque un cliente puede recibir vinculaciones de varios leads.
--
-- Append-only: 0068 ya está aplicada localmente; se reemplaza la función con
-- `create or replace` manteniendo compatibilidad (los dos primeros parámetros
-- no cambian, el resto lleva default).
-- ============================================================
begin;

-- ── 1) vincular_lead_convertido v2 ───────────────────────────────────────────
drop function if exists public.vincular_lead_convertido(uuid, uuid);

create or replace function public.vincular_lead_convertido(
  p_lead_id    uuid,
  p_cliente_id uuid,
  p_confirmar  boolean default false,
  p_autor_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reasignados int := 0;
  v_lead_estado text;
  v_envio_ids   uuid[] := '{}';
  v_tel_lead    text;
  v_tel_cliente text;
begin
  if p_lead_id is null or p_cliente_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
  end if;
  if p_lead_id = p_cliente_id then
    raise exception 'quiz_leads/misma_persona';
  end if;

  perform pg_advisory_xact_lock(hashtext('quiz_leads:vincular:' || p_lead_id::text));

  -- origen: persona lead/archivada de este módulo (sin teléfono: los leads
  -- del funnel nacen con telefono_e164 NULL, docs/11 §2)
  select estado into v_lead_estado
    from personas p
   where p.id = p_lead_id
     and p.telefono_e164 is null
   for update;
  if not found then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  -- idempotencia: ya archivado → nada por hacer (no exige envíos: tras la
  -- primera vinculación ya no hay ninguno apuntando al temporal)
  if v_lead_estado = 'archivado' then
    return jsonb_build_object('ok', true, 'cliente_id', p_cliente_id, 'envios_reasignados', 0);
  end if;
  if v_lead_estado is distinct from 'lead' then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  -- "creada y referenciada por este módulo" (§9.5): al menos un envío propio
  if not exists (select 1 from diagnostico_envios e where e.persona_id = p_lead_id) then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  -- destino: cliente definitivo con al menos un programa (§9.6)
  if not exists (
    select 1 from personas p
     where p.id = p_cliente_id and p.estado = 'cliente'
  ) or not exists (
    select 1 from programas g where g.persona_id = p_cliente_id
  ) then
    raise exception 'quiz_leads/cliente_invalido';
  end if;

  -- ── VALIDACIÓN DE TELÉFONO (docs/11 §9.1) ─────────────────────────────────
  -- El teléfono del lead vive en el SNAPSHOT de su envío completado más
  -- reciente (en personas es NULL a propósito). Si difiere del del cliente,
  -- se exige confirmación explícita: el clic equivocado no puede pasar en
  -- silencio, pero un teléfono cambiado legítimamente tampoco bloquea.
  select telefono_e164_capturado into v_tel_lead
    from diagnostico_envios
   where persona_id = p_lead_id
     and estado = 'completed'
     and telefono_e164_capturado is not null
   order by created_at desc
   limit 1;
  select telefono_e164 into v_tel_cliente from personas where id = p_cliente_id;

  if coalesce(v_tel_lead,'') <> coalesce(v_tel_cliente,'') and p_confirmar is not true then
    raise exception 'quiz_leads/telefono_no_coincide';
  end if;

  -- ── reasignación ─────────────────────────────────────────────────────────
  select coalesce(array_agg(id), '{}') into v_envio_ids
    from diagnostico_envios where persona_id = p_lead_id;

  update diagnostico_envios
     set persona_id = p_cliente_id
   where persona_id = p_lead_id;
  get diagnostics v_reasignados = row_count;

  -- el temporal no se borra: queda archivado como rastro (§9.8)
  update personas set estado = 'archivado' where id = p_lead_id;

  -- ── auditoría (docs/11 §9.2): el rastro que hace posible el rollback ─────
  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', p_lead_id, 'vinculacion', p_autor_id,
          jsonb_build_object(
            'cliente_id', p_cliente_id,
            'envio_ids', to_jsonb(v_envio_ids),
            'envios_reasignados', v_reasignados,
            'telefono_lead', v_tel_lead,
            'telefono_cliente', v_tel_cliente,
            'confirmado', coalesce(p_confirmar, false),
            'regla', 'hot-lead-v1'
          ));

  return jsonb_build_object('ok', true, 'cliente_id', p_cliente_id, 'envios_reasignados', v_reasignados);
end;
$$;

revoke all on function public.vincular_lead_convertido(uuid, uuid, boolean, uuid) from public, anon, authenticated;

-- ── 2) desvincular_lead: rollback exacto (docs/11 §9.3) ──────────────────────
-- Revierte la ÚLTIMA vinculación de ese cliente leyendo su auditoría: mueve
-- EXACTAMENTE los envíos registrados de vuelta al temporal y lo restaura a
-- 'lead'. Si un cliente recibió vinculaciones de varios leads, cada rollback
-- revierte solo la suya — por eso la auditoría guarda la lista exacta.
create or replace function public.desvincular_lead(
  p_cliente_id uuid,
  p_autor_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_datos      jsonb;
  v_lead_id    uuid;
  v_lead_estado text;
  v_restaurados int := 0;
begin
  if p_cliente_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
  end if;

  perform pg_advisory_xact_lock(hashtext('quiz_leads:vincular:' || p_cliente_id::text));

  -- la última vinculación registrada para este cliente: de ahí salen el lead
  -- de origen (entidad_id) y la lista exacta de envíos que se movieron
  select a.entidad_id, a.datos into v_lead_id, v_datos
    from auditoria a
   where a.entidad = 'persona'
     and a.accion = 'vinculacion'
     and a.datos->>'cliente_id' = p_cliente_id::text
   order by a.created_at desc
   limit 1;
  if not found then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;

  select estado into v_lead_estado from personas where id = v_lead_id for update;
  if v_lead_estado is distinct from 'archivado' then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;

  -- devolver EXACTAMENTE los envíos registrados que sigan en el cliente
  update diagnostico_envios e
     set persona_id = v_lead_id
    from (select jsonb_array_elements_text(v_datos->'envio_ids')::uuid as id) ids
   where e.id = ids.id
     and e.persona_id = p_cliente_id;
  get diagnostics v_restaurados = row_count;

  update personas set estado = 'lead' where id = v_lead_id;

  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', v_lead_id, 'desvinculacion', p_autor_id,
          jsonb_build_object(
            'cliente_id', p_cliente_id,
            'envio_ids', v_datos->'envio_ids',
            'envios_restaurados', v_restaurados,
            'revertido_de', v_datos->'confirmado'
          ));

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'envios_restaurados', v_restaurados);
end;
$$;

revoke all on function public.desvincular_lead(uuid, uuid) from public, anon, authenticated;

commit;
