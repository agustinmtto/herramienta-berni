-- ============================================================
-- MetaCrypto OS — Migración 0022: QUÉ PLANTILLA SE ENVIÓ
--
-- `wa_mensajes.body` guarda el texto de la plantilla con las variables ya
-- sustituidas. Sirve para leerlo, no para saber QUÉ se envió: preguntar
-- "¿recibió este cliente la bienvenida?" obligaba a comparar cadenas.
--
-- Con el nombre guardado, el estado se deriva del propio registro de
-- mensajes — un mensaje enviado es la prueba de que se envió — en vez de
-- duplicarlo en un flag por plantilla dentro de `personas`.
--
-- No se rellena hacia atrás: los mensajes históricos son de las pruebas de
-- julio y ninguno es plantilla.
-- ============================================================

alter table public.wa_mensajes
  add column if not exists plantilla_nombre text;

create index if not exists idx_wamsg_plantilla
  on public.wa_mensajes(plantilla_nombre)
  where plantilla_nombre is not null;
