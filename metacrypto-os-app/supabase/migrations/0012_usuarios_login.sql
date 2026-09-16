-- 0012_usuarios_login.sql — login por usuario
alter table public.team_members
  add column if not exists username      text,
  add column if not exists password_hash text;
create unique index if not exists idx_team_members_username
  on public.team_members (lower(username));
