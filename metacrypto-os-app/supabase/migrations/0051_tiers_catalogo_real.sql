-- ============================================================
-- MetaCrypto OS — Migración 0051: el catálogo de programas, como es de verdad
--
-- Berni, 26-ago-2026 por WhatsApp:
--   "No hay programa de 1800€: 2000, 3500 y 5000.
--    El de 2000 que son 6 meses ... Los otros dos que son de 1 año"
--
-- La tabla `tiers` llevaba desde julio contando otra cosa, y no era un detalle
-- cosmético: `meses_default` es la duración que el formulario propone y la base
-- sobre la que se calcula el bono de +50 %. Estaba así:
--
--   id     nombre               meses_default   realidad
--   1800   €1.800 / 6 meses     6               precio retirado a finales de julio
--   2000   €2.000 (legacy)      4               es el de 6 meses que se vende hoy
--   3500   €3.500 / 8 meses     8               es de 1 año
--
-- Comprobado contra las ventas reales antes de tocar nada:
--   · tier 2000 → 10 ventas de 6 meses, 0 de 4. Nunca se vendió a 4 meses; el
--     operador corregía el 4 a mano en cada alta desde el 27 de julio.
--   · tier 3500 → las 3 últimas ventas (14-ago en adelante) ya son de 12 meses.
--   · tier 1800 → ni una venta desde el 30 de julio, y todas las que hay
--     vinieron importadas de Airtable.
--
-- Qué NO hace esta migración: tocar ninguna venta ya registrada.
-- `programas.meses_duracion` es una copia congelada en el momento del cierre,
-- así que los contratos vivos siguen exactamente como se firmaron. Esto solo
-- cambia lo que el OS PROPONE de aquí en adelante.
-- ============================================================

begin;

-- 1) El de 6 meses: el precio subió de 1.800 a 2.000 y la fila nueva heredó
--    el `meses_default` de un tier legacy homónimo de 2024 que sí era de 4.
update public.tiers
   set nombre = '€2.000 / 6 meses',
       meses_default = 6
 where id = '2000';

-- 2) El de 3.500: nació copiando al 3.000 que sustituyó (8 meses) cuando el
--    programa ya se vendía a un año.
update public.tiers
   set nombre = '€3.500 / 12 meses',
       meses_default = 12
 where id = '3500';

-- 3) El 1.800 sale del desplegable. Mismo trato que se le dio al 3.000 cuando
--    lo sustituyó el 3.500 (`activo = false`): las 15 ventas históricas siguen
--    apuntando aquí y sus fichas se leen igual — `activo` solo filtra lo que se
--    puede vender hoy. Se deja la fila, no se borra.
update public.tiers
   set nombre = '€1.800 / 6 meses (retirado jul-2026)',
       activo = false
 where id = '1800';

-- 4) Red de seguridad: si alguna de las tres filas no existiera, mejor que la
--    migración reviente aquí que descubrirlo por un bono mal calculado.
do $$
declare v_mal text;
begin
  select string_agg(id || '=' || coalesce(meses_default::text,'null'), ', ')
    into v_mal
  from public.tiers
  where (id = '2000' and (meses_default is distinct from 6 or activo is not true))
     or (id = '3500' and (meses_default is distinct from 12 or activo is not true))
     or (id = '1800' and activo is not false);
  if v_mal is not null then
    raise exception 'catálogo de tiers no quedó como se esperaba: %', v_mal;
  end if;
  if not exists (select 1 from public.tiers where id = '5000' and meses_default = 12) then
    raise exception 'el tier 5000 debería ser de 12 meses';
  end if;
end $$;

commit;
