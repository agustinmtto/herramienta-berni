-- ============================================================
-- 0026 — El índice único de `ghl_appointment_id` no servía para el upsert.
--
-- `sesiones_ghl_appointment_id_key` (0024) es un índice PARCIAL
-- (`where ghl_appointment_id is not null`). El upsert de route.ts manda
-- `?on_conflict=ghl_appointment_id`, que PostgREST traduce a
-- `ON CONFLICT (ghl_appointment_id) DO UPDATE` SIN predicado — y Postgres
-- solo infiere un índice parcial cuando la sentencia repite su predicado
-- exacto, cosa que PostgREST no hace. Sin eso, cada upsert fallaba con:
--
--   ERROR: 42P10: there is no unique or exclusion constraint matching
--   the ON CONFLICT specification
--
-- Confirmado contra producción el 10-ago-2026 (transacción revertida).
-- Efecto real: el cron devolvía {ok:true, citas:N, sesiones:0} cada 5
-- minutos sin escribir una sola fila en `sesiones` — la idempotencia, que
-- era el punto de la tarea, nunca llegó a cumplirse.
--
-- Arreglo: sustituir el índice parcial por un UNIQUE normal. En Postgres
-- un UNIQUE ya admite múltiples NULL por defecto (NULLS DISTINCT), así que
-- las 103 sesiones históricas (de Airtable, sin ghl_appointment_id) siguen
-- conviviendo sin problema — el predicado parcial de la 0024 nunca hizo
-- falta para eso; solo bastaba con que UNIQUE ignora los NULL.
-- ============================================================
begin;

drop index if exists sesiones_ghl_appointment_id_key;
alter table sesiones add constraint sesiones_ghl_appointment_id_key unique (ghl_appointment_id);

commit;
