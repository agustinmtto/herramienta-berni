-- 0013_permisos_modulos.sql — permisos por módulo (escalable)
alter table public.team_members
  add column if not exists acceso_total boolean not null default true,
  add column if not exists modulos      text[];

-- Asignación inicial (idempotente por username; requiere que el seed de usuarios ya corrió).
update public.team_members set acceso_total = true,  modulos = null
  where lower(username) in ('berni','alex','milo');
update public.team_members set acceso_total = false, modulos = '{clientes,inbox}'
  where lower(username) = 'manuel';
