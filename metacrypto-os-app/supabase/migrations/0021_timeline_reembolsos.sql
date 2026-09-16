-- ============================================================
-- MetaCrypto OS — Migración 0021: reembolsos en la línea temporal
-- ============================================================
-- Por qué: v_timeline_cliente (migración 0019) titulaba TODA fila de `pagos`
-- como 'Cobro registrado', sin mirar `pg.tipo`. En producción hay 6 pagos con
-- tipo='refund' (4 de ellos con monto negativo: -1.000, -1.500, -1.500 y
-- -3.000 €), así que la ficha de esos clientes decía "Cobro registrado ·
-- -3.000 €" — llamaba cobro a una devolución. Una pantalla cuya razón de ser
-- es contar la verdad de lo que pasó no puede confundir esas dos cosas.
--
-- Los valores reales de `pagos.tipo` en producción (verificados antes de
-- escribir esto) son: 'cuota', 'nueva', 'refund', 'upsell'. Solo 'refund'
-- necesita un título distinto; el resto sigue diciendo 'Cobro registrado'.
--
-- `create or replace view` sobre la vista completa (no se toca la migración
-- 0019 ya aplicada). Única línea con cambio real: el `titulo` de la rama de
-- `pagos`, que pasa de un literal fijo a un `case` sobre `pg.tipo` — mismo
-- patrón que ya usan las otras cinco ramas de esta vista con sus propios
-- campos (`p.motivo`, `s.tipo`, `s.asistio`, etc.).
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

-- Pagos ------------------------------------------------------------------
-- El título distingue un reembolso de un cobro real (ver cabecera de esta
-- migración). El resto de tipos ('nueva', 'upsell', 'cuota') se sigue
-- anunciando como 'Cobro registrado', igual que en la 0019.
select
  pg.persona_id,
  ((pg.fecha + time '12:00') at time zone 'Europe/Madrid'),
  pg.fecha,
  'pago',
  case pg.tipo when 'refund' then 'Reembolso' else 'Cobro registrado' end,
  coalesce(pg.tipo_detalle, pg.tipo),
  pg.monto,
  pg.id
from public.pagos pg

union all

-- Cuotas (llegan a la persona a través de su programa) ------------------------
-- NOTA — doble significado de `monto` en `cuotas_programadas` (documentado,
-- no corregido aquí): mientras una cuota está `pendiente`, `monto` es "lo que
-- falta por cobrar". En cuanto se cierra (`pagada`), ese mismo campo pasa a
-- significar OTRA COSA: el importe del pago que la cerró (ver `pagar_cuota`,
-- migración 0016). Con un pago único eso coincide con el total de la cuota y
-- no se nota. Con abonos parciales, no: una cuota de 500€ cobrada en dos
-- abonos (300 + 200) puede acabar con `monto = 200` — el último abono, no el
-- total cobrado. Esta vista muestra ese `monto` tal cual bajo el título
-- "Cuota cobrada" (fila de abajo), así que en ese escenario diría
-- "Cuota cobrada · 200 €" cuando en realidad se cobraron 500.
-- Verificado en producción al escribir esta migración: HOY no existe ninguna
-- cuota pagada con más de un abono (0 filas), así que no hay caso real que
-- justifique tocar el comportamiento — sería un cambio sin nada que lo
-- valide. El día que aparezca la primera, la vista necesita sumar los abonos
-- de `pagos` (tipo='cuota', por `cuota_id`) en vez de leer `c.monto`
-- directamente, igual que ya hace `getCuotasDetalle()` en `lib/data.ts`.
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
