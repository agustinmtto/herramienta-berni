-- ============================================================
-- 0042 — Notificaciones push del inbox.
--
-- Milo, 19-ago-2026: "a mí me importa que las notificaciones lleguen, es
-- decir, que le llegue una notificación a Manuel cuando llegue un mensaje".
--
-- El inbox es el WhatsApp DEL NEGOCIO, no el personal de nadie: hoy un
-- cliente escribe, el mensaje se guarda, y nadie se entera hasta que alguien
-- abre el OS a mirar. Esto cierra ese hueco.
--
-- Diseño completo en
-- docs/superpowers/specs/2026-08-19-notificaciones-push-inbox-design.md
--
-- TODO ADITIVO: dos tablas nuevas y una columna con default. No toca ni una
-- fila existente, y nada financiero mira estas tablas.
-- ============================================================

-- Una fila por DISPOSITIVO, no por persona: Manuel con teléfono y portátil
-- son dos suscripciones. `endpoint` es único para que volver a suscribir el
-- mismo aparato haga upsert — si no, cada reinstalación duplicaría los avisos
-- de esa persona para siempre.
create table if not exists push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references team_members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  creada_at timestamptz not null default now(),
  ultimo_ok_at timestamptz,
  fallos int not null default 0
);
create index if not exists push_suscripciones_miembro_idx
  on push_suscripciones (team_member_id);

-- ANTIDUPLICADOS. La clave primaria compuesta ES la garantía, no un índice de
-- apoyo: se INSERTA antes de enviar y un conflicto significa "ya se avisó".
--
-- Se reserva primero y se envía después a sabiendas del coste: si el proceso
-- muere entre el insert y el envío, se pierde UN aviso. Al revés —enviar y
-- luego registrar— un fallo de registro reenvía en CADA reintento del
-- webhook. Eso ya pasó en agosto con el cron de sesiones: envío OK, registro
-- KO, reenvío cada 5 minutos hasta 12 veces.
--
-- Perder un aviso es recuperable. Doce notificaciones repetidas hacen que el
-- equipo silencie la app para siempre, y entonces no sirve ninguna.
create table if not exists push_enviados (
  mensaje_id uuid not null references wa_mensajes(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  enviado_at timestamptz not null default now(),
  primary key (mensaje_id, team_member_id)
);

-- A quién avisa cada mensaje. Va como DATO y no como código a propósito: se
-- cambia con un update y sin desplegar, igual que se acordó para los avisos
-- de sesiones (P3).
--
--   'todas'      — cualquier mensaje entrante avisa a esta persona
--   'asignadas'  — solo sus conversaciones, MÁS las que no tienen coach
--   'ninguna'    — no recibe
--
-- Ojo con 'asignadas': el 19-ago, 76 de 106 conversaciones (72%) no tienen
-- coach. Si se leyera como "solo las mías" literal, siete de cada diez
-- mensajes de clientes no avisarían a nadie. Por eso incluye las huérfanas.
--
-- Default 'ninguna': nadie recibe nada hasta que se le active a mano. Un
-- default 'todas' habría empezado a mandar avisos a los siete miembros del
-- equipo en el primer mensaje tras desplegar.
alter table team_members
  add column if not exists push_alcance text not null default 'ninguna';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'team_members_push_alcance_check'
  ) then
    alter table team_members add constraint team_members_push_alcance_check
      check (push_alcance in ('todas', 'asignadas', 'ninguna'));
  end if;
end $$;

-- Manuel es quien va a usar esto a diario (Milo, 19-ago). Dani queda fuera
-- por ahora — "Daniel no, aún no" — y por eso tampoco se le toca `modulos`.
update team_members set push_alcance = 'todas' where username = 'manuel';
