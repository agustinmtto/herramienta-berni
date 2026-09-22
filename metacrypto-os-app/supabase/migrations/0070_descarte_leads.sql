-- ============================================================
-- 0070 — Descarte de leads (docs/11 §9.4)
--
-- El flujo comercial del módulo cierra de ambos lados: si hubo venta se
-- vincula el lead al cliente (0068/0069); si NO la hubo, el triaje DESCARTA
-- el lead para que deje de ser una tarea viva sin borrar su rastro.
--
-- Dos piezas:
--   1) El estado 'descartado' entra en el CHECK de personas.estado. Único
--      cambio sobre el esquema preexistente del OS, append-only: nunca se
--      edita 0001/0039 — se sustituye el constraint con la lista ampliada.
--   2) RPC descartar_lead(p_lead_id, p_autor_id): mismo molde que vincular
--      (security definer, solo service_role, advisory lock, auditoría).
--
-- Reversible a nivel de datos (la auditoría guarda el ANTES; volver a 'lead'
-- es un update), sin UI de reactivación en esta fase.
-- ============================================================
begin;

-- ── 1) estado descartado -----------------------------------------------------
alter table public.personas drop constraint if exists personas_estado_check;
alter table public.personas add constraint personas_estado_check
  check (estado in ('lead','reservado','cliente','ex_cliente','archivado','descartado'));

-- ── 2) RPC descartar_lead ----------------------------------------------------
-- Idempotente: re-descartar un lead ya descartado responde OK sin tocar nada.
-- El origen es una persona lead de ESTE módulo (sin teléfono y con envíos
-- propios), igual que vincular_lead_convertido exige.
create or replace function public.descartar_lead(
  p_lead_id  uuid,
  p_autor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_estado text;
  v_envios      int;
begin
  if p_lead_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
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

  -- idempotencia: re-descartar el MISMO lead descartado responde OK. Un lead
  -- ARCHIVADO ya se convirtió (o fue a cliente): el descarte no aplica — se
  -- rechaza en vez de "confirmar" algo que nunca pasó (auditoría v2).
  if v_lead_estado = 'descartado' then
    return jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'estado', v_lead_estado);
  end if;
  if v_lead_estado is distinct from 'lead' then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  -- "creada y referenciada por este módulo" (§9.5): al menos un envío propio
  select count(*) into v_envios from diagnostico_envios e where e.persona_id = p_lead_id;
  if v_envios = 0 then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  update personas set estado = 'descartado' where id = p_lead_id;

  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', p_lead_id, 'descarte', p_autor_id,
          jsonb_build_object(
            'envios', v_envios,
            'motivo', 'sin_venta_triage'
          ));

  return jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'estado', 'descartado');
end;
$$;

revoke all on function public.descartar_lead(uuid, uuid) from public, anon, authenticated;

commit;
