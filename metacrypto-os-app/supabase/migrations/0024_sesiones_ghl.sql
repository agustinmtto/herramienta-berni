-- ============================================================
-- 0024 — Las consultorías de GoHighLevel viven en `sesiones`.
--
-- `ghl_appointment_id` es la clave de idempotencia del sync: una pasada
-- repetida (o dos crons solapados) hace upsert sobre la misma fila en vez
-- de duplicar la sesión.
--
-- `wa_mensajes.sesion_id` es lo que permite deduplicar los envíos POR SESIÓN.
-- Deduplicar solo por persona + plantilla silenciaría el recordatorio de la
-- segunda consultoría de un mismo cliente.
-- ============================================================
begin;

alter table sesiones
  add column if not exists ghl_appointment_id text,
  add column if not exists enlace text,
  add column if not exists estado text;

-- Único pero permitiendo NULL: las 103 sesiones históricas (de Airtable) no
-- vienen de GHL y deben poder convivir sin id.
create unique index if not exists sesiones_ghl_appointment_id_key
  on sesiones (ghl_appointment_id)
  where ghl_appointment_id is not null;

alter table wa_mensajes
  add column if not exists sesion_id uuid references sesiones(id) on delete set null;

-- El antiduplicados consulta por (sesion_id, plantilla_nombre) en cada pasada
-- del cron: sin índice es un scan de toda la tabla cada 5 minutos.
create index if not exists wa_mensajes_sesion_plantilla_idx
  on wa_mensajes (sesion_id, plantilla_nombre)
  where sesion_id is not null;

commit;
