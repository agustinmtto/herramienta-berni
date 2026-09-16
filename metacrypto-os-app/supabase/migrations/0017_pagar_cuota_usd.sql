-- ============================================================
-- MetaCrypto OS — Migración 0017: usd_recibido en pagar_cuota
--
-- pagar_cuota (0016) nunca leía `usd_recibido` del payload, así que cada
-- cuota cobrada desde su despliegue quedaría con usd_recibido = NULL para
-- siempre. getPnlUsd() (apps/inbox/lib/data.ts) solo cuenta un pago cuando
-- usd_recibido != null: /pnl (Beneficio neto YTD) no se movería nunca por
-- las cuotas cobradas, aunque /inicio e /ingresos sí muestren el cash
-- entrando. crear_venta (0014/0015) ya guarda este campo — se replica aquí
-- exactamente el mismo patrón: nullif(payload->>'usd_recibido','')::numeric
-- directo en el INSERT, NULL cuando no llega (campo opcional).
--
-- NO se toca 0016: ya está aplicada y committeada, y la historia de
-- migraciones aplicadas debe mantenerse honesta. Este archivo es un
-- `create or replace function` sobre la misma función.
--
-- Spec: docs/superpowers/specs/2026-08-05-gestion-cuotas-design.md
-- ============================================================

create or replace function public.pagar_cuota(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuota      public.cuotas_programadas%rowtype;
  v_persona_id uuid;
  v_importe    numeric(12,2) := round((payload->>'importe')::numeric, 2);
  v_fecha      date          := (payload->>'fecha')::date;
  v_autor      uuid          := nullif(payload->>'autor_id','')::uuid;
  v_metodo     text          := nullif(payload->>'metodo_pago','');
  v_comprob    text          := nullif(payload->>'comprobante_path','');
  v_pago_id    uuid;
  v_parcial    boolean;
  v_saldo      numeric(12,2);
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;
  if v_cuota.estado <> 'pendiente' then
    raise exception 'Esa cuota ya está %', v_cuota.estado;
  end if;
  if v_importe is null or v_importe <= 0 then
    raise exception 'El importe debe ser mayor que 0';
  end if;
  if v_importe > v_cuota.monto then
    raise exception 'El importe (%) supera lo pendiente de la cuota (%)', v_importe, v_cuota.monto;
  end if;
  if v_fecha is null then raise exception 'La fecha del pago es obligatoria'; end if;
  if v_fecha > current_date then raise exception 'La fecha del pago no puede ser futura'; end if;

  select persona_id into v_persona_id from public.programas where id = v_cuota.programa_id;
  if v_persona_id is null then raise exception 'La cuota no tiene programa asociado'; end if;

  -- Anti doble-submit acotado a ESTA cuota: protege del doble clic sin bloquear
  -- que un cliente pague dos cuotas distintas del mismo importe el mismo día
  -- (caso legítimo que sí bloquearía el guard por persona+importe+fecha de crear_venta).
  if exists (
    select 1 from public.pagos
     where cuota_id = v_cuota.id and monto = v_importe
       and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'pago duplicado: ya se registró ese importe para esta cuota hace menos de 2 minutos';
  end if;

  v_parcial := v_importe < v_cuota.monto;
  v_saldo   := v_cuota.monto - v_importe;

  insert into public.pagos (persona_id, cuota_id, tipo, tipo_detalle, monto, divisa,
                            usd_recibido, fecha, metodo_pago, comprobante_path)
  values (v_persona_id, v_cuota.id, 'cuota',
          case when v_parcial then 'Abono cuota ' || v_cuota.numero_cuota
               else 'Cuota ' || v_cuota.numero_cuota end,
          v_importe, v_cuota.divisa, nullif(payload->>'usd_recibido','')::numeric,
          v_fecha, v_metodo, v_comprob)
  returning id into v_pago_id;

  if v_parcial then
    update public.cuotas_programadas set monto = v_saldo where id = v_cuota.id;
  else
    update public.cuotas_programadas set estado = 'pagada' where id = v_cuota.id;
  end if;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id,
          case when v_parcial then 'pago_parcial' else 'pago' end, v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('monto', v_cuota.monto, 'estado', v_cuota.estado),
            'despues', jsonb_build_object('monto', case when v_parcial then v_saldo else v_cuota.monto end,
                                          'estado', case when v_parcial then 'pendiente' else 'pagada' end),
            'pago_id', v_pago_id, 'importe', v_importe, 'metodo_pago', v_metodo));

  return jsonb_build_object('cuota_id', v_cuota.id, 'pago_id', v_pago_id,
                            'parcial', v_parcial, 'saldo', v_saldo,
                            'estado', case when v_parcial then 'pendiente' else 'pagada' end);
end;
$$;

revoke all on function public.pagar_cuota(jsonb) from public, anon, authenticated;
grant execute on function public.pagar_cuota(jsonb) to service_role;
