-- ============================================================
-- 0057 — El contrato deja de ser forma reservada.
--
-- `contratos` existe desde la 0004 y nunca se usó: cero referencias en `apps/`
-- (verificado el 7-sep con un grep sobre .ts/.tsx). Por eso se puede ajustar su
-- forma sin migrar nada ni romper a nadie — es la última oportunidad de hacerlo
-- antes de que empiece a tener datos.
--
-- Lo que cambia, y por qué:
--
--  · `estado` solo aceptaba 'pendiente' y 'firmado'. Entre esos dos hay dos
--    momentos reales más:
--
--      'enviado'     — el PDF se generó y Resend aceptó el correo. El cliente
--                      todavía no lo devolvió firmado. Sin este estado no se
--                      distingue "falta generarlo" de "está esperando".
--
--      'error_envio' — el PDF se generó pero NO salió a nadie: los tres
--                      destinatarios fallaron (clave de Resend vencida, Resend
--                      caído). La fila tiene que existir igual —el PDF está
--                      subido y hay que poder llegar a él— pero llamarla
--                      'enviado' sería un registro que miente sobre un
--                      documento legal, y la pestaña no daría ninguna señal de
--                      que hay que reenviarlo a mano.
--
--                      Que fallen ALGUNOS no lo activa: con un destinatario que
--                      recibió, el contrato salió. Es el caso "ninguno" el que
--                      necesita nombre propio. Lo marcó el revisor el 7-sep y
--                      lo decidió Patricio el mismo día, antes de aplicar esta
--                      migración — después habría costado otra.
--
--  · `pdf_path` — el archivo vive en Storage, privado, igual que
--    `pagos.comprobante_path` (0014). Se guarda la RUTA, no una URL: una URL
--    firmada caduca, y una pública dejaría el contrato de un cliente colgando
--    de internet. `url_documento` (0004) se deja en paz por si alguna vez se
--    enlaza un contrato firmado alojado fuera.
--
--  · `tipo` — hay dos plantillas distintas, no una con variantes: venta nueva
--    (9 cláusulas) y ampliación (10, con otra política de reembolso). Saber con
--    cuál se generó un contrato viejo es lo que permite regenerarlo igual
--    cuando la plantilla vigente ya cambió.
--
--  · `emails_enviados.tipo` es una CHECK cerrada a cinco valores (0054, ampliada
--    en 0056). El correo del contrato es un sexto. Va en ESTA migración y no en
--    otra a propósito: si el código empieza a mandar `tipo: 'contrato'` y la
--    base todavía no lo acepta, el correo SALE y el registro falla — el modo de
--    fallo exacto del 12-ago (el mismo recordatorio siete veces). Las dos
--    listas, la de TypeScript y la de la base, se mueven juntas o no se mueven.
--
--  · El índice único sobre `programa_id` es el antiduplicados. Cada venta
--    —nueva, ascensión o extensión— crea SIEMPRE una fila en `programas`
--    (0052, línea 177: el insert es incondicional), así que "un contrato por
--    programa" es exactamente "un contrato por venta". Sin esto, un reintento
--    del hook tras un fallo de red le manda al cliente su segundo contrato.
--    Mismo criterio que `idempotency_key` en `emails_enviados` (0054): la
--    garantía vive en la base, no en la confianza de que el código no repita.
-- ============================================================
begin;

alter table public.contratos drop constraint if exists contratos_estado_check;
alter table public.contratos
  add constraint contratos_estado_check
  check (estado in ('pendiente', 'enviado', 'error_envio', 'firmado'));

comment on column public.contratos.estado is
  'pendiente = sin generar · enviado = Resend aceptó el correo (NO es una entrega, igual que en emails_enviados) · error_envio = el PDF existe pero no salió a NINGÚN destinatario · firmado = lo marca una persona.';

alter table public.contratos add column if not exists pdf_path text;
alter table public.contratos add column if not exists tipo text;

alter table public.contratos drop constraint if exists contratos_tipo_check;
alter table public.contratos
  add constraint contratos_tipo_check
  check (tipo is null or tipo in ('venta_nueva', 'ampliacion'));

-- El sexto tipo de correo. Se reescribe la CHECK entera porque Postgres no
-- sabe "añadir un valor" a una restricción: los cinco anteriores se copian de
-- 0056 (líneas 24-27), verificados al escribir esto.
alter table public.emails_enviados drop constraint if exists emails_enviados_tipo_check;
alter table public.emails_enviados
  add constraint emails_enviados_tipo_check
  check (tipo in ('estrategia', 'confirmacion_sesion', 'recordatorio_1h',
                  'invitacion_calendario', 'aviso_venta_equipo', 'contrato'));

-- Parcial: las filas sin programa (si alguna vez se carga un contrato suelto a
-- mano) no compiten entre sí por el único hueco de `null`.
create unique index if not exists uq_contratos_programa
  on public.contratos(programa_id) where programa_id is not null;

-- El bucket. Los otros dos (`wa-media`, `comprobantes`) se crearon a mano por el
-- dashboard y no dejaron rastro en ninguna migración; se hace acá para que haya
-- una sola fuente de verdad y para que quien recree la base de cero no descubra
-- que falta recién cuando el primer contrato no encuentra dónde ir.
-- `public => false`: se sirve por una ruta autenticada del OS, clon de
-- `app/api/comprobantes/[pagoId]/route.ts`, nunca por URL directa.
-- El límite y la lista de mimes copian a `comprobantes` (medido hoy con
-- `GET /storage/v1/bucket`: 10485760 bytes, png/jpeg/pdf), recortada a PDF
-- porque un contrato no es una foto. Sin la lista, un fallo del generador
-- podría dejar subido un HTML de error con extensión .pdf.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

commit;
