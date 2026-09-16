// ============================================================
// Envío de una plantilla de WhatsApp aprobada, vía Kapso (Meta proxy). NO
// valida la ventana de 24h (las plantillas existen justo para reabrir
// conversación fuera de esa ventana). Tras el envío exitoso registra el
// saliente atribuido en wa_mensajes.
//
// Compartida por dos llamantes:
//   · POST /api/inbox/send-template — el PlantillaPicker del inbox, envío
//     manual con plantilla e idioma elegidos por el equipo.
//   · enviarBienvenida (app/actions.ts) — server action, sin pasar por red:
//     llamar por HTTP a la propia app desde una server action es frágil
//     (URL absoluta, reenviar cookie de sesión a mano, salto de red
//     innecesario dentro del mismo proceso).
// ============================================================
import { rest } from "@/lib/supabase";
import { interpretarErrorEnvio } from "@/lib/envio-error";
import { soloDigitos, variantesE164 } from "@/lib/telefono";
import { idMensajeIncierto } from "@/lib/sesiones";
import { estadoWa } from "@/lib/wa-estado";

const API_KEY = process.env.KAPSO_API_KEY ?? "";
// Sin valor por defecto A PROPÓSITO. Hasta el 2-sep-2026 esto caía a
// "597907523413541", el SANDBOX DE KAPSO, que además es el mismo sandbox del
// proyecto de otro cliente. Si faltaba la env var, las plantillas de
// MetaCrypto salían por un número de otra empresa sin un solo error visible.
const PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID ?? "";
const VERSION = process.env.META_GRAPH_VERSION ?? "v24.0";
const META_BASE = process.env.KAPSO_META_BASE ?? "https://api.kapso.ai/meta/whatsapp";

// `incierto` distingue "no llegué a llamar a Kapso" (guard local: falta la
// API key, faltan parámetros — con certeza no salió nada) de "llamé y Kapso
// contestó con un 5xx" (el WhatsApp puede haber salido igual, ver el
// incidente del 6-ago). Un `status` numérico no basta: un guard local puede
// usar cualquier código (501 aquí, y nada impide que uno futuro use otro
// número ≥ 500) sin que eso signifique que hubo una llamada real. Quien
// consume el resultado (`enviarYCubrirIncierto` en route.ts,
// `enviarBienvenida` en actions.ts) debe mirar `incierto`, no `status`, para
// decidir si el envío pudo haber salido.
//
// `registrado` (solo cuando `ok`) dice si la fila del saliente quedó escrita en
// `wa_mensajes`. NO es un detalle cosmético: el antiduplicados del cron
// (`yaSeEnvio` en la ruta de sesiones) pregunta al registro de mensajes, así
// que un `ok:true` sin fila es un WhatsApp que salió de verdad y que la
// siguiente pasada (5 min después) volvería a mandar — hasta 7 veces el
// recordatorio y hasta 12 la confirmación. Hay cuatro caminos por los que el
// envío sale y el registro no: Kapso responde 200 sin `messages[0].id`,
// `resolverOCrearConversacion` no devuelve conversación, el POST a
// `wa_mensajes` responde ≥300, o `rest()` lanza (hace `JSON.parse` sin
// proteger y Kapso/Supabase pueden devolver HTML). Quien envía desde un bucle
// automático debe mirar este campo y, si es `false`, dejar constancia con
// `registrarEnvioIncierto` — que usa un id sintético estable y no necesita el
// wamid.
export type EnvioPlantillaResult =
  | { ok: true; registrado: boolean }
  | { ok: false; error: string; status: number; incierto: boolean };

// Busca la persona dueña de este teléfono probando las dos variantes de
// formato — Kapso manda dígitos, `personas` guarda E.164 con "+" — mismo
// patrón que `derivePersona()` en wa-ingest. Se reutiliza tanto al crear una
// conversación nueva como al rellenar el persona_id de una ya existente.
async function resolverPersonaPorTelefono(
  waId: string,
): Promise<{ id: string; coach_id: string | null } | undefined> {
  const variantes = variantesE164(waId);
  const filtro = variantes.map((v) => `telefono_e164.eq.${encodeURIComponent(v)}`).join(",");
  const per = filtro
    ? await rest<{ id: string; coach_id: string | null }[]>(
        "GET",
        `personas?or=(${filtro})&select=id,coach_id&limit=1`,
      )
    : { status: 200, json: [] as { id: string; coach_id: string | null }[] | null };
  if (per.status >= 300) {
    console.error("[send-template] fallo al buscar persona por teléfono", per.status, per.json);
  }
  return Array.isArray(per.json) ? per.json[0] : undefined;
}

// Encuentra la conversación de este teléfono o la crea — factorizado del
// bloque que antes vivía inline en `enviarPlantilla` para que también lo
// use `registrarEnvioIncierto` sin duplicar la resolución de conversación
// (mismo backfill de persona, mismos logs).
async function resolverOCrearConversacion(waId: string): Promise<string | undefined> {
  const conv = await rest<{ id: string; persona_id: string | null }[]>(
    "GET",
    `wa_conversaciones?telefono_e164=eq.${encodeURIComponent(waId)}&select=id,persona_id&limit=1`,
  );
  if (conv.status >= 300) {
    console.error("[send-template] fallo al buscar conversación", conv.status, conv.json);
  }
  const existente = Array.isArray(conv.json) ? conv.json[0] : undefined;
  let convId: string | undefined = existente?.id;
  if (!convId) {
    // Antes de crear el hilo, buscamos si el teléfono ya pertenece a una
    // persona conocida. Sin esto la conversación queda sin persona_id y
    // v_timeline_cliente nunca muestra el evento de plantilla en la ficha
    // del cliente (exige persona_id is not null).
    const persona = await resolverPersonaPorTelefono(waId);
    const creada = await rest(
      "POST",
      "wa_conversaciones?on_conflict=telefono_e164&select=id",
      {
        telefono_e164: waId,
        persona_id: persona?.id ?? null,
        coach_asignado: persona?.coach_id ?? null,
        estado_atencion: "pendiente",
        ultimo_mensaje_at: new Date().toISOString(),
      },
      "resolution=merge-duplicates,return=representation",
    );
    convId = Array.isArray(creada.json) ? creada.json[0]?.id : undefined;
    // PostgREST no lanza en fallos HTTP (`rest()` solo lanza si el fetch
    // en sí falla): si no comprobamos el status a mano, un insert que
    // falla de verdad deja `convId` undefined, el mensaje se salta y este
    // catch externo no se entera porque no hubo excepción — cero rastro.
    if (creada.status >= 300 || !convId) {
      console.error("[send-template] fallo al crear/upsert conversación", creada.status, creada.json);
    }
  } else if (existente?.persona_id == null) {
    // El hilo ya existía pero sin persona vinculada — el caso del lead que
    // escribe por WhatsApp ANTES de comprar: wa-ingest crea la
    // conversación, no encuentra persona porque aún no existía, y solo
    // re-vincula cuando el cliente vuelve a escribir. Sin este backfill,
    // la bienvenida se registra igual pero nunca aparece en la ficha del
    // cliente (v_timeline_cliente exige persona_id is not null). Se
    // resuelve igual que al crear y se actualiza con un PATCH; si no se
    // encuentra persona, o el PATCH falla, no se bloquea ni el envío
    // (ya salió) ni el registro del mensaje — solo se pierde la
    // vinculación, recuperable la próxima vez que se resuelva. No se toca
    // `coach_asignado`: a diferencia de una conversación nueva, esta ya
    // puede tener uno asignado a mano y no hay que pisarlo.
    const persona = await resolverPersonaPorTelefono(waId);
    if (persona?.id) {
      const patch = await rest(
        "PATCH",
        `wa_conversaciones?id=eq.${convId}`,
        { persona_id: persona.id },
        "return=minimal",
      );
      if (patch.status >= 300) {
        console.error(
          "[send-template] fallo al vincular persona a conversación existente",
          patch.status,
          patch.json,
        );
      }
    }
  }
  return convId;
}

export async function enviarPlantilla(args: {
  to: string; // teléfono en cualquier formato; la función normaliza
  name: string;
  language: string;
  variables?: Record<string, string>;
  bodyResuelto?: string;
  autor: string; // id de team_member, o "equipo"
  sesionId?: string; // si el envío pertenece a una sesión, para deduplicar por ella
}): Promise<EnvioPlantillaResult> {
  if (!API_KEY) {
    // Guard local: no se llegó a llamar a Kapso, así que con certeza no
    // salió nada. `incierto: false` a propósito — aunque el status (501)
    // caiga en el rango ≥500 que normalmente significa "5xx de Kapso",
    // aquí no lo es.
    return {
      ok: false,
      error: "Falta KAPSO_API_KEY en las env vars de Vercel.",
      status: 501,
      incierto: false,
    };
  }

  // Mismo guard local que la API key, y por el mismo motivo: no se llega a
  // llamar a Kapso, así que con certeza no salió nada (`incierto: false`).
  if (!PHONE_NUMBER_ID) {
    return {
      ok: false,
      error: "Falta KAPSO_PHONE_NUMBER_ID en las env vars de Vercel.",
      status: 501,
      incierto: false,
    };
  }

  // Canal caído (WABA baneada, incidente del 2-sep-2026). Tercer guard local
  // y por el mismo motivo que los dos de arriba: no se llama a Kapso, así que
  // con certeza no sale nada → `incierto: false`.
  //
  // Va AQUÍ, antes del fetch, y no en la UI: por esta función pasan también
  // los dos crons de `vercel.json` (`/api/sesiones/sync` y
  // `/api/sesiones/recurrentes`), que no ven ninguna pantalla y dispararían
  // cada 5 minutos contra un canal muerto.
  //
  // El 503 cae en el rango ≥500, pero NO es un 5xx de Kapso: quien decida si
  // el mensaje pudo salir debe mirar `incierto`, nunca `status` (ver el
  // contrato al principio del fichero).
  const wa = estadoWa();
  if (wa.bloqueado) {
    return { ok: false, error: wa.motivo, status: 503, incierto: false };
  }

  const { to, name, language, variables, bodyResuelto, autor, sesionId } = args;
  if (!to || !name || !language) {
    // Mismo caso: guard local antes de cualquier llamada de red.
    return {
      ok: false,
      error: "Faltan destinatario, nombre de plantilla o idioma.",
      status: 400,
      incierto: false,
    };
  }

  const paramEntries = Object.entries(variables ?? {});
  const components = paramEntries.length
    ? [
        {
          type: "body",
          parameters: paramEntries.map(([parameter_name, text]) => ({
            type: "text",
            parameter_name,
            text: String(text),
          })),
        },
      ]
    : [];
  const waId = soloDigitos(to); // wa_id = solo dígitos
  const kbody = {
    messaging_product: "whatsapp",
    to: waId,
    type: "template",
    template: { name, language: { code: language }, ...(components.length ? { components } : {}) },
  };

  const url = `${META_BASE}/${VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(kbody),
  });
  // Leemos el cuerpo como texto: cuando Kapso se cae devuelve HTML, no JSON, y
  // con res.json() ese detalle se perdía (quedaba `null` en el log).
  const bruto = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = bruto ? JSON.parse(bruto) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const { mensaje, crudo } = interpretarErrorEnvio(res.status, bruto);
    console.error("[send-template] kapso send failed", res.status, name, crudo);
    // El status que se propaga es el de Kapso/Meta, no un 502 fijo: quien
    // llama (enviarBienvenida) necesita distinguir un 5xx transitorio de
    // Kapso (mensaje puede haber salido igual) de un 4xx de Meta (rechazo
    // seguro, nada salió) — con un valor fijo esa distinción es imposible.
    // Aquí sí hubo una llamada real a Kapso, así que `incierto` se deriva
    // del status de su respuesta HTTP.
    return { ok: false, error: mensaje, status: res.status, incierto: res.status >= 500 };
  }

  // Arranca en `false` y solo pasa a `true` con la fila escrita y confirmada.
  // Todo lo que pueda salir mal a partir de aquí (incluida una excepción de
  // `rest()`) deja el envío como "salió pero no consta", que es justo lo que
  // el llamante necesita saber.
  let registrado = false;
  try {
    const wamid = data?.messages?.[0]?.id;
    if (!wamid) {
      // 200 sin id de mensaje: Kapso aceptó pero no hay wamid con el que
      // registrar. Antes esto era un `else` mudo dentro del `if`.
      console.error("[send-template] Kapso respondió 200 sin id de mensaje", name, waId, bruto.slice(0, 300));
    }
    // El cliente puede no tener conversación: una venta cerrada por llamada
    // llega aquí sin chat previo, y antes el envío se perdía sin registrar.
    // `telefono_e164` (solo dígitos) es la clave única del hilo desde 0020,
    // así que basta un upsert por esa clave.
    const convId = await resolverOCrearConversacion(waId);
    if (wamid && convId) {
      const msg = await rest(
        "POST",
        "wa_mensajes?on_conflict=kapso_message_id",
        {
          conversacion_id: convId,
          kapso_message_id: wamid,
          direction: "out",
          autor,
          tipo: "template",
          plantilla_nombre: name,
          body: bodyResuelto ?? name,
          status: "sent",
          sent_at: new Date().toISOString(),
          sesion_id: sesionId ?? null,
        },
        "resolution=merge-duplicates,return=minimal",
      );
      if (msg.status >= 300) {
        console.error("[send-template] fallo al registrar el mensaje saliente", msg.status, msg.json);
      } else {
        registrado = true;
      }
    } else if (wamid && !convId) {
      // El WhatsApp salió (con su coste) pero no hay conversación donde
      // colgarlo: dejamos rastro explícito en logs para no perderlo en
      // silencio.
      console.error("[send-template] envío realizado sin conversación: mensaje no registrado", wamid, waId);
    }
  } catch (e) {
    console.error("[send-template] no se pudo registrar saliente", e);
  }

  return { ok: true, registrado };
}

// Cuando Kapso devuelve 5xx no sabemos si el WhatsApp salió o no — mismo caso
// que el incidente del 6-ago (ver el comentario en app/actions.ts sobre el
// Postgres de Kapso en solo lectura: devolvió 500 después de que el mensaje
// SÍ hubiera llegado a Meta). En un envío manual hay un humano leyendo el
// aviso antes de decidir si reintentar; en un cron no hay nadie. Registrar el
// intento en `wa_mensajes` con un `kapso_message_id` sintético y estable
// (`idMensajeIncierto`, en lib/sesiones.ts) hace que el antiduplicados
// (`yaSeEnvio` en route.ts) vea "ya hubo un intento" y no reenvíe el mismo
// WhatsApp real en la próxima pasada — el registro de mensajes es la verdad,
// no una bandera aparte que pueda desincronizarse. El id es estable por
// (sesión, plantilla): si esta misma función se llama otra vez para el mismo
// intento incierto (p. ej. porque el propio registro falló y la pasada
// siguiente lo reintenta), el upsert por `on_conflict=kapso_message_id`
// no duplica la fila.
//
// Devuelve si quedó constancia: el llamante (un cron, sin humano delante) lo
// necesita para contarlo como fallo — un incierto sin registrar es el único
// caso que sigue pudiendo reenviar. Nunca lanza: se llama después de que el
// WhatsApp haya salido y una excepción aquí abortaría el resto de la pasada
// (`rest()` hace `JSON.parse` sin proteger).
// `porTelefono` lo pasa SOLO el cron de sesiones grupales: ahí la misma
// (sesión, plantilla) sale a ~98 teléfonos y, sin el teléfono en la clave, el
// segundo incierto pisaría la fila del primero vía el upsert por
// `on_conflict=kapso_message_id` — y a ese primero se le reenviaría. El flujo
// 1-a-1 lo omite para que sus inciertos ya registrados sigan casando.
export async function registrarEnvioIncierto(args: {
  to: string;
  name: string;
  sesionId: string;
  porTelefono?: boolean;
}): Promise<boolean> {
  try {
    return await registrarIncierto(args);
  } catch (e) {
    console.error("[plantillas] excepción al registrar el envío incierto", args.name, args.sesionId, e);
    return false;
  }
}

async function registrarIncierto(args: {
  to: string;
  name: string;
  sesionId: string;
  porTelefono?: boolean;
}): Promise<boolean> {
  const { to, name, sesionId, porTelefono } = args;
  const waId = soloDigitos(to);
  const convId = await resolverOCrearConversacion(waId);
  if (!convId) {
    // Sin conversación no hay dónde colgar el registro. No es ideal, pero
    // tampoco es peor que el resto del archivo: mismo patrón que el "envío
    // realizado sin conversación" de arriba — se deja rastro en logs y se
    // sigue. El antiduplicados en este caso concreto no queda cubierto (la
    // próxima pasada podría reintentar), pero es el mismo escenario límite,
    // no uno nuevo.
    console.error(
      "[plantillas] no se pudo registrar el envío incierto: sin conversación",
      to,
      name,
      sesionId,
    );
    return false;
  }
  const msg = await rest(
    "POST",
    "wa_mensajes?on_conflict=kapso_message_id",
    {
      conversacion_id: convId,
      kapso_message_id: idMensajeIncierto(sesionId, name, porTelefono ? waId : undefined),
      direction: "out",
      autor: "equipo",
      tipo: "template",
      plantilla_nombre: name,
      body: name,
      status: "incierto",
      sent_at: new Date().toISOString(),
      sesion_id: sesionId,
    },
    "resolution=merge-duplicates,return=minimal",
  );
  if (msg.status >= 300) {
    console.error("[plantillas] fallo al registrar el envío incierto", msg.status, msg.json, name, sesionId);
    return false;
  }
  return true;
}
