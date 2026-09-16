-- ============================================================
-- MetaCrypto OS — Migración 0018: tier 3500 (sustituye al 3000)
--
-- Berni (6-ago-2026): "Subimos justo el de 3000 a 3500". Mismo bundle,
-- solo cambia el precio. Programas activos según Berni: 2000/3500/5000/8000.
--
-- OJO — lo que esta migración NO hace, a propósito:
--   · No toca ni un solo registro de `programas`. Los 33 clientes que
--     compraron a 3.000€ siguen en el tier '3000' y su histórico financiero
--     queda intacto. Si Berni decide moverlos al 3500 es una decisión aparte
--     (y una migración aparte), porque reescribir `programas.tier` cambiaría
--     el valor de ventas ya cerradas.
--   · No desactiva 1500/1800, que siguen vendiéndose (30 programas desde
--     junio-26) pese a no estar en la lista de Berni. Pendiente de confirmar.
-- ============================================================

-- 1) Alta del 3500 — bundle idéntico al 3000 (8 meses, 2 consultorías,
--    sesiones en directo; sin Discord/comunidad/número de Berni).
insert into public.tiers
  (id, nombre, meses_default, n_consultorias, acceso_discord, acceso_comunidad, sesiones_directo, numero_berni, activo)
values
  ('3500', '€3.500 / 8 meses', 8, 2, false, false, true, false, true)
on conflict (id) do nothing;

-- 2) El 3000 deja de venderse: desaparece del desplegable de /nueva-venta
--    (getTiersVendibles filtra por activo), pero la fila se conserva porque
--    33 programas la referencian por clave foránea. Revertir = poner true.
update public.tiers set activo = false where id = '3000';
