-- ============================================================
-- 0030 — una clienta: la ascensión del 1-ago estaba metida
-- DOS VECES, en tres tablas a la vez.
--
-- QUÉ PASÓ
-- La misma ascensión entró por los dos caminos de la transición: el import
-- de Airtable (3-ago) y el formulario del OS (5-ago). Nada las cruzaba,
-- así que convivieron.
--
--   tabla      SE QUEDA (form_os)                BORRAR (import_airtable)
--   programa   7ff2c899 · 5000 · 2.000 € · 1-ago  5794ec43 · 5000 · 5.000 € · 2-ago
--   pago       dbe254c0 · 1.000 € · Stripe        13d1af26 · 1.000 € · sin método
--   cuota      aac417d6 · 1.000 € · vence 1-sep   e2147857 · 1.000 € · vence 2-sep
--
-- POR QUÉ SE QUEDA EL DEL FORMULARIO
-- Guarda el **precio acordado** (2.000 €), no el de lista (5.000 €). Es el
-- caso que Berni explicó el 7-ago: se asciende al programa de 5.000 pero se
-- cobran 2.000 porque lo ya pagado se abona. Además trae el método real
-- (Stripe) y la fecha exacta que puso Alex — la del import venía inferida.
--
-- QUÉ ESTABA ROMPIENDO
-- · Cash collected inflado en 1.000 €: sumaba 4.500 € cuando son 3.500 €.
-- · Deuda duplicada: 2.000 € pendientes cuando debe 1.000 €.
-- · `v_programa_activo` devolvía el duplicado (fecha_inicio posterior).
--   Al borrarlo pasa a ser el del OS, mismo tier 5000: su tier no cambia.
--
-- LA CUOTA DE 500 € TAMBIÉN SE VA
-- `e17b0189` (500 €, vence 1-sep, fecha inferida) colgaba del programa
-- viejo de 3.000 €, superado al ascender. Confirmado con Milo el 11-ago:
-- *"le falta otra cuota de 1.000, nada más"*. Con ella puesta, esa clienta
-- aparecería debiendo 1.500 €.
--
-- SIN RASTRO AUTOMÁTICO
-- Estas filas no están en `auditoria` (son anteriores a ella), así que este
-- comentario ES el registro de por qué desaparecieron.
--
-- COMPROBADO ANTES DE BORRAR: el programa 5794ec43 no tiene sesiones,
-- ni eventos, ni contratos, ni programas que lo declaren como previo.
-- Su única cuota es la que se borra aquí.
-- ============================================================
begin;

-- Cuotas primero: apuntan al programa por clave foránea.
delete from public.cuotas_programadas
where id in (
  'e2147857-b52e-40c0-b8d7-0e42be1922dc',  -- duplicada del import (2-sep)
  'e17b0189-634a-4b63-97b0-db6c468f181d'   -- residuo de 500 € del programa de 3.000
);

delete from public.pagos
where id = '13d1af26-1239-4414-8b14-850ac194f214';  -- airtable_id recha8zWjbTPCbhvv

delete from public.programas
where id = '5794ec43-82b4-47d8-b415-9c8593cf6d99';

commit;
