-- ============================================================
-- 0063 — "coach" pasa a "consultor" en los DOS mensajes que se leen en pantalla.
--
-- Berni, en CAMBIOS OS (6-sep): «cambiar Coach por consultor, aquí y en
-- cualquier parte que aparezca la palabra coach».
--
-- Casi todo eso ya se hizo en la capa de la app. Quedaban dos frases metidas
-- dentro de funciones de Postgres, y son de las que engañan: parecen errores
-- técnicos de la base, pero `mensajeRpc` (app/actions.ts:52) devuelve el
-- mensaje TAL CUAL salvo que sea un error técnico en inglés. Así que estas dos
-- llegan enteras a la pantalla:
--
--   registrar_sesion → "Falta el coach"            (al registrar una consultoría)
--   editar_persona   → "El coach indicado no existe" (al editar la ficha)
--
-- 🔴 POR QUÉ ESTE FICHERO REPITE LAS FUNCIONES ENTERAS. No se edita la
-- migración donde nacieron: 0037 y 0039 ya están aplicadas, y editar una
-- migración corrida no cambia nada en la base — solo hace que el repo mienta
-- sobre lo que hay en producción.
--
-- 🔴 Y POR QUÉ SE COPIAN DE LA BASE Y NO DE 0037/0039: `editar_persona` se ha
-- redefinido tres veces desde entonces (0050, 0052 y 0059). Partir de la
-- versión de 0039 habría revertido en silencio todo lo que esas tres añadieron.
-- El cuerpo de aquí sale de `pg_get_functiondef` contra producción el
-- 11-sep-2026, y se comprobó que entre el original y esta copia cambia
-- EXACTAMENTE UNA LÍNEA en cada función: la del mensaje. Nada más.
--
-- Lo que NO se toca, y conviene que siga sin tocarse: la variable `v_coach`,
-- la clave `payload->>'coach_id'`, la columna `coach_id` y el valor `'coach'`
-- de `team_members.rol`. Son identificadores: de ellos cuelgan las comisiones,
-- el selector de consultor al vender y la clasificación de llamadas de Fathom.
-- La palabra se traduce al PINTAR (ver `etiquetaRolEquipo` en lib/persona.ts).
-- ============================================================
begin;

CREATE OR REPLACE FUNCTION public.registrar_sesion(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_persona   uuid := nullif(payload->>'persona_id','')::uuid;
  v_coach     uuid := nullif(payload->>'coach_id','')::uuid;
  v_fecha     timestamptz := (payload->>'fecha')::timestamptz;
  v_estado    text := nullif(payload->>'estado_asistencia','');
  v_autor     uuid := nullif(payload->>'autor_id','')::uuid;
  v_sesion_id uuid;
  v_n_ops     int;
  v_numero    int;
begin
  if v_persona is null then raise exception 'Falta el cliente'; end if;
  if not exists (select 1 from public.personas where id = v_persona) then
    raise exception 'Ese cliente no existe';
  end if;
  if v_coach is null then raise exception 'Falta el consultor'; end if;
  if v_fecha is null then raise exception 'Falta la fecha de la sesión'; end if;

  -- No se puede haber asistido a algo que todavía no ha pasado. Se deja
  -- registrar la sesión futura (viene de GHL o se adelanta el registro), pero
  -- sin marcarla como hecha.
  if v_estado = 'asistio' and v_fecha > now() then
    raise exception 'No se puede marcar como asistida una sesión que aún no ha ocurrido';
  end if;

  -- Anti doble-submit acotado a esta persona y esta fecha: protege del doble
  -- clic sin bloquear el caso legítimo de registrar dos sesiones del mismo
  -- cliente en días distintos seguidos.
  if exists (
    select 1 from public.sesiones
     where persona_id = v_persona
       and fecha = v_fecha
       and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'sesión duplicada: ya se registró esa misma sesión hace menos de 2 minutos';
  end if;

  insert into public.sesiones
    (persona_id, coach_id, tipo, fecha, estado_asistencia, notas, url_grabacion,
     duracion_min, capital_total, exchange, proximo_paso)
  values
    (v_persona, v_coach,
     coalesce(nullif(payload->>'tipo',''), 'consultoria_1a1'),
     v_fecha, v_estado,
     nullif(payload->>'notas',''),
     nullif(payload->>'url_grabacion',''),
     nullif(payload->>'duracion_min','')::int,
     nullif(payload->>'capital_total','')::numeric,
     nullif(payload->>'exchange',''),
     nullif(payload->>'proximo_paso',''))
  returning id into v_sesion_id;

  v_n_ops := public.sesion_guardar_operaciones(v_sesion_id, payload->'operaciones');

  -- El número no se guarda: se lee de la vista, que lo deriva. Se devuelve para
  -- que la confirmación de la UI pueda decir "ha quedado como su Sesión 3".
  select numero into v_numero from public.v_sesiones_cliente where id = v_sesion_id;

  insert into public.auditoria (entidad, entidad_id, accion, autor_id, datos)
  values ('sesion', v_sesion_id, 'alta', v_autor,
          jsonb_build_object(
            'antes',   null,
            'despues', jsonb_build_object(
                         'persona_id', v_persona, 'coach_id', v_coach,
                         'fecha', v_fecha, 'estado_asistencia', v_estado,
                         'numero', v_numero),
            'operaciones', v_n_ops));

  return jsonb_build_object('sesion_id', v_sesion_id, 'numero', v_numero,
                            'operaciones', v_n_ops);
end;
$function$;

CREATE OR REPLACE FUNCTION public.editar_persona(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'El consultor indicado no existe';
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
$function$;

commit;
