-- ============================================================
-- 0025 — `sesiones.persona_id` deja de ser obligatoria.
--
-- El `NOT NULL` viene de 0002_servicio.sql, muy anterior al sync de
-- GoHighLevel (0024). El diseño de ese sync (docs/superpowers/specs/
-- 2026-08-10-sesiones-ghl-recordatorios-design.md) ya decidió que una
-- consultoría puede existir en GHL aunque su contacto todavía no esté
-- cruzado con ninguna fila de `personas` — el cruce se intenta por
-- ghl_contact_id, email y teléfono, pero puede no encontrar nada (dato real:
-- 1 de 3 citas reales no cruzó por ningún método).
--
-- Con el `NOT NULL` ese upsert fallaba en `sesiones?on_conflict=
-- ghl_appointment_id`, así que la cita se perdía y el cron la reintentaba —
-- fallando otra vez — cada 5 minutos indefinidamente. Guardar la sesión sin
-- persona es preferible: queda visible en `sesiones` y se vincula sola en
-- cuanto la persona aparezca (la próxima pasada del cron vuelve a intentar
-- el cruce, porque `cruzarPersona` no cachea "no encontrado").
--
-- Sin riesgo para lo existente: relajar un NOT NULL nunca invalida filas ya
-- guardadas, y ningún código de la app lee `sesiones` directamente hoy —
-- solo `v_timeline_cliente`, que ya filtra `persona_id is not null` donde
-- le hace falta.
-- ============================================================
begin;

alter table sesiones alter column persona_id drop not null;

commit;
