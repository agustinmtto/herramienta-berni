-- ============================================================
-- MetaCrypto OS — Migración 0002: SERVICIO
-- Módulo 1.2: programas · programa_eventos · sesiones
-- Programa = evento inmutable (se AÑADE, no se edita). Upsell/renovación
-- crean fila nueva encadenada por programa_previo_id. Fin efectiva = calculada.
-- ============================================================

-- 1) programas (evento inmutable por venta/upsell/renovación) ------------------
create table if not exists public.programas (
  id                uuid primary key default gen_random_uuid(),
  persona_id        uuid not null references public.personas(id),
  tier              text not null references public.tiers(id),
  motivo            text not null check (motivo in
                       ('nueva_venta','upsell','renovacion','downsell','reactivacion','cross_sell')),
  modo_transicion   text check (modo_transicion in ('suma','reemplaza')), -- null salvo upsell/renov
  programa_previo_id uuid references public.programas(id),
  fecha_inicio      date not null,
  meses_duracion    int,                          -- null = vitalicio (OG)
  monto             numeric(12,2),
  divisa            text not null default 'EUR',
  created_at        timestamptz not null default now()
);
create index if not exists idx_programas_persona on public.programas(persona_id);
create index if not exists idx_programas_previo   on public.programas(programa_previo_id);
create index if not exists idx_programas_tier      on public.programas(tier);

-- 2) programa_eventos (congelación/freeze — extiende la fin efectiva) ----------
create table if not exists public.programa_eventos (
  id            uuid primary key default gen_random_uuid(),
  programa_id   uuid not null references public.programas(id),
  tipo          text not null check (tipo in ('freeze')),
  fecha_inicio  date not null,
  fecha_fin     date,
  created_at    timestamptz not null default now()
);
create index if not exists idx_prog_eventos_prog on public.programa_eventos(programa_id);

-- 3) sesiones (consultorías 1-a-1 / sesiones grupales) ------------------------
create table if not exists public.sesiones (
  id            uuid primary key default gen_random_uuid(),
  persona_id    uuid not null references public.personas(id),
  programa_id   uuid references public.programas(id),
  tipo          text not null check (tipo in ('consultoria_1a1','grupal')),
  coach_id      uuid references public.team_members(id),
  fecha         timestamptz,
  asistio       boolean,
  notas         text,
  url_grabacion text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sesiones_persona on public.sesiones(persona_id);
create index if not exists idx_sesiones_programa on public.sesiones(programa_id);

-- 4) RLS ----------------------------------------------------------------------
alter table public.programas        enable row level security;
alter table public.programa_eventos enable row level security;
alter table public.sesiones         enable row level security;

drop policy if exists "auth read programas" on public.programas;
create policy "auth read programas" on public.programas for select to authenticated using (true);
drop policy if exists "auth read programa_eventos" on public.programa_eventos;
create policy "auth read programa_eventos" on public.programa_eventos for select to authenticated using (true);
drop policy if exists "auth read sesiones" on public.sesiones;
create policy "auth read sesiones" on public.sesiones for select to authenticated using (true);
