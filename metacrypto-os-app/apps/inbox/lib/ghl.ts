// Cliente de lectura de la API de GoHighLevel. Solo I/O: la lógica está en
// lib/sesiones.ts.
//
// Dos trampas verificadas el 10-ago-2026:
//  · Sin User-Agent de navegador la API responde 403.
//  · La cabecera `Version` cambia por recurso: 2021-04-15 en calendarios,
//    2021-07-28 en contactos.
//
// Desde el 25-ago-2026 el token también ESCRIBE (Milo amplió los scopes de la
// integración privada): custom fields, notas de contacto y notificaciones de
// calendario están verificados. Las citas en sí siguen sin tocarse desde aquí.
import { primerNombre, type CitaGhl } from "@/lib/sesiones";

const API_KEY = process.env.GHL_API_KEY ?? "";
const LOCATION_ID = process.env.GHL_LOCATION_ID ?? "";
const BASE = process.env.GHL_API_BASE ?? "https://services.leadconnectorhq.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Los calendarios cuyas citas SÍ son servicio y se espejan en `sesiones`.
// Añadir uno aquí obliga a dos cosas más, o el coach nuevo entra a medias:
// su usuario de GHL en `COACH_POR_USUARIO_GHL` (lib/sesiones.ts) —sin eso la
// cita se guarda sin coach y el recordatorio no sale— y el calendario en
// `CALENDARIOS_NO_VENTA` (lib/atribucion.ts).
export const CALENDARIOS_CONSULTORIA = [
  "mQvGZMNXeQhKHBjXgdA5", // Consultoría con Berni
  "UCpATrysC6kK1mezCMgF", // Consultoria con Manuel
  "iCAZAvZpFmdXuMhhnK1x", // Consultoria con Iker (2-sep-2026)
];

function cabeceras(version: string): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    Version: version,
    Accept: "application/json",
    "User-Agent": UA,
  };
}

// LANZA si GHL no responde bien, en vez de devolver una lista vacía. La lista
// vacía era indistinguible de "no hay citas": con el token caducado (403) el
// cron respondía `{ok:true, citas:0}` y todo parecía en orden — el fallo
// silencioso que este proyecto ya sufrió. Quien llama aísla el error por
// calendario y lo cuenta.
export async function traerCitas(calendarId: string, desde: Date, hasta: Date): Promise<CitaGhl[]> {
  const url =
    `${BASE}/calendars/events?locationId=${LOCATION_ID}&calendarId=${calendarId}` +
    `&startTime=${desde.getTime()}&endTime=${hasta.getTime()}`;
  const res = await fetch(url, { headers: cabeceras("2021-04-15"), cache: "no-store" });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`[ghl] citas ${calendarId} ${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => null);
  const eventos: CitaGhl[] = Array.isArray(data?.events) ? data.events : [];
  // Seguro, no optimización. Todo el diseño se apoya en que aquí solo entran
  // los calendarios de consultoría: las llamadas de venta quedan fuera a
  // propósito (quien las recibe es un lead que no ha comprado — consentimiento
  // y categoría de plantilla distintos, y las plantillas dicen "tu sesión con
  // {{coach}}"). Si GHL ignorase un `calendarId` desconocido —o cambiara el
  // nombre del parámetro en una versión futura de la API— devolvería todos los
  // eventos de la location y esas llamadas entrarían solas, sin que nada
  // fallara. Se filtra por lo que dice cada evento de sí mismo.
  const propios = eventos.filter((e) => !e.calendarId || e.calendarId === calendarId);
  if (propios.length !== eventos.length) {
    console.error(
      "[ghl] la respuesta traía citas de otro calendario, descartadas",
      calendarId,
      eventos.length - propios.length,
    );
  }
  return propios;
}

export async function traerContacto(contactId: string): Promise<{
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  zona: string | null;
  sourceId: string | null;
} | null> {
  const res = await fetch(`${BASE}/contacts/${contactId}`, {
    headers: cabeceras("2021-07-28"),
    cache: "no-store",
  });
  if (!res.ok) {
    // También lanza, por lo mismo que `traerCitas`: un 403 por token caducado
    // no puede parecerse a "este contacto no tiene datos". La diferencia es
    // que aquí el llamante SÍ sigue adelante con la cita (la sesión se
    // sincroniza igual, solo se queda sin cruzar), pero contando el fallo.
    throw new Error(`[ghl] contacto ${contactId} ${res.status}`);
  }
  const c = (await res.json().catch(() => null))?.contact;
  if (!c) return null;
  // `country` viene "US" para todos, incluidos españoles y mexicanos: no fiarse.
  //
  // El nombre SÍ se devuelve (antes se descartaba): es el saludo de las
  // plantillas y es la mejor fuente después de la persona ya cruzada. Sin él,
  // las citas sin cruzar —3 de las 6 reales— sacaban el `{{nombre}}` de la
  // primera palabra del TÍTULO de la cita, que no siempre es un nombre.
  // `firstName` primero por ser exactamente eso; `name` es el completo.
  return {
    nombre: primerNombre(c.firstName) ?? primerNombre(c.name),
    email: c.email ?? null,
    telefono: c.phone ?? null,
    zona: c.timezone ?? null,
    // El custom field Source_ID del contacto (OJF2hSyIXnOb4u4kXMgW,
    // `contact.source_id`). Es TEXTO LIBRE: se devuelve tal cual y lo
    // traduce `fuentes_atribucion`, nunca se interpreta aquí. El `typeof`
    // es la salvaguarda: casi todos los custom fields de GHL vienen como
    // array (checkboxes/selects), y este es de los pocos que es texto
    // simple — si algún día lo reconfiguran como multiselección, mejor
    // perder el dato que romper el tipo `string | null` de quien lo usa.
    sourceId: (() => {
      const v = (c.customFields ?? []).find(
        (f: { id?: string; value?: unknown }) => f.id === "OJF2hSyIXnOb4u4kXMgW",
      )?.value;
      return typeof v === "string" ? v : null;
    })(),
  };
}

// Busca el contacto de GHL por email y, si no aparece, por teléfono. Se usa
// en la COMPRA NUEVA, cuando el cliente aún no existe en `personas` pero su
// contacto sí existe en GHL desde que agendó.
//
// El email primero por ser la llave más fiable: en el sync de sesiones cruzó
// 2 de 3 contactos, contra 1 de 3 del teléfono.
//
// Verificado en vivo el 11-ago-2026 contra `GET /contacts/search/duplicate`
// con el contacto real de una clienta (cliente.ejemplo@gmail.com):
//  · El parámetro de teléfono se llama `number`, NO `phone` — con `phone` la
//    API responde 422 "property phone should not exist". Con `number` sí
//    empareja (comprobado con su +34600111333).
//  · "No hay duplicado" es un 200 con cuerpo `{ contact: null, traceId }`,
//    NUNCA un 404 (probado con un email inventado). El 404 que asumía el
//    plan original no se ha observado nunca contra esta API; se deja como
//    salvaguarda por si una versión futura de la API lo introdujera.
//  · Con acierto el cuerpo es `{ contact: {...contacto completo...},
//    matchingField, traceId }` — se usa `contact.id`.
export async function buscarContacto(
  email: string | null, telefono: string | null,
): Promise<string | null> {
  for (const [campo, valor] of [["email", email], ["number", telefono]] as const) {
    if (!valor) continue;
    const url =
      `${BASE}/contacts/search/duplicate?locationId=${LOCATION_ID}` +
      `&${campo}=${encodeURIComponent(valor)}`;
    const res = await fetch(url, { headers: cabeceras("2021-07-28"), cache: "no-store" });
    // 404 = no hay duplicado. No observado en vivo (ver nota arriba: la API
    // real devuelve 200 + contact:null), pero es una respuesta legítima si
    // apareciera. Cualquier otro código de error sí es un fallo real.
    if (res.status === 404) continue;
    if (!res.ok) {
      throw new Error(`[ghl] búsqueda de contacto ${res.status}`);
    }
    const id = (await res.json().catch(() => null))?.contact?.id ?? null;
    if (id) return id;
  }
  return null;
}

// El contacto tal cual lo da GHL, con `customFields` como lista de {id, value}.
// Para las notas del evento hace falta leer varios campos POR ID (dos de ellos
// comparten fieldKey y solo el id es unívoco), así que aquí no se filtra nada:
// interpreta el llamante. Lanza en error por lo mismo que `traerContacto`.
export async function traerContactoBruto(
  contactId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${BASE}/contacts/${contactId}`, {
    headers: cabeceras("2021-07-28"),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[ghl] contacto bruto ${contactId} ${res.status}`);
  return (await res.json().catch(() => null))?.contact ?? null;
}

export async function traerNotas(
  contactId: string,
): Promise<{ id?: string; body?: string | null }[]> {
  const res = await fetch(`${BASE}/contacts/${contactId}/notes`, {
    headers: cabeceras("2021-07-28"),
    cache: "no-store",
  });
  // Lanza también aquí: "no pude leer las notas" tratado como "no hay notas"
  // haría que el llamante creara la nota OTRA VEZ en cada pasada del cron.
  if (!res.ok) throw new Error(`[ghl] notas ${contactId} ${res.status}`);
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.notes) ? data.notes : [];
}

export async function crearNota(
  contactId: string,
  body: string,
  userId?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/contacts/${contactId}/notes`, {
    method: "POST",
    headers: { ...cabeceras("2021-07-28"), "Content-Type": "application/json" },
    body: JSON.stringify(userId ? { body, userId } : { body }),
    cache: "no-store",
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`[ghl] crear nota ${contactId} ${res.status}: ${cuerpo.slice(0, 300)}`);
  }
}

// Escribe la descripción de una cita. El campo del PUT es `description`
// (probado el 25-ago: `notes` en el PUT devuelve 200 pero NO persiste; con
// `description` persisten los dos, porque `notes` es su alias de lectura).
// Es lo que hace visible el resumen del formulario al abrir la cita en el
// calendario de GHL. No toca hora, estado ni asignado — verificado.
export async function ponerDescripcionCita(eventId: string, descripcion: string): Promise<void> {
  const res = await fetch(`${BASE}/calendars/events/appointments/${eventId}`, {
    method: "PUT",
    headers: { ...cabeceras("2021-04-15"), "Content-Type": "application/json" },
    body: JSON.stringify({ description: descripcion }),
    cache: "no-store",
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`[ghl] descripción de cita ${eventId} ${res.status}: ${cuerpo.slice(0, 300)}`);
  }
}

// El catálogo de calendarios de la location, tal cual lo da GHL. Lanza si no
// responde, como todo lo demás aquí: quien llama decide qué hacer sin red.
//
// NO filtra por `isActive` a propósito — el calendario de un evento se apaga
// cuando el evento pasa y sus citas siguen siendo las que cerraron ventas.
export async function traerCalendarios(): Promise<
  { id: string; nombre: string | null; activo?: boolean }[]
> {
  const res = await fetch(`${BASE}/calendars/?locationId=${LOCATION_ID}`, {
    headers: cabeceras("2021-04-15"),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`[ghl] calendarios ${res.status}`);
  const data = await res.json().catch(() => null);
  const lista: { id?: string; name?: string; isActive?: boolean }[] =
    Array.isArray(data?.calendars) ? data.calendars : [];
  return lista
    .filter((c): c is { id: string; name?: string; isActive?: boolean } => Boolean(c.id))
    .map((c) => ({ id: c.id, nombre: c.name ?? null, activo: c.isActive }));
}

// Las citas de VENTA de un contacto, ordenadas de más reciente a más antigua
// —que es como Alex las va a mirar: la que cerró suele ser la última—, más el
// nombre de cada calendario para poder distinguirlas en pantalla.
//
// Los calendarios se le PREGUNTAN a GHL en vez de venir de una lista escrita
// a mano: ver `calendariosDeVenta` en lib/atribucion.ts para el fallo del
// 27-ago-2026 que eso arregla (el calendario del evento 26/08 y sus 40 citas
// invisibles). Si el catálogo falla se sigue con la lista conocida: mejor tres
// calendarios seguros que ninguno.
//
// Un calendario que falle no tumba la búsqueda: se registra y se sigue con
// los otros. Perder las 2 citas del calendario duplicado es peor que no
// mostrar ninguna.
export async function traerCitasDeVenta(
  contactId: string,
  desde: Date,
  hasta: Date,
): Promise<{ citas: CitaGhl[]; nombres: Record<string, string> }> {
  const { calendariosDeVenta } = await import("@/lib/atribucion");
  let catalogo: { id: string; nombre: string | null; activo?: boolean }[] | null = null;
  try {
    catalogo = await traerCalendarios();
  } catch (e) {
    console.error("[ghl] no se pudo leer el catálogo de calendarios, se usa la lista conocida", e);
  }
  const calendarios = calendariosDeVenta(catalogo);

  const todas: CitaGhl[] = [];
  const nombres: Record<string, string> = {};
  for (const cal of calendarios) {
    if (cal.nombre) nombres[cal.id] = cal.nombre;
    try {
      const citas = await traerCitas(cal.id, desde, hasta);
      todas.push(...citas.filter((c) => c.contactId === contactId));
    } catch (e) {
      console.error("[ghl] fallo al traer citas de venta", cal.id, e);
    }
  }
  return {
    citas: todas.sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime)),
    nombres,
  };
}
