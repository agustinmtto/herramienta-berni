-- ============================================================
-- MetaCrypto OS — Migración 0007: VISTAS CALCULADAS
-- Módulo 1.7. "Estado actual" siempre se CALCULA, nunca se guarda.
-- security_invoker=true → respeta el RLS de las tablas base.
-- ============================================================

-- Programa activo hoy (fin efectiva = inicio + meses + días de freeze) --------
create or replace view public.v_programa_activo with (security_invoker=true) as
with fin as (
  select p.*,
    ( p.fecha_inicio
      + make_interval(months => coalesce(p.meses_duracion,0))
      + coalesce((
          select sum(e.fecha_fin - e.fecha_inicio)
          from public.programa_eventos e
          where e.programa_id = p.id and e.tipo='freeze' and e.fecha_fin is not null
        ),0) * interval '1 day'
    )::date as fin_efectiva
  from public.programas p
)
select distinct on (persona_id)
  persona_id, id as programa_id, tier, motivo, fecha_inicio,
  case when meses_duracion is null then null else fin_efectiva end as fin_efectiva
from fin
where meses_duracion is null or fin_efectiva >= current_date
order by persona_id, fecha_inicio desc;

-- Cash collected (pasado) por mes y divisa ------------------------------------
create or replace view public.v_cash_collected with (security_invoker=true) as
select date_trunc('month', fecha)::date as mes, divisa,
       sum(monto) as cash_collected, count(*) as n_pagos
from public.pagos
group by 1,2 order by 1,2;

-- Cash to be collected (futuro): cuotas pendientes por divisa -----------------
create or replace view public.v_cash_to_be_collected with (security_invoker=true) as
select divisa, sum(monto) as cash_to_be_collected, count(*) as n_cuotas
from public.cuotas_programadas
where estado = 'pendiente'
group by 1;

-- Flujo de caja futuro: cuotas pendientes por mes de vencimiento --------------
create or replace view public.v_flujo_caja_futuro with (security_invoker=true) as
select date_trunc('month', fecha_vencimiento)::date as mes, divisa,
       sum(monto) as por_cobrar, count(*) as n_cuotas
from public.cuotas_programadas
where estado = 'pendiente' and fecha_vencimiento >= current_date
group by 1,2 order by 1,2;

-- P&L mensual (BASE CAJA) — nota: v1 suma montos sin conversión de divisa;
-- la conversión con fx_rate llega en su iteración. -------------------------
create or replace view public.v_pnl_mensual with (security_invoker=true) as
with ing as (
  select date_trunc('month', fecha)::date as mes, sum(monto) as ingresos
  from public.pagos group by 1
),
gas as (
  select date_trunc('month', fecha)::date as mes, sum(monto) as gastos
  from public.gastos group by 1
)
select coalesce(ing.mes, gas.mes) as mes,
       coalesce(ing.ingresos,0)   as ingresos,
       coalesce(gas.gastos,0)     as gastos,
       coalesce(ing.ingresos,0) - coalesce(gas.gastos,0) as profit
from ing full outer join gas on ing.mes = gas.mes
order by 1;
