-- ============================================================
-- 0041 — Anular una cuota (y poder revertirlo).
--
-- Berni, 14-ago-2026: "en cuotas pendientes, que podamos eliminar y mover de
-- fecha el pago (por ejemplo clientes que echamos porque no cumplieron su
-- cuota)".
--
-- Mover de fecha YA existía (`editar_cuota`, migración 0016). Lo que faltaba
-- es sacar de en medio la deuda de un cliente que se va.
--
-- ANULAR, NO BORRAR. Un DELETE borra que la deuda existió, y este caso es
-- justo donde eso duele: dentro de un mes alguien preguntará por qué Fulano
-- dejó de deber 2.000 € y no habría respuesta. `anulada` es un estado más,
-- con motivo obligatorio y fila de auditoría, y se revierte con
-- `reactivar_cuota`.
--
-- LO QUE NO HAY QUE TOCAR: v_cash_to_be_collected, v_flujo_caja_futuro, el
-- KPI de cuotas pendientes y la bandeja de atribución ya filtran
-- `estado = 'pendiente'`, así que una cuota anulada sale de todos ellos sola.
-- La única que NO filtraba es v_timeline_cliente — ver el punto 3.
-- ============================================================
begin;

-- 1) El estado 'anulada' ------------------------------------------------------
alter table public.cuotas_programadas drop constraint if exists cuotas_programadas_estado_check;
alter table public.cuotas_programadas add constraint cuotas_programadas_estado_check
  check (estado in ('pendiente','pagada','vencida','anulada'));

-- 2) anular_cuota / reactivar_cuota -------------------------------------------
-- Mismo contrato que el resto de RPCs de cuotas (0016): security definer,
-- solo service_role, `for update`, y auditoría con antes/después.
create or replace function public.anular_cuota(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuota  public.cuotas_programadas%rowtype;
  v_motivo text := nullif(btrim(payload->>'motivo'), '');
  v_autor  uuid := nullif(payload->>'autor_id','')::uuid;
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;

  -- Una cuota ya cobrada no se anula: eso es deshacer un pago, que tiene su
  -- propia función (`deshacer_pago_cuota`) porque además hay que devolver el
  -- importe. Anularla aquí dejaría el pago vivo y la cuota fuera de las
  -- cuentas — dinero cobrado que no aparece en ningún sitio.
  if v_cuota.estado = 'pagada' then
    raise exception 'Esta cuota ya está cobrada — deshaz el pago antes de anularla';
  end if;
  if v_cuota.estado = 'anulada' then
    raise exception 'Esta cuota ya estaba anulada';
  end if;

  -- El motivo es OBLIGATORIO. Una deuda que desaparece sin explicación es
  -- exactamente lo que la auditoría existe para impedir: dentro de tres meses
  -- "¿por qué dejó de deber 2.000 €?" tiene que tener respuesta en el sistema
  -- y no en la memoria de quien le dio al botón.
  if v_motivo is null then
    raise exception 'Hace falta un motivo para anular la cuota';
  end if;

  update public.cuotas_programadas set estado = 'anulada' where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'anulada', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('estado', v_cuota.estado, 'monto', v_cuota.monto,
                                          'fecha_vencimiento', v_cuota.fecha_vencimiento),
            'despues', jsonb_build_object('estado', 'anulada', 'monto', v_cuota.monto,
                                          'fecha_vencimiento', v_cuota.fecha_vencimiento),
            'motivo',  v_motivo));

  return jsonb_build_object('cuota_id', v_cuota.id, 'estado', 'anulada');
end;
$$;

create or replace function public.reactivar_cuota(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuota public.cuotas_programadas%rowtype;
  v_autor uuid := nullif(payload->>'autor_id','')::uuid;
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;
  if v_cuota.estado <> 'anulada' then
    raise exception 'Esta cuota no está anulada';
  end if;

  -- Vuelve a 'pendiente', no al estado que tuviera antes: 'vencida' se
  -- deduce hoy de la fecha (ver clasificarCuota en lib/cuotas.ts), así que
  -- reponer un 'vencida' guardado sería resucitar un dato calculado y
  -- posiblemente ya falso.
  update public.cuotas_programadas set estado = 'pendiente' where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'reactivada', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('estado', 'anulada'),
            'despues', jsonb_build_object('estado', 'pendiente')));

  return jsonb_build_object('cuota_id', v_cuota.id, 'estado', 'pendiente');
end;
$$;

revoke all on function public.anular_cuota(jsonb)    from public, anon, authenticated;
revoke all on function public.reactivar_cuota(jsonb) from public, anon, authenticated;
grant execute on function public.anular_cuota(jsonb)    to service_role;
grant execute on function public.reactivar_cuota(jsonb) to service_role;

-- 3) La ficha del cliente dejaba de decir la verdad ---------------------------
-- `v_timeline_cliente` no filtra por estado y su CASE solo distinguía
-- 'pagada'. Sin esto, una cuota anulada seguiría apareciendo en la ficha como
-- "Cuota pendiente" para siempre.
--
-- NO se filtra fuera del timeline a propósito: que una deuda se anulara es un
-- hecho de la historia del cliente y merece verse. Lo que se arregla es la
-- etiqueta, no la presencia.
--
-- La vista se recrea desde su definición VIVA (pg_get_viewdef) con el CASE
-- parcheado, en vez de transcribir 96 líneas a mano: es la única forma de no
-- perder por el camino los arreglos de 0021, 0023 y 0036.
create or replace view public.v_timeline_cliente as
 SELECT p.persona_id,
    ((p.fecha_inicio + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    p.fecha_inicio AS dia,
    'programa'::text AS tipo,
        CASE p.motivo
            WHEN 'nueva_venta'::text THEN 'Compra nueva'::text
            WHEN 'upsell'::text THEN 'Ascensión de programa'::text
            WHEN 'renovacion'::text THEN 'Renovación'::text
            WHEN 'downsell'::text THEN 'Bajada de programa'::text
            WHEN 'reactivacion'::text THEN 'Reactivación'::text
            WHEN 'cross_sell'::text THEN 'Venta cruzada'::text
            ELSE p.motivo
        END AS titulo,
    'Tier '::text || p.tier AS detalle,
    p.monto AS importe,
    p.id AS ref_id
   FROM programas p
UNION ALL
 SELECT pg.persona_id,
    ((pg.fecha + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    pg.fecha AS dia,
    'pago'::text AS tipo,
        CASE pg.tipo
            WHEN 'refund'::text THEN 'Reembolso'::text
            ELSE 'Cobro registrado'::text
        END AS titulo,
    COALESCE(pg.tipo_detalle, pg.tipo) AS detalle,
    pg.monto AS importe,
    pg.id AS ref_id
   FROM pagos pg
UNION ALL
 SELECT pr.persona_id,
    ((c.fecha_vencimiento + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    c.fecha_vencimiento AS dia,
    'cuota'::text AS tipo,
        CASE c.estado
            WHEN 'pagada'::text THEN 'Cuota cobrada'::text
            WHEN 'anulada'::text THEN 'Cuota anulada'::text
            ELSE 'Cuota pendiente'::text
        END AS titulo,
    'Cuota '::text || c.numero_cuota AS detalle,
    c.monto AS importe,
    c.id AS ref_id
   FROM cuotas_programadas c
     JOIN programas pr ON pr.id = c.programa_id
UNION ALL
 SELECT vs.persona_id,
    vs.fecha,
    vs.dia,
    'sesion'::text AS tipo,
        CASE vs.tipo
            WHEN 'consultoria_1a1'::text THEN 'Consultoría 1-a-1'::text
            ELSE 'Sesión grupal'::text
        END || COALESCE(' · Sesión '::text || vs.numero, ''::text) AS titulo,
        CASE vs.estado_asistencia
            WHEN 'asistio'::text THEN 'asistió'::text
            WHEN 'no_asistio'::text THEN 'no asistió'::text
            WHEN 'reprogramada'::text THEN 'reprogramada'::text
            ELSE 'sin registrar'::text
        END AS detalle,
    NULL::numeric AS importe,
    vs.id AS ref_id
   FROM v_sesiones_cliente vs
UNION ALL
 SELECT pr.persona_id,
    ((e.fecha_inicio + '12:00:00'::time without time zone) AT TIME ZONE 'Europe/Madrid'::text) AS fecha,
    e.fecha_inicio AS dia,
    'freeze'::text AS tipo,
    'Programa pausado'::text AS titulo,
        CASE
            WHEN e.fecha_fin IS NULL THEN 'sin fecha de fin'::text
            ELSE 'hasta '::text || to_char(e.fecha_fin::timestamp with time zone, 'DD/MM/YYYY'::text)
        END AS detalle,
    NULL::numeric AS importe,
    e.id AS ref_id
   FROM programa_eventos e
     JOIN programas pr ON pr.id = e.programa_id
  WHERE e.tipo = 'freeze'::text
UNION ALL
 SELECT cv.persona_id,
    m.sent_at AS fecha,
    (m.sent_at AT TIME ZONE 'Europe/Madrid'::text)::date AS dia,
    'mensaje'::text AS tipo,
    'Plantilla enviada'::text AS titulo,
        CASE m.plantilla_nombre
            WHEN 'bienvenida_club_es'::text THEN 'Bienvenida'::text
            WHEN 'confirmacion_sesion_es'::text THEN 'Confirmación de sesión'::text
            WHEN 'recordatorio_sesion_es'::text THEN 'Recordatorio de sesión'::text
            WHEN 'recordatorio_1h_es'::text THEN 'Recordatorio (1 hora antes)'::text
            WHEN 'reengage_conversacion_es'::text THEN 'Reenganche'::text
            ELSE COALESCE(m.plantilla_nombre, 'Plantilla'::text)
        END AS detalle,
    NULL::numeric AS importe,
    m.id AS ref_id
   FROM wa_mensajes m
     JOIN wa_conversaciones cv ON cv.id = m.conversacion_id
  WHERE m.tipo = 'template'::text AND cv.persona_id IS NOT NULL;

commit;
