-- ============================================================
-- MetaCrypto OS — Migración 0016: GESTIÓN DE CUOTAS
-- Cerrar cuotas pagadas (incl. abonos parciales), editarlas, deshacerlas
-- y crear cuotas sueltas. Toda operación deja traza en public.auditoria.
-- Spec: docs/superpowers/specs/2026-08-05-gestion-cuotas-design.md
-- ============================================================

-- 1) Auditoría genérica -------------------------------------------------------
create table if not exists public.auditoria (
  id         uuid primary key default gen_random_uuid(),
  entidad    text not null,
  entidad_id uuid not null,
  accion     text not null,
  autor_id   uuid references public.team_members(id),
  datos      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_auditoria_entidad
  on public.auditoria (entidad, entidad_id, created_at desc);

alter table public.auditoria enable row level security;
drop policy if exists "auth read auditoria" on public.auditoria;
create policy "auth read auditoria" on public.auditoria
  for select to authenticated using (true);

-- 2) pagar_cuota --------------------------------------------------------------
-- Inserta el pago real y cierra la cuota. Si el importe es menor que el
-- pendiente, reduce el importe de la cuota y la deja pendiente (abono parcial).
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
                            fecha, metodo_pago, comprobante_path)
  values (v_persona_id, v_cuota.id, 'cuota',
          case when v_parcial then 'Abono cuota ' || v_cuota.numero_cuota
               else 'Cuota ' || v_cuota.numero_cuota end,
          v_importe, v_cuota.divisa, v_fecha, v_metodo, v_comprob)
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

-- 3) editar_cuota -------------------------------------------------------------
create or replace function public.editar_cuota(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuota   public.cuotas_programadas%rowtype;
  v_monto   numeric(12,2) := round(nullif(payload->>'monto','')::numeric, 2);
  v_fecha   date          := nullif(payload->>'fecha_vencimiento','')::date;
  v_autor   uuid          := nullif(payload->>'autor_id','')::uuid;
begin
  select * into v_cuota from public.cuotas_programadas
    where id = (payload->>'cuota_id')::uuid for update;
  if not found then raise exception 'La cuota no existe'; end if;
  if v_cuota.estado <> 'pendiente' then
    raise exception 'No se puede editar una cuota ya pagada — deshaz el pago primero';
  end if;
  if v_monto is not null and v_monto <= 0 then
    raise exception 'El importe debe ser mayor que 0';
  end if;
  if v_monto is null and v_fecha is null then
    raise exception 'No hay nada que cambiar';
  end if;

  update public.cuotas_programadas
     set monto = coalesce(v_monto, monto),
         fecha_vencimiento = coalesce(v_fecha, fecha_vencimiento),
         -- si el operador fija la fecha a mano, deja de ser inferida
         fecha_inferida = case when v_fecha is not null then false else fecha_inferida end
   where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'edicion', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('monto', v_cuota.monto,
                                          'fecha_vencimiento', v_cuota.fecha_vencimiento),
            'despues', jsonb_build_object('monto', coalesce(v_monto, v_cuota.monto),
                                          'fecha_vencimiento', coalesce(v_fecha, v_cuota.fecha_vencimiento))));

  return jsonb_build_object('cuota_id', v_cuota.id,
                            'monto', coalesce(v_monto, v_cuota.monto),
                            'fecha_vencimiento', coalesce(v_fecha, v_cuota.fecha_vencimiento));
end;
$$;

-- 4) deshacer_pago_cuota ------------------------------------------------------
-- Revierte UN pago concreto: lo borra, devuelve su importe a la cuota y la
-- reabre. Sirve tanto para un pago completo como para un abono parcial.
create or replace function public.deshacer_pago_cuota(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago   public.pagos%rowtype;
  v_cuota  public.cuotas_programadas%rowtype;
  v_autor  uuid := nullif(payload->>'autor_id','')::uuid;
  v_nuevo  numeric(12,2);
begin
  select * into v_pago from public.pagos where id = (payload->>'pago_id')::uuid for update;
  if not found then raise exception 'El pago no existe'; end if;
  if v_pago.tipo <> 'cuota' or v_pago.cuota_id is null then
    raise exception 'Ese pago no corresponde a una cuota';
  end if;

  select * into v_cuota from public.cuotas_programadas
    where id = v_pago.cuota_id for update;
  if not found then raise exception 'La cuota del pago no existe'; end if;

  -- Al cerrarse ('pagada'), la suma de los pagos activos de la cuota es
  -- exactamente el importe original (S = orig). Deshacer un pago P debe
  -- dejar pendiente orig - (S - P) = P — el importe de ESE pago concreto,
  -- sea el de cierre o uno anterior — y NO el `monto` actual de la cuota,
  -- que solo coincide con P cuando el pago deshecho es el que cerró la
  -- cuota. Si en cambio la cuota sigue 'pendiente', su `monto` ya es el
  -- saldo restante y basta sumarle el importe del pago que se deshace.
  v_nuevo := case when v_cuota.estado = 'pagada' then v_pago.monto
                  else v_cuota.monto + v_pago.monto end;

  delete from public.pagos where id = v_pago.id;
  update public.cuotas_programadas
     set estado = 'pendiente', monto = v_nuevo
   where id = v_cuota.id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_cuota.id, 'deshacer_pago', v_autor,
          jsonb_build_object(
            'antes',   jsonb_build_object('monto', v_cuota.monto, 'estado', v_cuota.estado),
            'despues', jsonb_build_object('monto', v_nuevo, 'estado', 'pendiente'),
            'pago_revertido', jsonb_build_object('id', v_pago.id, 'importe', v_pago.monto,
                                                 'fecha', v_pago.fecha)));

  return jsonb_build_object('cuota_id', v_cuota.id, 'monto', v_nuevo, 'estado', 'pendiente');
end;
$$;

-- 5) crear_cuota --------------------------------------------------------------
create or replace function public.crear_cuota(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programa public.programas%rowtype;
  v_monto    numeric(12,2) := round((payload->>'monto')::numeric, 2);
  v_fecha    date          := (payload->>'fecha_vencimiento')::date;
  v_autor    uuid          := nullif(payload->>'autor_id','')::uuid;
  v_num      int;
  v_id       uuid;
begin
  select * into v_programa from public.programas where id = (payload->>'programa_id')::uuid;
  if not found then raise exception 'El programa no existe'; end if;
  if v_monto is null or v_monto <= 0 then raise exception 'El importe debe ser mayor que 0'; end if;
  if v_fecha is null then raise exception 'La fecha de vencimiento es obligatoria'; end if;
  if v_fecha < current_date then raise exception 'La fecha de vencimiento no puede ser pasada'; end if;

  select coalesce(max(numero_cuota), 0) + 1 into v_num
    from public.cuotas_programadas where programa_id = v_programa.id;

  insert into public.cuotas_programadas (programa_id, numero_cuota, fecha_vencimiento,
                                         monto, divisa, estado, fecha_inferida)
  values (v_programa.id, v_num, v_fecha, v_monto, coalesce(v_programa.divisa,'EUR'),
          'pendiente', false)
  returning id into v_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('cuota', v_id, 'creacion', v_autor,
          jsonb_build_object('despues', jsonb_build_object(
            'programa_id', v_programa.id, 'numero_cuota', v_num,
            'monto', v_monto, 'fecha_vencimiento', v_fecha)));

  return jsonb_build_object('cuota_id', v_id, 'numero_cuota', v_num);
end;
$$;

revoke all on function public.editar_cuota(jsonb)        from public, anon, authenticated;
revoke all on function public.deshacer_pago_cuota(jsonb) from public, anon, authenticated;
revoke all on function public.crear_cuota(jsonb)         from public, anon, authenticated;
grant execute on function public.editar_cuota(jsonb)        to service_role;
grant execute on function public.deshacer_pago_cuota(jsonb) to service_role;
grant execute on function public.crear_cuota(jsonb)         to service_role;
