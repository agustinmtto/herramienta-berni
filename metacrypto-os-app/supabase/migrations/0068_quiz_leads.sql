-- ============================================================
-- 0068 — Quiz Funnel: módulo de leads (docs/11) — MIGRACIÓN ÚNICA DEL MÓDULO
--
-- Estado FINAL consolidado del módulo. Sustituye al histórico 0068–0073
-- (auditorías v3/v4/v5): esas migraciones nunca llegaron a producción y este
-- archivo reúne su resultado convergente sin el aparato de compatibilidad para
-- instalaciones históricas (staging de preflight, taxonomía `legacy-unknown`,
-- doble familia de advisory locks, validaciones duplicadas en trigger).
--
-- Lo que vive acá (y valido el funnel en su totalidad):
--   · 3 tablas: quiz_versiones (definiciones inmutables al publicar),
--     diagnostico_envios (un recorrido por session_id) y diagnostico_respuestas
--     (una fila por pregunta respondida).
--   · RPCs: registrar_diagnostico (ingesta transaccional e idempotente),
--     vincular_lead_convertido / desvincular_lead / descartar_lead (post-venta).
--   · Helper interno validar_respuestas_quiz + locks y guardas por base.
--   · RLS habilitada SIN policies (denegado por defecto); EXECUTE solo para
--     service_role. La app usa service_role desde el servidor (docs/09).
--   · Definición vigente: diagnostico-cripto-v1-a (8 preguntas + calificación
--     hot-lead-v1: los rangos desde 10.000 USD inclusive son calientes).
--
-- AISLAMIENTO (docs/11 D3/D4): este módulo NO busca, reutiliza ni modifica
-- clientes ni personas ajenas. La primera finalización de un contacto crea una
-- fila de personas con estado='lead' y telefono_e164 = NULL (el UNIQUE de
-- personas.telefono_e164 impediría dos leads con el mismo teléfono — el
-- teléfono real, obligatorio y normalizado E.164, vive en el snapshot de
-- diagnostico_envios, que es de donde lee el módulo /leads. Postgres permite
-- múltiples NULL bajo un UNIQUE, así que no se toca el esquema existente).
--
-- El teléfono y el email llegan ya normalizados desde el endpoint; el RPC
-- revalida. El flag de lead caliente se calcula AQUÍ desde la definición
-- almacenada y la respuesta estructurada — nunca desde el navegador.
-- ============================================================
begin;

-- ── 0) Convergencia desde estados previos del módulo ────────────────────────
-- Por si algún entorno ya aplicó versiones viejas de estas piezas (local o un
-- snapshot manual): limpia lo que este archivo ya no define. Sobre una base
-- fresca todas las sentencias son no-ops seguros.
do $$ begin
  if to_regclass('public.diagnostico_envios') is not null then
    execute 'alter table public.diagnostico_envios
      drop column if exists registro_origen,
      drop column if exists consentimiento_origen';
  end if;
end $$;
drop table if exists public.quiz_leads_legacy_upgrade_stage;
drop function if exists public.diagnostico_envios_guard_v3();
drop function if exists public.diag_envios_estado_guard();
drop function if exists public.registrar_diagnostico_v2_internal(jsonb);
drop function if exists public.vincular_lead_convertido(uuid, uuid);
drop function if exists public.desvincular_lead(uuid, uuid);

-- ── 1) quiz_versiones ────────────────────────────────────────────────────────
-- Una fila por versión/variante A/B. La definición (preguntas, opciones,
-- reglas de calificación) es INMUTABLE una vez publicada: cambiar el quiz
-- significa publicar otra versión, no editar esta fila.
create table if not exists public.quiz_versiones (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null,
  funnel       text not null,
  variante     text not null default 'control',
  version      integer not null check (version > 0),
  estado       text not null default 'draft' check (estado in ('draft','active','paused','archived')),
  definicion   jsonb not null,
  publicada_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint quiz_versiones_codigo_key unique (codigo),
  constraint quiz_versiones_variante_key unique (funnel, variante, version)
);

-- ── 2) diagnostico_envios ────────────────────────────────────────────────────
-- Un recorrido completo o parcial. Idempotencia por session_id: el mismo
-- recorrido nunca crea dos filas.
create table if not exists public.diagnostico_envios (
  id                       uuid primary key default gen_random_uuid(),
  session_id               uuid not null,
  quiz_version_id          uuid not null references public.quiz_versiones(id),
  persona_id               uuid references public.personas(id),
  schema_version           integer not null default 1,
  estado                   text not null default 'started'
                           check (estado in ('started','in_progress','dropped','completed')),
  nombre_capturado         text,
  email_capturado          text,
  telefono_e164_capturado  text,
  pais_capturado           text,
  consentimiento_aceptado  boolean,
  consentimiento_version   text,
  consentimiento_at        timestamptz,
  started_at               timestamptz,
  last_activity_at         timestamptz,
  finished_at              timestamptz,
  dropped_at               timestamptz,
  last_step_id             text,
  last_step_index          integer check (last_step_index is null or last_step_index >= 0),
  utm_source               text,
  utm_medium               text,
  utm_campaign             text,
  utm_content              text,
  utm_term                 text,
  referrer                 text,
  capital_min_usd          numeric(14,2) check (capital_min_usd is null or capital_min_usd >= 0),
  capital_max_usd          numeric(14,2),
  es_lead_caliente         boolean,
  qualification_rule_version text,
  motivo_calificacion      text,
  diagnosis_version        text,
  diagnosis_result         jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint diagnostico_envios_session_id_key unique (session_id),
  constraint diagnostico_envios_capital_rango_check
    check (capital_max_usd is null or capital_min_usd is null or capital_max_usd >= capital_min_usd),
  -- completed exige identidad resuelta, contacto y consentimiento reales,
  -- defendido por la base y no solo por el endpoint (docs/11 §7): nombres y
  -- claves sin strings vacíos, E.164 realista y la versión canónica del
  -- consentimiento (contacto-v1).
  constraint diagnostico_envios_completed_check check (
    estado <> 'completed' or (
      persona_id              is not null
      and nombre_capturado    is not null and btrim(nombre_capturado) <> ''
      and email_capturado     is not null and btrim(email_capturado) <> ''
      and telefono_e164_capturado is not null and btrim(telefono_e164_capturado) <> ''
      and telefono_e164_capturado ~ '^\+[1-9][0-9]{7,14}$'
      and consentimiento_aceptado is true
      and consentimiento_version = 'contacto-v1'
      and consentimiento_at   is not null
      and finished_at         is not null
    )
  ),
  -- dropped exige el momento del abandono
  constraint diagnostico_envios_dropped_con_fecha_check
    check (estado <> 'dropped' or dropped_at is not null)
);

create index if not exists idx_diag_envios_version_created
  on public.diagnostico_envios (quiz_version_id, created_at desc);
create index if not exists idx_diag_envios_estado_created
  on public.diagnostico_envios (estado, created_at desc);
create index if not exists idx_diag_envios_caliente_created
  on public.diagnostico_envios (es_lead_caliente, created_at desc);
-- El módulo /leads localiza el lead por contacto capturado, no por personas
-- (el teléfono del lead temporal es NULL en personas a propósito).
create index if not exists idx_diag_envios_contacto
  on public.diagnostico_envios (telefono_e164_capturado, email_capturado);
create index if not exists idx_diag_envios_persona
  on public.diagnostico_envios (persona_id);

-- updated_at automático en cada update
create or replace function public.diag_envios_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tg_diag_envios_touch_updated_at on public.diagnostico_envios;
create trigger tg_diag_envios_touch_updated_at
  before update on public.diagnostico_envios
  for each row execute function public.diag_envios_touch_updated_at();

-- ── 3) diagnostico_respuestas ────────────────────────────────────────────────
-- Genéricas por diseño: no hay una columna por pregunta. El módulo renderiza
-- cualquier pregunta futura desde sus snapshots (docs/11 §3.3).
create table if not exists public.diagnostico_respuestas (
  id             uuid primary key default gen_random_uuid(),
  envio_id       uuid not null references public.diagnostico_envios(id) on delete cascade,
  question_id    text not null,
  question_type  text not null,
  question_text  text not null,
  question_order integer not null check (question_order >= 0),
  answer_id      text,
  answer_text    text,
  answer_value   jsonb,
  answered_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint diagnostico_respuestas_envio_question_key unique (envio_id, question_id)
);

create index if not exists idx_diag_respuestas_pregunta
  on public.diagnostico_respuestas (question_id, answer_id);

-- ── 4) guard de estados: la base defiende la matriz sola ────────────────────
-- Dos reglas, sin más: un envío completed JAMÁS retrocede ni se edita (salvo
-- el cambio de propietario que hacen las RPC de vinculación), y un dropped ya
-- no recibe más eventos (salvo la finalización contractual). Las demás
-- validaciones viven en el RPC, su única fuente de escritura.
create or replace function public.diag_envios_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_persona_id uuid;
begin
  if tg_op = 'UPDATE' and old.estado = 'completed' and new is distinct from old then
    -- Vincular/desvincular cambia exclusivamente el propietario durable del
    -- snapshot: se compara el resto de la fila con el propietario neutralizado.
    v_persona_id := new.persona_id;
    new.persona_id := old.persona_id;
    if new is distinct from old then
      raise exception 'quiz_leads/completed_es_inmutable';
    end if;
    new.persona_id := v_persona_id;
  end if;
  if tg_op = 'UPDATE' and old.estado = 'dropped' and new.estado <> 'completed' and new is distinct from old then
    raise exception 'quiz_leads/dropped_es_terminal';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_diag_envios_estado_guard on public.diagnostico_envios;
drop trigger if exists tg_diag_envios_guard_v3 on public.diagnostico_envios;
drop trigger if exists tg_diag_envios_guard on public.diagnostico_envios;
create trigger tg_diag_envios_guard
  before insert or update on public.diagnostico_envios
  for each row execute function public.diag_envios_guard();

-- ── 5) estado 'descartado' en personas (docs/11 §9.4) ────────────────────────
-- Único cambio sobre el esquema preexistente del OS, append-only: se sustituye
-- el constraint con la lista ampliada; de encontrar la lista original se
-- conserva el mismo nombre del constraint.
alter table public.personas drop constraint if exists personas_estado_check;
alter table public.personas add constraint personas_estado_check
  check (estado in ('lead','reservado','cliente','ex_cliente','archivado','descartado'));

-- ── 6) RLS: habilitada y SIN policies (docs/11 §11) ─────────────────────────
-- Lectura para NADIE directo; escritura NADIE directo: todo entra por los RPC
-- con service_role desde el servidor (el endpoint público no expone la clave).
-- El default cuando no hay policies es denegar.
alter table public.quiz_versiones         enable row level security;
alter table public.diagnostico_envios     enable row level security;
alter table public.diagnostico_respuestas enable row level security;
drop policy if exists "auth read quiz_versiones" on public.quiz_versiones;
drop policy if exists "auth read diagnostico_envios" on public.diagnostico_envios;
drop policy if exists "auth read diagnostico_respuestas" on public.diagnostico_respuestas;

-- ── 7) Validación de respuestas contra la definición ────────────────────────
-- El navegador no define la verdad: toda respuesta se coteja contra la
-- definición publicada (docs/11 §5). Errores con prefijo quiz_leads/ para que
-- el endpoint los mapee a códigos HTTP honestos sin filtrar detalles internos.
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

  -- Cada pregunta del payload a lo sumo una vez: el upsert colapsaría
  -- silenciosamente los repetidos por (envio_id, question_id), con lo que
  -- "la última gana" ocultaría una manipulación en lugar de rechazarla.
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
      -- La selección vacía y los ids repetidos no son válidos: "no elegir nada"
      -- no es una respuesta, y duplicar un id solo ganaría el upsert sin
      -- representar algo que el lead haya marcado.
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
      -- Cada activo EXACTAMENTE una vez: el largo iguala al de los activos,
      -- pero si un activo aparece dos veces otro queda sin rango — un hueco
      -- imposible de distinguir después en el snapshot.
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
      -- text y cualquier tipo futuro: valor opcional, longitudes ya acotadas
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

-- ── 8) Inmutabilidad de versiones publicadas ────────────────────────────────
-- Publicar es irreversible aunque nunca haya habido envíos. Drafts sin
-- publicar se editan y borran libremente.
create or replace function public.quiz_versiones_congelada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.publicada_at is null then return old; end if;
    raise exception 'quiz_versiones/publicada_es_inmutable: % ya fue publicada', old.codigo;
  end if;

  if old.publicada_at is not null then
    if new.id is distinct from old.id
       or new.codigo is distinct from old.codigo
       or new.funnel is distinct from old.funnel
       or new.variante is distinct from old.variante
       or new.version is distinct from old.version
       or new.definicion is distinct from old.definicion
       or new.created_at is distinct from old.created_at
       or new.publicada_at is distinct from old.publicada_at
       or new.estado not in ('active', 'paused', 'archived') then
      raise exception 'quiz_versiones/publicada_es_inmutable: % ya fue publicada', old.codigo;
    end if;
  elsif new.publicada_at is not null and new.estado not in ('active', 'paused', 'archived') then
    raise exception 'quiz_versiones/estado_publicado_invalido';
  elsif new.publicada_at is null and new.estado not in ('draft', 'archived') then
    raise exception 'quiz_versiones/estado_draft_invalido';
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

-- ── 9) Helpers: la única clave de serialización del contacto ────────────────
-- TODO el ciclo comercial (completar / vincular / desvincular / descartar)
-- serializa con LA MISMA clave derivada del teléfono E.164 canónico.
create or replace function public.quiz_lead_contact_lock_key(p_phone text)
returns bigint
language sql
immutable strict
set search_path = public
as $$ select hashtextextended('quiz-leads/contact/v1:' || p_phone, 0) $$;

-- El funnel declara el catálogo de países en el cliente y el endpoint
-- revalida el E.164; este cross-check (una sola vez, en el RPC) rechaza
-- combinaciones incoherentes de país y prefijo que se cuelen hasta acá.
create or replace function public.quiz_phone_matches_country(p_country text, p_phone text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_phone ~ '^\+[1-9][0-9]{7,14}$' and p_phone like case upper(p_country)
    when 'AR' then '+549%' when 'BO' then '+591%' when 'BR' then '+55%'
    when 'CA' then '+1%' when 'CL' then '+56%' when 'CO' then '+57%'
    when 'CR' then '+506%' when 'EC' then '+593%' when 'ES' then '+34%'
    when 'US' then '+1%' when 'MX' then '+52%' when 'PA' then '+507%'
    when 'PY' then '+595%' when 'PE' then '+51%' when 'DO' then '+1809%'
    when 'UY' then '+598%' when 'VE' then '+58%' else '#invalid#' end;
$$;

-- ── 10) RPC de ingesta: registrar_diagnostico(p_payload jsonb) ───────────────
-- Una transacción, todo-o-nada (docs/11 §7). Idempotencias: session_id no
-- duplica; completed nunca retrocede ni re-crea persona. Locks: por sesión
-- (completed) antes que por contacto — dos completed de la misma sesión no
-- pueden reconciliar el resultado ganador con el contacto del request
-- perdedor; el lock de contacto serializa contra vincular/rollback/descarte.
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
  v_pais_upper text;
  v_persona_id uuid;
  v_capital_min numeric(14,2);
  v_capital_max numeric(14,2);
  v_hot        boolean;
  v_motivo     text;
  v_capital_a  jsonb;
  v_capital_def jsonb;
  v_consent_at timestamptz;
  v_step_index int;
  -- reconciliación de identidad post-finalización:
  v_audit_id        uuid;
  v_persona_destino uuid;
  v_current_persona uuid;
  v_envio_ids       jsonb;
begin
  -- 10.1) contrato básico
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

  -- 10.2) contacto: snapshot + revalidación de forma (la EXIGENCIA se aplica
  -- después, cuando ya se conoce el estado del envío; D2: los abandonos
  -- previos al contacto pueden no llevar datos).
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

  -- 10.3) lock de sesión para completed: serializa dobles clic / retries
  -- simultáneos del mismo recorrido antes de escribir o leer nada.
  if v_event = 'completed' then
    perform pg_advisory_xact_lock(hashtextextended(
      'quiz-leads/session/v1:' || v_session::text, 0
    ));
  end if;

  -- 10.4) envío + versión (M-04):
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

  -- 10.5) idempotencia sellada: CUALQUIER evento sobre un envío ya completado
  -- devuelve el resultado existente (el beacon tardío o el retry cae acá: solo
  -- se cotejó la versión, no el consentimiento ni las respuestas de un envío
  -- que ya es un hecho) — y el contacto mutable del retry no reasigna identidad.
  if v_envio.estado = 'completed' then
    return jsonb_build_object(
      'ok', true, 'session_id', v_session,
      'submission_id', v_envio.id, 'status', 'completed');
  end if;

  -- 10.6) contacto y coherencia país↔prefijo del completed. Llegando acá, el
  -- envío no está sellado: el contacto es el que define la persona.
  v_consent_at := null;
  if v_event = 'completed' then
    -- Consentimiento EXIGIBLE (v3 H-05): nombre, versión CANÓNICA y fecha
    -- parseable (I1: la cronología se acota AL RECORRIDO — no futura, no
    -- anterior al inicio, no posterior a la finalización, tolerancia 5 min).
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
      raise exception 'quiz_leads/contacto_incompleto';  -- fecha de aceptación no parseable
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

    -- Coherencia país↔prefijo (cross-check del catálogo); un teléfono sin
    -- país declarado no es coherente con móvil del funnel.
    v_pais_upper := upper(btrim(coalesce(v_lead->>'country','')));
    if v_pais_upper = ''
       or not public.quiz_phone_matches_country(v_pais_upper, v_telefono) then
      raise exception 'quiz_leads/telefono_pais_incoherente';
    end if;

    -- 10.7) advisory lock por contacto: serializa dos sesiones simultáneas del
    -- mismo teléfono para que no creen dos personas, y disputas contra
    -- vincular/desvincular/descartar (que toman la MISMA clave).
    perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_telefono));
  end if;

  -- 10.8) respuestas: validar SIEMPRE contra la definición; para completed
  -- además deben estar todas las requeridas.
  perform validar_respuestas_quiz(
    v_version.definicion,
    coalesce(p_payload->'answers','[]'::jsonb),
    v_event = 'completed'
  );

  -- 10.9) el paso reportado pertenece a la definición publicada (antes lo
  -- defendía un trigger por fila; el RPC es la única fuente de escritura).
  if coalesce(p_payload->'progress'->>'step_id','') <> '' then
    begin
      v_step_index := (p_payload->'progress'->>'step_index')::int;
    exception when others then
      raise exception 'quiz_leads/paso_invalido';
    end;
    if not exists (
      select 1
        from jsonb_array_elements_text(coalesce(v_version.definicion->'steps', '[]'::jsonb))
          with ordinality as s(step_id, pos)
       where s.step_id = p_payload->'progress'->>'step_id'
         and (v_step_index is null or s.pos - 1 = v_step_index)
    ) then
      raise exception 'quiz_leads/paso_invalido';
    end if;
  end if;

  -- 10.10) transición de estado (matriz docs/11 §7)
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

  -- 10.11) derivar capital + lead caliente desde la definición (§8)
  if v_event = 'completed' then
    select a into v_capital_a
      from jsonb_array_elements(coalesce(p_payload->'answers','[]'::jsonb)) a
     where a->>'question_id' = v_version.definicion->'qualification'->>'question_id';

    if v_capital_a is not null then
      -- El RANGO de capital proviene de la DEFINICION publicada: el answer_id
      -- ya validado contra las opciones es el que alcanza; los importes se
      -- leen de la opción elegida, NUNCA del value que manda el navegador
      -- (§8: el flag se calcula desde la definición, los importes quedan bajo
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

  -- 10.12) identidad (solo completed): reutilizar el lead PROPIO de este
  -- módulo si existe; si no, crear uno nuevo con telefono_e164 = NULL (§2).
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

  -- 10.13) persistir todo el estado del envío.
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

  -- 10.14) upsert de respuestas por (envio_id, question_id)
  insert into diagnostico_respuestas
    (envio_id, question_id, question_type, question_text, question_order,
     answer_id, answer_text, answer_value, answered_at)
  select
    v_envio.id,
    a->>'question_id',
    a->>'type',
    -- Snapshot sellado desde la DEFINICION cuando la respuesta referencia una
    -- opción: el texto/valor persistido es el del contrato versionado, no el
    -- que tramite el navegador. Sin id delegable (allocation, number, boolean)
    -- cae al snapshot del cliente, con largos ya acotados por la validación.
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

  -- 10.15) reconciliación de identidad post-finalización. Si el contacto ya
  -- estaba vinculado, el nuevo envío forma parte de ESA vinculación (se añade
  -- al conjunto auditado para que un rollback posterior siga siendo exacto,
  -- incluso si completar y desvincular compitieron). Sin vinculación activa,
  -- el teléfono canónico define una sola identidad lead.
  if v_event = 'completed' then
    v_current_persona := v_envio.persona_id;

    select a.id, (a.datos->>'cliente_id')::uuid into v_audit_id, v_persona_destino
      from auditoria a
      join personas destino on destino.id = (a.datos->>'cliente_id')::uuid
     where a.entidad = 'persona' and a.accion = 'vinculacion'
       and destino.estado = 'cliente'
       and coalesce((a.datos->>'revertido')::boolean, false) = false
       and exists (
         select 1
           from jsonb_array_elements_text(coalesce(a.datos->'envio_ids','[]'::jsonb)) x(id)
           join diagnostico_envios e on e.id = x.id::uuid
          where e.telefono_e164_capturado = v_telefono
       )
     order by a.created_at desc, a.id desc
     limit 1
     for update;

    if v_audit_id is not null then
      update diagnostico_envios set persona_id = v_persona_destino where id = v_envio.id;
      select jsonb_agg(id order by id) into v_envio_ids from (
        select value::uuid id from auditoria a2,
          jsonb_array_elements_text(coalesce(a2.datos->'envio_ids','[]'::jsonb)) x(value)
         where a2.id = v_audit_id
        union
        select v_envio.id
      ) ids;
      update auditoria
         set datos = jsonb_set(jsonb_set(datos, '{envio_ids}', v_envio_ids),
                               '{envios_reasignados}', to_jsonb(jsonb_array_length(v_envio_ids)))
       where id = v_audit_id;
    else
      select e.persona_id into v_persona_destino
        from diagnostico_envios e join personas p on p.id = e.persona_id
       where e.estado = 'completed'
         and e.telefono_e164_capturado = v_telefono
         and p.estado = 'lead'
       order by e.created_at, e.id
       limit 1;
      if v_persona_destino is not null and v_persona_destino <> v_current_persona then
        update diagnostico_envios set persona_id = v_persona_destino where id = v_envio.id;
      end if;
    end if;

    -- El temporal duplicado (creado en esta finalización) se elimina si quedó
    -- sin envíos: no borrarlo dejaría dos leads activos para el mismo contacto.
    if v_persona_destino is not null and v_current_persona <> v_persona_destino
       and not exists (select 1 from diagnostico_envios where persona_id = v_current_persona) then
      delete from personas where id = v_current_persona and estado = 'lead' and telefono_e164 is null;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'session_id', v_session,
    'submission_id', v_envio.id, 'status', v_estado);
end;
$$;

-- ── 11) RPC de conversión: vincular_lead_convertido ──────────────────────────
-- Post-venta (docs/11 §9): el flujo de ventas existente creó al cliente
-- definitivo; desde /leads se reasignan los diagnósticos del lead temporal a
-- ese cliente y el temporal se archiva. No toca datos del cliente. Idempotente.
-- El contacto y el conjunto exacto de envíos se releen DESPUÉS del lock
-- canónico; la auditoría NO guarda teléfonos (envio_ids es la fuente del rollback).
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
  v_estado text;
  v_phone text;
  v_client_phone text;
  v_ids uuid[];
  v_count int;
begin
  if p_lead_id is null or p_cliente_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
  end if;
  if p_lead_id = p_cliente_id then
    raise exception 'quiz_leads/misma_persona';
  end if;

  select e.telefono_e164_capturado into v_phone
    from diagnostico_envios e
   where e.persona_id = p_lead_id and e.estado = 'completed'
   order by e.created_at desc, e.id desc limit 1;
  if v_phone is null then
    select e.telefono_e164_capturado into v_phone
      from auditoria a
      cross join lateral jsonb_array_elements_text(coalesce(a.datos->'envio_ids','[]'::jsonb)) x(id)
      join diagnostico_envios e on e.id = x.id::uuid
     where a.entidad = 'persona' and a.accion = 'vinculacion' and a.entidad_id = p_lead_id
     order by a.created_at desc, a.id desc limit 1;
  end if;
  if v_phone is null then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone));

  -- origen: persona lead/archivada de este módulo (sin teléfono: los leads
  -- del funnel nacen con telefono_e164 NULL, docs/11 §2)
  select estado into v_estado
    from personas p
   where p.id = p_lead_id
     and p.telefono_e164 is null
   for update;
  if not found then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  -- idempotencia: ya archivado hacia el mismo cliente → nada por hacer
  if v_estado = 'archivado' then
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
  if v_estado is distinct from 'lead' then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  select telefono_e164 into v_client_phone
    from personas
   where id = p_cliente_id and estado = 'cliente'
   for update;
  if not found or not exists (select 1 from v_programa_activo where persona_id = p_cliente_id) then
    raise exception 'quiz_leads/cliente_invalido';
  end if;

  select coalesce(array_agg(e.id order by e.id), '{}'), count(*) into v_ids, v_count
    from diagnostico_envios e where e.persona_id = p_lead_id;
  if v_count = 0 or not exists (
    select 1 from diagnostico_envios e
     where e.persona_id = p_lead_id and e.estado = 'completed' and e.telefono_e164_capturado = v_phone
  ) then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  if v_phone is distinct from v_client_phone and p_confirmar is not true then
    raise exception 'quiz_leads/telefono_no_coincide';
  end if;

  update diagnostico_envios set persona_id = p_cliente_id
   where id = any(v_ids) and persona_id = p_lead_id;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then
    raise exception 'quiz_leads/conjunto_envios_cambio';
  end if;

  -- el temporal no se borra: queda archivado como rastro (§9.8)
  update personas set estado = 'archivado' where id = p_lead_id and estado = 'lead';
  if not found then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', p_lead_id, 'vinculacion', p_autor_id,
          jsonb_build_object(
            'cliente_id', p_cliente_id,
            'envio_ids', to_jsonb(v_ids),
            'envios_reasignados', v_count,
            'confirmado', coalesce(p_confirmar, false),
            'regla', 'hot-lead-v1'
          ));

  return jsonb_build_object('ok', true, 'cliente_id', p_cliente_id, 'envios_reasignados', v_count);
end;
$$;

-- ── 12) RPC de rollback: desvincular_lead ────────────────────────────────────
-- El contacto se deriva de los UUID auditados, nunca del propietario actual
-- del envío. Auditoría, persona y propietarios se revalidan post-lock.
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
  v_audit_id uuid;
  v_lead_id  uuid;
  v_data     jsonb;
  v_phone    text;
  v_ids      uuid[];
  v_state    text;
  v_restore_persona uuid;
  v_expected int;
  v_restored int;
begin
  if p_cliente_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
  end if;

  select a.id, a.entidad_id, a.datos into v_audit_id, v_lead_id, v_data
    from auditoria a
   where a.entidad = 'persona'
     and a.accion = 'vinculacion'
     and (p_lead_id is null or a.entidad_id = p_lead_id)
     and a.datos->>'cliente_id' = p_cliente_id::text
     and coalesce((a.datos->>'revertido')::boolean, false) = false
   order by a.created_at desc, a.id desc
   limit 1;
  if not found then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;
  select coalesce(array_agg(x.id::uuid order by x.id::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(v_data->'envio_ids','[]'::jsonb)) x(id);

  -- el contacto del lock viene de los envíos auditados
  select e.telefono_e164_capturado into v_phone
    from diagnostico_envios e
   where e.id = any(v_ids) and e.estado = 'completed'
   order by e.created_at desc, e.id desc limit 1;
  if v_phone is null then
    raise exception 'quiz_leads/rollback_sin_contacto';
  end if;
  perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone));

  select a.datos into v_data
    from auditoria a
   where a.id = v_audit_id
     and a.entidad_id = v_lead_id
     and a.accion = 'vinculacion'
     and a.datos->>'cliente_id' = p_cliente_id::text
     and coalesce((a.datos->>'revertido')::boolean, false) = false
   for update;
  if not found then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;
  select coalesce(array_agg(x.id::uuid order by x.id::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(v_data->'envio_ids','[]'::jsonb)) x(id);

  select estado into v_state from personas where id = v_lead_id for update;
  if v_state is distinct from 'archivado' then
    raise exception 'quiz_leads/nada_que_desvincular';
  end if;

  select count(*) into v_expected
    from diagnostico_envios e
   where e.id = any(v_ids) and e.persona_id = p_cliente_id;
  if v_expected <> cardinality(v_ids) then
    raise exception 'quiz_leads/rollback_incompleto: % de % envios esperados siguen en el cliente; se investiga antes de revertir', v_expected, cardinality(v_ids);
  end if;

  -- Si hubo una nueva finalización mientras el destino tenía el envío, ya
  -- existe otro temporal activo para el contacto: restaurar SOBRE ÉL evita
  -- revivir además el temporal archivado y producir dos leads activos.
  select p.id into v_restore_persona
    from personas p
    join diagnostico_envios e on e.persona_id = p.id
   where p.estado = 'lead' and p.id <> v_lead_id
     and e.estado = 'completed' and e.telefono_e164_capturado = v_phone
   order by e.finished_at, e.id limit 1;
  v_restore_persona := coalesce(v_restore_persona, v_lead_id);

  update diagnostico_envios e
     set persona_id = v_restore_persona
    from (select unnest(v_ids) as id) ids
   where e.id = ids.id
     and e.persona_id = p_cliente_id;
  get diagnostics v_restored = row_count;
  if v_restored <> cardinality(v_ids) then
    raise exception 'quiz_leads/rollback_incompleto';
  end if;

  if v_restore_persona = v_lead_id then
    update personas set estado = 'lead' where id = v_lead_id and estado = 'archivado';
    if not found then
      raise exception 'quiz_leads/nada_que_desvincular';
    end if;
  end if;

  update auditoria
     set datos = datos || jsonb_build_object('revertido', true, 'revertido_en', now())
   where id = v_audit_id;

  -- `revertido_de` guarda el UUID de la vinculación revertida.
  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', v_lead_id, 'desvinculacion', p_autor_id,
          jsonb_build_object(
            'cliente_id', p_cliente_id,
            'vinculacion_audit_id', v_audit_id,
            'envio_ids', to_jsonb(v_ids),
            'envios_esperados', cardinality(v_ids),
            'envios_restaurados', v_restored,
            'revertido_de', v_audit_id
          ));

  return jsonb_build_object('ok', true, 'lead_id', v_restore_persona, 'envios_restaurados', v_restored);
end;
$$;

-- ── 13) RPC de descarte: descartar_lead ──────────────────────────────────────
-- Idempotente: re-descartar un lead ya descartado responde OK sin tocar nada.
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
  v_state text;
  v_phone text;
  v_count int;
begin
  if p_lead_id is null then
    raise exception 'quiz_leads/parametros_faltantes';
  end if;

  select telefono_e164_capturado into v_phone
    from diagnostico_envios
   where persona_id = p_lead_id and estado = 'completed'
   order by created_at desc, id desc limit 1;
  if v_phone is null then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone));

  select estado into v_state
    from personas p
   where p.id = p_lead_id
     and p.telefono_e164 is null
   for update;
  if not found then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  if v_state = 'descartado' then
    return jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'estado', v_state);
  end if;
  if v_state is distinct from 'lead' then
    raise exception 'quiz_leads/lead_invalido';
  end if;
  select count(*) into v_count
    from diagnostico_envios e
   where e.persona_id = p_lead_id and e.telefono_e164_capturado = v_phone;
  if v_count = 0 then
    raise exception 'quiz_leads/lead_invalido';
  end if;

  update personas set estado = 'descartado' where id = p_lead_id and estado = 'lead';

  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', p_lead_id, 'descarte', p_autor_id,
          jsonb_build_object(
            'envios', v_count,
            'motivo', 'sin_venta_triage'
          ));

  return jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'estado', 'descartado');
end;
$$;

-- ── 14) Selector estable: solo el programa vigente calculado por el OS ──────
create or replace view public.v_clientes_para_vincular
with (security_invoker = true)
as
select p.id, p.nombre, p.email, p.telefono_e164,
       coalesce(t.nombre, v.tier) as programa
  from public.personas p
  join public.v_programa_activo v on v.persona_id = p.id
  left join public.tiers t on t.id = v.tier
 where p.estado = 'cliente';

-- ── 15) Privacidad: la auditoría del módulo NO guarda teléfonos ─────────────
-- Las auditorias de vinculación/desvinculación/descarte persisten envio_ids
-- (fuente del rollback y del lock), nunca teléfonos consultables.
update public.auditoria
   set datos = datos - 'telefono_lead' - 'telefono_cliente'
 where entidad = 'persona'
   and accion in ('vinculacion','desvinculacion','descarte')
   and datos ?| array['telefono_lead','telefono_cliente'];
alter table public.auditoria drop constraint if exists auditoria_quiz_leads_sin_telefono_check;
alter table public.auditoria add constraint auditoria_quiz_leads_sin_telefono_check
  check (not (entidad = 'persona' and accion in ('vinculacion','desvinculacion','descarte')
    and datos ?| array['telefono_lead','telefono_cliente']));
alter table public.auditoria validate constraint auditoria_quiz_leads_sin_telefono_check;
create index if not exists idx_auditoria_quiz_vinculacion
  on public.auditoria(entidad_id, created_at desc, id desc)
  where entidad = 'persona' and accion = 'vinculacion';

-- ── 16) ACL: EXECUTE solo para service_role ─────────────────────────────────
revoke all on function public.validar_respuestas_quiz(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.quiz_lead_contact_lock_key(text) from public, anon, authenticated;
revoke all on function public.quiz_phone_matches_country(text, text) from public, anon, authenticated;
revoke all on function public.registrar_diagnostico(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.vincular_lead_convertido(uuid, uuid, boolean, uuid) from public, anon, authenticated, service_role;
revoke all on function public.desvincular_lead(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.descartar_lead(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.registrar_diagnostico(jsonb) to service_role;
grant execute on function public.vincular_lead_convertido(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.desvincular_lead(uuid, uuid, uuid) to service_role;
grant execute on function public.descartar_lead(uuid, uuid) to service_role;

-- ── 17) Definición vigente: diagnostico-cripto-v1-a ──────────────────────────
-- Las 8 preguntas definitivas del wizard (lib/quiz/question-config.ts)
-- mapeadas a IDs estables. La calificación (hot-lead-v1) vive DENTRO de la
-- definición: los 5 rangos desde 10.000 USD inclusive son calientes.
insert into public.quiz_versiones (codigo, funnel, variante, version, estado, publicada_at, definicion)
values ('diagnostico-cripto-v1-a', 'diagnostico-cripto', 'control', 1, 'active', now(), $json${
  "schema_version": 1,
  "steps": ["start", "situation", "challenge", "allocation", "capital", "horizon", "drawdown", "influence", "rules", "contact", "analysis", "result"],
  "questions": [
    {
      "id": "situation", "type": "single_choice", "required": true,
      "text": "¿Qué describe mejor tu situación actual con las criptomonedas?",
      "options": [
        { "id": "exposure_full_unclear",   "text": "Estoy 100% expuesto, pero no tengo claro si mi portfolio está bien", "tags": ["exposure-full", "plan-unclear"] },
        { "id": "exposure_high_undeployed","text": "Estoy bastante expuesto pero no sé cómo aportar el resto de liquidez", "tags": ["exposure-high", "liquidity-undeployed"] },
        { "id": "exposure_waiting_ready",  "text": "Estoy esperando una oportunidad para aumentar posiciones", "tags": ["exposure-waiting", "liquidity-ready"] },
        { "id": "exposure_none",           "text": "Estoy completamente fuera del mercado", "tags": ["exposure-none"] }
      ]
    },
    {
      "id": "challenge", "type": "single_choice", "required": true,
      "text": "¿Qué es lo que más te cuesta ahora mismo?",
      "options": [
        { "id": "pain_buy",           "text": "Saber qué comprar",                                "tags": ["pain-buy"],          "video": "video1" },
        { "id": "pain_timing",        "text": "Saber cuándo comprar o vender",                    "tags": ["pain-timing"],       "video": "video2" },
        { "id": "pain_allocation",    "text": "Construir la cartera correcta",                    "tags": ["pain-allocation"],   "video": "video1" },
        { "id": "pain_risk",          "text": "Gestionar el riesgo",                              "tags": ["pain-risk"],         "video": "video3" },
        { "id": "pain_plan",          "text": "Tener un plan y no improvisar",                    "tags": ["pain-plan"],         "video": "video3" },
        { "id": "pain_concentration", "text": "Saber si mi cartera está demasiado concentrada",   "tags": ["pain-concentration"],"video": "video1" }
      ]
    },
    {
      "id": "allocation", "type": "allocation", "required": true,
      "text": "¿Cómo se distribuye tu portfolio hoy?",
      "hint": "Elegí un rango aproximado para cada bloque. No hace falta calcular porcentajes exactos.",
      "assets": [
        { "id": "btc",     "label": "Bitcoin",   "ticker": "BTC", "ranges": [ { "id": "zero", "label": "0%" }, { "id": "minimal", "label": "1-10%" }, { "id": "low", "label": "10-25%" }, { "id": "medium", "label": "25-50%" }, { "id": "high", "label": "50-75%" }, { "id": "dominant", "label": "75-100%" } ] },
        { "id": "eth",     "label": "Ethereum",  "ticker": "ETH", "ranges": [ { "id": "zero", "label": "0%" }, { "id": "minimal", "label": "1-10%" }, { "id": "low", "label": "10-25%" }, { "id": "medium", "label": "25-50%" }, { "id": "high", "label": "50-75%" }, { "id": "dominant", "label": "75-100%" } ] },
        { "id": "alts",    "label": "Altcoins",  "ticker": "ALT", "ranges": [ { "id": "zero", "label": "0%" }, { "id": "minimal", "label": "1-10%" }, { "id": "low", "label": "10-25%" }, { "id": "medium", "label": "25-50%" }, { "id": "high", "label": "50-75%" }, { "id": "dominant", "label": "75-100%" } ] },
        { "id": "stables", "label": "Stablecoins","ticker": "USD","ranges": [ { "id": "zero", "label": "0%" }, { "id": "minimal", "label": "1-10%" }, { "id": "low", "label": "10-25%" }, { "id": "medium", "label": "25-50%" }, { "id": "high", "label": "50-75%" }, { "id": "dominant", "label": "75-100%" } ] }
      ]
    },
    {
      "id": "capital", "type": "range", "required": true,
      "text": "¿Con qué cantidad de capital estás trabajando actualmente o tienes previsto destinar a cripto durante este ciclo?",
      "hint": "No necesitamos saber la cantidad exacta. El rango nos permite adaptar mejor el diagnóstico a tu situación.",
      "options": [
        { "id": "capital_lt_10k",     "text": "Menos de 10.000 USD",   "value": { "currency": "USD", "min": 0,      "max": 10000,  "min_inclusive": true,  "max_inclusive": false } },
        { "id": "capital_10k_25k",    "text": "Entre 10.000 y 25.000 USD", "value": { "currency": "USD", "min": 10000,  "max": 25000,  "min_inclusive": true,  "max_inclusive": false } },
        { "id": "capital_25k_50k",    "text": "Entre 25.000 y 50.000 USD", "value": { "currency": "USD", "min": 25000,  "max": 50000,  "min_inclusive": true,  "max_inclusive": false } },
        { "id": "capital_50k_100k",   "text": "Entre 50.000 y 100.000 USD","value": { "currency": "USD", "min": 50000,  "max": 100000, "min_inclusive": true, "max_inclusive": false } },
        { "id": "capital_100k_250k",  "text": "Entre 100.000 y 250.000 USD","value": { "currency": "USD", "min": 100000, "max": 250000, "min_inclusive": true, "max_inclusive": false } },
        { "id": "capital_gt_250k",    "text": "Más de 250.000 USD",    "value": { "currency": "USD", "min": 250000, "max": null,   "min_inclusive": true } }
      ]
    },
    {
      "id": "horizon", "type": "single_choice", "required": true,
      "text": "¿Cuál es tu horizonte de tiempo con estas inversiones?",
      "options": [
        { "id": "horizon_lt_6m",     "text": "Menos de 6 meses",                          "tags": ["horizon-short"] },
        { "id": "horizon_6m_12m",    "text": "De 6 meses a 1 año",                        "tags": ["horizon-short"] },
        { "id": "horizon_1_2y",      "text": "1-2 años",                                  "tags": ["horizon-medium"] },
        { "id": "horizon_cycle_3y",  "text": "El ciclo cripto completo (3 años aprox.)",  "tags": ["horizon-cycle"] },
        { "id": "horizon_5y_plus",   "text": "5+ años",                                   "tags": ["horizon-long"] }
      ]
    },
    {
      "id": "drawdown", "type": "single_choice", "required": true,
      "text": "Imagina que mañana hay una noticia negativa y tu portfolio ha caído un 30%. ¿Qué harías?",
      "options": [
        { "id": "drawdown_sell_all",     "text": "Vendo todo y espero a que pase la noticia",                 "tags": ["drawdown-exit"] },
        { "id": "drawdown_sell_partial", "text": "Vendo parcialmente para reducir riesgo",                    "tags": ["drawdown-reduce"] },
        { "id": "drawdown_hold",         "text": "Mantengo, no toco nada",                                    "tags": ["drawdown-hold"] },
        { "id": "drawdown_buy_more",     "text": "Aprovecho para comprar y/o aportar más liquidez",           "tags": ["drawdown-buy"] }
      ]
    },
    {
      "id": "influence", "type": "single_choice", "required": true,
      "text": "¿Qué influye más en tus decisiones de inversión?",
      "options": [
        { "id": "decision_own_system",    "text": "Tengo reglas claras y un sistema propio",                          "tags": ["decision-system"] },
        { "id": "decision_advisor",       "text": "Tengo un consultor o sigo una estrategia externa",                 "tags": ["decision-advisor"] },
        { "id": "decision_social",        "text": "Sigo principalmente análisis de personas que veo en redes",        "tags": ["decision-social"] },
        { "id": "decision_news",          "text": "Decido según noticias, eventos y lo que creo que va a pasar",      "tags": ["decision-news"] },
        { "id": "decision_price_reaction","text": "Miro el precio con frecuencia y reacciono según lo que veo",       "tags": ["decision-price"] },
        { "id": "decision_none",          "text": "No tengo un sistema definido",                                      "tags": ["decision-none"] }
      ]
    },
    {
      "id": "rules", "type": "single_choice", "required": true,
      "text": "¿Tienes reglas claras sobre cuándo aumentar, reducir o cerrar una posición?",
      "options": [
        { "id": "rules_clear_system",  "text": "Sí, tengo un sistema claro",              "tags": ["rules-clear"] },
        { "id": "rules_inconsistent",  "text": "Más o menos, pero no lo sigo siempre",    "tags": ["rules-inconsistent"] },
        { "id": "rules_improvising",   "text": "Voy improvisando según lo que veo",       "tags": ["rules-improvise"] },
        { "id": "rules_none",          "text": "No tengo reglas claras",                  "tags": ["rules-none"] }
      ]
    }
  ],
  "qualification": {
    "version": "hot-lead-v1",
    "question_id": "capital",
    "hot_answer_ids": ["capital_10k_25k", "capital_25k_50k", "capital_50k_100k", "capital_100k_250k", "capital_gt_250k"]
  },
  "diagnosis": { "version": "diagnostico-v1" }
}$json$::jsonb)
on conflict (codigo) do nothing;

commit;
