-- ============================================================
-- 0031 — Berni confirmó el mapeo de las 20 fuentes (11-ago-2026).
--
-- Respondió la hoja `outputs/atribucion-fuentes-para-berni.md`:
--   · Los 6 source_id con setter: los seis CORRECTOS. Se confirma que
--     db = Dani, js = Juan, pc = Paula.
--   · `as` y `AS_agenda`: sí, las dos son AutoSetter.
--   · Los 14 restantes: correctos, y ninguno lleva setter.
--
-- Con esto se levanta la salvaguarda: `confirmado=true` habilita calcular
-- comisiones sobre estas filas. Las reglas de cálculo que dio en la misma
-- respuesta están en `docs/comisiones.md`.
--
-- Un valor NUEVO que aparezca en GHL entra con `confirmado=false` por
-- defecto (definido en 0028) y vuelve a necesitar validación. Es a
-- propósito: el campo es texto libre y un typo crea una fuente nueva en
-- silencio.
-- ============================================================
begin;

update public.fuentes_atribucion
set confirmado = true,
    notas = coalesce(notas || ' · ', '') || 'Confirmado por Berni el 11-ago-2026.'
where confirmado = false;

commit;
