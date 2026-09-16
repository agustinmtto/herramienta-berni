-- ============================================================
-- MetaCrypto OS — Migración 0048: BONOS DEL EVENTO 26/08
--
-- Alex ofreció 4 bonos por cerrar en el directo del 26-ago-2026. Ninguno es
-- una prestación nueva: son el tier comprado tomando prestado lo que ya
-- incluye un tier superior (n_consultorias / meses_default / acceso_discord).
--
-- Dónde viven: en la VENTA (`programas.bonos`), no en el cliente. Si el
-- cliente renueva, la renovación es otra fila de `programas` y los bonos
-- dejan de contar solos — nadie tiene que acordarse de quitarlos.
--
-- ⚠️ GEMELO EN TYPESCRIPT: `apps/inbox/lib/bonos.ts` tiene las mismas claves y
-- la misma regla de "qué bono suma consultorías". Si cambia una lista, cambian
-- las dos. El test `lib/__tests__/bonos.test.ts` cubre el lado TS.
-- ============================================================

begin;

-- 1) La columna ---------------------------------------------------------------
-- `not null default '{}'` en vez de nullable: "sin bonos" y "no lo sé" son lo
-- mismo aquí, y así ninguna lectura tiene que defenderse de un null.
alter table public.programas
  add column if not exists bonos text[] not null default '{}';

comment on column public.programas.bonos is
  'Bonos aplicados a esta venta. Claves en apps/inbox/lib/bonos.ts (evento 26/08: consultoria_berni, consultoria_manuel, duracion_9m, discord_portafolio).';

-- 2) Cuántas consultorías añaden los bonos ------------------------------------
-- Función y no expresión suelta para que la vista se siga leyendo. Es el
-- gemelo SQL de `extraConsultorias()` en lib/bonos.ts.
create or replace function public.bonos_extra_consultorias(bonos text[])
returns int language sql immutable as $$
  select cardinality(array(
    select b
    from unnest(coalesce(bonos, '{}'::text[])) as b
    where b in ('consultoria_berni', 'consultoria_manuel')
  ));
$$;

-- 3) El cupo pasa a contar los bonos ------------------------------------------
-- Regla de convivencia con el ajuste manual (0035): el ajuste REEMPLAZA la base
-- del tier, los bonos SUMAN encima. Importa porque 5 clientes ya tienen
-- `consultorias_ajuste` escrito a mano y no se les puede pisar.
--
-- Si no hay programa activo, `n_consultorias` es null y todo el cálculo sigue
-- dando null: "no lo sé" y "cero" siguen siendo cosas distintas.
--
-- `create or replace view` solo admite añadir columnas AL FINAL — por eso
-- `bonos` y `extra_bonos` van después de `ultima` y no junto a `ajustado`.
create or replace view public.v_consultorias_cliente with (security_invoker=true) as
select
  p.id                                              as persona_id,
  p.nombre                                          as cliente,
  pa.tier,
  t.n_consultorias                                  as incluidas_tier,
  coalesce(p.consultorias_ajuste, t.n_consultorias)
    + public.bonos_extra_consultorias(prog.bonos)   as incluidas,
  (p.consultorias_ajuste is not null)               as ajustado,
  count(s.id) filter (where s.estado_asistencia = 'asistio')          as hechas,
  count(s.id) filter (where s.estado_asistencia is null
                        and s.fecha < now())                          as sin_registrar,
  case
    when coalesce(p.consultorias_ajuste, t.n_consultorias) is null then null
    else greatest(0, coalesce(p.consultorias_ajuste, t.n_consultorias)
                     + public.bonos_extra_consultorias(prog.bonos)
                     - count(s.id) filter (where s.estado_asistencia = 'asistio'))
  end                                                                 as pendientes,
  max(s.fecha) filter (where s.estado_asistencia = 'asistio')         as ultima,
  coalesce(prog.bonos, '{}')                        as bonos,
  public.bonos_extra_consultorias(prog.bonos)       as extra_bonos
from public.personas p
left join public.v_programa_activo pa on pa.persona_id = p.id
left join public.tiers t              on t.id = pa.tier
left join public.programas prog       on prog.id = pa.programa_id
left join public.sesiones s           on s.persona_id = p.id
group by p.id, p.nombre, pa.tier, t.n_consultorias, p.consultorias_ajuste, prog.bonos;

commit;
