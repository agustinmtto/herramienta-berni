-- ============================================================
-- 0027 — `personas.pais` pasa a usar los nombres canónicos de lib/paises.ts.
--
-- El campo es texto libre y el formulario ofrecía una lista de 9 países que no
-- cubría la realidad de la base, así que se acumularon grafías que se pisan:
-- "Otro" y "Otros" son el mismo valor escrito de dos formas, y "USA" no coincide
-- con el nombre que usa la lista nueva.
--
-- Se canonizan solo los tres que discrepan. El resto de valores ya coinciden.
-- Las filas con `pais` nulo se quedan nulas: no hay dato que canonizar y no se
-- inventa uno.
--
-- Sin cambio de esquema. Toca ~19 filas de clientes reales, así que va en una
-- transacción y no roza ninguna otra columna.
-- ============================================================
begin;

update personas set pais = 'Estados Unidos'          where pais = 'USA';
update personas set pais = 'Otro'                    where pais = 'Otros';
update personas set pais = 'Emiratos Árabes Unidos'  where pais = 'Emiratos Árabes';

commit;
