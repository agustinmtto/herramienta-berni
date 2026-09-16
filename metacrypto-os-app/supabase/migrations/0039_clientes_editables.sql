-- ============================================================
-- 0039 — Editar la ficha del cliente, y archivar a los OG.
--
-- Dos peticiones de Berni (14-ago-2026) que resultaron ser la misma:
--   · "conseguí el número de Nombre Ejemplo y no veo cómo añadirlo"
--   · "eliminaría todos los OG, no vamos a contactarles nunca"
--
-- Por qué son la misma: de los 82 clientes sin teléfono, 76 son OG. Archivar
-- a los OG deja el problema real del teléfono en 6 personas — abordable a
-- mano — en vez de en 82, que no lo es.
--
-- ARCHIVAR, NO BORRAR (decisión de Milo, 14-ago). Un DELETE se llevaría por
-- delante sus pagos y programas y el histórico financiero de 2025 dejaría de
-- cuadrar. Archivado es un estado de `personas`: las finanzas no lo miran
-- (leen `pagos` y `programas`), así que no mueve ni un céntimo de P&L, cash
-- collected ni comisiones. Solo desaparecen de listas y selectores, y es
-- reversible con un update.
-- ============================================================
begin;

-- 1) El estado 'archivado' ----------------------------------------------------
-- NO se reutiliza 'ex_cliente': eso significa "se fue", y los OG no se
-- fueron — son legacy del programa viejo. Mezclarlos convertiría "3
-- ex-clientes" en "79" y borraría el único dato real de churn que hay.
alter table public.personas drop constraint if exists personas_estado_check;
alter table public.personas add constraint personas_estado_check
  check (estado in ('lead','reservado','cliente','ex_cliente','archivado'));

-- 2) editar_persona -----------------------------------------------------------
-- Mismo contrato que editar_cuota (0016): security definer, solo service_role,
-- `for update`, y una fila de auditoría con antes/después.
--
-- Convención heredada de editar_cuota: la cadena vacía significa "no tocar
-- este campo", no "vaciarlo". Esta pantalla existe para RELLENAR huecos
-- (teléfonos que faltan), no para vaciarlos; un borrado accidental de un
-- teléfono desvincularía el hilo de WhatsApp del cliente.
create or replace function public.editar_persona(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p        public.personas%rowtype;
  v_nombre   text := nullif(payload->>'nombre','');
  v_tel      text := nullif(payload->>'telefono_e164','');
  v_email    text := nullif(payload->>'email','');
  v_pais     text := nullif(payload->>'pais','');
  v_coach    uuid := nullif(payload->>'coach_id','')::uuid;
  v_estado   text := nullif(payload->>'estado','');
  v_autor    uuid := nullif(payload->>'autor_id','')::uuid;
  v_digitos  text;
  v_choque   text;
  v_adoptada uuid;
begin
  select * into v_p from public.personas
    where id = (payload->>'persona_id')::uuid for update;
  if not found then raise exception 'La persona no existe'; end if;

  if v_nombre is null and v_tel is null and v_email is null
     and v_pais is null and v_coach is null and v_estado is null then
    raise exception 'No hay nada que cambiar';
  end if;

  if v_estado is not null
     and v_estado not in ('lead','reservado','cliente','ex_cliente','archivado') then
    raise exception 'Estado no válido: %', v_estado;
  end if;

  -- El coach tiene que existir. Sin esto un id copiado a mano deja la ficha
  -- apuntando al vacío y el cliente sale "sin coach" sin que nadie lo note.
  if v_coach is not null
     and not exists (select 1 from public.team_members where id = v_coach) then
    raise exception 'El coach indicado no existe';
  end if;

  if v_tel is not null then
    -- El teléfono llega ya canónico desde la server action (aE164): "+" y
    -- dígitos. Se revalida aquí porque el RPC es la última puerta antes del
    -- dato, y este campo es la llave de cruce de medio sistema.
    if v_tel !~ '^\+[0-9]{8,}$' then
      raise exception 'El teléfono debe ser internacional: + y al menos 8 dígitos';
    end if;
    v_digitos := regexp_replace(v_tel, '\D', '', 'g');

    -- Choque con otra persona. Robar el número en silencio significaría que
    -- el hilo de WhatsApp de una cliente empieza a caer en la ficha de otra.
    select nombre into v_choque from public.personas
     where id <> v_p.id
       and regexp_replace(coalesce(telefono_e164,''), '\D', '', 'g') = v_digitos
     limit 1;
    if v_choque is not null then
      raise exception 'Ese número ya es de %', v_choque;
    end if;
  end if;

  update public.personas
     set nombre        = coalesce(v_nombre, nombre),
         telefono_e164 = coalesce(v_tel,    telefono_e164),
         email         = coalesce(v_email,  email),
         pais          = coalesce(v_pais,   pais),
         coach_id      = coalesce(v_coach,  coach_id),
         estado        = coalesce(v_estado, estado)
   where id = v_p.id;

  -- Adopción del hilo huérfano. El caso que lo motiva es literalmente el de
  -- Nombre Ejemplo: le pones el número, le escribes, contesta — y sin esto la
  -- conversación queda suelta en vez de caer en su ficha.
  --
  -- OJO al formato: `wa_conversaciones.telefono_e164` guarda SOLO DÍGITOS
  -- desde la migración 0020, mientras `personas.telefono_e164` guarda E.164
  -- con "+". Cruzarlos por igualdad directa no encuentra nunca nada.
  --
  -- Solo hilos SIN persona: uno que ya pertenece a otra ficha no se toca.
  if v_tel is not null then
    update public.wa_conversaciones
       set persona_id = v_p.id
     where persona_id is null
       and regexp_replace(coalesce(telefono_e164,''), '\D', '', 'g') = v_digitos
    returning id into v_adoptada;
  end if;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('persona', v_p.id,
          case when v_estado = 'archivado' and v_p.estado <> 'archivado'
               then 'archivado' else 'edicion' end,
          v_autor,
          jsonb_build_object(
            'antes', jsonb_build_object(
              'nombre', v_p.nombre, 'telefono_e164', v_p.telefono_e164,
              'email', v_p.email, 'pais', v_p.pais,
              'coach_id', v_p.coach_id, 'estado', v_p.estado),
            'despues', jsonb_build_object(
              'nombre', coalesce(v_nombre, v_p.nombre),
              'telefono_e164', coalesce(v_tel, v_p.telefono_e164),
              'email', coalesce(v_email, v_p.email),
              'pais', coalesce(v_pais, v_p.pais),
              'coach_id', coalesce(v_coach, v_p.coach_id),
              'estado', coalesce(v_estado, v_p.estado)),
            'conversacion_adoptada', v_adoptada));

  return jsonb_build_object(
    'persona_id', v_p.id,
    'conversacion_adoptada', v_adoptada);
end;
$$;

revoke all on function public.editar_persona(jsonb) from public, anon, authenticated;
grant execute on function public.editar_persona(jsonb) to service_role;

commit;
