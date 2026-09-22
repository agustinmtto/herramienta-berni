-- ============================================================
-- 0068 — Quiz Funnel: módulo de leads (docs/11, spec cerrada)
--
-- Tres tablas nuevas: quiz_versiones (definiciones inmutables del quiz),
-- diagnostico_envios (un recorrido por session_id) y diagnostico_respuestas
-- (una fila por pregunta respondida). RPCs: registrar_diagnostico (ingesta
-- transaccional e idempotente) y vincular_lead_convertido (post-venta).
--
-- AISLAMIENTO (docs/11 D3/D4): este módulo NO busca, reutiliza ni modifica
-- clientes ni personas ajenas. La primera finalización de un contacto crea
-- una fila de personas con estado='lead' y telefono_e164 = NULL — el UNIQUE
-- de personas.telefono_e164 impediría dos leads con el mismo teléfono; el
-- teléfono real (obligatorio, normalizado E.164) vive en el snapshot de
-- diagnostico_envios, que es de donde lee el módulo /leads. Postgres permite
-- múltiples NULL bajo un UNIQUE, así que no se toca el esquema existente.
--
-- El teléfono y el email llegan ya normalizados desde el endpoint; el RPC
-- revalida. El flag de lead caliente se calcula AQUÍ desde la definición
-- almacenada y la respuesta estructurada — nunca desde el navegador.
-- ============================================================
begin;

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
  -- completed exige identidad resuelta, contacto y consentimiento reales
  -- (nombre + version de consentimiento + fecha: lo que la spec afirma en §7,
  -- ahora defendido por la base y no solo por el endpoint)
  constraint diagnostico_envios_completed_completo_check check (
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

-- Candado duro de transiciones: un envío completed JAMÁS retrocede, ni si
--quiera por una escritura directa con service_role (docs/11 §7). El RPC
-- respeta la matriz por diseño; el trigger la defiende pase lo que pase.
create or replace function public.diag_envios_estado_guard()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'completed' and new.estado <> 'completed' then
    raise exception 'quiz_leads/completed_no_retrocede: un envio completado no puede volver a %', new.estado;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_diag_envios_estado_guard on public.diagnostico_envios;
create trigger tg_diag_envios_estado_guard
  before update on public.diagnostico_envios
  for each row execute function public.diag_envios_estado_guard();

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

-- ── 4) RLS (docs/11 §11: habilitar al crear) ─────────────────────────────────
-- Lectura para la app autenticada; escritura NADIE directo: todo entra por el
-- RPC con service_role desde el servidor (el endpoint público no expone la
-- clave). Sin INSERT/UPDATE/DELETE policies: el default es denegar.
alter table public.quiz_versiones         enable row level security;
alter table public.diagnostico_envios     enable row level security;
alter table public.diagnostico_respuestas enable row level security;

drop policy if exists "auth read quiz_versiones" on public.quiz_versiones;
create policy "auth read quiz_versiones" on public.quiz_versiones
  for select to authenticated using (true);
drop policy if exists "auth read diagnostico_envios" on public.diagnostico_envios;
create policy "auth read diagnostico_envios" on public.diagnostico_envios
  for select to authenticated using (true);
drop policy if exists "auth read diagnostico_respuestas" on public.diagnostico_respuestas;
create policy "auth read diagnostico_respuestas" on public.diagnostico_respuestas
  for select to authenticated using (true);

-- ── 5) Validación de respuestas contra la definición ────────────────────────
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
      -- La seleccion vacia y los ids repetidos no son validos: "no elegir nada"
      -- no es una respuesta, y duplicar un id solo ganaria el upsert sin
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
      -- imposible de distinguir despues en el snapshot.
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

-- ── 6) RPC de ingesta: registrar_diagnostico(p_payload jsonb) ────────────────
-- Una transacción, todo-o-nada (docs/11 §7). Idempotencias: session_id no
-- duplica; completed nunca retrocede ni re-crea persona; advisory lock por
-- contacto para que dos sesiones simultáneas del mismo email+teléfono no
-- creen dos personas.
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

  select * into v_version
    from quiz_versiones
   where codigo = p_payload->>'quiz_version'
     and estado = 'active';
  if not found then
    raise exception 'quiz_leads/quiz_version_desconocida: %', p_payload->>'quiz_version';
  end if;

  -- 6.2) contacto: snapshot + revalidación. Solo completed lo exige (D2:
  -- los abandonos previos al contacto pueden no llevar datos).
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
  -- La EXIGENCIA de contacto se aplica ADEMÁS de conocer el estado del envío:
  -- se valida en 6.4 (después del lock y del early-return de idempotencia)
  -- para que un retry tardío de completed no falle revalidando datos de un
  -- envío que ya es un hecho.

  -- 6.3) upsert del envío por session_id + lock de fila. Va ANTES de la
  -- validación: para una sesión existente la definición contra la que se
  -- valida es la SUYA (la versión con la que se creó el recorrido) — nunca la
  -- que venga en el payload. Un conflicto de versión se rechaza: una sesión
  -- que arrancó con la versión A no puede seguir llenándose con respuestas
  -- validadas contra la B, porque ese snapshot mezclado no es de nadie.
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
  if v_envio.quiz_version_id is distinct from v_version.id then
    raise exception 'quiz_leads/version_conflictada: la sesion % pertenece a otra version del quiz', v_session;
  end if;

  -- 6.4) idempotencia + exigencia de contacto:
  -- a) CUALQUIER evento sobre un envío ya completado devuelve el resultado
  --    existente (el beacon tardío o el retry cae acá: solo se cotejó la
  --    versión, no el consentimiento ni las respuestas de un envío que ya
  --    es un hecho — antes, un retry incompleto fallaba).
  if v_envio.estado = 'completed' then
    return jsonb_build_object(
      'ok', true, 'session_id', v_session,
      'submission_id', v_envio.id, 'status', 'completed');
  end if;

  -- b) Consentimiento EXIGIBLE, no verificable-de-paso: nombre, version y
  --    fecha de aceptacion son datos que la base guarda como hechos, y la
  --    fecha faltante no se reemplaza en silencio por otra (§7/D2). Un
  --    accepted_at en el FUTURO es basura de contrato, no un hecho.
  v_consent_at := null;
  if v_event = 'completed' then
    if v_lead is null or jsonb_typeof(v_lead) <> 'object'
       or coalesce((v_lead->'consent'->>'accepted')::boolean, false) is not true
       or v_email = '' or v_telefono = ''
       or v_nombre = ''
       or coalesce(v_lead->'consent'->>'version','') = ''
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
      raise exception 'quiz_leads/contacto_incompleto';  -- la aceptacion no puede ser futura
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
      -- (§8: el flag se calcula desde la definicion, los importes quedan bajo
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
    last_step_id             = coalesce(p_payload->'progress'->>'step_id', last_step_id),
    last_step_index          = coalesce(nullif(p_payload->'progress'->>'step_index','')::int, last_step_index),
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

  return jsonb_build_object(
    'ok', true, 'session_id', v_session,
    'submission_id', v_envio.id, 'status', v_estado);
end;
$$;

revoke all on function public.registrar_diagnostico(jsonb) from public, anon, authenticated;

-- ── 7) RPC de conversión: vincular_lead_convertido ───────────────────────────
-- Post-venta (docs/11 §9): el flujo de ventas existente creó al cliente
-- definitivo; desde /leads se reasignan los diagnósticos del lead temporal a
-- ese cliente y el temporal se archiva. No toca datos del cliente. Idempotente.
create or replace function public.vincular_lead_convertido(p_lead_id uuid, p_cliente_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reasignados int := 0;
  v_lead_estado text;
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

  update diagnostico_envios
     set persona_id = p_cliente_id
   where persona_id = p_lead_id;
  get diagnostics v_reasignados = row_count;

  -- el temporal no se borra: queda archivado como rastro (§9.8)
  update personas set estado = 'archivado' where id = p_lead_id;

  return jsonb_build_object('ok', true, 'cliente_id', p_cliente_id, 'envios_reasignados', v_reasignados);
end;
$$;

revoke all on function public.vincular_lead_convertido(uuid, uuid) from public, anon, authenticated;

-- ── 8) Definición vigente: diagnostico-cripto-v1-a ───────────────────────────
-- Las 8 preguntas definitivas del wizard (lib/question-config.js del repo del
-- quiz) mapeadas a IDs estables. La calificación (hot-lead-v1) vive DENTRO de
-- la definición: los 5 rangos desde 10.000 USD inclusive son calientes.
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
        { "id": "capital_50k_100k",   "text": "Entre 50.000 y 100.000 USD","value": { "currency": "USD", "min": 50000,  "max": 100000, "min_inclusive": true,  "max_inclusive": false } },
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
        { "id": "decision_none",          "text": "No tengo un sistema definido",                                     "tags": ["decision-none"] }
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
