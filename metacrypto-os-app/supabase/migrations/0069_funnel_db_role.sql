-- ============================================================
-- 0069 — Rol de base con privilegio mínimo para la app pública del funnel
-- (docs/00, separación del funnel).
--
-- El funnel corre en una app/instancia aparte del OS: su única conexión a la
-- base es el RPC registrar_diagnostico. En lugar de darle la service_role
-- completa (llave maestra del negocio), la app usa UN ROL PROPIO `funnel`
-- que solo puede ejecutar ese RPC — si la llave se expone  algún día, el
-- peor caso es insertar recorridos falsos: ni leer un email/pone un dato de
-- cliente, ni escribir en tablas ajenas.
--
-- La clave de la app es un JWT con claim `role=funnel` firmado con el
-- JWT_SECRET del proyecto de Supabase (scripts/mint-funnel-token.mjs en la
-- app funnel; en producción lo genera el operador).
-- ============================================================
begin;

-- El rol NO login (solo entra por PostgREST con el JWT que lo representa).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'funnel') then
    create role funnel nologin;
  end if;
end $$;

-- Privilegio exacto y único del funnel.
revoke execute on function public.registrar_diagnostico(jsonb) from funnel;
grant execute on function public.registrar_diagnostico(jsonb) to funnel;
-- Lectura de la DEFINICIÓN del quiz publicado: contenido público (las
-- preguntas están de todas formas en el navegador); sin datos de leads.
grant select on public.quiz_versiones to funnel;
drop policy if exists "funnel read definiciones" on public.quiz_versiones;
create policy "funnel read definiciones" on public.quiz_versiones
  for select to funnel using (true);

-- PostgREST cambia de identidad desde el rol `authenticator` según el claim
-- `role` del JWT: para que pueda adoptar `funnel` debe ser miembro.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant funnel to authenticator;
  end if;
end $$;

-- Cinturón: nada del resto del negocio puede adoptar `funnel`.
revoke funnel from authenticated;
revoke funnel from service_role;

commit;
