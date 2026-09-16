-- ============================================================
-- MetaCrypto OS — Migración 0019: LÍNEA TEMPORAL DEL CLIENTE
-- Vista de solo lectura que une los eventos que ya viven repartidos
-- en seis tablas. Sin tablas nuevas, sin escrituras, sin backfill.
--
-- Zona horaria: las fuentes con `date` se anclan a las 12:00 de Madrid.
-- Al mediodía ninguna conversión de zona cambia el día — así el evento
-- del 3-ago sigue siendo del 3-ago se mire desde donde se mire.
-- ============================================================

create or replace view public.v_timeline_cliente with (security_invoker=true) as

-- Programas: alta, ascensión, renovación… ------------------------------------
select
  p.persona_id,
  ((p.fecha_inicio + time '12:00') at time zone 'Europe/Madrid') as fecha,
  p.fecha_inicio                                                  as dia,
  'programa'::text                                                as tipo,
  case p.motivo
    when 'nueva_venta'  then 'Compra nueva'
    when 'upsell'       then 'Ascensión de programa'
    when 'renovacion'   then 'Renovación'
    when 'downsell'     then 'Bajada de programa'
    when 'reactivacion' then 'Reactivación'
    when 'cross_sell'   then 'Venta cruzada'
    else p.motivo
  end                                                             as titulo,
  ('Tier ' || p.tier)                                             as detalle,
  p.monto                                                         as importe,
  p.id                                                            as ref_id
from public.programas p

union all

-- Pagos ----------------------------------------------------------------------
select
  pg.persona_id,
  ((pg.fecha + time '12:00') at time zone 'Europe/Madrid'),
  pg.fecha,
  'pago',
  'Cobro registrado',
  coalesce(pg.tipo_detalle, pg.tipo),
  pg.monto,
  pg.id
from public.pagos pg

union all

-- Cuotas (llegan a la persona a través de su programa) ------------------------
select
  pr.persona_id,
  ((c.fecha_vencimiento + time '12:00') at time zone 'Europe/Madrid'),
  c.fecha_vencimiento,
  'cuota',
  case c.estado when 'pagada' then 'Cuota cobrada' else 'Cuota pendiente' end,
  ('Cuota ' || c.numero_cuota),
  c.monto,
  c.id
from public.cuotas_programadas c
join public.programas pr on pr.id = c.programa_id

union all

-- Sesiones (fecha es timestamptz real; puede ser null) ------------------------
select
  s.persona_id,
  s.fecha,
  (s.fecha at time zone 'Europe/Madrid')::date,
  'sesion',
  case s.tipo when 'consultoria_1a1' then 'Consultoría 1-a-1' else 'Sesión grupal' end,
  case when s.asistio is null then 'sin registrar'
       when s.asistio then 'asistió'
       else 'no asistió' end,
  null::numeric,
  s.id
from public.sesiones s

union all

-- Pausas del programa --------------------------------------------------------
select
  pr.persona_id,
  ((e.fecha_inicio + time '12:00') at time zone 'Europe/Madrid'),
  e.fecha_inicio,
  'freeze',
  'Programa pausado',
  case when e.fecha_fin is null then 'sin fecha de fin'
       else ('hasta ' || to_char(e.fecha_fin, 'DD/MM/YYYY')) end,
  null::numeric,
  e.id
from public.programa_eventos e
join public.programas pr on pr.id = e.programa_id
where e.tipo = 'freeze'

union all

-- Plantillas de WhatsApp enviadas --------------------------------------------
select
  cv.persona_id,
  m.sent_at,
  (m.sent_at at time zone 'Europe/Madrid')::date,
  'mensaje',
  'Plantilla enviada',
  m.body,
  null::numeric,
  m.id
from public.wa_mensajes m
join public.wa_conversaciones cv on cv.id = m.conversacion_id
where m.tipo = 'template' and cv.persona_id is not null;
