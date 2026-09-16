-- ============================================================
-- 0064 — La columna de sesiones 1 a 1 con Berni.
--
-- Aditiva e inofensiva: nace en 0 y no cambia ningún comportamiento del OS
-- hoy — nadie la lee todavía (la plantilla v2 del contrato la leerá cuando
-- exista). Por eso va SOLA, separada del congelado y del cambio de catálogo
-- (0066_catalogo_2026.sql):
--
--   · esta se aplica esta noche, para no bloquear el trabajo de contratos.
--   · 0066 cambia lo que ven 59 clientes y la aplica Milo por la mañana,
--     después de revisarla.
--
-- Ir juntas habría obligado a elegir entre bloquear una cosa o aplicar la
-- otra sin su visto bueno. `numero_berni` (columna ya existente) es un
-- booleano de acceso al teléfono de Berni — otra cosa, no confundir.
-- ============================================================
begin;

alter table public.tiers
  add column if not exists n_sesiones_berni int not null default 0;
comment on column public.tiers.n_sesiones_berni is
  'Sesiones individuales 1 a 1 con Berni incluidas en el programa. La plantilla v2 del contrato lo imprime; el OS no lo aplica.';

commit;
