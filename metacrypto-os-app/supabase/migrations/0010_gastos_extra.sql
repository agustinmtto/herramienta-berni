-- ============================================================
-- MetaCrypto OS — Migración 0010: GASTOS (campos extra)
-- Alinea la tabla `gastos` con la tabla Gastos de Airtable de Berni:
-- tipo de gasto (único/recurrente), método de pago, y airtable_id
-- para importar de forma idempotente.
-- ============================================================

alter table public.gastos
  add column if not exists tipo_gasto  text,   -- 'Gasto único' | 'Gasto recurrente'
  add column if not exists metodo_pago text,   -- 'Cripto' | 'Transferencia' | 'Tarjeta'
  add column if not exists airtable_id text;

-- El CHECK original solo permitía ('software','ads','salarios','comisiones','otros').
-- Berni usa categorías reales (Software, Salario, Herramientas, Gastos LLC, Formación,
-- Otros, Ads, Comisiones) → quitamos el CHECK para no perder Formación/Herramientas.
alter table public.gastos drop constraint if exists gastos_categoria_check;

-- Idempotencia del import por airtable_id
create unique index if not exists uq_gastos_airtable_id
  on public.gastos(airtable_id) where airtable_id is not null;

create index if not exists idx_gastos_fecha     on public.gastos(fecha);
create index if not exists idx_gastos_categoria on public.gastos(categoria);
