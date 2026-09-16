-- ============================================================
-- 0045 — Devoluciones: deshacer una venta sin dejar cabos sueltos.
-- Spec: docs/superpowers/specs/2026-08-21-devoluciones-design.md
--
-- POR QUÉ COLUMNAS EN `pagos` Y NO UNA TABLA APARTE
-- `v_cash_collected` lee de `pagos` agrupando por date_trunc('month', fecha)
-- y sin filtrar tipo. Manteniendo la devolución como fila de ese mismo libro,
-- la regla que confirmó Berni el 21-ago ("se resta en este mes") NO HAY QUE
-- CONSTRUIRLA: sale sola. Una tabla espejo obligaría a sumar dos sitios y a
-- mantenerlos de acuerdo para siempre.
--
-- El significado (qué fue, qué revierte, por qué) va en estas tres columnas;
-- el "qué provocó" va en `auditoria` (0016), que ya existe.
-- ============================================================
begin;

-- 1) Las tres columnas --------------------------------------------------------
alter table public.pagos
  add column if not exists revierte_pago_id   uuid references public.pagos(id),
  add column if not exists devolucion_alcance text,
  add column if not exists devolucion_motivo  text;

comment on column public.pagos.revierte_pago_id is
  'Qué cobro devuelve esta fila. Obligatorio en devoluciones parciales: sin él no se sabe qué comisión revertir.';
comment on column public.pagos.devolucion_alcance is
  'total | parcial | sin_clasificar. Obligatorio en tipo=refund, prohibido en el resto.';
comment on column public.pagos.devolucion_motivo is
  'Por qué se devolvió. Obligatorio al registrar o clasificar; null en las heredadas sin clasificar.';

-- 2) Backfill ANTES del check -------------------------------------------------
-- Las 6 filas `refund` del histórico de Airtable entraron sin alcance. Se
-- marcan `sin_clasificar` — el valor honesto: cuatro son devoluciones de
-- programa y dos no se sabe qué fueron, y esta migración no es quien para
-- decidirlo. El saneado (Task 10) promueve las cuatro reales a 'total'.
update public.pagos
   set devolucion_alcance = 'sin_clasificar'
 where tipo = 'refund' and devolucion_alcance is null;

-- 3) Guardas ------------------------------------------------------------------
-- OJO CON EL `is not null` — sin él esta guarda no sirve para nada.
-- Un CHECK solo rechaza la fila cuando la expresión da FALSE; si da NULL, la
-- deja pasar. Y con `tipo='refund'` y `devolucion_alcance` a null, la primera
-- rama era `TRUE and (null in (...))` = NULL y la segunda FALSE, así que el
-- conjunto daba NULL y una devolución sin alcance entraba tan campante.
-- Cazado al probar la guarda (Task 2, 24-ago): el `insert` de prueba pasó.
alter table public.pagos drop constraint if exists pagos_devolucion_alcance_check;
alter table public.pagos add constraint pagos_devolucion_alcance_check check (
  (tipo =  'refund' and devolucion_alcance is not null
                    and devolucion_alcance in ('total','parcial','sin_clasificar')) or
  (tipo <> 'refund' and devolucion_alcance is null)
);

-- Una parcial sin `revierte_pago_id` es una comisión que no se puede revertir.
alter table public.pagos drop constraint if exists pagos_devolucion_parcial_check;
alter table public.pagos add constraint pagos_devolucion_parcial_check check (
  devolucion_alcance is distinct from 'parcial' or revierte_pago_id is not null
);

-- Una devolución nunca SUMA dólares. El euro no se puede restringir igual sin
-- romper el histórico (dos de las seis tienen `monto` a 0 con dólares
-- negativos); el dólar sí, y es la base de la comisión, que es donde duele
-- equivocarse.
alter table public.pagos drop constraint if exists pagos_refund_usd_check;
alter table public.pagos add constraint pagos_refund_usd_check check (
  tipo <> 'refund' or coalesce(usd_recibido, 0) <= 0
);

create index if not exists idx_pagos_revierte on public.pagos(revierte_pago_id);
create index if not exists idx_auditoria_devolucion
  on public.auditoria (entidad_id) where entidad = 'devolucion';

-- 4) v_devoluciones -----------------------------------------------------------
-- Todo lo que la pestaña necesita, sin joins en el cliente. `n_efectos` es el
-- conteo de filas de auditoría: es lo que distingue una devolución registrada
-- desde el OS (con su cascada escrita) de una heredada de Airtable.
create or replace view public.v_devoluciones with (security_invoker=true) as
select
  p.id                  as devolucion_id,
  p.fecha,
  p.monto,
  p.usd_recibido,
  p.devolucion_alcance  as alcance,
  p.devolucion_motivo   as motivo,
  p.revierte_pago_id,
  p.persona_id,
  pe.nombre             as persona_nombre,
  pe.estado             as persona_estado,
  p.programa_id,
  g.tier,
  g.monto               as programa_valor,
  (select count(*) from public.auditoria a
    where a.entidad = 'devolucion' and a.entidad_id = p.id)          as n_efectos,
  (select a.autor_id from public.auditoria a
    where a.entidad = 'devolucion' and a.entidad_id = p.id
      and a.accion = 'devolucion_registrada' limit 1)                as autor_id
from public.pagos p
left join public.personas  pe on pe.id = p.persona_id
left join public.programas g  on g.id  = p.programa_id
where p.tipo = 'refund';

commit;
