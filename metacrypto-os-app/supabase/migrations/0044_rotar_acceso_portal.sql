-- ============================================================
-- 0044 — Rotar el enlace del portal de un cliente.
--
-- El único riesgo que añadió el acceso por token es el reenvío: quien reciba
-- el enlace entra. La mitigación es cortarlo, y hasta ahora eso era un UPDATE
-- a mano en la base — o sea, en la práctica, imposible para Berni.
--
-- Rotar en vez de revocar a secas: el cliente NO puede quedarse sin acceso a
-- su propia estrategia por un susto. Se le invalida el viejo y se le da uno
-- nuevo en el mismo gesto, listo para mandárselo.
--
-- Spec: docs/superpowers/specs/2026-08-20-estrategias-design.md
-- ADITIVO: una función. No toca ninguna tabla ni ninguna fila existente.
-- ============================================================

begin;

create or replace function public.rotar_acceso_portal(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_persona uuid := nullif(payload->>'persona_id','')::uuid;
  v_autor   uuid := nullif(payload->>'autor_id','')::uuid;
  v_token   text := nullif(btrim(payload->>'token_nuevo'), '');
  v_antiguo text;
begin
  if v_persona is null then raise exception 'Falta el cliente'; end if;
  -- El token lo genera Node (randomBytes(24)), no Postgres, para no depender
  -- de que pgcrypto esté instalado. Mismo criterio que `crear_estrategia`.
  if v_token is null then raise exception 'Falta el token nuevo'; end if;

  select token into v_antiguo from public.portal_accesos
    where persona_id = v_persona for update;

  if not found then
    -- Un cliente sin llave todavía: dársela ahora es lo correcto, no un error.
    -- Pasa con quien tiene estrategias importadas pero nunca se le mandó nada.
    insert into public.portal_accesos (persona_id, token, creado_por)
    values (v_persona, v_token, v_autor);
  else
    update public.portal_accesos
       set token = v_token,
           creado_por = coalesce(v_autor, creado_por),
           created_at = now(),
           -- Se limpia la marca de acceso: es de la llave anterior y dejarla
           -- haría creer que el cliente ya entró con la nueva.
           ultimo_acceso_at = null,
           revocado_at = null
     where persona_id = v_persona;
  end if;

  -- El token viejo NO se guarda en la traza: es una credencial, y la auditoría
  -- la leen más ojos que la tabla. Basta con saber que se rotó y quién.
  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('portal_acceso', v_persona,
          case when v_antiguo is null then 'crear_enlace' else 'rotar_enlace' end,
          v_autor, jsonb_build_object('tenia_enlace', v_antiguo is not null));

  return jsonb_build_object('ok', true, 'token', v_token,
                            'era_nuevo', v_antiguo is null);
end;
$$;

revoke all on function public.rotar_acceso_portal(jsonb) from public, anon, authenticated;
grant execute on function public.rotar_acceso_portal(jsonb) to service_role;

commit;
