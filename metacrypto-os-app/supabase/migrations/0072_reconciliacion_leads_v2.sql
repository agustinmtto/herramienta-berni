-- ============================================================
-- 0072 — Reconciliación v2 del módulo de leads (append-only, auditoría v4)
--
-- La 0071 re-aplicó funciones/constraints/grants pero quedó incompleta para
-- instalaciones históricas y dejó varios puntos abiertos de la auditoría v4.
-- Esta migración es el parche append-only que cierra esos puntos y vuelve a
-- garantizar que CUALQUIER base (limpia, histórica o híbrida) termina en el
-- MISMO estado final. Corre siempre `create or replace` para que valga tanto
-- sobre una base limpia (0068→0071) como sobre una histórica (versiones viejas
-- de 0068/0069/0070 + 0071).
--
-- Puntos de la auditoría v4 que cierra:
--   C1  · redefine `validar_respuestas_quiz` en su versión final: una base que
--         aplicó la 0068 VIEJA (sin el guard de respuestas_duplicadas) queda
--         equivalente a una instalación nueva.
--   C2  · inmutabilidad: bloquea "despublicar" (publicada_at → NULL) una
--         versión publicada que ya tiene envíos históricos (la evasión en dos
--         pasos: quitar la marca y luego editar).
--   I1  · cronología del consentimiento: aceptado DENTRO del recorrido
--         (ni futuro, ni anterior al inicio, ni posterior a la finalización),
--         con tolerancia de reloj chica (5 min) en vez de las 24 h laxas.
--   I2  · CHECK de completed rechaza strings VACÍOS (btrim <> '') por escritura
--         directa, no solo NULL.
--   I3  · no inventa consentimiento: las filas que la 0071 backfilleó con
--         'contacto-v1' sin evidencia real quedan con un marcador honesto
--         'legacy-sin-registro' (el checkbox existía, la VERSIÓN no consta).
--   I4a · carrera de sesión: una petición concurrente que crea la misma sesión
--         con OTRA versión pierde limpiamente (version_conflictada) en vez de
--         validar/sellar contra la versión equivocada.
--   I5  · `revertido_de` guarda el UUID de la vinculación revertida (no el
--         booleano `confirmado`).
--   I6  · el evento `dropped` registra su propio paso al TRANSITAR a abandono
--         (un abandono sin `progress` previo ya no queda como "start").
--
-- No toca 0068–0071 (ya aplicados). Número pendiente de confirmación con
-- Miled antes del release (docs/06 #19).
-- ============================================================
begin;

-- ── 1) validar_respuestas_quiz en su versión FINAL (C1) ──────────────────────
-- Copia exacta del validador definitivo de 0068. La 0071 no lo redefinió, así
-- que una base histórica conservaba el validador viejo (sin respuestas_duplicadas).
create or replace function public.validar_respuestas_quiz(
  p_definicion   jsonb,
  p_answers      jsonb,
  p_exigir_todas boolean
)
returns void
language plpgsql
as $$
declare
  v_q        jsonb;
  v_a        jsonb;
  v_opcion   jsonb;
  v_asset_id text;
  v_nivel    text;
  v_faltantes text;
  v_ids      jsonb;
  v_id       text;
begin
  if jsonb_typeof(p_answers) <> 'array' then
    raise exception 'quiz_leads/answers_invalidas';
  end if;
  if jsonb_array_length(p_answers) > 32 then
    raise exception 'quiz_leads/demasiadas_respuestas';
  end if;

  -- Cada pregunta del payload a lo sumo una vez: el upsert colapsaria
  -- silenciosamente los repetidos por (envio_id, question_id), con lo que
  -- "la ultima gana" ocultaria una manipulación en lugar de rechazarla.
  if (select count(*) from jsonb_array_elements(p_answers) a)
     <> (select count(distinct a->>'question_id') from jsonb_array_elements(p_answers) a) then
    raise exception 'quiz_leads/respuestas_duplicadas';
  end if;

  for v_a in select * from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(v_a) <> 'object' then
      raise exception 'quiz_leads/respuesta_invalida';
    end if;

    select q into v_q
      from jsonb_array_elements(p_definicion->'questions') q
     where q->>'id' = v_a->>'question_id';
    if not found then
      raise exception 'quiz_leads/pregunta_ajena: %', v_a->>'question_id';
    end if;
    if v_a->>'type' is distinct from v_q->>'type' then
      raise exception 'quiz_leads/tipo_incorrecto: %', v_a->>'question_id';
    end if;
    if length(coalesce(v_a->>'question_text','')) > 500
       or length(coalesce(v_a->>'answer_text','')) > 1000 then
      raise exception 'quiz_leads/texto_demasiado_largo: %', v_a->>'question_id';
    end if;
    if (v_a->>'order')::int < 0 then
      raise exception 'quiz_leads/orden_invalido: %', v_a->>'question_id';
    end if;

    if v_q->>'type' in ('single_choice', 'range') then
      select o into v_opcion
        from jsonb_array_elements(coalesce(v_q->'options','[]'::jsonb)) o
       where o->>'id' = v_a->>'answer_id';
      if not found then
        raise exception 'quiz_leads/opcion_ajena: % / %', v_a->>'question_id', v_a->>'answer_id';
      end if;
    elsif v_q->>'type' = 'multiple_choice' then
      v_ids := v_a->'value'->'ids';
      if jsonb_typeof(v_ids) is distinct from 'array' then
        raise exception 'quiz_leads/opcion_ajena: %', v_a->>'question_id';
      end if;
      if jsonb_array_length(v_ids) = 0 then
        raise exception 'quiz_leads/seleccion_vacia: %', v_a->>'question_id';
      end if;
      if (select count(*) from jsonb_array_elements_text(v_ids))
         <> (select count(distinct id) from jsonb_array_elements_text(v_ids) id) then
        raise exception 'quiz_leads/respuestas_duplicadas: %', v_a->>'question_id';
      end if;
      for v_id in select jsonb_array_elements_text(v_ids) loop
        if not exists (
          select 1 from jsonb_array_elements(coalesce(v_q->'options','[]'::jsonb)) o
           where o->>'id' = v_id
        ) then
          raise exception 'quiz_leads/opcion_ajena: % / %', v_a->>'question_id', v_id;
        end if;
      end loop;
    elsif v_q->>'type' = 'allocation' then
      if jsonb_typeof(v_a->'value') is distinct from 'array'
         or jsonb_array_length(v_a->'value') <> jsonb_array_length(coalesce(v_q->'assets','[]'::jsonb)) then
        raise exception 'quiz_leads/allocation_incompleta: %', v_a->>'question_id';
      end if;
      if (select count(distinct e->>'asset_id') from jsonb_array_elements(v_a->'value') e)
         <> jsonb_array_length(v_a->'value') then
        raise exception 'quiz_leads/allocation_duplicada: %', v_a->>'question_id';
      end if;
      for v_nivel, v_asset_id in
        select e->>'level', e->>'asset_id'
          from jsonb_array_elements(v_a->'value') e
      loop
        if not exists (
          select 1
            from jsonb_array_elements(coalesce(v_q->'assets','[]'::jsonb)) a
           where a->>'id' = v_asset_id
             and exists (
               select 1 from jsonb_array_elements(coalesce(a->'ranges','[]'::jsonb)) r
                where r->>'id' = v_nivel
             )
        ) then
          raise exception 'quiz_leads/allocation_invalida: % / % / %', v_a->>'question_id', v_asset_id, v_nivel;
        end if;
      end loop;
    elsif v_q->>'type' = 'number' then
      if jsonb_typeof(v_a->'value') is distinct from 'number' then
        raise exception 'quiz_leads/valor_invalido: %', v_a->>'question_id';
      end if;
    elsif v_q->>'type' = 'boolean' then
      if jsonb_typeof(v_a->'value') is distinct from 'boolean' then
        raise exception 'quiz_leads/valor_invalido: %', v_a->>'question_id';
      end if;
    else
      null;
    end if;
  end loop;

  if p_exigir_todas then
    select string_agg(q->>'id', ', ') into v_faltantes
      from jsonb_array_elements(p_definicion->'questions') q
     where (q->>'required')::boolean is true
       and not exists (
         select 1 from jsonb_array_elements(p_answers) a
          where a->>'question_id' = q->>'id'
       );
    if v_faltantes is not null then
      raise exception 'quiz_leads/preguntas_requeridas_faltantes: %', v_faltantes;
    end if;
  end if;
end;
$$;

-- ── 2) Inmutabilidad de versiones publicadas + C2 (no despublicar) ───────────
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
    select count(*) into v_envios from diagnostico_envios where quiz_version_id = old.id;
    if v_envios > 0 then
      raise exception 'quiz_versiones/publicada_es_inmutable: % tiene % envíos históricos y no se puede borrar', old.codigo, v_envios;
    end if;
    return old;
  end if;
  -- C2: una versión publicada con historial no se puede DESPUBLICAR
  -- (publicada_at → NULL): era la evasión en dos pasos (quitar la marca y
  -- después editar la definición). Sin envíos, despublicar es limpieza
  -- legítima de una versión de pruebas que nunca se usó (mismo criterio que el
  -- borrado).
  if new.publicada_at is null and old.publicada_at is not null then
    select count(*) into v_envios from diagnostico_envios where quiz_version_id = old.id;
    if v_envios > 0 then
      raise exception 'quiz_versiones/publicada_es_inmutable: % ya fue publicada y tiene % envíos; no se puede despublicar', old.codigo, v_envios;
    end if;
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

-- ── 3) registrar_diagnostico v4 (I1 cronología + I4a carrera + I6 dropped) ────
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
    -- I4a: otra petición concurrente pudo haber creado la sesión con OTRA
    -- versión antes que esta. Si es así, esta petición pierde: validar o
    -- sellar contra una versión que no es la suya corrompería el snapshot.
    if v_envio.quiz_version_id is distinct from v_version.id then
      raise exception 'quiz_leads/version_conflictada: la sesion % pertenece a otra version del quiz', v_session;
    end if;
  end if;

  -- 6.4) idempotencia + exigencia de contacto:
  if v_envio.estado = 'completed' then
    return jsonb_build_object(
      'ok', true, 'session_id', v_session,
      'submission_id', v_envio.id, 'status', 'completed');
  end if;

  -- b) Consentimiento EXIGIBLE (v3 H-05): nombre, versión CANÓNICA y fecha
  --    parseable. I1: la cronología se acota AL RECORRIDO — no futura, no
  --    anterior al inicio, no posterior a la finalización (tolerancia de reloj
  --    chica: 5 minutos, no las 24 h laxas que dejaban pasar consentimientos
  --    "antes de empezar").
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
    if v_consent_at > now() + interval '5 minutes' then
      raise exception 'quiz_leads/contacto_incompleto';  -- la aceptación no puede ser futura
    end if;
    if v_envio.started_at is not null and v_consent_at < v_envio.started_at - interval '5 minutes' then
      raise exception 'quiz_leads/contacto_incompleto';  -- anterior al inicio del recorrido
    end if;
    if v_consent_at > v_ocurrido + interval '5 minutes' then
      raise exception 'quiz_leads/contacto_incompleto';  -- posterior a la finalización
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

  -- 6.10) persistir todo el estado del envío.
  -- I6: el paso reportado se registra cuando el envío AVANZA a un paso:
  --   · `progress` → actualiza al paso visible (avance/retroceso/primera pregunta).
  --   · `dropped` transitando desde started/in_progress → guarda el paso exacto
  --     del abandono.
  --   · `started` sobre un envío YA existente NO reescribe el paso (evita que un
  --     retry/beacon tardío de "started" pise la primera pregunta ya registrada).
  --   · `completed`/`dropped` ya asentados → no reescriben nada.
  update diagnostico_envios set
    estado                   = v_estado,
    last_activity_at         = now(),
    last_step_id             = case
        when v_event = 'progress'
          then coalesce(p_payload->'progress'->>'step_id', last_step_id)
        when v_event = 'dropped' and v_envio.estado is distinct from 'dropped'
          then coalesce(p_payload->'progress'->>'step_id', last_step_id)
        else last_step_id
      end,
    last_step_index          = case
        when v_event = 'progress'
          then coalesce(nullif(p_payload->'progress'->>'step_index','')::int, last_step_index)
        when v_event = 'dropped' and v_envio.estado is distinct from 'dropped'
          then coalesce(nullif(p_payload->'progress'->>'step_index','')::int, last_step_index)
        else last_step_index
      end,
    dropped_at               = case when v_estado = 'dropped' then coalesce(dropped_at, v_ocurrido) else dropped_at end,
    nombre_capturado         = coalesce(nullif(v_nombre,''), nombre_capturado),
    email_capturado          = coalesce(nullif(v_email,''), email_capturado),
    telefono_e164_capturado  = coalesce(nullif(v_telefono,''), telefono_e164_capturado),
    pais_capturado           = coalesce(nullif(v_pais,''), pais_capturado),
    consentimiento_aceptado  = case when v_event = 'completed' then true else consentimiento_aceptado end,
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

-- ── 4) vincular_lead_convertido (v3, lock canónico de contacto) ──────────────
-- Copia de la versión final de 0071. Orden de locks: LEAD → CONTACTO.
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

  select estado into v_lead_estado
    from personas p
   where p.id = p_lead_id
     and p.telefono_e164 is null
   for update;
  if not found then
    raise exception 'quiz_leads/lead_invalido';
  end if;

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
  if not exists (select 1 from diagnostico_envios e where e.persona_id = p_lead_id) then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  select email_capturado, telefono_e164_capturado into v_email_lead, v_tel_lead
    from diagnostico_envios
   where persona_id = p_lead_id and estado = 'completed'
   order by created_at desc
   limit 1;
  if v_tel_lead is not null then
    perform pg_advisory_xact_lock(hashtext('quiz_leads:' || coalesce(v_email_lead,'') || ':' || v_tel_lead));
  end if;

  if not exists (
    select 1 from personas p
     where p.id = p_cliente_id and p.estado = 'cliente'
  ) or not exists (
    select 1 from programas g where g.persona_id = p_cliente_id
  ) then
    raise exception 'quiz_leads/cliente_invalido';
  end if;

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

  select coalesce(array_agg(id), '{}') into v_envio_ids
    from diagnostico_envios where persona_id = p_lead_id;

  update diagnostico_envios
     set persona_id = p_cliente_id
   where persona_id = p_lead_id;
  get diagnostics v_reasignados = row_count;

  update personas set estado = 'archivado' where id = p_lead_id;

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

-- ── 5) desvincular v4: rollback ESTRICTO + revertido_de con UUID real (I5) ───
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

  perform pg_advisory_xact_lock(hashtext('quiz_leads:vincular:' || v_lead_id::text));

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

  select email_capturado, telefono_e164_capturado into v_email_lead, v_tel_lead
    from diagnostico_envios
   where persona_id = v_lead_id and estado = 'completed'
   order by created_at desc
   limit 1;
  if v_tel_lead is not null then
    perform pg_advisory_xact_lock(hashtext('quiz_leads:' || coalesce(v_email_lead,'') || ':' || v_tel_lead));
  end if;

  select count(*) into v_esperados
    from diagnostico_envios e
   where e.persona_id = p_cliente_id
     and e.id in (select jsonb_array_elements_text(v_datos->'envio_ids')::uuid);
  if v_esperados <> coalesce(jsonb_array_length(v_datos->'envio_ids'), 0) then
    raise exception 'quiz_leads/rollback_incompleto: % de % envios esperados siguen en el cliente; se investiga antes de revertir', v_esperados, jsonb_array_length(v_datos->'envio_ids');
  end if;

  update diagnostico_envios e
     set persona_id = v_lead_id
    from (select jsonb_array_elements_text(v_datos->'envio_ids')::uuid as id) ids
   where e.id = ids.id
     and e.persona_id = p_cliente_id;
  get diagnostics v_restaurados = row_count;

  update personas set estado = 'lead' where id = v_lead_id;

  update auditoria set datos = datos || jsonb_build_object('revertido', true, 'revertido_en', now())
   where id = v_audit_id;

  -- I5: `revertido_de` guarda el UUID de la vinculación revertida, no el
  -- booleano `confirmado` de la vinculación original.
  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', v_lead_id, 'desvinculacion', p_autor_id,
          jsonb_build_object(
            'cliente_id', p_cliente_id,
            'vinculacion_audit_id', v_audit_id,
            'envio_ids', v_datos->'envio_ids',
            'envios_esperados', v_esperados,
            'envios_restaurados', v_restaurados,
            'revertido_de', v_audit_id
          ));

  return jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'envios_restaurados', v_restaurados);
end;
$$;

-- ── 6) descartar_lead (v2, lock canónico de contacto) ────────────────────────
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

-- ── 7) CHECK de completed endurecido contra strings vacíos (I2) ──────────────
alter table public.diagnostico_envios drop constraint if exists diagnostico_envios_completed_completo_check;

alter table public.diagnostico_envios add constraint diagnostico_envios_completed_completo_check
  check (
    estado <> 'completed' or (
      persona_id              is not null
      and nombre_capturado    is not null and btrim(nombre_capturado) <> ''
      and email_capturado     is not null and btrim(email_capturado) <> ''
      and telefono_e164_capturado is not null and btrim(telefono_e164_capturado) <> ''
      and consentimiento_aceptado is true
      and consentimiento_version is not null and btrim(consentimiento_version) <> ''
      and consentimiento_at   is not null
      and finished_at         is not null
    )
  );

-- ── 8) I3: no inventar consentimiento en filas históricas ────────────────────
-- La 0071 backfilleó consentimiento_version='contacto-v1' y consentimiento_at
-- para filas completed que no lo tenían documentado. La firma del backfill es
-- `consentimiento_at = finished_at` (coalesce(consentimiento_at, finished_at,
-- now())). Esas filas se corrigen a un marcador honesto: el checkbox de
-- consentimiento existía (accepted=true lo puso el RPC siempre), pero la
-- VERSIÓN del texto aceptado nunca quedó registrada — no se afirma 'contacto-v1'.
update public.diagnostico_envios
   set consentimiento_version = 'legacy-sin-registro'
 where estado = 'completed'
   and consentimiento_version = 'contacto-v1'
   and consentimiento_at = finished_at;

-- ── 9) ACL/RLS (v3 H-08): grants finales ─────────────────────────────────────
revoke all on function public.validar_respuestas_quiz(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.validar_respuestas_quiz(jsonb, jsonb, boolean) to service_role;

revoke all on function public.registrar_diagnostico(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_diagnostico(jsonb) to service_role;
revoke all on function public.vincular_lead_convertido(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.vincular_lead_convertido(uuid, uuid, boolean, uuid) to service_role;
revoke all on function public.desvincular_lead(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.desvincular_lead(uuid, uuid, uuid) to service_role;
revoke all on function public.descartar_lead(uuid, uuid) from public, anon, authenticated;
grant execute on function public.descartar_lead(uuid, uuid) to service_role;

commit;
