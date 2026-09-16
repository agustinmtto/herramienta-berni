-- ============================================================
-- 0056 — El aviso de cierre al equipo, también por correo.
--
-- Hoy ese aviso solo existe como push (`avisarNuevaVenta`, migración 0042):
-- llega a quien tiene la PWA instalada y con el móvil desbloqueado, y nada
-- más. El correo es el segundo canal, mismo criterio que el resto de avisos
-- desde el baneo de la WABA del 2-sep — no sustituye al push, lo acompaña.
--
-- Dos piezas:
--
--  · `team_members.email` no existía. La tabla tiene rol, usuario y permisos
--    desde la migración 0001, pero nunca un correo — no hacía falta hasta que
--    el equipo pasó a ser DESTINATARIO de un canal, no solo remitente.
--  · `emails_enviados.tipo` tiene una CHECK cerrada a los cuatro tipos que
--    escribe a un CLIENTE (0054). Este aviso es al EQUIPO, y reutiliza esa
--    misma tabla para heredar gratis el antiduplicados y la consulta de
--    entrega (`GET /api/email/estados`, que no filtra por tipo).
-- ============================================================
begin;

alter table public.team_members add column if not exists email text;

alter table public.emails_enviados drop constraint if exists emails_enviados_tipo_check;
alter table public.emails_enviados
  add constraint emails_enviados_tipo_check
  check (tipo in ('estrategia', 'confirmacion_sesion', 'recordatorio_1h',
                  'invitacion_calendario', 'aviso_venta_equipo'));

-- Confirmado por Milo (7-sep): el suyo es el único que no depende de
-- reconciliar GHL/Airtable con el equipo real. El resto (Berni, Alex, Manuel,
-- Iker) se rellena en cuanto los confirme — hasta entonces el envío los trata
-- como "sin email" y no se cae por eso (ver lib/aviso-venta-email.ts).
update public.team_members set email = 'milo@neureka.xyz' where username = 'milo';

commit;
