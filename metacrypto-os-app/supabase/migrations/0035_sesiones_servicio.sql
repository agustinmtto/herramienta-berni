-- ============================================================
-- 0035 — Las sesiones dejan de ser un archivo muerto.
--
-- `sesiones` lleva 111 filas desde el backfill de Airtable (3-ago) y el sync de
-- GoHighLevel (0024), pero ninguna pantalla del OS deja verlas ni escribirlas:
-- la única escritura de toda la app es el upsert del cron. Esta migración pone
-- el esquema que necesita el módulo de servicio.
--
-- (1) La asistencia pasa de booleano a tres estados: "reprogramada" no es
--     "no asistió" y NO debe descontar del cupo del cliente.
-- (2) Lo que se le recomendó al cliente sale de dentro de las notas a una tabla
--     propia: una sesión puede cerrar con una estrategia o con varias.
-- (3) El cupo de consultorías admite un ajuste manual sobre lo que dice el tier.
--
-- Spec: docs/superpowers/specs/2026-08-12-sesiones-servicio-design.md
-- ============================================================
begin;

-- 1) Asistencia con tres estados ---------------------------------------------
alter table public.sesiones
  add column if not exists estado_asistencia text
    check (estado_asistencia in ('asistio','no_asistio','reprogramada'));

update public.sesiones
   set estado_asistencia = case when asistio then 'asistio' else 'no_asistio' end
 where asistio is not null and estado_asistencia is null;   -- 103 filas

-- Las 7 sesiones pasadas sin asistencia registrada se asumen HECHAS: nunca hubo
-- formulario donde marcarlas, así que su vacío significa "no había dónde", no
-- "no fue". De aquí en adelante el campo se rellena siempre, y el KPI naranja
-- "sin registrar" existe para que no se vuelvan a acumular.
-- La sesión futura se queda en null, que es lo correcto: aún no ha pasado.
update public.sesiones
   set estado_asistencia = 'asistio'
 where estado_asistencia is null and fecha < now();          -- 7 filas

-- `asistio` NO se retira aquí: v_timeline_cliente depende de la columna
-- (verificado en pg_depend el 12-ago-2026) y Postgres rechaza el DROP mientras
-- la vista la referencie. Se retira al final de la 0036, justo después de
-- rehacer la vista sobre `estado_asistencia`.

-- 2) Contexto de la sesión ----------------------------------------------------
-- `capital_total` es la FOTO del momento, no el capital vigente del cliente:
-- cambia sesión a sesión y ese historial es justo lo que interesa.
alter table public.sesiones
  add column if not exists duracion_min  int,
  add column if not exists capital_total numeric(14,2),
  add column if not exists exchange      text,
  add column if not exists proximo_paso  text;

-- 3) El prefijo "[Sesión N]" que el backfill de Airtable metió DENTRO de la
-- nota (scripts/sync_airtable_os_20260803.py:150). El número pasa a derivarse
-- por cliente en la 0036, así que dentro del texto sólo estorba — y además lo
-- contradice: Airtable numeraba por coach y 18 clientes tienen el número
-- repetido (Ruben Arroyo: Berni 1, Manuel 1, Berni 2).
--
-- El `nullif` evita dejar cadenas vacías donde la nota era SÓLO el prefijo:
-- hay filas cuyo texto completo es "[Sesión 1]" y sin esto quedarían como ''
-- en vez de null, que es lo que el resto del esquema usa para "sin nota".
update public.sesiones
   set notas = nullif(trim(regexp_replace(notas, '^\[Sesión \d+\]\s*', '')), '')
 where notas ~ '^\[Sesión \d+\]';

-- 4) Lo que se le recomendó al cliente ----------------------------------------
-- Tabla y no JSONB: lo que se va a preguntar es "qué operaciones quedaron
-- pendientes de entrar" y "cuánto capital va a shorts" — filtros y sumas sobre
-- columnas, no lecturas de documento.
create table if not exists public.sesion_operaciones (
  id             uuid primary key default gen_random_uuid(),
  sesion_id      uuid not null references public.sesiones(id) on delete cascade,
  orden          int not null default 1,
  direccion      text not null check (direccion in ('short','long','spot','etfs','esperar')),
  activo         text,
  capital        numeric(14,2),
  apalancamiento text,
  zona_entrada   text,
  objetivo       text,
  estado         text check (estado in ('ejecutada','ordenes_puestas','planificada')),
  created_at     timestamptz not null default now()
);
create index if not exists idx_sesion_ops_sesion on public.sesion_operaciones(sesion_id);

alter table public.sesion_operaciones enable row level security;
drop policy if exists "auth read sesion_operaciones" on public.sesion_operaciones;
create policy "auth read sesion_operaciones" on public.sesion_operaciones
  for select to authenticated using (true);

-- 5) Ajuste manual del cupo (decisión 3 del spec) -----------------------------
-- Null = manda tiers.n_consultorias. Con valor = manda el ajuste, y la UI avisa
-- de que alguien lo tocó a propósito ("3 · ajustado, su tier incluye 2").
-- Hace falta porque 5 de los 75 clientes con sesiones ya superaron su tier.
alter table public.personas
  add column if not exists consultorias_ajuste int;

commit;
