-- ============================================================
-- 0070 — RPC de lookup de vinculación por envío (hallazgo del QA E2E)
--
-- El módulo /leads identificaba "qué lead temporal se movió a qué cliente"
-- filtrando auditoria.con datos `datos.cs={...}` (PostgREST). En esta build
-- (postgrest/16.4) el operador de contención se IGNORA silenciosamente
-- (devuelve todas las vinculaciones) y con `cs=` responde 400 — el detalle
-- del lead se rompía de una u otra forma. El look-up pasa a una RPC SQL con
-- containment NATIVO de Postgres `@>`, determinístico y ordenado como el
-- resto del ciclo comercial (created_at desc, id desc).
-- ============================================================
begin;

create or replace function public.auditoria_lead_del_envio(p_envio_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('lead_id', a.entidad_id)
    from auditoria a
   where a.entidad = 'persona'
     and a.accion = 'vinculacion'
     and a.datos @> jsonb_build_object('envio_ids', jsonb_build_array(p_envio_id))
     and coalesce((a.datos->>'revertido')::boolean, false) = false
   order by a.created_at desc, a.id desc
   limit 1;
$$;

revoke all on function public.auditoria_lead_del_envio(uuid) from public, anon, authenticated;
grant execute on function public.auditoria_lead_del_envio(uuid) to service_role;

commit;
