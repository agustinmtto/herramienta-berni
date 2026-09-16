-- ============================================================
-- MetaCrypto OS — Migración 0003: FINANCIERO
-- Módulo 1.3: cuotas_programadas · pagos
-- cuotas_programadas = el PLAN (futuro). pagos = el EVENTO real (pasado).
-- cash collected = Σ pagos · cash to be collected = Σ cuotas pendientes.
-- ============================================================

-- 1) cuotas_programadas (plan de pago del programa) ---------------------------
create table if not exists public.cuotas_programadas (
  id                uuid primary key default gen_random_uuid(),
  programa_id       uuid not null references public.programas(id),
  numero_cuota      int not null,
  fecha_vencimiento date not null,
  monto             numeric(12,2) not null,
  divisa            text not null default 'EUR',
  estado            text not null default 'pendiente'
                     check (estado in ('pendiente','pagada','vencida')),
  created_at        timestamptz not null default now()
);
create index if not exists idx_cuotas_programa   on public.cuotas_programadas(programa_id);
create index if not exists idx_cuotas_venc        on public.cuotas_programadas(fecha_vencimiento);
create index if not exists idx_cuotas_estado      on public.cuotas_programadas(estado);

-- 2) pagos (evento real; refund = monto negativo; reserva = depósito) ---------
create table if not exists public.pagos (
  id           uuid primary key default gen_random_uuid(),
  persona_id   uuid not null references public.personas(id),
  cuota_id     uuid references public.cuotas_programadas(id),
  tipo         text not null check (tipo in ('reserva','cuota','nueva','upsell','refund')),
  monto        numeric(12,2) not null,          -- refund => negativo
  divisa       text not null default 'EUR',
  fx_rate      numeric(12,6),
  fecha        date not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pagos_persona on public.pagos(persona_id);
create index if not exists idx_pagos_cuota    on public.pagos(cuota_id);
create index if not exists idx_pagos_fecha     on public.pagos(fecha);

-- 3) RLS ----------------------------------------------------------------------
alter table public.cuotas_programadas enable row level security;
alter table public.pagos              enable row level security;

drop policy if exists "auth read cuotas" on public.cuotas_programadas;
create policy "auth read cuotas" on public.cuotas_programadas for select to authenticated using (true);
drop policy if exists "auth read pagos" on public.pagos;
create policy "auth read pagos" on public.pagos for select to authenticated using (true);
