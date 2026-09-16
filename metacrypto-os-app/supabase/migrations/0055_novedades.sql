-- ============================================================
-- MetaCrypto OS — Migración 0055: CENTRO DE NOVEDADES
-- Marca de "visto hasta" por miembro para la campana del OS.
-- Spec: docs/superpowers/specs/2026-09-03-novedades-design.md
-- (La 0054 pertenece a emails_enviados — sesión de email, en su rama.
--  Los números están apalabrados: no renumerar si la 0054 aún no está.)
-- ============================================================

create table if not exists public.notificaciones_vistas (
  team_member_id uuid primary key references public.team_members(id) on delete cascade,
  visto_hasta    timestamptz not null default now()
);

-- RLS activado SIN policies: a esta tabla solo llega el service role del
-- servidor (el navegador jamás consulta Supabase directo). Mismo criterio
-- que las tablas operativas de 0043.
alter table public.notificaciones_vistas enable row level security;

-- SIEMBRA: la auditoría tiene meses de historia (cuota/pago desde agosto).
-- Sin esta fila inicial, todo el equipo estrenaría la campana en "9+" con
-- novedades viejas. Primer contacto = al día; desde ahí acumulas.
insert into public.notificaciones_vistas (team_member_id, visto_hasta)
select id, now() from public.team_members
on conflict (team_member_id) do nothing;

-- El feed es cronológico puro; el índice existente de auditoria es por
-- (entidad, entidad_id) y no sirve para "las últimas N".
create index if not exists idx_auditoria_created
  on public.auditoria (created_at desc);
