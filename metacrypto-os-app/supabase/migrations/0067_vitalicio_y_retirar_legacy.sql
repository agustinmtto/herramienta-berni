-- 0067 — El acceso al contenido deja de ser vitalicio en todos los tiers,
-- y los tres programas legacy dejan de poder venderse.
--
-- Decidido por Milo el 16-sep-2026, tras la revisión del texto del contrato:
--
--   1. El tier de 2.000 € NO da acceso vitalicio al contenido grabado: da
--      acceso durante los meses que dura el programa. Hasta hoy la cláusula 1
--      prometía "Acceso vitalicio" a TODOS los tiers por igual, porque estaba
--      escrita a mano en la plantilla y no salía del catálogo. Ahora sale del
--      catálogo, como el Discord y las consultorías.
--
--   2. Solo se venden los cuatro tiers que están en el contrato revisado:
--      2.000, 3.500, 5.000 y 10.000. Los tres "legacy" (1.000, 1.500 y 2.500)
--      dejan de aparecer en el desplegable de nueva venta.
--
-- 🔴 EXIGE LA 0066 APLICADA. El tier 10.000 nace allí, y sin él el catálogo
-- vendible se quedaría en tres. Se comprueba abajo y se aborta por su nombre,
-- igual que la 0066 comprueba la 0064.
--
-- NO toca a ningún cliente: `activo` solo decide si un tier se puede VENDER
-- (`getTiersVendibles`, lib/data.ts). Los programas ya vendidos conservan su
-- tier, su cupo y su contrato — misma mecánica con la que se retiraron el
-- 1.800 y el 3.000 en julio, y el 8.000 en la 0066.

begin;

-- ── 1) Comprobar que la 0066 ya entró ────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.tiers where id = '10000') then
    raise exception
      'falta la migración 0066_catalogo_2026.sql: el tier 10000 no existe todavía';
  end if;
end $$;

-- ── 2) La columna nueva ──────────────────────────────────────────────────
-- `default true` porque hasta hoy la plantilla prometía vitalicio a todos:
-- el valor por defecto reproduce exactamente lo que decían los contratos ya
-- emitidos. Solo el 2.000 se aparta de ahí, y se aparta abajo.
alter table public.tiers
  add column if not exists acceso_vitalicio boolean not null default true;

comment on column public.tiers.acceso_vitalicio is
  'Si el acceso al contenido grabado es vitalicio. En false, la cláusula 1 del '
  'contrato promete el acceso durante los meses que dura el programa. '
  'Decidido el 16-sep-2026: el tier de 2.000 € no es vitalicio.';

update public.tiers set acceso_vitalicio = false where id = '2000';

-- ── 3) Retirar los legacy ────────────────────────────────────────────────
-- OG no entra: `getTiersVendibles` ya lo excluye por id (lib/data.ts:518),
-- así que nunca se pudo vender desde el OS y tocarlo aquí no cambiaría nada.
update public.tiers set activo = false where id in ('1000', '1500', '2500');

-- ── 4) Red de seguridad ──────────────────────────────────────────────────
-- Mismo criterio que la 0066: si el catálogo no queda EXACTAMENTE como se
-- espera, la transacción entera se deshace. El conteo de vendibles es el
-- testigo que importa: son los que Alex verá en el desplegable, y son los
-- cuatro que están en el contrato que revisó Paula.
do $$
declare
  v_mal      text;
  v_vendible int;
  v_lista    text;
begin
  select string_agg(id || '=' || acceso_vitalicio::text, ', ' order by id) into v_mal
  from public.tiers
  where (id = '2000'  and acceso_vitalicio is not false)
     or (id in ('3500','5000','10000') and acceso_vitalicio is not true);
  if v_mal is not null then
    raise exception 'acceso_vitalicio no quedó como se esperaba: %', v_mal;
  end if;

  -- Los vendibles, con el mismo filtro que usa el OS.
  select count(*), string_agg(id, ', ' order by id)
    into v_vendible, v_lista
  from public.tiers
  where activo is true and id <> 'OG';

  if v_vendible <> 4 then
    raise exception
      'se esperaban 4 tiers vendibles (2000, 3500, 5000, 10000) y hay %: %',
      v_vendible, v_lista;
  end if;
  if v_lista is distinct from '10000, 2000, 3500, 5000' then
    raise exception 'los tiers vendibles no son los esperados: %', v_lista;
  end if;
end $$;

commit;
