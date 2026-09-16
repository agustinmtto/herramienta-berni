-- ============================================================
-- 0047 — Clasificar una devolución heredada.
--
-- Las 6 filas del histórico de Airtable entraron sin saber qué eran. Cuatro
-- son devoluciones de programa; de dos (Carlos Dreves, −203,44 $ y Daniel
-- García, −41,71 $) no se sabe, y Milo lo mirará. Esta función es lo que
-- permite que ese "no se sabe" NO bloquee el build: entran marcadas y se
-- resuelven desde la pestaña el día que se averigüe.
--
-- Reutiliza `aplicar_efectos_devolucion` (0046): clasificar algo como total
-- tiene que provocar exactamente lo mismo que nacer total, o las dos puertas
-- acabarían dejando el sistema en estados distintos.
-- ============================================================
begin;

create or replace function public.clasificar_devolucion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid := nullif(payload->>'devolucion_id','')::uuid;
  v_alcance  text := payload->>'alcance';
  v_motivo   text := nullif(btrim(payload->>'motivo'), '');
  v_revierte uuid := nullif(payload->>'revierte_pago_id','')::uuid;
  v_autor    uuid := nullif(payload->>'autor_id','')::uuid;
  v_pago     public.pagos%rowtype;
  v_efectos  jsonb := '{}'::jsonb;
begin
  if v_alcance is null or v_alcance not in ('total','parcial') then
    raise exception 'Alcance no reconocido: usa «total» o «parcial»';
  end if;
  if v_motivo is null then
    raise exception 'Hace falta decir qué fue esta devolución';
  end if;

  select * into v_pago from public.pagos
   where id = v_id and tipo = 'refund' for update;
  if not found then raise exception 'La devolución no existe'; end if;
  if v_pago.devolucion_alcance <> 'sin_clasificar' then
    raise exception 'Esta devolución ya está clasificada como «%»', v_pago.devolucion_alcance;
  end if;

  -- Una parcial necesita saber qué cobro devuelve, igual que al registrarla:
  -- sin eso no hay forma de revertir la comisión correcta.
  if v_alcance = 'parcial' and coalesce(v_revierte, v_pago.revierte_pago_id) is null then
    raise exception 'Una devolución parcial tiene que decir qué cobro devuelve';
  end if;

  update public.pagos
     set devolucion_alcance = v_alcance,
         devolucion_motivo  = v_motivo,
         revierte_pago_id   = coalesce(v_revierte, revierte_pago_id)
   where id = v_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('devolucion', v_id, 'devolucion_clasificada', v_autor,
          jsonb_build_object('antes', 'sin_clasificar', 'despues', v_alcance,
                             'motivo', v_motivo));

  if v_alcance = 'total' then
    v_efectos := public.aplicar_efectos_devolucion(v_id, v_autor);
  end if;

  return jsonb_build_object('devolucion_id', v_id, 'alcance', v_alcance, 'efectos', v_efectos);
end;
$$;

revoke all on function public.clasificar_devolucion(jsonb) from public, anon, authenticated;
grant execute on function public.clasificar_devolucion(jsonb) to service_role;

commit;
