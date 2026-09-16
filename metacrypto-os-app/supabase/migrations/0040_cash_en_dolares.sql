-- ============================================================
-- 0040 — El cash collected, y la base de las comisiones, en DÓLARES.
--
-- Berni, 14-ago-2026: "El cash collected siempre en $ (incluido en el reporte
-- semanal y demás)" y "En comisiones, se calculan siempre sobre el cash
-- collected en $, nunca sobre el numero redondo de facturación en euros".
--
-- POR QUÉ SE PUEDE HACER YA: los 149 pagos de la base tienen `usd_recibido`
-- relleno — cobertura 100 % desde nov-2025. No hay que decidir ningún tipo de
-- cambio ni convertir nada: `usd_recibido` es lo que REALMENTE entró en la
-- cuenta, no una conversión teórica de los euros facturados. Esa es
-- exactamente la distinción que pide Berni ("nunca sobre el número redondo").
--
-- QUÉ NO CAMBIA: la facturación, el valor de las ventas y las cuotas siguen
-- en EUR, que es como se firman. Una cuota futura no tiene `usd_recibido`
-- porque todavía no se ha cobrado — convertirla exigiría inventar un tipo de
-- cambio, justo lo que este diseño evita.
-- ============================================================
begin;

-- 1) v_cash_collected: el euro se queda, el dólar se suma ---------------------
-- No se sustituye `cash_collected` por dólares: se añade `cash_usd` al lado.
-- El euro sigue siendo la divisa en la que se firma y sirve para cuadrar
-- contra Airtable y contra lo que el equipo tiene en la cabeza. La pantalla
-- decide cuál enseña; la vista no le quita el dato a nadie.
--
-- `sum(usd_recibido)` ignora los NULL por sí solo (no envenena la suma), pero
-- eso haría que un mes con pagos sin USD mostrara un cash más bajo sin decir
-- por qué. Por eso se expone también `n_sin_usd`: si no es 0, el total en
-- dólares está incompleto y la pantalla puede avisarlo.
--
-- Las columnas nuevas van AL FINAL, no junto a las que acompañan:
-- `create or replace view` no permite insertar en medio (renombraría las
-- posteriores y Postgres lo rechaza con 42P16). Añadir al final evita tener
-- que hacer `drop view`, que a su vez fallaría si alguna vista dependiera de
-- esta. El orden de las columnas de una vista no lo lee nadie — todas las
-- lecturas son por nombre.
create or replace view public.v_cash_collected with (security_invoker=true) as
select date_trunc('month', fecha)::date as mes, divisa,
       sum(monto)                                    as cash_collected,
       count(*)                                      as n_pagos,
       sum(usd_recibido)                             as cash_usd,
       count(*) filter (where usd_recibido is null)  as n_sin_usd
from public.pagos
group by 1,2 order by 1,2;

-- 2) v_pagos_atribuidos: expone el USD, que es la base de la comisión --------
-- Se reescribe entera (create or replace no permite añadir columnas en medio)
-- conservando el filtro de reembolsos de 0034 — ver allí por qué: 4 de las 6
-- filas `tipo='refund'` tienen `monto` negativo y generarían una comisión
-- NEGATIVA sin incidencia ni aviso.
create or replace view public.v_pagos_atribuidos as
select
  p.id                as pago_id,
  p.fecha,
  p.monto,
  p.divisa,
  p.persona_id,
  pe.nombre           as persona_nombre,
  coalesce(p.programa_id, cu.programa_id) as programa_id,
  g.motivo,
  g.tier,
  g.source_id,
  f.fuente,
  f.confirmado        as fuente_confirmada,
  g.setter_id,
  g.closer_id,
  g.upsell_por_id,
  (g.atribucion_at is not null) as atribuido,
  -- Al final por la misma razón que en v_cash_collected (42P16).
  --
  -- La base real de la comisión desde 0040. Puede ser NULL en un pago
  -- registrado sin el dato: `comisionesDePago` lo marca como incidencia
  -- `sin_usd` en vez de comisionar sobre los euros, que pagaría un ~7 % de
  -- diferencia en silencio.
  p.usd_recibido
from public.pagos p
left join public.personas pe on pe.id = p.persona_id
left join public.cuotas_programadas cu on cu.id = p.cuota_id
left join public.programas g on g.id = coalesce(p.programa_id, cu.programa_id)
left join public.fuentes_atribucion f on f.source_id = g.source_id
where p.tipo is distinct from 'refund';

commit;
