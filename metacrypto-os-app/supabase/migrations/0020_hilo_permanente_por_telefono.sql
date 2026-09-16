-- ============================================================
-- 0020 — La conversación se identifica por el TELÉFONO, no por la sesión de Kapso.
--
-- Problema: `kapso_conversation_id` refleja la sesión de 24 h de Meta, que es
-- efímera. Al ser la clave del hilo (UNIQUE), cada vez que un cliente volvía a
-- escribir tras un silencio largo se creaba una conversación NUEVA: historial
-- partido y `estado_atencion` (el ticket) reseteado. El diseño pedía un hilo
-- permanente por persona.
--
-- Solución: UNIQUE sobre `telefono_e164` normalizado a solo dígitos, y
-- `kapso_conversation_id` pasa a ser un atributo mutable (la sesión en curso).
-- ============================================================
begin;

-- 0) Soltar el UNIQUE de la sesión ANTES de mover nada: el superviviente hereda
--    el `kapso_conversation_id` del duplicado, y con el constraint puesto ese
--    UPDATE choca contra la fila que aún no hemos borrado.
alter table wa_conversaciones
  drop constraint wa_conversaciones_kapso_conversation_id_key;

-- 1) Teléfono canónico: solo dígitos, igual que el wa_id que manda Kapso.
update wa_conversaciones
set telefono_e164 = regexp_replace(telefono_e164, '\D', '', 'g')
where telefono_e164 is distinct from regexp_replace(telefono_e164, '\D', '', 'g');

-- 2) Por cada teléfono, elegir el hilo superviviente (el más antiguo: conserva
--    la historia) y qué valores hereda de sus duplicados.
create temporary table _fusion on commit drop as
select
  telefono_e164,
  (array_agg(id order by created_at))[1] as keep_id,
  -- el id de sesión de Kapso vigente es el del hilo más reciente
  (array_agg(kapso_conversation_id order by created_at desc))[1] as kapso_actual,
  max(ultimo_mensaje_at) as ultimo_mensaje_at,
  -- para persona/coach/tier gana el primer valor no nulo
  (array_agg(persona_id     order by (persona_id is null),     created_at))[1] as persona_id,
  (array_agg(coach_asignado order by (coach_asignado is null), created_at))[1] as coach_asignado,
  (array_agg(tier           order by (tier is null),           created_at))[1] as tier,
  -- nunca cerrar un ticket en silencio: si algún hilo estaba pendiente, sigue pendiente
  bool_or(estado_atencion = 'pendiente') as hay_pendiente,
  bool_or(estado = 'active') as hay_activa
from wa_conversaciones
group by telefono_e164;

-- 3) Los mensajes de los duplicados pasan al superviviente.
update wa_mensajes m
set conversacion_id = f.keep_id
from wa_conversaciones c
join _fusion f on f.telefono_e164 = c.telefono_e164
where m.conversacion_id = c.id
  and c.id <> f.keep_id;

-- 4) El superviviente absorbe los valores heredados.
update wa_conversaciones c
set kapso_conversation_id = f.kapso_actual,
    ultimo_mensaje_at     = f.ultimo_mensaje_at,
    persona_id            = f.persona_id,
    coach_asignado        = f.coach_asignado,
    tier                  = f.tier,
    estado_atencion       = case when f.hay_pendiente then 'pendiente' else 'resuelto' end,
    estado                = case when f.hay_activa    then 'active'    else 'ended'    end
from _fusion f
where c.id = f.keep_id;

-- 5) Fuera los duplicados (ya sin mensajes colgando).
delete from wa_conversaciones c
using _fusion f
where c.telefono_e164 = f.telefono_e164
  and c.id <> f.keep_id;

-- 6) Cerrar la nueva identidad del hilo: el teléfono.
alter table wa_conversaciones
  alter column telefono_e164 set not null;

alter table wa_conversaciones
  add constraint wa_conversaciones_telefono_e164_key unique (telefono_e164);

commit;
