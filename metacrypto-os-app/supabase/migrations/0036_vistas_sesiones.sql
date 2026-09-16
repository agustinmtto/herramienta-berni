-- ============================================================
-- MetaCrypto OS — Migración 0036: las vistas del módulo de servicio
--
-- Tres vistas nuevas y una rehecha:
--   v_sesiones_cliente     — cada sesión con su número, su cliente y su coach
--   v_sesiones_por_coach   — cuántas lleva cada cliente con cada coach
--   v_consultorias_cliente — el cupo: incluidas / hechas / pendientes
--   v_timeline_cliente     — pasa a leer `estado_asistencia` (create or replace)
--
-- Y sólo al final, con la vista ya sin referencias, se retira `sesiones.asistio`.
--
-- Spec: docs/superpowers/specs/2026-08-12-sesiones-servicio-design.md
-- ============================================================
begin;

-- 1) Cada sesión, numerada -----------------------------------------------------
-- El número se DERIVA, no se guarda: guardarlo obligaría a renumerar a mano
-- cada vez que se corrige una fecha o se borra una sesión, y ahí es donde
-- aparecen los huecos.
--
-- Tres detalles que no son adorno:
--
-- a) `order by fecha, created_at, id` — el desempate es obligatorio. 103 de las
--    111 filas llevan la hora placeholder 12:00Z que les puso el backfill de
--    Airtable, y 2 clientes tienen dos sesiones el MISMO día (Raul Alonso el
--    10-jul, Jhon Rua el 1-may). Sin desempate, esas parejas cambiarían de
--    número entre una consulta y la siguiente.
--
-- b) `count(*) filter (...) over (...)` en vez de `row_number()` — una sesión
--    reprogramada no gasta número. Con `row_number()` la reprogramada ocuparía
--    su posición igual y la siguiente sesión real se saltaría un número.
--
-- c) Las sesiones sin `persona_id` (hoy 2: citas de GHL cuyo contacto no cruzó)
--    se quedan SIN número. Numerarlas juntas sería inventar un cliente que no
--    existe. Salen igual en la vista, para que la bandeja pueda pescarlas.
--
-- `tier` sale del programa activo de HOY, no del que tenía el día de la sesión.
-- Es para etiquetar en pantalla; si algún día hace falta el tier histórico, se
-- resuelve buscando el programa vigente en `s.fecha`.
create or replace view public.v_sesiones_cliente with (security_invoker=true) as
select
  s.id,
  s.persona_id,
  p.nombre                                        as cliente,
  s.coach_id,
  tm.nombre                                       as coach,
  s.fecha,
  (s.fecha at time zone 'Europe/Madrid')::date     as dia,
  s.tipo,
  s.estado_asistencia,
  s.notas,
  s.url_grabacion,
  s.enlace,
  s.duracion_min,
  s.capital_total,
  s.exchange,
  s.proximo_paso,
  (s.ghl_appointment_id is not null)              as de_ghl,
  pa.tier,
  case
    when s.persona_id is null then null
    when s.estado_asistencia is distinct from 'reprogramada' then
      count(*) filter (where s.estado_asistencia is distinct from 'reprogramada')
        over (partition by s.persona_id
              order by s.fecha, s.created_at, s.id
              rows between unbounded preceding and current row)
  end                                             as numero
from public.sesiones s
left join public.personas p            on p.id  = s.persona_id
left join public.team_members tm       on tm.id = s.coach_id
left join public.v_programa_activo pa  on pa.persona_id = s.persona_id;

-- 2) Reparto por coach ---------------------------------------------------------
-- Vive aparte y agrupa por `coach_id`, sin nombrar a nadie en el SQL: si mañana
-- entra un tercer coach, esta vista lo recoge sola. Meter "Berni"/"Manuel"
-- literales dentro de un `filter` habría convertido cada alta de coach en una
-- migración.
create or replace view public.v_sesiones_por_coach with (security_invoker=true) as
select
  s.persona_id,
  s.coach_id,
  tm.nombre                                       as coach,
  count(*) filter (where s.estado_asistencia = 'asistio') as hechas
from public.sesiones s
left join public.team_members tm on tm.id = s.coach_id
where s.persona_id is not null
group by s.persona_id, s.coach_id, tm.nombre;

-- 3) El cupo de consultorías ---------------------------------------------------
-- `incluidas` = lo que dice el tier, salvo que alguien haya escrito un ajuste.
-- `ajustado` deja que la UI muestre "3 · ajustado, su tier incluye 2" en vez de
-- un número a secas que parecería un error del sistema.
--
-- `pendientes` nunca es negativo: 5 clientes ya superaron lo que su tier
-- incluye (Ivan Moreno y Nico Villalón, 3 con un tier de 2, entre otros). Un
-- "-1 pendientes" en pantalla no significa nada para nadie.
--
-- Sin programa activo no hay tier, así que `incluidas` y `pendientes` quedan
-- en null: "no lo sé" y "cero" son cosas distintas y la UI las pinta distinto.
create or replace view public.v_consultorias_cliente with (security_invoker=true) as
select
  p.id                                              as persona_id,
  p.nombre                                          as cliente,
  pa.tier,
  t.n_consultorias                                  as incluidas_tier,
  coalesce(p.consultorias_ajuste, t.n_consultorias) as incluidas,
  (p.consultorias_ajuste is not null)               as ajustado,
  count(s.id) filter (where s.estado_asistencia = 'asistio')          as hechas,
  count(s.id) filter (where s.estado_asistencia is null
                        and s.fecha < now())                          as sin_registrar,
  case
    when coalesce(p.consultorias_ajuste, t.n_consultorias) is null then null
    else greatest(0, coalesce(p.consultorias_ajuste, t.n_consultorias)
                     - count(s.id) filter (where s.estado_asistencia = 'asistio'))
  end                                                                 as pendientes,
  max(s.fecha) filter (where s.estado_asistencia = 'asistio')         as ultima
from public.personas p
left join public.v_programa_activo pa on pa.persona_id = p.id
left join public.tiers t              on t.id = pa.tier
left join public.sesiones s           on s.persona_id = p.id
group by p.id, p.nombre, pa.tier, t.n_consultorias, p.consultorias_ajuste;

-- 4) El timeline de la ficha, sin `asistio` ------------------------------------
-- `create or replace view` sobre la vista completa, mismo criterio que la 0021
-- y la 0023: no se tocan las migraciones ya aplicadas. La forma de salida no
-- cambia (mismas columnas, mismos tipos, mismo orden), así que `replace` basta.
--
-- Cambios reales, sólo en la rama de sesiones:
--   - lee `estado_asistencia` en vez de `asistio`, y sabe decir "reprogramada"
--   - el título lleva el número: "Consultoría 1-a-1 · Sesión 3"
--   - se apoya en v_sesiones_cliente para no repetir aquí la ventana del número
create or replace view public.v_timeline_cliente with (security_invoker=true) as

-- Programas: alta, ascensión, renovación… ------------------------------------
select
  p.persona_id,
  ((p.fecha_inicio + time '12:00') at time zone 'Europe/Madrid') as fecha,
  p.fecha_inicio                                                  as dia,
  'programa'::text                                                as tipo,
  case p.motivo
    when 'nueva_venta'  then 'Compra nueva'
    when 'upsell'       then 'Ascensión de programa'
    when 'renovacion'   then 'Renovación'
    when 'downsell'     then 'Bajada de programa'
    when 'reactivacion' then 'Reactivación'
    when 'cross_sell'   then 'Venta cruzada'
    else p.motivo
  end                                                             as titulo,
  ('Tier ' || p.tier)                                             as detalle,
  p.monto                                                         as importe,
  p.id                                                            as ref_id
from public.programas p

union all

-- Pagos ------------------------------------------------------------------
select
  pg.persona_id,
  ((pg.fecha + time '12:00') at time zone 'Europe/Madrid'),
  pg.fecha,
  'pago',
  case pg.tipo when 'refund' then 'Reembolso' else 'Cobro registrado' end,
  coalesce(pg.tipo_detalle, pg.tipo),
  pg.monto,
  pg.id
from public.pagos pg

union all

-- Cuotas (llegan a la persona a través de su programa) ------------------------
-- El doble significado de `monto` en `cuotas_programadas` sigue igual que en la
-- 0023: pendiente = lo que falta; pagada = el importe del último abono. Ver la
-- nota larga de aquella migración. No se toca aquí.
select
  pr.persona_id,
  ((c.fecha_vencimiento + time '12:00') at time zone 'Europe/Madrid'),
  c.fecha_vencimiento,
  'cuota',
  case c.estado when 'pagada' then 'Cuota cobrada' else 'Cuota pendiente' end,
  ('Cuota ' || c.numero_cuota),
  c.monto,
  c.id
from public.cuotas_programadas c
join public.programas pr on pr.id = c.programa_id

union all

-- Sesiones -------------------------------------------------------------------
select
  vs.persona_id,
  vs.fecha,
  vs.dia,
  'sesion',
  (case vs.tipo when 'consultoria_1a1' then 'Consultoría 1-a-1' else 'Sesión grupal' end)
    || coalesce(' · Sesión ' || vs.numero, ''),
  case vs.estado_asistencia
    when 'asistio'      then 'asistió'
    when 'no_asistio'   then 'no asistió'
    when 'reprogramada' then 'reprogramada'
    else 'sin registrar'
  end,
  null::numeric,
  vs.id
from public.v_sesiones_cliente vs

union all

-- Pausas del programa --------------------------------------------------------
select
  pr.persona_id,
  ((e.fecha_inicio + time '12:00') at time zone 'Europe/Madrid'),
  e.fecha_inicio,
  'freeze',
  'Programa pausado',
  case when e.fecha_fin is null then 'sin fecha de fin'
       else ('hasta ' || to_char(e.fecha_fin, 'DD/MM/YYYY')) end,
  null::numeric,
  e.id
from public.programa_eventos e
join public.programas pr on pr.id = e.programa_id
where e.tipo = 'freeze'

union all

-- Plantillas de WhatsApp enviadas --------------------------------------------
-- `detalle` es el NOMBRE de la plantilla (etiqueta de catálogo fija), no su
-- cuerpo resuelto. Ver la cabecera de la 0023: `m.body` no aparece aquí.
select
  cv.persona_id,
  m.sent_at,
  (m.sent_at at time zone 'Europe/Madrid')::date,
  'mensaje',
  'Plantilla enviada',
  case m.plantilla_nombre
    when 'bienvenida_club_es'        then 'Bienvenida'
    when 'confirmacion_sesion_es'    then 'Confirmación de sesión'
    when 'recordatorio_sesion_es'    then 'Recordatorio de sesión'
    when 'recordatorio_1h_es'        then 'Recordatorio (1 hora antes)'
    when 'reengage_conversacion_es'  then 'Reenganche'
    else coalesce(m.plantilla_nombre, 'Plantilla')
  end,
  null::numeric,
  m.id
from public.wa_mensajes m
join public.wa_conversaciones cv on cv.id = m.conversacion_id
where m.tipo = 'template' and cv.persona_id is not null;

-- 5) Y ahora sí, fuera la columna vieja ---------------------------------------
-- Hasta esta línea `v_timeline_cliente` dependía de `sesiones.asistio` y
-- Postgres rechazaba el DROP. Con la vista ya rehecha sobre
-- `estado_asistencia`, la dependencia desaparece y la columna puede irse:
-- dejarla viva sería tener dos fuentes de verdad de lo mismo.
alter table public.sesiones drop column if exists asistio;

commit;
