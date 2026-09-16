// ============================================================
// GET /api/sesiones/sync — trae las consultorías de GoHighLevel y las espeja
// en `sesiones`. Invocado por Vercel Cron cada 5 minutos.
//
// Idempotente por `ghl_appointment_id`: una pasada repetida actualiza, no
// duplica. Si GHL no responde, la pasada acaba sin tocar nada y la siguiente
// recupera — por eso no hace falta webhook para no perder citas.
//
// Auth: Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
// ============================================================
import { rest, patronLike, type RestResult } from "@/lib/supabase";
import { traerCitas, traerContacto, CALENDARIOS_CONSULTORIA } from "@/lib/ghl";
import {
  citaViva,
  primerNombre,
  coachDeUsuarioGhl,
  estadoDeCita,
  enlaceDeCita,
  horaEnZona,
  nombreDeCoach,
  tocaRecordatorio1h,
  tocaAvisoSinEnlace,
  zonaValida,
} from "@/lib/sesiones";
import { aE164, variantesE164 } from "@/lib/telefono";
import { enviarPlantilla, registrarEnvioIncierto } from "@/lib/plantillas";
import { enviarYRegistrarEmail, yaSeEnvioEmail } from "@/lib/email-envio";
import { emailConfirmacionSesion, emailRecordatorio1h } from "@/lib/email-plantillas";
import { claveSesion } from "@/lib/canales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Acotado a propósito: la pasada es secuencial (por cita: traerContacto +
// hasta 3 GET de cruce + 1 PATCH + 1 upsert), sobre 2 calendarios × ventana
// de 31 días. 60s es generoso para el volumen real de consultorías de MCC,
// y se queda bien por debajo del intervalo del cron (5 min) — si algo se
// degrada aguas arriba, la función corta sola en vez de arrastrarse hasta
// pisar la siguiente invocación. Mismo contrato que "GHL no responde": esta
// pasada se pierde, la de 5 minutos después recupera.
export const maxDuration = 60;

// El envío nace apagado: el sync puede correr y llenarse `sesiones` sin que
// salga un solo WhatsApp, y así se verifica contra datos reales antes de
// exponer a un cliente. Se enciende poniendo SESIONES_ENVIO_ACTIVO=1 en Vercel.
const ENVIO_ACTIVO = process.env.SESIONES_ENVIO_ACTIVO === "1";

// Llave PROPIA para el email, deliberadamente separada de la de WhatsApp.
//
// Una sola llave para los dos canales tiene un modo de fallo concreto y
// probable: con la WABA baneada el cron devuelve error cada 5 minutos,
// alguien apaga la llave para callar la alarma — y apaga con ella el canal
// que se construyó justamente para sobrevivir a ese baneo. Dos llaves
// significan que apagar el canal roto no apaga el que funciona.
const EMAIL_ACTIVO = process.env.SESIONES_EMAIL_ACTIVO === "1";

const DIA = 24 * 3600 * 1000;

// Lo que la pasada devuelve, y que un humano (o un monitor) lee sin bucear en
// los logs de Vercel.
//
// `errores` cuenta FALLOS TÉCNICOS: GHL o Supabase que no responden, una cita
// que revienta, un envío rechazado. Es lo que decide el `ok` de la respuesta.
// Las condiciones de datos que hacen que un mensaje no salga (persona
// ambigua, coach sin mapear, zona horaria no fiable) se loguean pero no
// cuentan aquí: son de otro tipo, no se arreglan reintentando, y meterlas
// dejaría el `ok:false` clavado hasta que alguien limpie la base — un aviso
// permanente es un aviso que se ignora.
//
// `sinEnlace` es la excepción, y tiene contador propio justo por eso: hoy 2
// de las 6 sesiones reales no tienen enlace, y con el envío encendido eso es
// un tercio de los clientes sin recordatorio. Merece verse, pero no es un
// fallo del cron.
type Contadores = {
  citas: number;
  sesiones: number;
  enviados: number;       // WhatsApp
  enviadosEmail: number;
  sinTelefono: number;    // no se pudo avisar por WhatsApp
  sinEmail: number;       // no se pudo avisar por email
  sinEnlace: number;
  errores: number;
};

type FilaPersona = { id: string; email: string | null; telefono_e164: string | null };

// `limit=2`, no `limit=1`: ni `personas.email` ni `personas.ghl_contact_id`
// tienen UNIQUE, así que puede haber dos candidatas de verdad. Con `limit=1`
// (y sin `order`) PostgREST devolvía UNA CUALQUIERA y el PATCH le grababa
// `ghl_contact_id` de forma permanente a la equivocada: a partir de ahí la
// sesión sale en su ficha y el WhatsApp va a su teléfono, sin nada que lo
// delate. Pedir dos es lo que permite DISTINGUIR "una candidata" de "más de
// una" y, en el segundo caso, no cruzar. El `order` fija además qué dos filas
// se miran, para que el resultado no dependa del plan de ejecución.
const SELECCION_CRUCE = "select=id,email,telefono_e164&order=id.asc&limit=2";

// Una sola candidata o ninguna. Un cruce ambiguo se resuelve a mano; aquí lo
// único que se puede hacer bien es no elegir. La sesión queda sin persona
// (visible en el OS) en vez de colgada de la persona equivocada.
function unicaCandidata(
  r: RestResult<FilaPersona[]>,
  via: string,
  clave: string,
  c: Contadores,
): FilaPersona | null {
  if (r.status >= 300) {
    // No distingue "no encontrado" de "Supabase falló": el lado seguro es
    // seguir probando el siguiente método de cruce, pero que quede en el log
    // y en el contador.
    console.error("[sesiones-sync] cruce falló", via, r.status, r.json);
    c.errores++;
    return null;
  }
  const filas = Array.isArray(r.json) ? r.json : [];
  if (filas.length > 1) {
    console.error(
      "[sesiones-sync] cruce AMBIGUO: más de una persona con el mismo dato, no se cruza (resolver a mano)",
      via,
      clave,
      filas.map((f) => f.id).join(","),
    );
    return null;
  }
  return filas[0] ?? null;
}

// Cruce GHL → personas. El email es la llave buena: sobre las citas reales
// cruzó 2 de 3, y el teléfono solo 1 de 3 (un cliente tiene un número distinto
// en cada sistema). Al primer cruce se guarda `ghl_contact_id` para que las
// siguientes pasadas sean directas.
async function cruzarPersona(
  contactId: string,
  email: string | null,
  telefonoE164: string | null,
  c: Contadores,
): Promise<string | null> {
  const em = (email ?? "").trim();

  const porId = await rest<FilaPersona[]>(
    "GET",
    `personas?ghl_contact_id=eq.${encodeURIComponent(contactId)}&${SELECCION_CRUCE}`,
  );
  let persona = unicaCandidata(porId, "ghl_contact_id", contactId, c);

  if (!persona && em) {
    // `ilike` en vez de `eq`: PostgREST compara con `=`, que en Postgres
    // distingue mayúsculas, y el email de GHL lo escribe una persona a mano
    // ("Cliente2.Ejemplo@Gmail.com" contra "cliente2.ejemplo@gmail.com" en el OS). No
    // cruzar no es neutro: `telefonoDestino` cae entonces al teléfono de GHL,
    // que la decisión 3 del diseño declara no fiable — un cliente real tiene
    // un número distinto en cada sistema.
    //
    // El patrón va escapado (`patronLike`) porque en LIKE el `_` es comodín y
    // los emails lo llevan: sin escapar, `juan_perez@x.com` casaría también
    // con `juanXperez@x.com`. Y aun así se confirma en cliente comparando en
    // minúsculas: `ilike` sigue siendo un patrón, no una igualdad, y esta
    // consulta decide a qué número sale un WhatsApp.
    const r = await rest<FilaPersona[]>(
      "GET",
      `personas?email=ilike.${encodeURIComponent(patronLike(em))}&${SELECCION_CRUCE}`,
    );
    const cand = unicaCandidata(r, "email", em, c);
    if (cand && (cand.email ?? "").trim().toLowerCase() === em.toLowerCase()) {
      persona = cand;
    } else if (cand) {
      console.error("[sesiones-sync] el email casó por patrón pero no es el mismo, no se cruza", em, cand.email);
    }
  }
  if (!persona && telefonoE164) {
    const filtro = variantesE164(telefonoE164)
      .map((v) => `telefono_e164.eq.${encodeURIComponent(v)}`)
      .join(",");
    if (filtro) {
      const r = await rest<FilaPersona[]>("GET", `personas?or=(${filtro})&${SELECCION_CRUCE}`);
      persona = unicaCandidata(r, "telefono", telefonoE164, c);
    }
  }
  if (!persona) return null;

  // Un solo PATCH: guarda el id de GHL para que la próxima pasada sea directa,
  // y rellena SOLO los huecos. Nunca pisa un dato que ya tiene el OS — el
  // teléfono del OS es el WhatsApp verificado y el de GHL puede ser otro.
  //
  // El teléfono se escribe ya normalizado por `aE164` (lo hace el llamante):
  // `telefono_e164` es la llave de cruce de medio sistema y guardar ahí el
  // valor crudo de GHL —con espacios, o con "00" en vez de "+"— lo deja como
  // canónico y ningún cruce posterior vuelve a encontrarlo.
  const parche: Record<string, unknown> = { ghl_contact_id: contactId };
  if (!persona.email && em) parche.email = em;
  if (!persona.telefono_e164 && telefonoE164) parche.telefono_e164 = telefonoE164;

  const patch = await rest("PATCH", `personas?id=eq.${persona.id}`, parche, "return=minimal");
  if (patch.status >= 300) {
    // No bloquea: el cruce ya está hecho para esta pasada.
    console.error("[sesiones-sync] no se pudo enriquecer la persona", patch.status, patch.json);
    c.errores++;
  }
  return persona.id;
}

// Manda el teléfono del OS, no el de GHL: un cliente tiene números distintos en
// cada sistema, y el del OS es el WhatsApp verificado (hay mensajes suyos desde
// él). Solo si falta se usa el de GHL.
async function telefonoDestino(
  personaId: string | null,
  deGhl: string | null,
  c: Contadores,
): Promise<string | null> {
  if (personaId) {
    const r = await rest<{ telefono_e164: string | null }[]>(
      "GET",
      `personas?id=eq.${personaId}&select=telefono_e164&limit=1`,
    );
    if (r.status >= 300) {
      console.error("[sesiones-sync] no se pudo leer el teléfono de la persona", personaId, r.status, r.json);
      c.errores++;
    }
    const t = Array.isArray(r.json) ? r.json[0]?.telefono_e164 : null;
    if (t) return t;
  }
  return deGhl;
}

// El email de destino, mismo orden de fiabilidad que el teléfono: primero la
// persona del OS (el dato que el equipo mantiene y que el 3-sep se rellenó
// desde GHL para 26 clientes), y si no, el contacto de GHL.
//
// A diferencia del teléfono, que no tenerlo hoy corta el aviso entero, aquí
// devolver null solo apaga un canal: quien llama decide.
async function emailDestino(
  personaId: string | null,
  deGhl: string | null,
  c: Contadores,
): Promise<string | null> {
  if (personaId) {
    const r = await rest<{ email: string | null }[]>(
      "GET",
      `personas?id=eq.${personaId}&select=email&limit=1`,
    );
    if (r.status >= 300) {
      console.error("[sesiones-sync] no se pudo leer el email de la persona", personaId, r.status, r.json);
      c.errores++;
    }
    const e = Array.isArray(r.json) ? (r.json[0]?.email ?? "").trim() : "";
    if (e) return e;
  }
  return (deGhl ?? "").trim() || null;
}

// El nombre del saludo, por orden de fiabilidad:
//   1. la persona cruzada en el OS — el dato que el equipo mantiene;
//   2. el contacto de GoHighLevel — lo escribió el cliente al reservar, y
//      cubre las 3 de 6 citas reales que hoy no cruzan con ninguna persona;
//   3. el título de la cita — último recurso, porque no siempre es un nombre
//      limpio (una cita de prueba se llamaba "Test De Milo. Gassibetest.");
//   4. nada: `null`.
//
// Antes el paso 2 no existía —`traerContacto` tenía el nombre y lo tiraba— y
// el paso 4 era el literal "hola", que producía "Hola hola,". Devolver `null`
// deja la decisión donde se puede tomar bien: quien llama prefiere no mandar
// nada a mandar un saludo roto (y `{{nombre}}` no admite ir vacío: Meta
// rechaza los parámetros en blanco, así que "no saludar por nombre" y "no
// enviar esta plantilla" son la misma cosa).
async function nombreDePila(
  personaId: string | null,
  deGhl: string | null,
  titulo: string | null,
  c: Contadores,
): Promise<string | null> {
  if (personaId) {
    const r = await rest<{ nombre: string | null }[]>(
      "GET",
      `personas?id=eq.${personaId}&select=nombre&limit=1`,
    );
    if (r.status >= 300) {
      console.error("[sesiones-sync] no se pudo leer el nombre de la persona", personaId, r.status, r.json);
      c.errores++;
    }
    const n = Array.isArray(r.json) ? primerNombre(r.json[0]?.nombre) : null;
    if (n) return n;
  }
  return primerNombre(deGhl) ?? primerNombre(titulo);
}

function fechaEnZona(iso: string, zona: string | null): string {
  for (const tz of [zona, "Europe/Madrid"]) {
    if (!tz) continue;
    try {
      return new Intl.DateTimeFormat("es-ES", {
        timeZone: tz,
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso));
    } catch {
      // Zona inválida: probamos la siguiente.
    }
  }
  return "";
}

// El antiduplicados sale del REGISTRO DE MENSAJES, no de una bandera en la
// sesión. Una bandera puede mentir: si el envío sale y el registro falla,
// diría "pendiente" de algo que el cliente ya recibió, invitando a un reenvío
// real. Un mensaje registrado es la prueba de que se envió.
async function yaSeEnvio(sesionId: string, plantilla: string, c: Contadores): Promise<boolean> {
  const r = await rest<{ id: string }[]>(
    "GET",
    `wa_mensajes?sesion_id=eq.${sesionId}&plantilla_nombre=eq.${plantilla}&select=id&limit=1`,
  );
  if (r.status >= 300) {
    // Ante la duda, NO enviar: un falso "ya enviado" cuesta un recordatorio;
    // un falso "no enviado" cuesta un mensaje duplicado a un cliente.
    console.error("[sesiones-sync] no se pudo comprobar duplicados", r.status, r.json);
    c.errores++;
    return true;
  }
  return Array.isArray(r.json) && r.json.length > 0;
}

// Envía una plantilla y cubre los DOS casos en que el WhatsApp puede haber
// salido sin que quede constancia en `wa_mensajes`:
//
//   1. Kapso responde 5xx (incidente real del 6-ago: su Postgres en solo
//      lectura devolvió 500 con el mensaje ya entregado a Meta).
//   2. Kapso responde 200 pero el registro falla — sin `messages[0].id`, sin
//      conversación donde colgarlo, con un ≥300 del POST a `wa_mensajes` o
//      con una excepción de `rest()`. `enviarPlantilla` lo dice con
//      `registrado:false`.
//
// Los dos importan por lo mismo: `yaSeEnvio` pregunta al registro de
// mensajes, así que sin fila seguiría viendo "no enviado" y el cron (cada 5
// min) reenviaría el mismo WhatsApp real en cada pasada dentro de la ventana
// — hasta 7 veces el recordatorio (45-75 min), hasta 12 la confirmación (60
// min desde `dateAdded`). Se registra con `registrarEnvioIncierto`, que usa
// un id sintético estable por (sesión, plantilla) y por eso no necesita el
// wamid que precisamente falta en el caso 2.
//
// Se mira `env.incierto`, NUNCA `env.status >= 500`: `enviarPlantilla` tiene
// guards locales (falta `KAPSO_API_KEY`) que devuelven un status ≥500 (501)
// sin haber llamado a Kapso — ahí consta con certeza que no salió nada. Si
// esto se tratara como "incierto", quedaría registrado en `wa_mensajes` y
// `yaSeEnvio` suprimiría esa confirmación/recordatorio para siempre, aunque
// la variable de entorno se arreglara cinco minutos después — el fallo
// contrario al que este mismo arreglo evita, y en silencio.
async function enviarYCubrirIncierto(
  args: Parameters<typeof enviarPlantilla>[0],
  c: Contadores,
): Promise<boolean> {
  const env = await enviarPlantilla(args);
  if (env.ok) {
    if (!env.registrado && args.sesionId) {
      // El mensaje salió con su coste y su ruido para el cliente, pero no
      // consta. Sin esta línea el antiduplicados no lo ve y la pasada
      // siguiente lo manda otra vez.
      console.error(
        "[sesiones-sync] envío realizado pero NO registrado; se marca como incierto para no reenviarlo",
        args.name,
        args.sesionId,
      );
      c.errores++;
      await registrarEnvioIncierto({ to: args.to, name: args.name, sesionId: args.sesionId });
    }
    return true;
  }
  c.errores++;
  if (env.incierto && args.sesionId) {
    console.error(
      "[sesiones-sync] envío con resultado incierto (5xx de Kapso); el WhatsApp puede haber salido igual. Registrando para no reintentar.",
      args.name,
      args.sesionId,
      env.status,
      env.error,
    );
    await registrarEnvioIncierto({ to: args.to, name: args.name, sesionId: args.sesionId });
  } else {
    console.error("[sesiones-sync] envío rechazado", args.name, args.sesionId, env.status, env.error);
  }
  return false;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("no", { status: 401 });
  }

  const ahora = new Date();
  const desde = new Date(ahora.getTime() - DIA);
  const hasta = new Date(ahora.getTime() + 30 * DIA);

  const c: Contadores = {
    citas: 0, sesiones: 0, enviados: 0, enviadosEmail: 0,
    sinTelefono: 0, sinEmail: 0, sinEnlace: 0, errores: 0,
  };

  for (const calendarId of CALENDARIOS_CONSULTORIA) {
    // Aislado por calendario: un error de red (timeout, DNS) leyendo el
    // calendario de Berni no debe abortar también el de Manuel en la misma
    // pasada. Si falla, esta pasada se queda sin ese calendario y la
    // siguiente (5 min después) lo reintenta — mismo contrato que "GHL no
    // responde" a nivel de pasada completa, pero ahora por calendario.
    try {
      for (const cita of await traerCitas(calendarId, desde, hasta)) {
        // `citas++` DESPUÉS del descarte: antes contaba también las que se
        // tiraban aquí mismo, así que el número de la respuesta decía
        // "procesadas" cuando en realidad era "vistas". Una cita sin id o sin
        // hora no es una cita procesable — y que GHL devuelva una es
        // anómalo, así que se cuenta como error en vez de desaparecer.
        if (!cita.id || !cita.startTime) {
          console.error("[sesiones-sync] cita descartada: sin id o sin hora", cita.id, cita.startTime);
          c.errores++;
          continue;
        }
        c.citas++;

        // Aislado por cita, además del try/catch de calendario: `rest()`
        // hace JSON.parse sin proteger (un 502 de gateway o un body no-JSON
        // lanza) y `new Date(...).toISOString()` lanza RangeError con una
        // fecha inválida. Si la causa es la cita en sí, el fallo es
        // determinista — sin este catch, esa cita mataría a todas las que
        // van detrás en el mismo calendario, en cada pasada, para siempre.
        try {
          // Un fallo leyendo el contacto (403 por token caducado, 429, 5xx)
          // NO tumba la cita: la sesión se sincroniza igual, solo se queda
          // sin cruzar y sin zona horaria — y con la zona ausente el envío se
          // salta solo más abajo. Pero se cuenta, que es justo lo que antes
          // no pasaba.
          let contacto: Awaited<ReturnType<typeof traerContacto>> = null;
          if (cita.contactId) {
            try {
              contacto = await traerContacto(cita.contactId);
            } catch (err) {
              console.error("[sesiones-sync] no se pudo leer el contacto", cita.contactId, err);
              c.errores++;
            }
          }
          // Normalizado UNA vez y usado en los tres sitios donde importa:
          // buscar la persona, rellenar `personas.telefono_e164` si estaba
          // vacío, y —si no hay teléfono en el OS— mandar el WhatsApp. GHL
          // devuelve el número tal cual lo tecleó quien creó el contacto.
          const telefonoGhl = aE164(contacto?.telefono ?? null);
          const personaId = cita.contactId
            ? await cruzarPersona(cita.contactId, contacto?.email ?? null, telefonoGhl, c)
            : null;

          const fechaIso = new Date(cita.startTime).toISOString();
          const enlace = enlaceDeCita(cita.address);
          const estado = estadoDeCita(cita.appointmentStatus);

          // persona_id y coach_id NO van en el payload cuando son null: en
          // el upsert (`merge-duplicates`), una clave ausente no se toca en
          // el DO UPDATE. Si los mandáramos como null, un fallo transitorio
          // en cruzarPersona (o un assignedUserId sin mapear en
          // coachDeUsuarioGhl) pisaría con null un dato ya bueno que la
          // sesión tuviera de una pasada anterior o de un cruce manual.
          // fecha/enlace/estado sí se pisan siempre: esos tres los decide
          // GoHighLevel, no el OS.
          const fila: Record<string, unknown> = {
            ghl_appointment_id: cita.id,
            fecha: fechaIso,
            enlace,
            estado,
            tipo: "consultoria_1a1",
          };
          const coachId = coachDeUsuarioGhl(cita.assignedUserId);
          if (coachId) fila.coach_id = coachId;
          if (personaId) fila.persona_id = personaId;

          const up = await rest<{ id: string }[]>(
            "POST",
            "sesiones?on_conflict=ghl_appointment_id",
            fila,
            "resolution=merge-duplicates,return=representation",
          );
          if (up.status >= 300) {
            console.error("[sesiones-sync] upsert falló", cita.id, up.status, up.json);
            c.errores++;
            continue;
          }
          // `sesiones++` solo con el id en la mano: antes se contaba la
          // sesión y dos líneas después podía no haber `sesionId`, así que la
          // respuesta decía "6 sesiones" mientras ninguna había recibido
          // nada. Sin id no hay sesión con la que deduplicar ni a la que
          // colgar el mensaje: es un fallo, no un éxito.
          const sesionId = Array.isArray(up.json) ? up.json[0]?.id : undefined;
          if (!sesionId) {
            console.error("[sesiones-sync] upsert sin id de vuelta", cita.id, up.status, up.json);
            c.errores++;
            continue;
          }
          c.sesiones++;

          // Detector, no parche. La causa raíz (cuentas de GHL sin Google
          // conectado y un calendario con la ubicación en `custom`) se arregló el
          // 10-ago. Pero ese fallo estuvo activo 13 días y se descubrió un minuto
          // después de empezar una sesión: si vuelve, que se sepa en 2 horas.
          // Funciona aunque el envío esté apagado — es solo un log, no un WhatsApp.
          // Se cuenta además de loguearse: un `console.error` vive en los
          // logs de Vercel, donde hay que ir a buscarlo sabiendo ya que pasa
          // algo. Con el contador en la respuesta del cron, un humano o un
          // monitor ve "sinEnlace: 2" sin bucear. No se manda WhatsApp al
          // coach: no hay plantilla aprobada para eso.
          // Solo cuenta si la cita sigue viva: una cancelada no necesita
          // enlace y nunca iba a recibir recordatorio. Contarla llenaría de
          // ruido el único número que sirve para saber cuántos clientes se
          // quedarán sin aviso, y un contador con ruido se deja de mirar.
          if (citaViva(estado) && tocaAvisoSinEnlace(fechaIso, enlace, ahora)) {
            c.sinEnlace++;
            console.error(
              "[sesiones-sync] SESIÓN SIN ENLACE",
              cita.id,
              fechaIso,
              nombreDeCoach(coachId) ?? "desconocido",
              cita.title,
            );
          }

          // Solo se envía a una cita VIVA (lista blanca en `citaViva`). Una
          // cancelada no manda nada, y tampoco un `invalid` ni un estado que
          // GHL invente mañana. Reagendar, para GHL, es una cita NUEVA: entra
          // por este mismo flujo y recibe lo suyo.
          // `citaViva` gobierna los DOS canales: una cita cancelada no
          // manda nada por ningún sitio. Las llaves, en cambio, son por
          // canal — ver el comentario de EMAIL_ACTIVO.
          if (!citaViva(estado)) continue;
          if (!ENVIO_ACTIVO && !EMAIL_ACTIVO) continue;

          // Ninguno de los dos corta ya la iteración. Antes
          // `if (!telefono) continue` mataba el aviso entero, sin log y sin
          // contador, justo para el perfil que el segundo canal existe para
          // cubrir: cliente con email y sin teléfono. Ahora cada canal
          // decide con el dato que necesita.
          const telefono = await telefonoDestino(personaId, telefonoGhl, c);
          const email = await emailDestino(personaId, contacto?.email ?? null, c);
          // Si el usuario de GHL no está mapeado, `coachId` es null y no
          // sabemos de quién es la sesión. No se inventa un nombre: se salta
          // y se registra, porque la plantilla dice "tu sesión con {{coach}}"
          // y un nombre erróneo es peor que ningún mensaje.
          const nombreCoach = nombreDeCoach(coachId);
          if (!nombreCoach) {
            console.error("[sesiones-sync] cita sin coach mapeado", cita.id, cita.assignedUserId);
            continue;
          }
          const nombrePila = await nombreDePila(
            personaId,
            contacto?.nombre ?? null,
            cita.title ?? null,
            c,
          );
          // Sin nombre no se saluda por nombre, y como `{{nombre}}` es
          // obligatorio en las dos plantillas, eso significa no mandar. Mismo
          // criterio que el coach sin mapear: un mensaje mal dirigido o mal
          // escrito es peor que ninguno. Con el contacto de GHL como segunda
          // fuente, llegar hasta aquí exige una cita sin persona, sin nombre
          // en GHL y sin título.
          // Ya NO corta: `{{nombre}}` es obligatorio en las plantillas de
          // Meta (rechaza los parámetros en blanco), así que sin nombre no
          // hay WhatsApp — pero el correo saluda con "Hola," y sale igual.
          if (!nombrePila) {
            console.error("[sesiones-sync] cita sin nombre utilizable: no sale WhatsApp, el email sí", cita.id);
          }
          // Sin zona (o con una que no es un timezone IANA real) no hay
          // forma fiable de decir una hora: `fechaEnZona`/`horaEnZona`
          // capturan el `RangeError` de `Intl` y caerían en silencio a
          // Europe/Madrid (su fallback), y a un cliente en otro huso
          // (Rodolfo, América/Monterrey, ya en la base) eso le dice una hora
          // que no es la suya — el fallo exacto que guardar la zona por
          // contacto quiere evitar. `zonaValida` cubre las tres formas de
          // "no se puede determinar": la lectura del contacto falló entera
          // (403/429/5xx de GHL: `traerContacto` lanza y el catch de arriba
          // deja `contacto` en null contándolo como error), GHL no tiene
          // timezone para este contacto, o GHL tiene guardado un valor que
          // no es un timezone IANA reconocible. En los tres casos, mejor
          // ningún mensaje esta pasada que uno con la hora equivocada —
          // mismo criterio que ya se aplica al coach sin mapear.
          const zona = contacto?.zona ?? null;
          const zonaOk = zonaValida(zona);

          // La confirmación solo tiene sentido RECIÉN agendada. Sin este
          // guard, la primera pasada con el envío encendido mandaría
          // "¡confirmado!" a todo el que ya tuviera cita en la ventana de 30
          // días — gente que reservó hace días recibiría una confirmación
          // absurda. `dateAdded` lo da GHL.
          const reciente =
            !!cita.dateAdded && ahora.getTime() - Date.parse(cita.dateAdded) < 60 * 60 * 1000;

          // La elegibilidad se calcula UNA vez y fuera del antiduplicados.
          // Antes `yaSeEnvio` vivía dentro de la condición de la rama, y eso
          // tenía una consecuencia que no se ve leyendo: meter el email ahí
          // lo habría puesto bajo el antiduplicados de WhatsApp. En cuanto
          // existiera fila en `wa_mensajes` —enviada o incierta— la rama
          // entera se cerraría y el email no llegaría ni a evaluarse. Es
          // justo lo que D5 quiere evitar, reintroducido por la forma del
          // `if`.
          const tocaConfirmacion = reciente;
          const tocaRecordatorio = tocaRecordatorio1h(fechaIso, ahora) && !!enlace;

          // Sin zona fiable no se puede decir una hora, y las dos plantillas
          // dicen una. Gobierna los dos canales por el mismo motivo.
          if ((tocaConfirmacion || tocaRecordatorio) && !zonaOk) {
            console.error(
              "[sesiones-sync] aviso sin zona horaria confiable, se salta esta pasada",
              cita.id,
              zona,
            );
          } else {
            // ── WhatsApp ────────────────────────────────────────────────
            // El `else if` de aquí dentro se conserva tal cual: una cita
            // creada entre 45 y 75 minutos antes cumple las dos condiciones
            // en la MISMA pasada, y el cliente recibiría dos plantillas con
            // un segundo de diferencia. La confirmación gana; el
            // recordatorio, si aún cabe en la ventana, sale en la pasada
            // siguiente.
            if (ENVIO_ACTIVO && telefono && nombrePila) {
              if (tocaConfirmacion && !(await yaSeEnvio(sesionId, "confirmacion_sesion_es", c))) {
                if (
                  await enviarYCubrirIncierto(
                    {
                      to: telefono,
                      name: "confirmacion_sesion_es",
                      language: "es",
                      autor: "equipo",
                      sesionId,
                      variables: {
                        nombre: nombrePila,
                        coach: nombreCoach,
                        fecha: fechaEnZona(cita.startTime, zona),
                      },
                    },
                    c,
                  )
                ) {
                  c.enviados++;
                }
              } else if (
                tocaRecordatorio &&
                !(await yaSeEnvio(sesionId, "recordatorio_1h_es", c))
              ) {
                if (
                  await enviarYCubrirIncierto(
                    {
                      to: telefono,
                      name: "recordatorio_1h_es",
                      language: "es",
                      autor: "equipo",
                      sesionId,
                      variables: {
                        nombre: nombrePila,
                        hora: horaEnZona(fechaIso, zona),
                        coach: nombreCoach,
                        link: enlace as string,
                      },
                    },
                    c,
                  )
                ) {
                  c.enviados++;
                }
              }
            } else if (ENVIO_ACTIVO && (tocaConfirmacion || tocaRecordatorio)) {
              // Que no se pueda avisar por WhatsApp deja de ser un silencio.
              console.error(
                "[sesiones-sync] sin WhatsApp para esta cita",
                cita.id,
                telefono ? "sin nombre utilizable" : "sin teléfono",
              );
              c.sinTelefono++;
            }

            // ── Email ───────────────────────────────────────────────────
            // Bloque INDEPENDIENTE, con su propia consulta al antiduplicados
            // (D5). El resultado de WhatsApp no lo condiciona: un canal roto
            // no puede llevarse al otro por delante.
            if (EMAIL_ACTIVO && email) {
              const nombreCorreo = nombrePila ?? "";
              if (
                tocaConfirmacion &&
                !(await yaSeEnvioEmail(claveSesion("confirmacion_sesion", sesionId, fechaIso)))
              ) {
                const correo = emailConfirmacionSesion({
                  nombre: nombreCorreo,
                  coach: nombreCoach,
                  cuando: fechaEnZona(cita.startTime, zona),
                  enlace: enlace ?? "",
                });
                const env = await enviarYRegistrarEmail({
                  to: email,
                  asunto: correo.asunto,
                  html: correo.html,
                  texto: correo.texto,
                  clave: claveSesion("confirmacion_sesion", sesionId, fechaIso),
                  tipo: "confirmacion_sesion",
                  personaId: personaId ?? undefined,
                  sesionId,
                });
                if (env.ok) c.enviadosEmail++;
                else c.errores++;
              } else if (
                tocaRecordatorio &&
                !(await yaSeEnvioEmail(claveSesion("recordatorio_1h", sesionId, fechaIso)))
              ) {
                const correo = emailRecordatorio1h({
                  nombre: nombreCorreo,
                  coach: nombreCoach,
                  hora: horaEnZona(fechaIso, zona),
                  enlace: enlace as string,
                });
                const env = await enviarYRegistrarEmail({
                  to: email,
                  asunto: correo.asunto,
                  html: correo.html,
                  texto: correo.texto,
                  clave: claveSesion("recordatorio_1h", sesionId, fechaIso),
                  tipo: "recordatorio_1h",
                  personaId: personaId ?? undefined,
                  sesionId,
                });
                if (env.ok) c.enviadosEmail++;
                else c.errores++;
              }
            } else if (EMAIL_ACTIVO && (tocaConfirmacion || tocaRecordatorio)) {
              console.error("[sesiones-sync] cliente sin email para esta cita", cita.id);
              c.sinEmail++;
            }
          }
        } catch (err) {
          console.error("[sesiones-sync] cita falló", cita.id, err);
          c.errores++;
        }
      }
    } catch (err) {
      // Aquí cae también un GHL que no responde: `traerCitas` LANZA en vez de
      // devolver lista vacía, precisamente para que un 403 por token caducado
      // no se confunda con "no hay citas".
      console.error("[sesiones-sync] calendario falló", calendarId, err);
      c.errores++;
    }
  }

  // `ok` es el resultado de la pasada, no el de la petición HTTP. Antes era
  // `true` fijo: con GHL devolviendo 403 la respuesta era `{ok:true,
  // citas:0}` y nada delataba que llevaba días sin sincronizar.
  return Response.json({ ...c, ok: c.errores === 0 });
}
