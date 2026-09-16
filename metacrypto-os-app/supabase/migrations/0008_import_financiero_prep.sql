-- ============================================================
-- MetaCrypto OS — Migración 0008: PREP IMPORT FINANCIERO
-- Columnas de trazabilidad (airtable_id), usd_recibido, marcas de
-- revisión (upsell ambiguo) y de fecha inferida, + tiers legacy.
-- ============================================================

-- Trazabilidad a Airtable (para reimport idempotente y para enlazar pagos) ----
alter table public.personas           add column if not exists airtable_id text unique;

-- Pagos: USD realmente recibido (Mercury) + detalle de tipo + traza ----------
alter table public.pagos add column if not exists usd_recibido numeric(12,2);
alter table public.pagos add column if not exists tipo_detalle text;         -- 'Pago único','Cuota 1',...
alter table public.pagos add column if not exists airtable_id  text unique;

-- Programas: marca de revisión (upsell/AppSale ambiguo) + origen + traza ------
alter table public.programas add column if not exists necesita_revision boolean not null default false;
alter table public.programas add column if not exists origen text;           -- 'import_airtable'
alter table public.programas add column if not exists airtable_id text;

-- Cuotas: marcar las de fecha inferida (no confirmada por el cliente) ---------
alter table public.cuotas_programadas add column if not exists fecha_inferida boolean not null default false;

-- Tiers legacy (precios históricos vistos en Airtable) ------------------------
insert into public.tiers (id, nombre, meses_default, n_consultorias, acceso_discord, acceso_comunidad, sesiones_directo, numero_berni) values
  ('1000','€1.000 (legacy)', 3, 1, false, false, false, false),
  ('1500','€1.500 (legacy)', 4, 1, false, false, false, false),
  ('2000','€2.000 (legacy)', 4, 1, false, false, false, false),
  ('2500','€2.500 (legacy)', 6, 2, false, false, false, false)
on conflict (id) do nothing;
