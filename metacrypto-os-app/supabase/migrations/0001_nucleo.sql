-- ============================================================
-- MetaCrypto OS — Migración 0001: NÚCLEO
-- Módulo 1.1 del plan: personas · team_members · tiers
-- Principio: identidad durable (personas) + eventos inmutables.
-- ============================================================

-- 1) team_members (coaches / closers / admin) ---------------------------------
create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  rol         text not null check (rol in ('coach','closer','admin')),
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 2) tiers (referencia: bundle/entitlements por programa) ----------------------
--    OJO: los valores de bundle son BORRADOR — confirmar con Berni/Alex.
create table if not exists public.tiers (
  id                text primary key,          -- '1800','3000','5000','8000','OG'
  nombre            text not null,
  meses_default     int,                        -- null = vitalicio (OG)
  n_consultorias    int  not null default 0,
  acceso_discord    boolean not null default false,
  acceso_comunidad  boolean not null default false,
  sesiones_directo  boolean not null default false,
  numero_berni      boolean not null default false,
  activo            boolean not null default true
);

-- 3) personas (RAÍZ · identidad durable) --------------------------------------
create table if not exists public.personas (
  id                uuid primary key default gen_random_uuid(),
  estado            text not null default 'cliente'
                     check (estado in ('lead','reservado','cliente','ex_cliente')),
  nombre            text,
  telefono_e164     text unique,
  email             text,
  pais              text,
  ghl_contact_id    text,                       -- llave externa a GHL (reservada)
  coach_id          uuid references public.team_members(id),
  divisa_preferida  text not null default 'EUR',
  created_at        timestamptz not null default now()
);

create index if not exists idx_personas_telefono on public.personas(telefono_e164);
create index if not exists idx_personas_ghl       on public.personas(ghl_contact_id);
create index if not exists idx_personas_estado    on public.personas(estado);
create index if not exists idx_personas_coach     on public.personas(coach_id);

-- 4) Seed de tiers (BORRADOR — ajustar bundle con el cliente) ------------------
insert into public.tiers (id, nombre, meses_default, n_consultorias, acceso_discord, acceso_comunidad, sesiones_directo, numero_berni) values
  ('1800', '€1.800 / 6 meses',  6, 1, false, false, false, false),
  ('3000', '€3.000 / 8 meses',  8, 2, false, false, true,  false),
  ('5000', '€5.000 / 12 meses', 12,4, true,  true,  true,  false),
  ('8000', '€8.000 (premium)',  12,6, true,  true,  true,  true),
  ('OG',   'OG vitalicio (2023)', null, 0, true, false, false, false)
on conflict (id) do nothing;

-- 5) RLS (seguridad a nivel de fila) ------------------------------------------
alter table public.team_members enable row level security;
alter table public.tiers        enable row level security;
alter table public.personas     enable row level security;

-- Lectura para usuarios autenticados (el equipo del inbox). Escrituras van por
-- service_role (que bypassa RLS) desde la Edge Function / scripts.
drop policy if exists "auth read team_members" on public.team_members;
create policy "auth read team_members" on public.team_members for select to authenticated using (true);

drop policy if exists "auth read tiers" on public.tiers;
create policy "auth read tiers" on public.tiers for select to authenticated using (true);

drop policy if exists "auth read personas" on public.personas;
create policy "auth read personas" on public.personas for select to authenticated using (true);
