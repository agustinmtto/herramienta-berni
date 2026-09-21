-- ============================================================
-- 0066 — Catálogo 2026: congelar a los que ya están y cambiar el catálogo,
-- en la MISMA transacción.
--
-- Lo que Paula y Milo cerraron el 14-sep: 2.000 € pasa de 1 a 2 consultorías,
-- 3.500 € de 2 a 6, 5.000 € de 4 a 6; el 8.000 € se retira; nace el 10.000 €.
-- Y la regla que manda sobre todo lo demás: «todo lo anterior queda como
-- estaba antes» — son condiciones para los cierres nuevos.
--
-- Va separada de `0064_n_sesiones_berni.sql` (la columna aditiva, aplicada
-- antes): esta migración sí cambia lo que ven 59 clientes, así que la aplica
-- Milo cuando la haya revisado, no antes. La constraint de "una sola
-- transacción" es sobre ESTA migración (congelado + catálogo); 0064 va suelta
-- a propósito. Por eso el paso 2 comprueba esa dependencia antes de tocar
-- nada: sin ella, `n_sesiones_berni` no existe y esto reventaría a medio
-- catálogo con un error de Postgres que no dice qué falta.
--
-- El problema: `v_consultorias_cliente` calcula el cupo EN VIVO desde
-- `tiers.n_consultorias` (0048:56). Cambiar el número regala consultorías a
-- todos los que cuelgan de ese tier: medido el 16-sep (Task 1, foto en
-- outputs/catalogo/cupos-antes-20260916-004435.json), +134 repartidas entre
-- 59 clientes con programa vigente (22 + 19 + 18). Confirmado por el revisor
-- en solo lectura, sin filtrar por programa vigente: 0 personas en TODA la
-- tabla tienen hoy `consultorias_ajuste` distinto de NULL — los "5 ajustes
-- manuales" que mencionan los comentarios de `0048_bonos_evento.sql:43` y
-- `0035_sesiones_servicio.sql:90-91` están obsoletos, ya no describen la base.
--
-- La solución ya estaba en la vista y nadie la usaba: `coalesce(
-- p.consultorias_ajuste, t.n_consultorias)`. Esta migración le da su primer
-- significado: "cupo heredado, congelado hasta el siguiente programa".
--
-- 🔴 Se congela el VALOR DEL TIER (1, 2 o 4), no `incluidas`. La vista suma
-- los bonos encima: 18 de los 59 tienen bonos de consultorías, y congelar con
-- el total les duplicaría los bonos. un cliente (tier 2000): base 1 + bonos 2
-- = ve 3. Se escribe 1, y sigue viendo 3.
--
-- 🔴 El congelado caduca solo. `consultorias_ajuste` cuelga de la PERSONA y
-- sobrevive al cambio de programa; sin esto, un congelado que mañana haga un
-- upsell se quedaría con el cupo viejo para siempre, en silencio — y 11 de
-- los 59 ya han cambiado de programa alguna vez. El disparador borra el
-- ajuste al insertar un programa nuevo a esa persona: compra algo nuevo →
-- condiciones nuevas. Aplica también a `extension`: en el formulario es un
-- tipo aparte, pero en `programas.motivo` es `'renovacion'` igual que una
-- renovación normal (0014_ventas_form.sql) — un cierre nuevo es un cierre
-- nuevo (decisión de Milo: «estos serían como nuevos programas»), y el
-- disparador no distingue motivos: cualquier INSERT en `programas` descongela.
-- Pero el disparador solo cubre la mitad del calendario: un programa que
-- simplemente CADUCA no inserta nada y no descongela nada. Esa otra mitad la
-- tapa la vista del paso 4 (`case when pa.persona_id is null then null`) —
-- ver allí, es la parte de esta migración que no se nota el día que se aplica.
--
-- 🔴 El congelado se marca, no solo se escribe. `consultorias_ajuste_motivo`
-- guarda por qué tiene valor esa fila, y la vista lo expone como
-- `ajuste_motivo` (paso 4): sin esto, el chip "ajustado" que ya pinta la
-- pantalla (`SesionesPanel.tsx:263-270`, `servicio.ts:100`) —cuyo significado
-- documentado es "alguien tocó el número a mano"— mentiría en 59 fichas, e
-- invitaría a "arreglarlo" borrando el ajuste: exactamente cómo se regalarían
-- las 134 consultorías que esta migración existe para evitar. La columna hace
-- el arreglo de la interfaz POSIBLE; no lo hace por sí sola — eso es trabajo
-- de front-end fuera de esta migración, que ya puede apoyarse en
-- `ajuste_motivo` para distinguir "congelado por el catálogo" de un ajuste
-- manual real.
--
-- 🔴 Motivo huérfano: un CHECK, no el disparador. Si alguien pone
-- `consultorias_ajuste` a NULL a mano (editor de Supabase, una consulta
-- suelta) sin tocar `consultorias_ajuste_motivo`, la marca sobreviviría para
-- siempre — y el disparador no lo vería nunca, porque solo se dispara al
-- INSERTAR un programa, no al editar `personas` directamente. Por eso el
-- candado va en la tabla (paso 3), no en el disparador: un CHECK se cumple
-- pase lo que pase escriba la fila, venga de donde venga; una condición extra
-- en el `where` del disparador solo protegería la única vía que YA estaba
-- sana (la propia limpieza del disparador, que ya toca las dos columnas
-- juntas).
--
-- 🔴 De las cinco columnas de `tiers` que trae el catálogo, solo
-- `n_consultorias` la lee alguien (la vista). `acceso_discord`,
-- `sesiones_directo`, `numero_berni` y `n_sesiones_berni` no cambian ningún
-- comportamiento del OS hoy: son el catálogo, y la plantilla v2 del contrato
-- las leerá. Por eso no hace falta congelar nada más que las consultorías.
--
-- 🔴 La migración se verifica SOLA, con tres testigos distintos: aborta si el
-- congelado toca un número de personas distinto de 59 (paso 5), si la SUMA de
-- lo escrito no es 132 —el testigo de que se escribieron los valores VIEJOS
-- del tier y no los nuevos, que un conteo de filas no distinguiría—, si esa
-- suma no se reparte 22/38/72 entre los tres tiers —lo que un total de 132 a
-- secas tampoco distingue— o si el catálogo no queda exactamente como se
-- espera (paso 8). Mejor que reviente aquí a que se aplique a medias.
--
-- 🔴 `set local lock_timeout`: el `alter table personas` (paso 3) toma ACCESS
-- EXCLUSIVE sobre `personas` hasta el `commit`. Con 210 filas es sub-segundo,
-- pero si alguna consulta larga tiene la tabla cogida en ese instante, el
-- `alter` haría cola y CUALQUIER lectura nueva de `personas` —el OS entero—
-- haría cola detrás de él. Con el timeout, esta migración aborta limpio en
-- vez de dejar la app parada esperando un lock.
--
-- Deshacer: `update personas set consultorias_ajuste = null,
-- consultorias_ajuste_motivo = null where consultorias_ajuste_motivo =
-- 'catalogo_2026';` (OJO: por `consultorias_ajuste_motivo`, NO por
-- `consultorias_ajuste is not null` — esa condición se llevaría por delante
-- cualquier ajuste manual legítimo hecho entre medias, que no lleva esta
-- marca) + devolver los tres números (1, 2, 4) + `activo = true` en 8000 y
-- `nombre = '€8.000 (premium)'` (su nombre original, de `0001_nucleo.sql:55`;
-- escrito aquí literal a propósito: el día que haya que revertir, nadie va a
-- ir a buscarlo a una migración de julio) + borrar 10000 + `drop trigger
-- trg_descongelar_cupo on programas` + `drop function
-- descongelar_cupo_al_nuevo_programa()` + `alter table personas drop
-- constraint personas_consultorias_ajuste_motivo_check` + rehacer
-- `v_consultorias_cliente` sin `ajuste_motivo` si hace falta (la versión
-- anterior, literal, está en `0048_bonos_evento.sql:50-76` — OJO: esa no lleva
-- los `case when pa.persona_id is null` del paso 4, y solo se puede volver a
-- ella DESPUÉS de haber borrado los ajustes, nunca antes, o se reabre la fuga
-- del programa caducado). Reversible.
-- ============================================================
begin;

-- 1) Lock corto o nada. Ver la nota de la cabecera: sin esto, un `alter`
--    bloqueado por una consulta larga encolaría detrás suyo a todo el que
--    lea `personas` — el OS entero.
set local lock_timeout = '5s';

-- 2) La dependencia declarada. Sin `0064_n_sesiones_berni.sql` ya aplicada,
--    el `update ... set n_sesiones_berni = 2` del paso 6 revienta con
--    `column "n_sesiones_berni" does not exist` — cierto, pero no dice CUÁL
--    migración falta. Esto sí lo dice, y aborta antes de tocar una sola fila.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tiers'
       and column_name = 'n_sesiones_berni'
  ) then
    raise exception 'falta aplicar 0064_n_sesiones_berni.sql antes que esta';
  end if;
end $$;

-- 3) La marca del congelado: por qué esa persona tiene un ajuste escrito, no
--    solo que lo tiene. Hoy solo existe un motivo; si el día de mañana hace
--    falta congelar por otra razón, esa migración añadirá su propio valor —
--    no hace falta una CHECK cerrada a una lista de valores para uno solo.
--
--    El CHECK de abajo sí es cerrado: impide el estado huérfano
--    (`consultorias_ajuste` NULL con `consultorias_ajuste_motivo` escrito)
--    pase lo que pase escriba la fila — ver la nota de la cabecera sobre por
--    qué va aquí y no en el disparador.
alter table public.personas
  add column if not exists consultorias_ajuste_motivo text;
comment on column public.personas.consultorias_ajuste_motivo is
  'Por qué consultorias_ajuste tiene un valor. NULL = nadie lo tocó. El disparador trg_descongelar_cupo la borra junto con consultorias_ajuste al insertar un programa nuevo; el CHECK de la tabla impide que quede huérfana si alguien edita consultorias_ajuste a mano.';

alter table public.personas
  drop constraint if exists personas_consultorias_ajuste_motivo_check;
alter table public.personas
  add constraint personas_consultorias_ajuste_motivo_check
  check (consultorias_ajuste is not null or consultorias_ajuste_motivo is null);

-- 4) Exponer la marca en la vista, y taparle la fuga que abre el congelado.
--
--    Lo de la marca: mismo patrón que la 0048 — `create or replace view` solo
--    admite añadir columnas AL FINAL, así que `ajuste_motivo` va después de
--    `extra_bonos` y no junto a `ajustado`; aunque estén relacionadas, moverla
--    habría reordenado la vista para cualquier código que la lea por posición.
--    Ni una columna existente ni su orden cambian; `security_invoker=true` se
--    mantiene igual que en 0048. Sin esto la interfaz no puede distinguir
--    nada: la columna de la persona existiría pero la vista que lee la
--    pantalla no la vería.
--
-- 🔴 Y lo importante: los dos `case when pa.persona_id is null then null`.
--    `0036_vistas_sesiones.sql:98-99` lo dejó escrito como invariante del OS:
--    «sin programa activo no hay tier, así que `incluidas` y `pendientes`
--    quedan en null: "no lo sé" y "cero" son cosas distintas». Hoy eso sale
--    solo, de rebote: sin programa, `t.n_consultorias` es NULL, el `coalesce`
--    no tiene con qué quedarse y todo el cálculo se propaga a NULL. El
--    congelado rompe ese rebote — `consultorias_ajuste` cuelga de la PERSONA
--    y sobrevive a que el programa caduque, así que en cuanto a uno de los 59
--    le venza el programa el `coalesce` SÍ tiene con qué quedarse y la ficha
--    vuelve a decir "quedan 3" de un programa terminado, barra de progreso
--    incluida. El disparador del paso 6 no salva esto: solo reacciona a un
--    INSERT en `programas`, y un programa que simplemente caduca no inserta
--    nada. Es el espejo exacto de la fuga que esta migración existe para
--    evitar, por el otro extremo del calendario, y con el tiempo alcanza a
--    los 59 (tier 2000 son 6 meses; 3500 y 5000, 12).
--
--    Se pregunta por `pa.persona_id` y no por `pa.tier` porque es la clave
--    del `left join`: es NULL si y solo si no hubo fila de programa vigente,
--    mientras que `tier` podría en teoría ser NULL por otra razón. El día de
--    la aplicación esto no cambia ni una fila (las 11 personas sin programa
--    tienen `consultorias_ajuste` NULL, así que su resultado ya era NULL por
--    el camino viejo) — por eso hay que escribirlo ahora y no cuando se note.
--
--    `pa.persona_id` entra en el `group by`; no cambia la cardinalidad,
--    `p.id` ya es la clave del grupo y `pa` está unida 1-a-1 por ella.
create or replace view public.v_consultorias_cliente with (security_invoker=true) as
select
  p.id                                              as persona_id,
  p.nombre                                          as cliente,
  pa.tier,
  t.n_consultorias                                  as incluidas_tier,
  case when pa.persona_id is null then null
       else coalesce(p.consultorias_ajuste, t.n_consultorias)
              + public.bonos_extra_consultorias(prog.bonos)
  end                                                as incluidas,
  (p.consultorias_ajuste is not null)                as ajustado,
  count(s.id) filter (where s.estado_asistencia = 'asistio')          as hechas,
  count(s.id) filter (where s.estado_asistencia is null
                        and s.fecha < now())                          as sin_registrar,
  case
    when pa.persona_id is null
      or coalesce(p.consultorias_ajuste, t.n_consultorias) is null then null
    else greatest(0, coalesce(p.consultorias_ajuste, t.n_consultorias)
                     + public.bonos_extra_consultorias(prog.bonos)
                     - count(s.id) filter (where s.estado_asistencia = 'asistio'))
  end                                                                 as pendientes,
  max(s.fecha) filter (where s.estado_asistencia = 'asistio')         as ultima,
  coalesce(prog.bonos, '{}')                        as bonos,
  public.bonos_extra_consultorias(prog.bonos)       as extra_bonos,
  p.consultorias_ajuste_motivo                      as ajuste_motivo
from public.personas p
left join public.v_programa_activo pa on pa.persona_id = p.id
left join public.tiers t              on t.id = pa.tier
left join public.programas prog       on prog.id = pa.programa_id
left join public.sesiones s           on s.persona_id = p.id
group by p.id, p.nombre, pa.persona_id, pa.tier, t.n_consultorias,
         p.consultorias_ajuste, p.consultorias_ajuste_motivo, prog.bonos;

-- 5) Congelar ANTES de tocar tiers. Solo los que cambian de número, y solo
--    los que no tienen ajuste (confirmado en solo lectura: 0 en toda la
--    tabla). El `with ... returning` deja verificar DOS cosas del mismo
--    UPDATE: cuántas filas tocó y CON QUÉ VALORES, sin una segunda consulta
--    que pudiera leer algo distinto si algo más escribiera `personas` entre
--    medias.
do $$
declare
  v_congelados int;
  v_suma       bigint;
  v_s2000      bigint;
  v_s3500      bigint;
  v_s5000      bigint;
begin
  with congelado as (
    update public.personas p
       set consultorias_ajuste        = t.n_consultorias,
           consultorias_ajuste_motivo  = 'catalogo_2026'
      from public.v_programa_activo pa
      join public.tiers t on t.id = pa.tier
     where pa.persona_id = p.id
       and pa.tier in ('2000', '3500', '5000')
       and p.consultorias_ajuste is null
    returning pa.tier as tier, p.consultorias_ajuste as valor
  )
  select count(*), coalesce(sum(valor), 0),
         coalesce(sum(valor) filter (where tier = '2000'), 0),
         coalesce(sum(valor) filter (where tier = '3500'), 0),
         coalesce(sum(valor) filter (where tier = '5000'), 0)
    into v_congelados, v_suma, v_s2000, v_s3500, v_s5000
  from congelado;

  -- Testigo 1: cuántas filas. El número esperado (59 = 22+19+18) sale de la
  -- foto de Task 1, hecha minutos antes de escribir esto.
  --
  -- La excepción es la base VACÍA: un `supabase db reset` desde cero (docs/08
  -- §1.3) no tiene ninguna persona, no hay nada que congelar y los tres
  -- testigos no miden nada — ahí se saltan. En producción hay población y el
  -- testigo corre igual que siempre: 59 o excepción.
  if v_congelados = 0
     and not exists (select 1 from public.personas limit 1) then
    return;
  end if;

  if v_congelados <> 59 then
    raise exception
      'congelado: se esperaban 59 personas (22 tier 2000 + 19 tier 3500 + 18 tier 5000, foto de Task 1 del 16-sep) y el UPDATE tocó % — si tocó 0, comprueba primero si esta migración ya se aplicó antes de reintentar; si tocó otro número, el alcance cambió desde la foto y hay que decidir con datos frescos, no forzar el que traíamos',
      v_congelados;
  end if;

  -- Testigo 2: con QUÉ valores. 59 filas tocadas da igual si el UPDATE
  -- hubiera escrito por error los números NUEVOS del catálogo (el `row_count`
  -- de arriba no lo distingue) — ahí es donde se regalarían las
  -- consultorías que esta migración existe para evitar. La suma solo puede
  -- dar 132 si son los viejos (22×1 + 19×2 + 18×4); con los nuevos daría 266,
  -- la diferencia de 134 es el mismo "+134" de la cabecera de este fichero.
  if v_suma <> 132 then
    raise exception
      'congelado con valores que no cuadran: suma de lo escrito %, esperada 132 (22×1 + 19×2 + 18×4) — probablemente se escribieron los números NUEVOS del catálogo en vez de los viejos',
      v_suma;
  end if;

  -- Testigo 2b: la misma suma, DESGLOSADA. 132 es una sola cifra, y con 59
  -- personas hay más de un reparto que también la da: 24 en el 2000 + 16 en
  -- el 3500 + 19 en el 5000 son 59 personas y suman 24 + 32 + 76 = 132
  -- exactos. Un join que se llevara gente al tier de al lado pasaría los dos
  -- testigos de arriba; comprobar 22, 38 y 72 por separado no deja ninguno.
  -- Sale gratis: son los mismos tres números, ya contados en el mismo `select`.
  if v_s2000 <> 22 or v_s3500 <> 38 or v_s5000 <> 72 then
    raise exception
      'congelado mal repartido por tier: suma escrita en 2000=% (esperada 22 = 22×1), 3500=% (esperada 38 = 19×2), 5000=% (esperada 72 = 18×4) — el total daba 132 pero el reparto no es el que se midió',
      v_s2000, v_s3500, v_s5000;
  end if;
end $$;

-- 6) El disparador que hace que el congelado caduque, marca incluida.
create or replace function public.descongelar_cupo_al_nuevo_programa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.personas
     set consultorias_ajuste = null,
         consultorias_ajuste_motivo = null
   where id = new.persona_id
     and consultorias_ajuste is not null;
  return new;
end;
$$;

drop trigger if exists trg_descongelar_cupo on public.programas;
create trigger trg_descongelar_cupo
  after insert on public.programas
  for each row
  execute function public.descongelar_cupo_al_nuevo_programa();

-- Este `revoke` documenta intención, no seguridad: una función `returns
-- trigger` no se puede invocar como función normal desde SQL bajo ningún
-- permiso (solo la dispara el propio motor de triggers), y la lista de abajo
-- ni siquiera incluye a `service_role`, que en Supabase recibe EXECUTE por
-- defecto sobre todo lo nuevo. El disparador dispara igual con o sin esto.
revoke all on function public.descongelar_cupo_al_nuevo_programa() from public, anon, authenticated;

-- 7) El catálogo. Solo ahora, con los 59 ya congelados.
update public.tiers set n_consultorias = 2, sesiones_directo = true
 where id = '2000';
update public.tiers set n_consultorias = 6, acceso_discord = true
 where id = '3500';
update public.tiers set n_consultorias = 6, n_sesiones_berni = 2
 where id = '5000';
-- Retirado, como 1800 y 3000. Los 2 clientes conservan su fila y su cupo (no
-- estaba entre los tiers congelados: su número de tier no cambia, solo deja
-- de venderse); `getTiersVendibles` ya filtra por `activo` (lib/data.ts:517).
update public.tiers set activo = false, nombre = '€8.000 (retirado sep-2026)'
 where id = '8000';
-- `acceso_comunidad` se copia del 8.000 (true): es el tier del que hereda el
-- resto del bundle.
insert into public.tiers
  (id, nombre, meses_default, n_consultorias, n_sesiones_berni,
   acceso_discord, acceso_comunidad, sesiones_directo, numero_berni, activo)
values
  ('10000', '€10.000 / 12 meses', 12, 6, 3, true, true, true, true, true)
on conflict (id) do nothing;

-- 8) Red de seguridad final, mismo criterio que la 0051: comprueba el
-- catálogo Y que el congelado del paso 5 quedó exactamente donde tenía que
-- quedar (nada se filtró fuera de los tres tiers, nada se quedó corto). Se
-- recalcula aquí, después de tocar `tiers`, para probar que el join de la
-- vista sigue devolviendo lo mismo con el catálogo ya cambiado. Incluye
-- `nombre` y `meses_default`: en este repo `tiers.meses_default` ya mintió
-- una vez (0051), así que entra en el candado.
do $$
declare
  v_mal          text;
  v_2000         int;
  v_3500         int;
  v_5000         int;
  v_total_ajuste int;
  v_n_tiers      int;
begin
  select string_agg(id || '=' || nombre, ', ') into v_mal
  from public.tiers
  where (id = '2000'  and (n_consultorias is distinct from 2 or sesiones_directo is not true))
     or (id = '3500'  and (n_consultorias is distinct from 6 or acceso_discord is not true))
     or (id = '5000'  and (n_consultorias is distinct from 6 or n_sesiones_berni is distinct from 2))
     or (id = '8000'  and (activo is not false
                            or nombre is distinct from '€8.000 (retirado sep-2026)'))
     or (id = '10000' and (n_consultorias is distinct from 6 or n_sesiones_berni is distinct from 3
                            or acceso_discord is not true or acceso_comunidad is not true
                            or sesiones_directo is not true or numero_berni is not true
                            or activo is not true
                            or nombre is distinct from '€10.000 / 12 meses'
                            or meses_default is distinct from 12));
  if v_mal is not null then
    raise exception 'catálogo 2026 no quedó como se esperaba: %', v_mal;
  end if;

  select count(*) into v_n_tiers from public.tiers;
  if v_n_tiers <> 11 then
    raise exception 'se esperaban 11 filas en tiers (las 10 de antes + el 10000 nuevo) y hay %', v_n_tiers;
  end if;

  -- Se filtra por `consultorias_ajuste_motivo = 'catalogo_2026'`, NO por
  -- `consultorias_ajuste is not null`: este candado tiene que contar lo que
  -- congela ESTA migración, no todo ajuste que exista en la tabla. Hoy no hay
  -- ninguno (0 en toda `personas`, comprobado en solo lectura), pero entre
  -- hoy y el momento en que esto se aplique alguien puede escribir un ajuste
  -- manual perfectamente legítimo —en cualquier tier— y sin el filtro la
  -- migración abortaría por hacer exactamente lo correcto. Mismo criterio,
  -- palabra por palabra, que el "Deshacer" de la cabecera.
  select
    count(*) filter (where pa.tier = '2000'),
    count(*) filter (where pa.tier = '3500'),
    count(*) filter (where pa.tier = '5000'),
    count(*)
  into v_2000, v_3500, v_5000, v_total_ajuste
  from public.personas p
  join public.v_programa_activo pa on pa.persona_id = p.id
  where p.consultorias_ajuste is not null
    and p.consultorias_ajuste_motivo = 'catalogo_2026';

  if v_2000 <> 22 or v_3500 <> 19 or v_5000 <> 18 or v_total_ajuste <> 59 then
    -- Base vacía (reset local): nada se congeló, el recuento no aplica. El
    -- candado del catálogo de arriba sí corrió — ese no depende de datos.
    if v_total_ajuste = 0
       and not exists (select 1 from public.personas limit 1) then
      return;
    end if;
    raise exception
      'congelado no cuadra tras tocar el catálogo: tier 2000=% (esperado 22), 3500=% (esperado 19), 5000=% (esperado 18), total=% (esperado 59)',
      v_2000, v_3500, v_5000, v_total_ajuste;
  end if;
end $$;

commit;
