-- ============================================================
-- 0054 — El registro de los correos que el OS le manda a un cliente.
--
-- Nace del baneo de la WABA del 2-sep-2026: durante casi tres horas el OS dio
-- por enviados mensajes que Meta estaba tirando, porque Kapso devolvía 200 y
-- el fallo real llegaba después, y porque `wa_mensajes.status` se queda
-- congelado en "sent" para siempre. Esta tabla existe para que el canal nuevo
-- no herede ese defecto.
--
-- Dos piezas hacen ese trabajo:
--
--  · `idempotency_key` es UNIQUE. Viaja además como cabecera Idempotency-Key
--    a Resend, que deduplica 24 h. La restricción de aquí NO caduca, y es la
--    que de verdad impide el incidente del 12-ago (el mismo recordatorio
--    enviado 7 veces porque el envío salía y el registro fallaba).
--
--  · `estado` distingue "aceptado" de "entregado", que es la distinción que
--    `wa_mensajes` no hace. Nace en 'enviado' y solo la consulta periódica a
--    `GET /emails/{id}` (campo `last_event` de Resend) lo mueve a 'entregado'
--    o 'rebotado'. Se consulta en vez de esperar un webhook porque los
--    webhooks de Resend son de plan de pago y la consulta da lo mismo.
--
-- El antiduplicados de esta tabla es SUYO, separado de `wa_mensajes`: por
-- decisión D2 los dos canales salen para el mismo evento, y si compartieran
-- clave el envío de WhatsApp suprimiría el correo.
-- ============================================================
begin;

create table if not exists emails_enviados (
  id              uuid primary key default gen_random_uuid(),
  persona_id      uuid references public.personas(id) on delete set null,
  -- `on delete set null` y no cascade: que alguien borre una sesión no puede
  -- borrar la prueba de que a un cliente se le escribió. La unicidad no
  -- depende de esta columna — vive en `idempotency_key`, que lleva el id
  -- dentro.
  sesion_id       uuid references public.sesiones(id) on delete set null,
  tipo            text not null check (tipo in ('estrategia', 'confirmacion_sesion', 'recordatorio_1h',
                                  'invitacion_calendario')),
  destinatario    text not null,
  idempotency_key text not null unique,
  resend_id       text,                    -- el id que devuelve Resend; null si no llegó a aceptarlo
  -- Seis estados, y ninguno es redundante:
  --   enviado       Resend lo aceptó. NO es una entrega.
  --   entregado     confirmado por `last_event` (delivered/opened/clicked).
  --   rebotado      el servidor del cliente lo rechazó de forma permanente.
  --   quejado       LLEGÓ y el cliente lo marcó como spam. Es lo contrario de
  --                 un rebote y para la reputación del dominio es la peor
  --                 señal que hay: colapsarlo en 'rebotado' perdería justo el
  --                 dato por el que hay que llamar a esa persona.
  --   rechazado     nunca salió (failed, suppressed, o rechazo nuestro).
  --   sin_confirmar tres días sin resolver. Es la salida honesta al modo de
  --                 fallo de `wa_mensajes.status`, que se queda en "sent"
  --                 para siempre y por eso el baneo del 2-sep fue invisible.
  estado          text not null default 'enviado'
                    check (estado in ('enviado', 'entregado', 'rebotado',
                                      'quejado', 'rechazado', 'sin_confirmar')),
  error           text,
  created_at      timestamptz not null default now(),
  actualizado_at  timestamptz
);

-- Para `yaSeEnvioEmail(sesionId, tipo)`, que corre en cada pasada de los dos
-- crons (cada 5 minutos).
create index if not exists emails_enviados_sesion_tipo_idx
  on emails_enviados (sesion_id, tipo);

-- Para la consulta de estado: busca lo aceptado y todavía sin confirmar.
-- Parcial a propósito — las filas ya resueltas no se vuelven a mirar nunca.
create index if not exists emails_enviados_pendientes_idx
  on emails_enviados (created_at)
  where estado = 'enviado';

comment on column emails_enviados.estado is
  'enviado = Resend lo aceptó, NO es una entrega. Solo last_event lo mueve a un estado final.';

commit;
