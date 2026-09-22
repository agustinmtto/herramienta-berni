-- ============================================================
-- 0071 — Reconciliación del módulo de leads (append-only, docs/11 §12)
--
-- Es el parche que pide la auditoría v3 (H-01): las correcciones de 0068-0070
-- se editaron in place mientras ningún entorno las había aplicado. Esta
-- migración de RECONCILIACIÓN garantiza que CUALQUIER base (limpia, con las
-- versiones viejas de 0068-0070, o ya reseteada) termine en el MISMO estado
-- final. Aplica el estado definitivo por completo:
--
--   1) Funciones reemplazadas con la última versión (create or replace):
--      registrar_diagnostico (retry histórico idempotente aunque la versión
--      esté pausada — v3 M-04; last_step no se sobrescribe después del
--      abandono — v3 H-09c; consentimiento solo versión canónica — v3 H-05)
--      vincular_lead_convertido y desvincular_lead y descartar_lead con el
--      lock canónico de contacto (v3 H-06) y rollback estricto (v3 H-07).
--   2) TRIGGER de inmutabilidad de quiz_versiones publicadas (v3 H-04).
--   3) CHECKs re-aplicados (idempotentes: drop if exists + add).
--   4) RLS/ACL: policies SELECT genéricas eliminadas; EXECUTE de helpers y
--      RPCs otorgado explícitamente solo a service_role (v3 H-08).
--
-- Corre sobre bases limpias (después de 0068→0069→0070) e híbridas (versiones
-- viejas de esos archivos): las filas ya completadas que no tengan nombre o
-- consentimiento se rellenan con marcadores honestos para que el CHECK
-- endurecido no rechace el upgrade.
-- ============================================================
begin;

-- ── 1) Estado de las tablas: constraints en su versión final ────────────────
alter table public.diagnostico_envios drop constraint if exists diagnostico_envios_completed_completo_check;

-- filas históricas de bases híbridas: completadas sin los datos exigidos hoy
update public.diagnostico_envios set nombre_capturado = '(desconocido)'      where estado = 'completed' and nombre_capturado is null;
update public.diagnostico_envios set consentimiento_version = 'contacto-v1' where estado = 'completed' and consentimiento_version is null;
update public.diagnostico_envios set consentimiento_at = coalesce(consentimiento_at, finished_at, now()) where estado = 'completed' and consentimiento_at is null;

alter table public.diagnostico_envios add constraint diagnostico_envios_completed_completo_check
  check (
    estado <> 'completed' or (
      persona_id              is not null
      and nombre_capturado    is not null
      and email_capturado     is not null
      and telefono_e164_capturado is not null
      and consentimiento_aceptado is true
      and consentimiento_version is not null
      and consentimiento_at   is not null
      and finished_at         is not null
    )
  );

alter table public.personas drop constraint if exists personas_estado_check;
alter table public.personas add constraint personas_estado_check
  check (estado in ('lead','reservado','cliente','ex_cliente','archivado','descartado'));

-- ── 2) Inmutabilidad de versiones publicadas (v3 H-04) ──────────────────────
-- La definición publicada es el CONTRATO: cambiarla retroactivamente reescribe
-- qué se validó, qué significó y qué clasificación produjo. Cambiar el quiz
-- exige publicar OTRA versión — nunca editar la publicada.
create or replace function public.quiz_versiones_congelada()
returns trigger
language plpgsql
as $$
declare
  v_envios int;
begin
  if old.publicada_at is null then
    return new;  -- en draft todavía se puede editar todo (y borrar)
  end if;
  if TG_OP = 'DELETE' then
    -- publicada con historial: no se borra (su FK impide con envíos; si no
    -- tiene envíos aún, el borrado es limpieza legítima de una versión de
    -- pruebas que nunca fue usada)
    select count(*) into v_envios from diagnostico_envios where quiz_version_id = old.id;
    if v_envios > 0 then
      raise exception 'quiz_versiones/publicada_es_inmutable: % tiene % envíos históricos y no se puede borrar', old.codigo, v_envios;
    end if;
    return old;
  end if;
  if new.definicion is distinct from old.definicion
     or new.codigo is distinct from old.codigo
     or new.funnel is distinct from old.funnel
     or new.variante is distinct from old.variante
     or new.version is distinct from old.version then
    raise exception 'quiz_versiones/publicada_es_inmutable: % ya fue publicada; cambiar el quiz exige publicar otra version', old.codigo;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_quiz_versiones_congelada on public.quiz_versiones;
create trigger tg_quiz_versiones_congelada
  before update on public.quiz_versiones
  for each row execute function public.quiz_versiones_congelada();

drop trigger if exists tg_quiz_versiones_no_borrar_publicadas on public.quiz_versiones;
create trigger tg_quiz_versiones_no_borrar_publicadas
  before delete on public.quiz_versiones
  for each row execute function public.quiz_versiones_congelada();

-- ── 3) registrar_diagnostico v3 ─────────────────────────────────────────────
-- Cambios sobre la versión de 0068 (que ya llevaba B1/B4/B5/B6/M8):
--   · M-04: la versión se resuelve POR SESIÓN — una sesión existente usa su
--     propia versión aunque hoy esté paused/archived; solo las sesiones
--     NUEVAS exigen una versión activa. El conflicto de versión sigue
--     detectado cuando el payload trae OTRA versión.
--   · H-09c: last_step_id/index solo se actualizan si el envío queda en
--     'started'/'in_progress' — un progress tardío ya no reescribe el paso
--     del abandono.
--   · H-05: consentimiento solo con la versión canónica 'contacto-v1' y
--     coherencia temporal (no futura, no absurdamente anterior al inicio).
create or replace function public.registrar_diagnostico(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session    uuid;
  v_event      text;
  v_ocurrido   timestamptz;
  v_version    quiz_versiones%rowtype;
  v_envio      diagnostico_envios%rowtype;
  v_estado     text;
  v_lead       jsonb;
  v_email      text;
  v_telefono   text;
  v_nombre     text;
  v_pais       text;
  v_persona_id uuid;
  v_capital_min numeric(14,2);
  v_capital_max numeric(14,2);
  v_hot        boolean;
  v_motivo     text;
  v_capital_a  jsonb;
  v_capital_def jsonb;
  v_consent_at timestamptz;
begin
  -- 6.1) contrato básico
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'quiz_leads/payload_invalido';
  end if;
  if coalesce(p_payload->>'schema_version','') <> '1' then
    raise exception 'quiz_leads/schema_version_no_soportada';
  end if;

  begin
    v_session := (p_payload->>'session_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'quiz_leads/session_id_invalido';
  end;
  v_event := p_payload->>'event';
  if v_event not in ('started','progress','dropped','completed') then
    raise exception 'quiz_leads/evento_invalido';
  end if;

  v_ocurrido := now();
  begin
    if p_payload ? 'occurred_at' then
      v_ocurrido := (p_payload->>'occurred_at')::timestamptz;
    end if;
  exception when others then
    v_ocurrido := now();  -- timestamp del cliente: si llega basura, manda el servidor (§11)
  end;

  -- contacto: snapshot + revalidación de forma (la EXIGENCIA se aplica en
  -- 6.4b, cuando ya se conoce el estado del envío)
  v_lead := p_payload->'lead';
  if v_lead is not null and jsonb_typeof(v_lead) = 'object' then
    v_email    := lower(btrim(coalesce(v_lead->>'email','')));
    v_telefono := btrim(coalesce(v_lead->>'phone',''));
    v_nombre   := left(btrim(coalesce(v_lead->>'name','')), 120);
    v_pais     := left(btrim(coalesce(v_lead->>'country','')), 2);
    if v_telefono <> '' and v_telefono !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'quiz_leads/telefono_invalido';
    end if;
  end if;

  -- 6.3) envío + versión (M-04):
  select * into v_envio
    from diagnostico_envios
   where session_id = v_session
   for update;
  if found then
    -- sesión existente: la definición válida es la SUYA, esté pausada o no
    select * into v_version
      from quiz_versiones
     where id = v_envio.quiz_version_id;
    if not found then
      raise exception 'quiz_leads/envio_no_encontrado';
    end if;
    if p_payload->>'quiz_version' is distinct from v_version.codigo then
      raise exception 'quiz_leads/version_conflictada: la sesion % pertenece a otra version del quiz', v_session;
    end if;
  else
    -- sesión nueva: exige versión ACTIVA publicada
    select * into v_version
      from quiz_versiones
     where codigo = p_payload->>'quiz_version'
       and estado = 'active';
    if not found then
      raise exception 'quiz_leads/quiz_version_desconocida: %', p_payload->>'quiz_version';
    end if;
    insert into diagnostico_envios
      (session_id, quiz_version_id, schema_version, estado,
       started_at, last_activity_at, last_step_id, last_step_index,
       utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer)
    values
      (v_session, v_version.id, 1,
       case v_event when 'started' then 'started' else 'in_progress' end,
       v_ocurrido, now(),
       p_payload->'progress'->>'step_id',
       (nullif(p_payload->'progress'->>'step_index','')::int),
       nullif(p_payload->'source'->>'utm_source',''),
       nullif(p_payload->'source'->>'utm_medium',''),
       nullif(p_payload->'source'->>'utm_campaign',''),
       nullif(p_payload->'source'->>'utm_content',''),
       nullif(p_payload->'source'->>'utm_term',''),
       nullif(left(p_payload->'source'->>'referrer', 500),''))
    on conflict (session_id) do nothing;
    select * into v_envio
      from diagnostico_envios
     where session_id = v_session
     for update;
    if not found then
      raise exception 'quiz_leads/envio_no_encontrado';  -- imposible: acabamos de insertarlo
    end if;
  end if;

  -- 6.4) idempotencia + exigencia de contacto:
  -- a) CUALQUIER evento sobre un envío ya completado devuelve el resultado
  --    existente (beacon tardío o retry: solo se cotejó la versión; el envío
  --    histórico no se revalida — antes, un retry incompleto fallaba).
  if v_envio.estado = 'completed' then
    return jsonb_build_object(
      'ok', true, 'session_id', v_session,
      'submission_id', v_envio.id, 'status', 'completed');
  end if;

  -- b) Consentimiento EXIGIBLE, no verificable-de-paso (v3 H-05): nombre,
  --    versión CANÓNICA del texto aceptado y fecha de aceptación parseable:
  --    ni futura ni absurdamente anterior al inicio del recorrido (tolerancia
  --    de reloj: 24 h). Sin defaults silenciosos (§7/D2).
  v_consent_at := null;
  if v_event = 'completed' then
    if v_lead is null or jsonb_typeof(v_lead) <> 'object'
       or coalesce((v_lead->'consent'->>'accepted')::boolean, false) is not true
       or v_email = '' or v_telefono = ''
       or v_nombre = ''
       or coalesce(v_lead->'consent'->>'version','') <> 'contacto-v1'
       or v_lead->'consent'->>'accepted_at' is null
       or jsonb_typeof(v_lead->'consent'->'accepted_at') not in ('string') then
      raise exception 'quiz_leads/contacto_incompleto';
    end if;
    begin
      v_consent_at := (v_lead->'consent'->>'accepted_at')::timestamptz;
    exception when others then
      raise exception 'quiz_leads/contacto_incompleto';  -- fecha de aceptacion no parseable
    end;
    if v_consent_at > now() then
      raise exception 'quiz_leads/contacto_incompleto';  -- la aceptación no puede ser futura
    end if;
    if v_envio.started_at is not null and v_consent_at < v_envio.started_at - interval '24 hours' then
      raise exception 'quiz_leads/contacto_incompleto';  -- la aceptación no puede ser anterior al recorrido (tolerancia 24 h de reloj)
    end if;
  end if;

  -- 6.5) advisory lock por contacto (solo completed): serializa dos sesiones
  -- simultáneas del mismo email+teléfono para que no creen dos personas.
  if v_event = 'completed' then
    perform pg_advisory_xact_lock(hashtext('quiz_leads:' || v_email || ':' || v_telefono));
  end if;

  -- 6.6) respuestas: validar SIEMPRE contra la definición; para completed
  -- además deben estar todas las requeridas.
  perform validar_respuestas_quiz(
    v_version.definicion,
    coalesce(p_payload->'answers','[]'::jsonb),
    v_event = 'completed'
  );

  -- 6.7) transición de estado (matriz docs/11 §7)
  v_estado := case v_event
    when 'started'   then case when v_envio.estado in ('started','in_progress') then v_envio.estado else 'started' end
    when 'progress'  then 'in_progress'
    when 'dropped'   then 'dropped'
    when 'completed' then 'completed'
  end;
  -- de dropped solo se sale hacia completed
  if v_envio.estado = 'dropped' and v_estado <> 'completed' then
    v_estado := 'dropped';
  end if;

  -- 6.8) derivar capital + lead caliente desde la definición (§8)
  if v_event = 'completed' then
    select a into v_capital_a
      from jsonb_array_elements(coalesce(p_payload->'answers','[]'::jsonb)) a
     where a->>'question_id' = v_version.definicion->'qualification'->>'question_id';

    if v_capital_a is not null then
      -- El RANGO de capital proviene de la DEFINICION publicada: el answer_id
      -- ya validado contra las opciones es el que alcanza; los importes se
      -- leen de la opcion elejida, NUNCA del value que manda el navegador
      -- (§8: el flag se calcula desde la definicion; los importes quedan bajo
      -- el mismo candado — un value falsificado no pisa ni una columna).
      select o->'value' into v_capital_def
        from jsonb_array_elements(v_version.definicion->'questions') q,
             jsonb_array_elements(coalesce(q->'options','[]'::jsonb)) o
       where q->>'id' = v_version.definicion->'qualification'->>'question_id'
         and o->>'id' = v_capital_a->>'answer_id';
      if v_capital_def is null then
        raise exception 'quiz_leads/opcion_ajena: % / %', v_version.definicion->'qualification'->>'question_id', v_capital_a->>'answer_id';
      end if;

      v_capital_min := (v_capital_def->>'min')::numeric;
      v_capital_max := (v_capital_def->>'max')::numeric;
      v_hot := v_capital_a->>'answer_id' in (
        select jsonb_array_elements_text(v_version.definicion->'qualification'->'hot_answer_ids')
      );
      v_motivo := format('hot-lead-v1: %s (%s)', v_capital_a->>'answer_id',
        case when v_hot then 'capital >= 10000 USD' else 'capital < 10000 USD' end);
    end if;
  end if;

  -- 6.9) identidad (solo completed): reutilizar el lead PROPIO de este módulo
  -- si existe; si no, crear uno nuevo con telefono_e164 = NULL (§2).
  if v_event = 'completed' then
    select e.persona_id into v_persona_id
      from diagnostico_envios e
      join personas p on p.id = e.persona_id
     where e.estado = 'completed'
       and e.email_capturado = v_email
       and e.telefono_e164_capturado = v_telefono
       and p.estado = 'lead'
     order by e.finished_at
     limit 1;

    if v_persona_id is null then
      insert into personas (estado, nombre, email, pais, telefono_e164)
      values ('lead', nullif(v_nombre,''), nullif(v_email,''), nullif(v_pais,''), null)
      returning id into v_persona_id;
    end if;
  end if;

  -- 6.10) persistir todo el estado del envío
  update diagnostico_envios set
    estado                   = v_estado,
    last_activity_at         = now(),
    -- H-09c: el paso reportado solo se registra si el envío sigue en marcha;
    -- un progress tardío sobre un envío dropped/completed NO reescribe
    -- el último paso (la métrica de abandono queda en el punto real).
    last_step_id             = case when v_estado in ('started','in_progress')
                                   then coalesce(p_payload->'progress'->>'step_id', last_step_id)
                                   else last_step_id end,
    last_step_index          = case when v_estado in ('started','in_progress')
                                   then coalesce(nullif(p_payload->'progress'->>'step_index','')::int, last_step_index)
                                   else last_step_index end,
    dropped_at               = case when v_estado = 'dropped' then coalesce(dropped_at, v_ocurrido) else dropped_at end,
    nombre_capturado         = coalesce(nullif(v_nombre,''), nombre_capturado),
    email_capturado          = coalesce(nullif(v_email,''), email_capturado),
    telefono_e164_capturado  = coalesce(nullif(v_telefono,''), telefono_e164_capturado),
    pais_capturado           = coalesce(nullif(v_pais,''), pais_capturado),
    consentimiento_aceptado  = case when v_event = 'completed' then true else consentimiento_aceptado end,
    -- (B5): los datos de consentimiento exigidos arriba se guardan tal cual
    -- llegan; ningún default convierte una ausencia en un hecho que no ocurrió.
    consentimiento_version   = case when v_event = 'completed' then nullif(v_lead->'consent'->>'version','') else consentimiento_version end,
    consentimiento_at        = case when v_event = 'completed' then v_consent_at else consentimiento_at end,
    finished_at              = case when v_event = 'completed' then coalesce(finished_at, v_ocurrido) else finished_at end,
    persona_id               = coalesce(v_persona_id, persona_id),
    capital_min_usd          = coalesce(v_capital_min, capital_min_usd),
    capital_max_usd          = coalesce(v_capital_max, capital_max_usd),
    es_lead_caliente         = coalesce(v_hot, es_lead_caliente),
    qualification_rule_version = coalesce(case when v_hot is not null then v_version.definicion->'qualification'->>'version' end, qualification_rule_version),
    motivo_calificacion      = coalesce(v_motivo, motivo_calificacion),
    diagnosis_version        = coalesce(nullif(p_payload->'diagnosis'->>'version',''), diagnosis_version),
    diagnosis_result         = coalesce(p_payload->'diagnosis'->'result', diagnosis_result)
  where id = v_envio.id
  returning * into v_envio;

  -- 6.11) upsert de respuestas por (envio_id, question_id)
  insert into diagnostico_respuestas
    (envio_id, question_id, question_type, question_text, question_order,
     answer_id, answer_text, answer_value, answered_at)
  select
    v_envio.id,
    a->>'question_id',
    a->>'type',
    -- Snapshot sellado desde la DEFINICION cuando la respuesta referencia una
    -- opción: el texto/valor persistido es el del contrato versionado, no el
    left(coalesce(
      (select q->>'text' from jsonb_array_elements(v_version.definicion->'questions') q
        where q->>'id' = a->>'question_id'),
      a->>'question_text'), 500),
    (a->>'order')::int,
    nullif(a->>'answer_id',''),
    left(nullif(coalesce(
      (select o->>'text'
         from jsonb_array_elements(v_version.definicion->'questions') q,
              jsonb_array_elements(coalesce(q->'options','[]'::jsonb)) o
        where q->>'id' = a->>'question_id' and o->>'id' = a->>'answer_id'),
      a->>'answer_text'), ''), 1000),
    coalesce(
      (select o->'value'
         from jsonb_array_elements(v_version.definicion->'questions') q,
              jsonb_array_elements(coalesce(q->'options','[]'::jsonb)) o
        where q->>'id' = a->>'question_id' and o->>'id' = a->>'answer_id'),
      a->'value'),
    (case when a ? 'answered_at' then (a->>'answered_at')::timestamptz end)
  from jsonb_array_elements(coalesce(p_payload->'answers','[]'::jsonb)) a
  on conflict (envio_id, question_id) do update set
    question_type  = excluded.question_type,
    question_text  = excluded.question_text,
    question_order = excluded.question_order,
    answer_id      = excluded.answer_id,
    answer_text    = excluded.answer_text,
    answer_value   = excluded.answer_value,
    answered_at    = coalesce(excluded.answered_at, diagnostico_respuestas.answered_at);

  return jsonb_build_object(
    'ok', true, 'session_id', v_session,
    'submission_id', v_envio.id, 'status', v_estado);
end;
$$;

-- ── 4) vincular/desvincular/descartar: lock canónico de contacto (v3 H-06) ──
-- El lock por contacto es el que usa la ingesta: así una finalización
-- concurrente NO puede colgarse de un lead que está siendo archivado o
-- descartado en el mismo instante. Orden de locks: LEAD → CONTACTO (registrar
-- toma solo contacto): sin ciclo posible.
drop function if exists public.vincular_lead_convertido(uuid, uuid);
drop function if exists public.vincular_lead_convertido(uuid, uuid, boolean, uuid);

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
  v_email_lead  text;
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

  -- idempotencia: ya archivado → solo es "nada por hacer" si el cliente
  -- recibido es de verdad aquel a quien fue vinculado (auditado), nunca un
  -- eco ciego del parámetro: un ok con un cliente equivocado haría creer al
  -- operador que este lead quedó en su cliente.
  if v_lead_estado = 'archivado' then
    if exists (
      select 1 from auditoria a
       where a.entidad = 'persona'
         and a.accion = 'vinculacion'
         and a.entidad_id = p_lead_id
         and a.datos->>'cliente_id' = p_cliente_id::text
         and coalesce((a.datos->>'revertido')::boolean, false) = false
    ) then
      return jsonb_build_object('ok', true, 'cliente_id', p_cliente_id, 'envios_reasignados', 0);
    end if;
    raise exception 'quiz_leads/lead_vinculado_a_otro_cliente';
  end if;
  if v_lead_estado is distinct from 'lead' then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  -- "creada y referenciada por este módulo" (§9.5): al menos un envío propio
  if not exists (select 1 from diagnostico_envios e where e.persona_id = p_lead_id) then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  -- LOCK CANÓNICO DE CONTACTO (v3 H-06): la ingesta serializa completados por
  -- contacto; vincular toma el MISMO candado antes de mover envíos — un
  -- completed concurrente del mismo contacto espera y, al despertar, ve el
  -- lead ya archivado (crea temporal nuevo en vez de colgarse del cliente).
  select email_capturado, telefono_e164_capturado into v_email_lead, v_tel_lead
    from diagnostico_envios
   where persona_id = p_lead_id and estado = 'completed'
   order by created_at desc
   limit 1;
  if v_tel_lead is not null then
    perform pg_advisory_xact_lock(hashtext('quiz_leads:' || coalesce(v_email_lead,'') || ':' || v_tel_lead));
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

-- ── desvincular v3: rollback ESTRICTO (v3 H-07) ─────────────────────────────
-- Si NO todos los envíos esperados siguen apuntando al cliente, el rollback
-- FALLA en vez de restaurar una parte y declarar éxito. La auditoría de la
-- desvinculación guarda el UUID real de la vinculación revertida.
drop function if exists public.desvincular_lead(uuid, uuid);
drop function if exists public.desvincular_lead(uuid, uuid, uuid);

create or replace function public.desvincular_lead(
  p_cliente_id uuid,
  p_lead_id    uuid default null,
  p_autor_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_datos       jsonb;
  v_audit_id    uuid;
  v_lead_id     uuid;
  v_lead_estado text;
  v_esperados   int;
  v_restaurados int := 0;
  v_email_lead  text;
  v_tel_lead    text;
begin
  if p_cliente_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
  end if;

  -- 1) resolver la vinculación a revertir SIN lock: la fila exacta se
  --    re-confirma dentro del lock del lead, que es lo que ambos lados mutan.
  if p_lead_id is not null then
    select a.id, a.entidad_id, a.datos into v_audit_id, v_lead_id, v_datos
      from auditoria a
     where a.entidad = 'persona'
       and a.accion = 'vinculacion'
       and a.entidad_id = p_lead_id
       and a.datos->>'cliente_id' = p_cliente_id::text
       and coalesce((a.datos->>'revertido')::boolean, false) = false
     order by a.created_at desc
     limit 1;
  else
    select a.id, a.entidad_id, a.datos into v_audit_id, v_lead_id, v_datos
      from auditoria a
     where a.entidad = 'persona'
       and a.accion = 'vinculacion'
       and a.datos->>'cliente_id' = p_cliente_id::text
       and coalesce((a.datos->>'revertido')::boolean, false) = false
     order by a.created_at desc
     limit 1;
  end if;
  if not found then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;

  -- 2) lock del lead (la MISMA clave que usa vincular)…
  perform pg_advisory_xact_lock(hashtext('quiz_leads:vincular:' || v_lead_id::text));

  -- re-verificar DENTRO del lock: la fila elegida puede haber sido revertida
  -- por otra transacción entre el paso 1 y acá.
  select a.datos into v_datos
    from auditoria a
   where a.id = v_audit_id
     and a.accion = 'vinculacion'
     and coalesce((a.datos->>'revertido')::boolean, false) = false
   for update;
  if not found then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;

  select estado into v_lead_estado from personas where id = v_lead_id for update;
  if v_lead_estado is distinct from 'archivado' then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;

  -- LOCK CANÓNICO DE CONTACTO: mismo candado que la ingesta y que vincular
  -- (v3 H-06): un completado concurrente del mismo contacto queda serializado.
  select email_capturado, telefono_e164_capturado into v_email_lead, v_tel_lead
    from diagnostico_envios
   where persona_id = v_lead_id and estado = 'completed'
   order by created_at desc
   limit 1;
  if v_tel_lead is not null then
    perform pg_advisory_xact_lock(hashtext('quiz_leads:' || coalesce(v_email_lead,'') || ':' || v_tel_lead));
  end if;

  -- 3) ROLLBACK ESTRICTO (v3 H-07): el lead debe seguir archivado (ya chequeado
  --    arriba) y TODOS los envíos esperados siguen apuntando al cliente. Si
  --    falta alguno, alguien movió envíos por fuera → abortar SIN mutar nada
  --    (se investiga, no se "cierra" falso).
  select count(*) into v_esperados
    from diagnostico_envios e
   where e.persona_id = p_cliente_id
     and e.id in (select jsonb_array_elements_text(v_datos->'envio_ids')::uuid);
  if v_esperados <> coalesce(jsonb_array_length(v_datos->'envio_ids'), 0) then
    raise exception 'quiz_leads/rollback_incompleto: % de % envios esperados siguen en el cliente; se investiga antes de revertir', v_esperados, jsonb_array_length(v_datos->'envio_ids');
  end if;

  -- devolver EXACTAMENTE los envíos registrados que sigan en el cliente
  update diagnostico_envios e
     set persona_id = v_lead_id
    from (select jsonb_array_elements_text(v_datos->'envio_ids')::uuid as id) ids
   where e.id = ids.id
     and e.persona_id = p_cliente_id;
  get diagnostics v_restaurados = row_count;

  update personas set estado = 'lead' where id = v_lead_id;

  -- 4) marcar la vinculación COMO REVERTIDA: su envio_ids ya no vuelven a ser
  --    elegidos; la próxima desvinculación de este cliente toma la anterior.
  update auditoria set datos = datos || jsonb_build_object('revertido', true, 'revertido_en', now())
   where id = v_audit_id;

  -- 5) auditoría de la desvinculación, con la referencia real (v3 H-07)
  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', v_lead_id, 'desvinculacion', p_autor_id,
          jsonb_build_object(
            'cliente_id', p_cliente_id,
            'vinculacion_audit_id', v_audit_id,
            'envio_ids', v_datos->'envio_ids',
            'envios_esperados', v_esperados,
            'envios_restaurados', v_restaurados,
            'revertido_de', v_datos->'confirmado'
          ));

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'envios_restaurados', v_restaurados);
end;
$$;

-- ── descartar v2: mismo lock canónico de contacto (v3 H-06) ────────────────
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
  v_email_lead  text;
  v_tel_lead    text;
begin
  if p_lead_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
  end if;

  perform pg_advisory_xact_lock(hashtext('quiz_leads:vincular:' || p_lead_id::text));

  select estado into v_lead_estado
    from personas p
   where p.id = p_lead_id
     and p.telefono_e164 is null
   for update;
  if not found then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  if v_lead_estado = 'descartado' then
    return jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'estado', v_lead_estado);
  end if;
  if v_lead_estado is distinct from 'lead' then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  select count(*) into v_envios from diagnostico_envios e where e.persona_id = p_lead_id;
  if v_envios = 0 then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  -- LOCK CANÓNICO DE CONTACTO: mismo candado que la ingesta (v3 H-06)
  select email_capturado, telefono_e164_capturado into v_email_lead, v_tel_lead
    from diagnostico_envios
   where persona_id = p_lead_id and estado = 'completed'
   order by created_at desc
   limit 1;
  if v_tel_lead is not null then
    perform pg_advisory_xact_lock(hashtext('quiz_leads:' || coalesce(v_email_lead,'') || ':' || v_tel_lead));
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

-- ── 5) ACL/RLS (v3 H-08) ────────────────────────────────────────────────────
-- Sin policies: el default de RLS es DENEGAR para anon/authenticated. La app
-- habla por service_role, que ignora RLS. Así el PII del funnel no queda
-- legible para cualquier JWT Supabase `authenticated`.
drop policy if exists "auth read quiz_versiones" on public.quiz_versiones;
drop policy if exists "auth read diagnostico_envios" on public.diagnostico_envios;
drop policy if exists "auth read diagnostico_respuestas" on public.diagnostico_respuestas;

-- Helper de validación: EXECUTE solo para service_role (evidencia v3: estaba
-- grantado a PUBLIC vía default de PostgreSQL).
revoke all on function public.validar_respuestas_quiz(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.validar_respuestas_quiz(jsonb, jsonb, boolean) to service_role;

-- RPC mutadores: denegar a todos, permitir solo service_role.
revoke all on function public.registrar_diagnostico(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_diagnostico(jsonb) to service_role;
revoke all on function public.vincular_lead_convertido(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.vincular_lead_convertido(uuid, uuid, boolean, uuid) to service_role;
revoke all on function public.desvincular_lead(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.desvincular_lead(uuid, uuid, uuid) to service_role;
revoke all on function public.descartar_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.descartar_lead(uuid, uuid) to service_role;

commit;
