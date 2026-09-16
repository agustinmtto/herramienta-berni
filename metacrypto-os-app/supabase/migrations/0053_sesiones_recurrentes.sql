-- ============================================================
-- 0053 — Sesiones grupales recurrentes (miércoles con Manuel, domingo con
-- Berni) y su aviso de WhatsApp 1 hora antes.
--
-- El horario vive en el OS, no en GoHighLevel: estas sesiones son grupales y
-- fijas — GHL daría el horario (que ya se sabe) pero no la lista de
-- destinatarios, y colgar el aviso de un sync añade un modo de fallo a cambio
-- de nada. Decisión del 16-ago, plan
-- docs/superpowers/plans/2026-08-16-recordatorios-sesiones-recurrentes.md.
--
-- Las dos filas nacen DESACTIVADAS y sin hora ni enlace: se rellenan desde
-- /sesiones cuando lleguen los links de Zoom, y el envío cuelga además de la
-- env var RECORDATORIO_GRUPAL_ACTIVO. Encender es un dato, no un deploy.
-- ============================================================
begin;

create table if not exists sesiones_recurrentes (
  id               uuid primary key default gen_random_uuid(),
  dia_semana       smallint not null check (dia_semana between 0 and 6), -- 0=domingo … 6=sábado
  hora             time,                          -- null = sin confirmar; sin hora no se programa nada
  zona             text not null default 'Europe/Madrid',
  coach_id         uuid references public.team_members(id),
  enlace           text,                          -- Zoom; null = sin confirmar
  plantilla_nombre text not null default 'recordatorio_1h_es',
  audiencia        text not null default 'todos', -- lista blanca en lib/recurrentes.ts
  activa           boolean not null default false,
  duracion_min     integer not null default 60,
  creada_at        timestamptz not null default now()
);

-- La ocurrencia de cada semana se materializa en `sesiones` (tipo 'grupal',
-- admitido por el check de la 0002 desde el principio), colgada de su regla.
alter table sesiones
  add column if not exists recurrente_id uuid references sesiones_recurrentes(id);

-- Clave de idempotencia del cron: una pasada repetida reutiliza la fila de la
-- ocurrencia en vez de duplicarla. Índice único COMPLETO, no parcial — la
-- lección de la 0026: PostgREST no puede inferir un índice parcial en
-- ON CONFLICT y el upsert fallaría en silencio. Con NULLs distintos (el
-- comportamiento por defecto), las sesiones normales (recurrente_id null)
-- conviven sin chocar entre sí.
create unique index if not exists sesiones_recurrente_ocurrencia_key
  on sesiones (recurrente_id, fecha);

-- Las dos sesiones fijas de la semana. Idempotente por (dia_semana, coach_id):
-- reaplicar la migración no duplica las filas.
insert into sesiones_recurrentes (dia_semana, coach_id)
select v.dia_semana, v.coach_id
from (values
  (3, 'bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1'::uuid), -- miércoles con Manuel
  (0, '6cbb5982-6051-4c00-bc98-97310140e23f'::uuid)  -- domingo con Berni
) as v(dia_semana, coach_id)
where not exists (
  select 1 from sesiones_recurrentes r
  where r.dia_semana = v.dia_semana and r.coach_id = v.coach_id
);

commit;
