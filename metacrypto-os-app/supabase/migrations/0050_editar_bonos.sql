-- ============================================================
-- MetaCrypto OS — Migración 0050: editar los bonos de una venta ya registrada
--
-- El caso que lo pide, literal (Alex, 25-ago por WhatsApp):
--   "un cliente que no le metí los bonos, para editarlo en el OS ¿cómo
--    podemos hacer?"
--
-- Es un RPC y no un PATCH desde la app porque cambiar los bonos cambia también
-- la duración del programa y deja rastro en `auditoria`: los tres pasos tienen
-- que ir o no ir juntos. Un PATCH suelto podría dejar los bonos guardados sin
-- fila de auditoría, y entonces nadie sabe quién alargó un programa.
-- ============================================================

begin;

create or replace function public.editar_bonos(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_programa_id uuid := (payload->>'programa_id')::uuid;
  v_autor       uuid := nullif(payload->>'autor_id','')::uuid;
  v_tier        text;
  v_antes       text[];
  v_meses_antes int;
  v_bonos       text[];
  v_meses       int;
begin
  if v_programa_id is null then
    raise exception 'programa_id requerido';
  end if;

  -- `for update`: dos personas corrigiendo la misma venta a la vez no se
  -- pisan a medias. Mismo criterio que editar_persona (0039).
  select tier, coalesce(bonos,'{}'), meses_duracion
    into v_tier, v_antes, v_meses_antes
  from programas where id = v_programa_id for update;

  if v_tier is null then
    raise exception 'ese programa no existe';
  end if;

  -- Mismo saneado que crear_venta: catálogo + regla del tier.
  v_bonos := array(
    select distinct b
    from jsonb_array_elements_text(coalesce(payload->'bonos','[]'::jsonb)) as b
    where b in ('consultoria_berni','consultoria_manuel','duracion_9m','discord_portafolio')
  );
  if v_tier is distinct from '1800' then
    v_bonos := array_remove(v_bonos, 'duracion_9m');
  end if;

  -- La duración sigue al bono en los dos sentidos: ponerlo la lleva a 9,
  -- quitarlo la devuelve al default del tier. Si el bono no está en juego,
  -- no se toca lo que hubiera (puede ser una duración escrita a mano).
  v_meses := v_meses_antes;
  if 'duracion_9m' = any(v_bonos) then
    v_meses := 9;
  elsif 'duracion_9m' = any(v_antes) then
    select meses_default into v_meses from tiers where id = v_tier;
  end if;

  update programas
     set bonos = v_bonos, meses_duracion = v_meses
   where id = v_programa_id;

  insert into auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('programa', v_programa_id, 'editar_bonos', v_autor,
          jsonb_build_object(
            'antes',  jsonb_build_object('bonos', to_jsonb(v_antes), 'meses_duracion', v_meses_antes),
            'despues', jsonb_build_object('bonos', to_jsonb(v_bonos), 'meses_duracion', v_meses)));

  return jsonb_build_object('programa_id', v_programa_id,
                            'bonos', to_jsonb(v_bonos),
                            'meses_duracion', v_meses);
end;
$$;

revoke execute on function public.editar_bonos(jsonb) from public, anon, authenticated;

commit;
