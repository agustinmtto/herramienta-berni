// Lógica pura de las consultorías que llegan de GoHighLevel. Sin red ni base:
// todo lo que decide qué se guarda y qué se envía vive aquí para poder testearlo.

export type CitaGhl = {
  id: string;
  startTime: string;
  endTime?: string;
  // El calendario al que pertenece la cita, según la propia cita. `traerCitas`
  // lo compara con el que pidió: es el seguro de que no se cuelan las llamadas
  // de venta, que este build excluye a propósito.
  calendarId?: string | null;
  address?: string | null;
  assignedUserId?: string | null;
  contactId?: string | null;
  appointmentStatus?: string | null;
  title?: string | null;
  dateAdded?: string | null; // cuándo se creó la cita en GHL
  // La descripción de la propia cita (GHL los devuelve como `description` y
  // su alias `notes`). El cron del evento escribe ahí el resumen del
  // formulario para que se vea al abrir la cita en el calendario.
  description?: string | null;
  notes?: string | null;
};

const BERNI = "6cbb5982-6051-4c00-bc98-97310140e23f";
const MANUEL = "bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1";
const IKER = "1826f965-d12f-4550-b7ac-673326f5f671";

// Berni tiene DOS usuarios en GHL: el corporativo (actual) y el de gmail, que
// firma las citas anteriores al 6-ago. Los dos son la misma persona.
const COACH_POR_USUARIO_GHL: Record<string, string> = {
  DmvcKL0fg38HFDLZZRI8: BERNI,
  hlQOxNZMgRZWtbahC2c4: BERNI,
  pb9C0LZCk0N2FNrL1feC: MANUEL,
  // Iker entra el 2-sep-2026 con su propio calendario de consultoría. Una
  // sola cuenta, corporativa desde el primer día.
  ubF4xEEXrP3d7yovZAfH: IKER,
};

// El nombre que ve el cliente en "tu sesión con {{coach}}". Vive aquí, junto a
// los UUID de los que sale, porque tenerlo duplicado en la ruta era la receta
// para que un día se cambiara uno y no el otro: la plantilla saldría con el
// nombre del coach que no es, o —peor— se dejaría de enviar en silencio
// porque el mapa de nombres no reconoce un id que el de coaches sí.
const NOMBRE_POR_COACH: Record<string, string> = {
  [BERNI]: "Berni",
  [MANUEL]: "Manuel",
  [IKER]: "Iker",
};

export function nombreDeCoach(coachId: string | null | undefined): string | null {
  return NOMBRE_POR_COACH[coachId ?? ""] ?? null;
}

export function coachDeUsuarioGhl(assignedUserId: string | null | undefined): string | null {
  return COACH_POR_USUARIO_GHL[assignedUserId ?? ""] ?? null;
}

export function estadoDeCita(appointmentStatus: string | null | undefined): string {
  // `trim()` y el `||`: GHL manda cadenas vacías donde no tiene dato (lo mismo
  // que ya pasaba con `address`, ver `enlaceDeCita`). Sin esto, `estado`
  // quedaba "" en la fila de `sesiones` — ni "confirmed" ni nada legible.
  const s = (appointmentStatus ?? "").trim().toLowerCase();
  return s || "confirmed";
}

// Lista BLANCA de estados que significan "esta cita sigue en pie".
//
// Antes el corte era una lista negra de uno: `estado === "cancelled"`. Una
// lista negra falla HACIA ENVIAR — todo lo que no esté escrito en ella manda
// el mensaje. Un `invalid` de GHL, un `" cancelled"` con espacio (el
// `appointmentStatus` no venía trimado) o un `""` mandaban el recordatorio
// igual, a alguien que ya no tiene sesión.
//
// Con lista blanca el fallo es el contrario y es el bueno: si GHL inventa
// mañana un estado nuevo, dejamos de enviar hasta que alguien lo añada aquí.
// Nadie recibe un WhatsApp que no debía.
//
// `new` y `booked` son los estados de una cita recién creada; `confirmed` el
// habitual. Fuera quedan a propósito `cancelled`, `noshow`, `invalid` y
// `showed`: los tres primeros porque la cita no está viva, y `showed` porque
// para cuando GHL lo marca la sesión ya pasó — recordarla llega tarde.
const ESTADOS_VIVOS = new Set(["confirmed", "new", "booked"]);

export function citaViva(estado: string | null | undefined): boolean {
  return ESTADOS_VIVOS.has((estado ?? "").trim().toLowerCase());
}

// GHL deja `address` como "" cuando no pudo crear la conferencia (pasó 13 días
// seguidos en agosto). Solo cuenta como enlace algo que sea una URL.
export function enlaceDeCita(address: string | null | undefined): string | null {
  const a = (address ?? "").trim();
  return a.startsWith("http") ? a : null;
}

// Comprueba que `zona` sea un timezone IANA que `Intl` reconozca. Sin esto,
// una zona PRESENTE pero corrupta (un valor raro guardado en el contacto de
// GHL) pasaría el guard `if (!zona)` de route.ts y llegaría de todos modos a
// `horaEnZona`/`fechaEnZona`, que capturan el `RangeError` de `Intl` y caen
// en silencio a Europe/Madrid — el mismo fallo de "hora equivocada sin
// avisar" que motivó guardar la zona por contacto, solo que con la zona
// presente en vez de ausente. `Intl.DateTimeFormat` valida `timeZone` en el
// constructor (lanza `RangeError` ahí mismo, no hace falta llamar a
// `.format()`), así que basta con construirlo dentro de un try/catch.
export function zonaValida(zona: string | null | undefined): boolean {
  if (!zona) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

export function horaEnZona(iso: string, zona: string | null | undefined): string {
  const d = new Date(iso);
  for (const tz of [zona, "Europe/Madrid"]) {
    if (!tz) continue;
    try {
      return new Intl.DateTimeFormat("es-ES", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(d);
    } catch {
      // Zona inválida: probamos la siguiente.
    }
  }
  return "";
}

const MIN = 60 * 1000;

function minutosHasta(fechaIso: string, ahora: Date): number {
  return (Date.parse(fechaIso) - ahora.getTime()) / MIN;
}

// Ventana ancha (45-75 min) a propósito: con el cron cada 5 minutos aguanta
// dos pasadas fallidas seguidas sin que el recordatorio se pierda.
export function tocaRecordatorio1h(fechaIso: string, ahora: Date): boolean {
  const m = minutosHasta(fechaIso, ahora);
  return m >= 45 && m <= 75;
}

// Solo desde 2 horas antes: antes de eso GHL todavía puede generarlo y el
// aviso sería ruido.
export function tocaAvisoSinEnlace(
  fechaIso: string, enlace: string | null, ahora: Date,
): boolean {
  if (enlace) return false;
  const m = minutosHasta(fechaIso, ahora);
  return m > 0 && m <= 120;
}

// El nombre con el que se saluda en la plantilla: la primera palabra, sin
// espacios de más. "Nombre Apellido Apellido" → "Nombre". Devuelve `null` cuando no
// hay nada que usar, para que quien llama pueda seguir buscando en la
// siguiente fuente en vez de recibir una cadena vacía que parece un nombre.
export function primerNombre(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return t.split(/\s+/)[0] || null;
}

// Id sintético y estable para un envío cuyo resultado no se pudo confirmar
// (Kapso respondió 5xx pero el WhatsApp puede haber salido igual — ver
// `registrarEnvioIncierto` en lib/plantillas.ts). Estable por (sesión,
// plantilla): el mismo intento genera siempre el mismo id, así que
// registrarlo dos veces no duplica la fila en `wa_mensajes` (choca con el
// UNIQUE de `kapso_message_id` y el upsert lo resuelve) — y el antiduplicados
// (`yaSeEnvio`) lo ve como "ya hubo un intento" y no reenvía.
// El tercer argumento existe por las sesiones GRUPALES: ahí una misma (sesión,
// plantilla) sale a ~98 teléfonos, y sin el teléfono en la clave el segundo
// incierto haría upsert sobre la fila del primero — borrando el registro que
// evita reenviarle. En el flujo 1-a-1 se omite y el id queda EXACTAMENTE como
// siempre, para que los inciertos ya registrados en `wa_mensajes` sigan
// casando con su clave.
export function idMensajeIncierto(sesionId: string, plantilla: string, telefono?: string): string {
  return `incierto:${sesionId}:${plantilla}${telefono ? `:${telefono}` : ""}`;
}
