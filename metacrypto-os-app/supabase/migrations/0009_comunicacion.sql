-- ============================================================
-- MetaCrypto OS — Migración 0009: COMUNICACIÓN / TICKETS
-- Layer 2. Espejo de WhatsApp (Kapso) en Supabase.
-- Ticket = HÍBRIDO: hilo permanente por cliente + estado_atencion.
-- ============================================================

-- Conversaciones (1 por cliente×número de servicio) ---------------------------
create table if not exists public.wa_conversaciones (
  id                   uuid primary key default gen_random_uuid(),
  persona_id           uuid references public.personas(id),          -- null = desconocido
  telefono_e164        text not null,
  kapso_conversation_id text unique,
  estado               text not null default 'active' check (estado in ('active','ended')),
  estado_atencion      text not null default 'pendiente' check (estado_atencion in ('pendiente','resuelto')),
  coach_asignado       uuid references public.team_members(id),
  tier                 text references public.tiers(id),             -- denormalizado para segmentar
  ultimo_mensaje_at    timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists idx_waconv_persona   on public.wa_conversaciones(persona_id);
create index if not exists idx_waconv_telefono   on public.wa_conversaciones(telefono_e164);
create index if not exists idx_waconv_atencion   on public.wa_conversaciones(estado_atencion);
create index if not exists idx_waconv_coach       on public.wa_conversaciones(coach_asignado);

-- Mensajes (espejo idempotente por kapso_message_id) --------------------------
create table if not exists public.wa_mensajes (
  id               uuid primary key default gen_random_uuid(),
  conversacion_id  uuid not null references public.wa_conversaciones(id) on delete cascade,
  kapso_message_id text unique,                                       -- idempotencia
  direction        text not null check (direction in ('in','out')),
  body             text,
  tipo             text,                                              -- text/template/image/...
  autor            text,                                              -- 'cliente' o team_member_id
  status           text,                                              -- sent/delivered/read/failed
  sent_at          timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index if not exists idx_wamsg_conv   on public.wa_mensajes(conversacion_id);
create index if not exists idx_wamsg_sent    on public.wa_mensajes(sent_at);

-- RLS -------------------------------------------------------------------------
alter table public.wa_conversaciones enable row level security;
alter table public.wa_mensajes       enable row level security;

drop policy if exists "auth read waconv" on public.wa_conversaciones;
create policy "auth read waconv" on public.wa_conversaciones for select to authenticated using (true);
drop policy if exists "auth write waconv" on public.wa_conversaciones;
create policy "auth write waconv" on public.wa_conversaciones for update to authenticated using (true) with check (true);

drop policy if exists "auth read wamsg" on public.wa_mensajes;
create policy "auth read wamsg" on public.wa_mensajes for select to authenticated using (true);
