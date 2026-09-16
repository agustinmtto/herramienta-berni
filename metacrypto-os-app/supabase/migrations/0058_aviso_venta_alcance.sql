-- ============================================================
-- 0058 — Quién recibe el aviso de cierre: todas las ventas, o solo las suyas.
--
-- Por qué una columna nueva y no `push_alcance` (0042), que ya tiene
-- exactamente los valores que hacen falta: ese campo gobierna las
-- notificaciones del INBOX y hoy vale 'ninguna' para Alex, Berni, Milo y
-- Paula. Si el aviso de venta empezara a respetarlo, cuatro de las seis
-- personas del equipo dejarían de enterarse de los cierres — un cambio que
-- nadie pidió, causado por reutilizar un campo que significa otra cosa.
-- Medido el 8-sep antes de escribir esto, precisamente para no hacerlo.
--
-- `todas` por defecto: es el comportamiento de hoy (`destinatariosVenta` no
-- filtra por nada, petición de Alex el 3-sep — "el cierre lo celebra todo el
-- equipo"), así que la migración no cambia a nadie hasta que se le cambie a
-- mano.
--
-- `asignadas` = solo las ventas donde esa persona figura como setter. Se
-- estrena con Dani (Milo, 8-sep), que entra al equipo con correo pero solo
-- para sus propios cierres.
--
-- ⚠️ Ojo con lo que esto promete: `programas.setter_id` es OPCIONAL y hoy
-- viene relleno en 21 de las 51 ventas de los últimos 60 días. Quien esté en
-- `asignadas` se perderá sus propias ventas cada vez que el closer no
-- complete ese campo. No es un fallo de esta regla: es el dato que hay.
-- ============================================================
begin;

alter table public.team_members
  add column if not exists aviso_venta_alcance text not null default 'todas';

alter table public.team_members drop constraint if exists team_members_aviso_venta_alcance_check;
alter table public.team_members
  add constraint team_members_aviso_venta_alcance_check
  check (aviso_venta_alcance in ('todas', 'asignadas'));

comment on column public.team_members.aviso_venta_alcance is
  'todas = se entera de todos los cierres · asignadas = solo de las ventas donde es el setter. No confundir con push_alcance, que es para el inbox.';

commit;
