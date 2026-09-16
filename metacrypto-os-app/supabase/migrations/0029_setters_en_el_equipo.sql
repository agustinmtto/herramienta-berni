-- ============================================================
-- 0029 — Dani, Juan y Paula existen en el OS, y `fuentes_atribucion`
-- apunta a ellos.
--
-- POR QUÉ HACÍA FALTA
-- No se puede atribuir una venta a un setter que el sistema no conoce.
-- `team_members` solo tenía a Alex, Berni, Manuel y Milo, y su `rol` estaba
-- restringido a coach/closer/admin — no existía "setter".
--
-- TRES CAUTELAS, PORQUE `team_members` NO ES UNA TABLA CUALQUIERA
--
-- 1. ES LA TABLA DE LOGIN. `/api/login` busca por `username` + `activo`.
--    Estos tres entran con `username` y `password_hash` NULL, así que no
--    hay credencial con la que entrar. Darles acceso es un acto aparte y
--    deliberado (poner username y hash), no un efecto de esta migración.
--
-- 2. `acceso_total` TIENE DEFAULT `true` (viene de 0013). Un INSERT normal
--    los habría creado con acceso a TODO el OS el día que alguien les diera
--    usuario. Se fija explícitamente en false con `modulos` vacío.
--
-- 3. ALIMENTA EL SELECTOR DE COACH del inbox (`Thread.tsx` → `asignarCoach`).
--    Sin filtrar, Dani/Juan/Paula aparecerían como coaches asignables a un
--    cliente. El filtro va en el componente, en el mismo commit que esta
--    migración: excluye `rol='setter'` y deja intacto quién salía antes.
--
-- POR QUÉ ESTOS TRES Y NO MÁS
-- Salen de los pagos de comisión ya registrados en `gastos` (Dani en may,
-- jun y jul; Juan en jul) y del campo Source_ID (`ig_set_pc` = Paula).
-- Alex ya estaba como `closer` — y cobra comisión de closing Y de setting,
-- así que setea también, pero no se duplica: se queda con su fila y su rol.
-- ============================================================
begin;

alter table public.team_members drop constraint if exists team_members_rol_check;
alter table public.team_members
  add constraint team_members_rol_check
  check (rol in ('coach', 'closer', 'admin', 'setter'));

-- Sin credenciales y sin permisos: existen para poder atribuirles trabajo,
-- no para entrar al OS.
insert into public.team_members (nombre, rol, activo, acceso_total, modulos)
select v.nombre, 'setter', true, false, '{}'::text[]
from (values ('Dani'), ('Juan'), ('Paula')) as v(nombre)
where not exists (
  select 1 from public.team_members t where lower(t.nombre) = lower(v.nombre)
);

-- Enlaza el catálogo de fuentes con las personas reales. `setter_nombre`
-- sigue siendo la fuente de verdad legible; `setter_id` es la que servirá
-- para agregar comisiones sin depender de que el texto coincida.
update public.fuentes_atribucion f
set setter_id = t.id
from public.team_members t
where lower(t.nombre) = lower(f.setter_nombre)
  and f.setter_nombre is not null
  and f.setter_id is null;

commit;
