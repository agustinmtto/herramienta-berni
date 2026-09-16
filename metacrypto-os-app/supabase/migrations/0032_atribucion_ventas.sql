-- ============================================================
-- 0032 — La atribución vive en la venta, y cada pago sabe de qué venta es.
--
-- POR QUÉ CONGELADA Y NO DEDUCIDA
-- `setter_id` se guarda RESUELTO, no se deduce de `fuentes_atribucion` al
-- leer. Si Berni corrige el catálogo dentro de dos meses, las comisiones ya
-- pagadas no pueden cambiar solas. Se guardan los dos: `source_id` crudo
-- para rastrear, `setter_id` resuelto para pagar.
--
-- POR QUÉ `upsell_por_id` Y NO `personas.coach_id`
-- "El coach del cliente" no es un valor estable: en Airtable las 105
-- sesiones se reparten Berni 53 / Manuel 52, y de los 73 clientes con coach
-- deducible, 18 tienen los dos. El 10% va a QUIEN HIZO esa ascensión, que
-- es lo que dijo Berni ("si el upsell lo hace otro miembro..."). Se
-- pregunta en el formulario en vez de adivinarse.
--
-- POR QUÉ `atribucion_at`
-- Distingue "nadie lo ha mirado" de "lo miré y no vino de ninguna agenda".
-- Sin ella, las ventas legítimamente sin fuente contaminan la bandeja para
-- siempre y a las dos semanas nadie la mira.
-- ============================================================
begin;

alter table public.programas
  add column if not exists source_id          text references public.fuentes_atribucion(source_id),
  add column if not exists setter_id          uuid references public.team_members(id),
  add column if not exists closer_id          uuid references public.team_members(id),
  add column if not exists upsell_por_id      uuid references public.team_members(id),
  add column if not exists ghl_appointment_id text,
  add column if not exists atribucion_at      timestamptz;

alter table public.pagos
  add column if not exists programa_id uuid references public.programas(id);

-- La bandeja consulta por esto en cada carga.
create index if not exists programas_sin_atribuir_idx
  on public.programas (fecha_inicio)
  where atribucion_at is null;

create index if not exists pagos_programa_idx on public.pagos (programa_id);

-- ---------- Relleno del histórico ----------
-- Pasada 1: persona con UN SOLO programa. Resuelve 118 de 140.
update public.pagos p
set programa_id = g.id
from public.programas g
where p.programa_id is null
  and g.persona_id = p.persona_id
  and (select count(*) from public.programas x where x.persona_id = p.persona_id) = 1;

-- Pasada 2: persona con varios, emparejando por fecha exacta Y tipo
-- compatible. De los 21 ambiguos casan 19. esa clienta cae sola: su pago de
-- upsell del 25-jun contra su programa de upsell del 25-jun.
update public.pagos p
set programa_id = g.id
from public.programas g
where p.programa_id is null
  and g.persona_id = p.persona_id
  and g.fecha_inicio = p.fecha
  and ((p.tipo = 'upsell' and g.motivo = 'upsell')
    or (p.tipo = 'nueva'  and g.motivo in ('nueva_venta', 'renovacion')));

-- Lo que quede (3 pagos) se deja en null a propósito: sale marcado en el
-- informe en vez de colgarse de un programa inventado.

-- ---------- La vista que lee el informe ----------
-- Expone el pago con su atribución YA RESUELTA. Las reglas de cálculo NO
-- viven aquí: viven en lib/comisiones.ts, con tests. Esta vista solo junta
-- los datos para que la lógica pura decida.
-- `coalesce`: un pago de CUOTA no necesita `programa_id` propio — su cuota ya
-- sabe de qué programa es. Así ni `cobrar_cuota` ni `pagar_cuota_usd` hay que
-- tocarlas: el eslabón se deriva. Solo el primer pago de una venta necesita
-- la columna directa.
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
left join public.fuentes_atribucion f on f.source_id = g.source_id;

commit;
