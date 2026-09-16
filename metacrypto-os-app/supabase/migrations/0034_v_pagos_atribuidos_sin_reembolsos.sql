-- ============================================================
-- 0034 — `v_pagos_atribuidos` no debe incluir reembolsos.
--
-- EL AGUJERO
-- La vista de 0032 no filtra `pagos.tipo`. Hay 6 filas `tipo='refund'` en
-- producción, y ya tienen `programa_id` resuelto (el relleno del histórico
-- las emparejó igual que a cualquier otro pago). Si una de esas 6 se
-- atribuyera (entra en la bandeja como cualquier otra, porque su programa
-- puede tener `atribucion_at is null`), `comisionesDePago` la trataría como
-- un cobro más: 4 de las 6 tienen `monto` NEGATIVO (-1.000, -1.500, -1.500,
-- ...), así que generaría una línea de comisión NEGATIVA — sin incidencia,
-- sin aviso, un número plausible que resta en vez de sumar en el informe
-- que Berni usa para pagar.
--
-- POR QUÉ EN LA VISTA Y NO EN `comisionesDePago`
-- La lógica pura ya no ve `pagos.tipo` — la vista lo colapsa. Filtrar aquí,
-- en el único sitio que sí lo tiene, evita que la lógica pura tenga que
-- volver a aprender un concepto (reembolso) que no le hace falta para
-- calcular comisiones sobre cobros de verdad.
-- ============================================================
begin;

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
  (g.atribucion_at is not null) as atribuido
from public.pagos p
left join public.personas pe on pe.id = p.persona_id
left join public.cuotas_programadas cu on cu.id = p.cuota_id
left join public.programas g on g.id = coalesce(p.programa_id, cu.programa_id)
left join public.fuentes_atribucion f on f.source_id = g.source_id
where p.tipo is distinct from 'refund';

commit;
