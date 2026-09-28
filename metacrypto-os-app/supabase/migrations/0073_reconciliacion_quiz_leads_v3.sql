-- Reconciliacion final append-only del quiz/leads (auditoria v5).
--
-- Preflight para instalaciones que aun no alcanzaron 0072 y tienen completed
-- incompatibles: con ingesta detenida, crear quiz_leads_legacy_upgrade_stage
-- (envio_id uuid PK, estado_original text='completed'), guardar los UUID,
-- deshabilitar tg_diag_envios_estado_guard dentro de una transaccion y mover
-- esos envios temporalmente a in_progress. 0073 restaura el estado y elimina
-- el staging despues de comprobar que todos los UUID existen. No copiar PII.

begin;

-- Procedencia explicita. Nada anterior a esta migracion prueba por si solo que
-- el consentimiento sea canonico, por lo que todo completed previo es legado.
alter table public.diagnostico_envios
  add column if not exists registro_origen text,
  add column if not exists consentimiento_origen text;

alter table public.diagnostico_envios
  drop constraint if exists diagnostico_envios_registro_origen_check,
  drop constraint if exists diagnostico_envios_consentimiento_origen_check;

alter table public.diagnostico_envios
  add constraint diagnostico_envios_registro_origen_check
    check (registro_origen in ('canonical', 'legacy-unknown')) not valid,
  add constraint diagnostico_envios_consentimiento_origen_check
    check (consentimiento_origen in ('canonical', 'legacy-unknown')) not valid;

update public.diagnostico_envios
   set registro_origen = case when estado = 'completed' then 'legacy-unknown' else 'canonical' end,
       consentimiento_origen = case when estado = 'completed' then 'legacy-unknown' else 'canonical' end
 where registro_origen is null or consentimiento_origen is null;

do $$
begin
  if to_regclass('public.quiz_leads_legacy_upgrade_stage') is not null then
    execute $sql$
      update public.diagnostico_envios e
         set registro_origen = 'legacy-unknown',
             consentimiento_origen = 'legacy-unknown'
        from public.quiz_leads_legacy_upgrade_stage s
       where e.id = s.envio_id
    $sql$;
  end if;
end;
$$;

alter table public.diagnostico_envios
  drop constraint if exists diagnostico_envios_completed_v3_check;

alter table public.diagnostico_envios
  add constraint diagnostico_envios_completed_v3_check
  check (
    estado <> 'completed'
    or (registro_origen = 'legacy-unknown' and consentimiento_origen = 'legacy-unknown')
    or (
      registro_origen = 'canonical'
      and consentimiento_origen = 'canonical'
      and persona_id is not null
      and nombre_capturado is not null and btrim(nombre_capturado) <> ''
      and email_capturado is not null and btrim(email_capturado) <> ''
      and telefono_e164_capturado is not null
      and telefono_e164_capturado ~ '^\+[1-9][0-9]{7,14}$'
      and consentimiento_aceptado is true
      and consentimiento_version = 'contacto-v1'
      and consentimiento_at is not null
      and finished_at is not null
    )
  ) not valid;

alter table public.diagnostico_envios
  drop constraint if exists diagnostico_envios_completed_completo_check;

do $$
declare
  v_stage int;
  v_restored int;
begin
  if to_regclass('public.quiz_leads_legacy_upgrade_stage') is not null then
    execute 'select count(*) from public.quiz_leads_legacy_upgrade_stage' into v_stage;
    execute $sql$
      update public.diagnostico_envios e
         set estado = 'completed',
             registro_origen = 'legacy-unknown',
             consentimiento_origen = 'legacy-unknown'
        from public.quiz_leads_legacy_upgrade_stage s
       where e.id = s.envio_id and s.estado_original = 'completed'
    $sql$;
    get diagnostics v_restored = row_count;
    if v_restored <> v_stage then
      raise exception 'quiz_leads/preflight_incompleto: % de % envios restaurados', v_restored, v_stage;
    end if;
    execute 'drop table public.quiz_leads_legacy_upgrade_stage';
  end if;
end;
$$;

alter table public.diagnostico_envios
  validate constraint diagnostico_envios_registro_origen_check;
alter table public.diagnostico_envios
  validate constraint diagnostico_envios_consentimiento_origen_check;
alter table public.diagnostico_envios
  validate constraint diagnostico_envios_completed_v3_check;

alter table public.diagnostico_envios
  alter column registro_origen set default 'canonical',
  alter column consentimiento_origen set default 'canonical',
  alter column registro_origen set not null,
  alter column consentimiento_origen set not null;

-- Publicar es irreversible aunque nunca haya habido envios.
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

-- Una sola clave de serializacion para todo el ciclo comercial del contacto.
create or replace function public.quiz_lead_contact_lock_key(p_phone text)
returns bigint
language sql
immutable strict
set search_path = public
as $$ select hashtextextended('quiz-leads/contact/v1:' || p_phone, 0) $$;

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

-- La implementación reconciliada por 0072 se conserva como helper interno.
-- El wrapper toma el lock telefónico ANTES de que aquella función busque o
-- cree la persona, cerrando la carrera completar/vincular/rollback/descarte.
do $$
begin
  if to_regprocedure('public.registrar_diagnostico_v2_internal(jsonb)') is null then
    alter function public.registrar_diagnostico(jsonb)
      rename to registrar_diagnostico_v2_internal;
  end if;
end;
$$;

create or replace function public.registrar_diagnostico(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  v_phone text;
  v_country text;
  v_result jsonb;
  v_submission_id uuid;
  v_current_persona uuid;
  v_target_persona uuid;
  v_audit_id uuid;
  v_envio_ids jsonb;
  v_session_id uuid;
begin
  v_event := p_payload->>'event';
  if v_event = 'completed' then
    begin
      v_session_id := (p_payload->>'session_id')::uuid;
    exception when invalid_text_representation then
      return public.registrar_diagnostico_v2_internal(p_payload);
    end;
    -- La sesión se serializa antes que el contacto. Así dos completed para la
    -- misma sesión con teléfonos distintos no pueden reconciliar el resultado
    -- ganador usando el contacto del request perdedor.
    perform pg_advisory_xact_lock(hashtextextended(
      'quiz-leads/session/v1:' || v_session_id::text, 0
    ));
    -- Un retry ya sellado conserva el snapshot persistido. El contacto mutable
    -- del retry no puede consolidar ni reasignar la identidad original.
    if exists (
      select 1 from public.diagnostico_envios
       where session_id = v_session_id and estado = 'completed'
    ) then
      return public.registrar_diagnostico_v2_internal(p_payload);
    end if;
    v_phone := btrim(coalesce(p_payload->'lead'->>'phone',''));
    v_country := upper(btrim(coalesce(p_payload->'lead'->>'country','')));
    if v_phone !~ '^\+[1-9][0-9]{7,14}$' or v_country = '' then
      return public.registrar_diagnostico_v2_internal(p_payload);
    end if;
    if not public.quiz_phone_matches_country(v_country,v_phone) then
      raise exception 'quiz_leads/telefono_pais_incoherente';
    end if;
    perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone));
  end if;
  v_result := public.registrar_diagnostico_v2_internal(p_payload);
  if v_event <> 'completed' then return v_result; end if;

  v_submission_id := (v_result->>'submission_id')::uuid;
  select persona_id into v_current_persona
    from public.diagnostico_envios where id=v_submission_id;

  -- Si el contacto ya estaba vinculado, el nuevo envio forma parte de ESA
  -- vinculacion. Se añade al conjunto auditado para que un rollback posterior
  -- siga siendo exacto, incluso si completar y desvincular compitieron.
  select a.id,(a.datos->>'cliente_id')::uuid into v_audit_id,v_target_persona
    from public.auditoria a
    join public.personas destino on destino.id=(a.datos->>'cliente_id')::uuid
   where a.entidad='persona' and a.accion='vinculacion'
     and destino.estado='cliente'
     and coalesce((a.datos->>'revertido')::boolean,false)=false
     and exists (
       select 1
         from jsonb_array_elements_text(coalesce(a.datos->'envio_ids','[]'::jsonb)) x(id)
         join public.diagnostico_envios e on e.id=x.id::uuid
        where e.telefono_e164_capturado=v_phone
     )
   order by a.created_at desc,a.id desc limit 1 for update;

  if v_audit_id is not null then
    update public.diagnostico_envios set persona_id=v_target_persona where id=v_submission_id;
    select jsonb_agg(id order by id) into v_envio_ids from (
      select value::uuid id from public.auditoria a,
        jsonb_array_elements_text(coalesce(a.datos->'envio_ids','[]'::jsonb)) x(value)
       where a.id=v_audit_id
      union select v_submission_id
    ) ids;
    update public.auditoria
       set datos=jsonb_set(jsonb_set(datos,'{envio_ids}',v_envio_ids),'{envios_reasignados}',to_jsonb(jsonb_array_length(v_envio_ids)))
     where id=v_audit_id;
  else
    -- Sin vinculacion activa, telefono canonico define una sola identidad lead.
    select e.persona_id into v_target_persona
      from public.diagnostico_envios e join public.personas p on p.id=e.persona_id
     where e.estado='completed' and e.telefono_e164_capturado=v_phone and p.estado='lead'
     order by e.created_at,e.id limit 1;
    if v_target_persona is not null and v_target_persona<>v_current_persona then
      update public.diagnostico_envios set persona_id=v_target_persona where id=v_submission_id;
    end if;
  end if;

  if v_target_persona is not null and v_current_persona<>v_target_persona
     and not exists (select 1 from public.diagnostico_envios where persona_id=v_current_persona) then
    delete from public.personas where id=v_current_persona and estado='lead' and telefono_e164 is null;
  end if;
  return v_result;
end;
$$;

-- Defensa final para escrituras directas y para carreras con las RPC antiguas.
create or replace function public.diagnostico_envios_guard_v3()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_phone text;
  v_persona_id uuid;
begin
  if tg_op = 'UPDATE' and old.estado = 'completed' and new is distinct from old then
    -- Vincular/desvincular cambia exclusivamente el propietario durable del
    -- snapshot. Ningun evento puede modificar el resto de un completed.
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
  if new.estado = 'completed' and (tg_op = 'INSERT' or old.estado <> 'completed') then
    if new.registro_origen <> 'canonical' or new.consentimiento_origen <> 'canonical' then
      raise exception 'quiz_leads/procedencia_invalida';
    end if;
    if new.telefono_e164_capturado is null
       or not public.quiz_phone_matches_country(new.pais_capturado, new.telefono_e164_capturado) then
      raise exception 'quiz_leads/telefono_pais_incoherente';
    end if;
    v_phone := new.telefono_e164_capturado;
    if not pg_try_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone)) then
      raise exception 'quiz_leads/contacto_ocupado';
    end if;
    if not exists (
      select 1 from public.personas p
       where p.id = new.persona_id and p.estado in ('lead', 'cliente')
    ) then
      raise exception 'quiz_leads/persona_invalida_post_lock';
    end if;
  elsif tg_op = 'UPDATE' and new.persona_id is distinct from old.persona_id then
    v_phone := coalesce(old.telefono_e164_capturado, new.telefono_e164_capturado);
    if v_phone is not null then
      if not pg_try_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone)) then
        raise exception 'quiz_leads/contacto_ocupado';
      end if;
    end if;
    if not exists (
      select 1 from public.personas p
       where p.id = new.persona_id and p.estado in ('lead', 'cliente', 'archivado')
    ) then
      raise exception 'quiz_leads/persona_invalida_post_lock';
    end if;
  end if;

  if new.last_step_id is not null and not exists (
    select 1
      from public.quiz_versiones q,
           jsonb_array_elements_text(coalesce(q.definicion->'steps', '[]'::jsonb)) with ordinality s(step_id, pos)
     where q.id = new.quiz_version_id
       and s.step_id = new.last_step_id
       and s.pos - 1 = new.last_step_index
  ) then
    raise exception 'quiz_leads/paso_invalido';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_diag_envios_guard_v3 on public.diagnostico_envios;
create trigger tg_diag_envios_guard_v3
  before insert or update on public.diagnostico_envios
  for each row execute function public.diagnostico_envios_guard_v3();

-- Selector estable: solo el programa vigente calculado por el OS.
create or replace view public.v_clientes_para_vincular
with (security_invoker = true)
as
select p.id, p.nombre, p.email, p.telefono_e164,
       coalesce(t.nombre, v.tier) as programa
  from public.personas p
  join public.v_programa_activo v on v.persona_id = p.id
  left join public.tiers t on t.id = v.tier
 where p.estado = 'cliente';

-- Vinculacion: contacto y conjunto exacto se releen despues del lock canonico.
create or replace function public.vincular_lead_convertido(
  p_lead_id uuid, p_cliente_id uuid, p_confirmar boolean default false, p_autor_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_estado text; v_phone text; v_client_phone text; v_ids uuid[]; v_count int;
begin
  if p_lead_id is null or p_cliente_id is null then raise exception 'quiz_leads/parametros_faltantes'; end if;
  if p_lead_id = p_cliente_id then raise exception 'quiz_leads/misma_persona'; end if;

  select e.telefono_e164_capturado into v_phone
    from public.diagnostico_envios e
   where e.persona_id = p_lead_id and e.estado = 'completed'
   order by e.created_at desc, e.id desc limit 1;
  if v_phone is null then
    select e.telefono_e164_capturado into v_phone
      from public.auditoria a
      cross join lateral jsonb_array_elements_text(coalesce(a.datos->'envio_ids','[]'::jsonb)) x(id)
      join public.diagnostico_envios e on e.id = x.id::uuid
     where a.entidad = 'persona' and a.accion = 'vinculacion' and a.entidad_id = p_lead_id
     order by a.created_at desc, a.id desc limit 1;
  end if;
  if v_phone is null then raise exception 'quiz_leads/lead_invalido'; end if;
  perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone));

  select estado into v_estado from public.personas where id = p_lead_id and telefono_e164 is null for update;
  if not found then raise exception 'quiz_leads/lead_invalido'; end if;
  if v_estado = 'archivado' then
    if exists (
      select 1 from public.auditoria a where a.entidad='persona' and a.accion='vinculacion'
       and a.entidad_id=p_lead_id and a.datos->>'cliente_id'=p_cliente_id::text
       and coalesce((a.datos->>'revertido')::boolean,false)=false
    ) then return jsonb_build_object('ok',true,'cliente_id',p_cliente_id,'envios_reasignados',0); end if;
    raise exception 'quiz_leads/lead_vinculado_a_otro_cliente';
  end if;
  if v_estado <> 'lead' then raise exception 'quiz_leads/lead_invalido'; end if;

  select telefono_e164 into v_client_phone from public.personas
   where id=p_cliente_id and estado='cliente' for update;
  if not found or not exists (select 1 from public.v_programa_activo where persona_id=p_cliente_id) then
    raise exception 'quiz_leads/cliente_invalido';
  end if;
  select coalesce(array_agg(e.id order by e.id), '{}'), count(*) into v_ids, v_count
    from public.diagnostico_envios e where e.persona_id=p_lead_id;
  if v_count=0 or not exists (
    select 1 from public.diagnostico_envios e
     where e.persona_id=p_lead_id and e.estado='completed' and e.telefono_e164_capturado=v_phone
  ) then raise exception 'quiz_leads/lead_invalido'; end if;
  if v_phone is distinct from v_client_phone and p_confirmar is not true then
    raise exception 'quiz_leads/telefono_no_coincide';
  end if;

  update public.diagnostico_envios set persona_id=p_cliente_id where id=any(v_ids) and persona_id=p_lead_id;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_ids) then raise exception 'quiz_leads/conjunto_envios_cambio'; end if;
  update public.personas set estado='archivado' where id=p_lead_id and estado='lead';
  if not found then raise exception 'quiz_leads/lead_invalido'; end if;
  insert into public.auditoria(entidad,entidad_id,accion,autor_id,datos)
  values ('persona',p_lead_id,'vinculacion',p_autor_id,jsonb_build_object(
    'cliente_id',p_cliente_id,'envio_ids',to_jsonb(v_ids),'envios_reasignados',v_count,
    'confirmado',coalesce(p_confirmar,false),'regla','hot-lead-v1'));
  return jsonb_build_object('ok',true,'cliente_id',p_cliente_id,'envios_reasignados',v_count);
end;
$$;

-- Rollback: el contacto se deriva de los UUID auditados, nunca del propietario
-- actual del envio. Auditoria, persona y propietarios se revalidan post-lock.
create or replace function public.desvincular_lead(
  p_cliente_id uuid, p_lead_id uuid default null, p_autor_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_audit_id uuid; v_lead_id uuid; v_data jsonb; v_phone text;
  v_ids uuid[]; v_expected int; v_restored int; v_state text;
  v_restore_persona uuid;
begin
  if p_cliente_id is null then raise exception 'quiz_leads/parametros_faltantes'; end if;
  select a.id,a.entidad_id,a.datos into v_audit_id,v_lead_id,v_data
    from public.auditoria a
   where a.entidad='persona' and a.accion='vinculacion'
     and (p_lead_id is null or a.entidad_id=p_lead_id)
     and a.datos->>'cliente_id'=p_cliente_id::text
     and coalesce((a.datos->>'revertido')::boolean,false)=false
   order by a.created_at desc,a.id desc limit 1;
  if not found then raise exception 'quiz_leads/nada_que_desvincular'; end if;
  select array_agg(x.id::uuid order by x.id::uuid) into v_ids
    from jsonb_array_elements_text(coalesce(v_data->'envio_ids','[]'::jsonb)) x(id);
  select e.telefono_e164_capturado into v_phone from public.diagnostico_envios e
   where e.id=any(v_ids) and e.estado='completed'
   order by e.created_at desc,e.id desc limit 1;
  if v_phone is null then raise exception 'quiz_leads/rollback_sin_contacto'; end if;
  perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone));

  select a.datos into v_data from public.auditoria a
   where a.id=v_audit_id and a.entidad_id=v_lead_id and a.accion='vinculacion'
     and a.datos->>'cliente_id'=p_cliente_id::text
     and coalesce((a.datos->>'revertido')::boolean,false)=false for update;
  if not found then raise exception 'quiz_leads/nada_que_desvincular'; end if;
  select array_agg(x.id::uuid order by x.id::uuid) into v_ids
    from jsonb_array_elements_text(coalesce(v_data->'envio_ids','[]'::jsonb)) x(id);
  select estado into v_state from public.personas where id=v_lead_id for update;
  if v_state is distinct from 'archivado' then raise exception 'quiz_leads/nada_que_desvincular'; end if;
  select count(*) into v_expected from public.diagnostico_envios
   where id=any(v_ids) and persona_id=p_cliente_id;
  if v_expected <> cardinality(v_ids) then raise exception 'quiz_leads/rollback_incompleto'; end if;

  -- Si hubo una nueva finalización mientras el destino estaba en ex_cliente,
  -- ya existe otro temporal activo para el contacto. Restaurar sobre él evita
  -- revivir además el temporal archivado y producir dos leads activos.
  select p.id into v_restore_persona
    from public.personas p
    join public.diagnostico_envios e on e.persona_id=p.id
   where p.estado='lead' and p.id<>v_lead_id
     and e.estado='completed' and e.telefono_e164_capturado=v_phone
   order by e.finished_at,e.id limit 1;
  v_restore_persona := coalesce(v_restore_persona,v_lead_id);

  update public.diagnostico_envios set persona_id=v_restore_persona where id=any(v_ids) and persona_id=p_cliente_id;
  get diagnostics v_restored = row_count;
  if v_restored <> cardinality(v_ids) then raise exception 'quiz_leads/rollback_incompleto'; end if;
  if v_restore_persona=v_lead_id then
    update public.personas set estado='lead' where id=v_lead_id and estado='archivado';
    if not found then raise exception 'quiz_leads/nada_que_desvincular'; end if;
  end if;
  update public.auditoria set datos=datos||jsonb_build_object('revertido',true,'revertido_en',now()) where id=v_audit_id;
  insert into public.auditoria(entidad,entidad_id,accion,autor_id,datos)
  values ('persona',v_lead_id,'desvinculacion',p_autor_id,jsonb_build_object(
    'cliente_id',p_cliente_id,'vinculacion_audit_id',v_audit_id,'envio_ids',to_jsonb(v_ids),
    'envios_esperados',cardinality(v_ids),'envios_restaurados',v_restored,'revertido_de',v_audit_id));
  return jsonb_build_object('ok',true,'lead_id',v_restore_persona,'envios_restaurados',v_restored);
end;
$$;

create or replace function public.descartar_lead(p_lead_id uuid,p_autor_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_state text; v_phone text; v_count int;
begin
  if p_lead_id is null then raise exception 'quiz_leads/parametros_faltantes'; end if;
  select telefono_e164_capturado into v_phone from public.diagnostico_envios
   where persona_id=p_lead_id and estado='completed'
   order by created_at desc,id desc limit 1;
  if v_phone is null then raise exception 'quiz_leads/lead_invalido'; end if;
  perform pg_advisory_xact_lock(public.quiz_lead_contact_lock_key(v_phone));
  select estado into v_state from public.personas where id=p_lead_id and telefono_e164 is null for update;
  if not found then raise exception 'quiz_leads/lead_invalido'; end if;
  if v_state='descartado' then return jsonb_build_object('ok',true,'lead_id',p_lead_id,'estado',v_state); end if;
  if v_state<>'lead' then raise exception 'quiz_leads/lead_invalido'; end if;
  select count(*) into v_count from public.diagnostico_envios
   where persona_id=p_lead_id and telefono_e164_capturado=v_phone;
  if v_count=0 then raise exception 'quiz_leads/lead_invalido'; end if;
  update public.personas set estado='descartado' where id=p_lead_id and estado='lead';
  insert into public.auditoria(entidad,entidad_id,accion,autor_id,datos)
  values ('persona',p_lead_id,'descarte',p_autor_id,jsonb_build_object('envios',v_count,'motivo','sin_venta_triage'));
  return jsonb_build_object('ok',true,'lead_id',p_lead_id,'estado','descartado');
end;
$$;

-- La auditoria compartida conserva su policy general, pero las acciones de
-- este modulo ya no contienen telefonos consultables por authenticated.
update public.auditoria
   set datos=datos-'telefono_lead'-'telefono_cliente'
 where entidad='persona' and accion in ('vinculacion','desvinculacion','descarte')
   and datos ?| array['telefono_lead','telefono_cliente'];
alter table public.auditoria drop constraint if exists auditoria_quiz_leads_sin_telefono_check;
alter table public.auditoria add constraint auditoria_quiz_leads_sin_telefono_check
  check (not (entidad='persona' and accion in ('vinculacion','desvinculacion','descarte')
    and datos ?| array['telefono_lead','telefono_cliente'])) not valid;
alter table public.auditoria validate constraint auditoria_quiz_leads_sin_telefono_check;
create index if not exists idx_auditoria_quiz_vinculacion
  on public.auditoria(entidad_id,created_at desc,id desc)
  where entidad='persona' and accion='vinculacion';

-- Reafirmar RLS y ACL del modulo, incluidas las firmas reales.
alter table public.quiz_versiones enable row level security;
alter table public.diagnostico_envios enable row level security;
alter table public.diagnostico_respuestas enable row level security;
drop policy if exists "auth read quiz_versiones" on public.quiz_versiones;
drop policy if exists "auth read diagnostico_envios" on public.diagnostico_envios;
drop policy if exists "auth read diagnostico_respuestas" on public.diagnostico_respuestas;

revoke all on function public.quiz_lead_contact_lock_key(text) from public,anon,authenticated;
revoke all on function public.quiz_phone_matches_country(text,text) from public,anon,authenticated;
revoke all on function public.registrar_diagnostico_v2_internal(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.validar_respuestas_quiz(jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.registrar_diagnostico(jsonb) from public,anon,authenticated;
revoke all on function public.vincular_lead_convertido(uuid,uuid,boolean,uuid) from public,anon,authenticated;
revoke all on function public.desvincular_lead(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.descartar_lead(uuid,uuid) from public,anon,authenticated;
grant execute on function public.registrar_diagnostico(jsonb) to service_role;
grant execute on function public.vincular_lead_convertido(uuid,uuid,boolean,uuid) to service_role;
grant execute on function public.desvincular_lead(uuid,uuid,uuid) to service_role;
grant execute on function public.descartar_lead(uuid,uuid) to service_role;

commit;
