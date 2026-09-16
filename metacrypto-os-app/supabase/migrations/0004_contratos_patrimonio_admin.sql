-- ============================================================
-- MetaCrypto OS — Migración 0004: CONTRATOS/ONBOARDING · PATRIMONIO · ADMIN
-- Módulos 1.4 + 1.5 + 1.6 (tablas simples; patrimonio = forma reservada)
-- ============================================================

-- 1.4 CONTRATOS / ONBOARDING --------------------------------------------------
create table if not exists public.contratos (
  id            uuid primary key default gen_random_uuid(),
  persona_id    uuid not null references public.personas(id),
  programa_id   uuid references public.programas(id),
  fecha_firma   date,
  estado        text not null default 'pendiente' check (estado in ('pendiente','firmado')),
  url_documento text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_contratos_persona on public.contratos(persona_id);

create table if not exists public.onboarding (
  id                 uuid primary key default gen_random_uuid(),
  persona_id         uuid not null references public.personas(id),
  accesos            jsonb not null default '{}'::jsonb,   -- {woop:bool, discord:bool, calendario:bool}
  bienvenida_enviada boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists idx_onboarding_persona on public.onboarding(persona_id);

-- 1.5 PATRIMONIO (forma reservada; se puebla en su propio módulo futuro) -------
create table if not exists public.posiciones (
  id             uuid primary key default gen_random_uuid(),
  persona_id     uuid not null references public.personas(id),
  activo         text not null,               -- 'BTC','ETH',...
  cantidad       numeric(24,8),
  precio_entrada numeric(18,2),
  fecha          date,
  created_at     timestamptz not null default now()
);
create index if not exists idx_posiciones_persona on public.posiciones(persona_id);

create table if not exists public.patrimonio_snapshots (
  id          uuid primary key default gen_random_uuid(),
  persona_id  uuid not null references public.personas(id),
  valor_total numeric(18,2),
  divisa      text not null default 'USD',
  fecha       date,
  created_at  timestamptz not null default now()
);
create index if not exists idx_patsnap_persona on public.patrimonio_snapshots(persona_id);

-- 1.6 ADMIN (gastos a nivel empresa) ------------------------------------------
create table if not exists public.gastos (
  id         uuid primary key default gen_random_uuid(),
  concepto   text not null,
  categoria  text not null check (categoria in ('software','ads','salarios','comisiones','otros')),
  monto      numeric(12,2) not null,
  divisa     text not null default 'EUR',
  fecha      date not null,
  notas      text,
  created_at timestamptz not null default now()
);
create index if not exists idx_gastos_fecha on public.gastos(fecha);

-- RLS -------------------------------------------------------------------------
alter table public.contratos            enable row level security;
alter table public.onboarding           enable row level security;
alter table public.posiciones           enable row level security;
alter table public.patrimonio_snapshots enable row level security;
alter table public.gastos               enable row level security;

drop policy if exists "auth read contratos" on public.contratos;
create policy "auth read contratos" on public.contratos for select to authenticated using (true);
drop policy if exists "auth read onboarding" on public.onboarding;
create policy "auth read onboarding" on public.onboarding for select to authenticated using (true);
drop policy if exists "auth read posiciones" on public.posiciones;
create policy "auth read posiciones" on public.posiciones for select to authenticated using (true);
drop policy if exists "auth read patsnap" on public.patrimonio_snapshots;
create policy "auth read patsnap" on public.patrimonio_snapshots for select to authenticated using (true);
drop policy if exists "auth read gastos" on public.gastos;
create policy "auth read gastos" on public.gastos for select to authenticated using (true);
