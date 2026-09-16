// Lógica pura de la atribución de ventas. Sin red ni base.

// Los calendarios de CONSULTORÍA — servicio, no venta. Una venta nunca sale
// de una consultoría, así que son la lista negra de `calendariosDeVenta`.
// Duplicados a propósito de `CALENDARIOS_CONSULTORIA` en lib/ghl.ts: este
// fichero es lógica pura y no importa nada (sus tests corren sin el alias
// `@/`).
//
// OJO: la versión anterior de este comentario decía "son dos ids que no
// cambian nunca". Cambiaron el 2-sep-2026, al entrar Iker. Cada coach nuevo
// trae un calendario que hay que añadir EN LOS DOS SITIOS: aquí, para que sus
// consultorías no se ofrezcan como la llamada que cerró una venta, y en
// lib/ghl.ts, para que el cron las espeje en `sesiones`.
export const CALENDARIOS_NO_VENTA = [
  "mQvGZMNXeQhKHBjXgdA5", // Consultoría con Berni
  "UCpATrysC6kK1mezCMgF", // Consultoria con Manuel
  "iCAZAvZpFmdXuMhhnK1x", // Consultoria con Iker (2-sep-2026)
];

// Los calendarios de venta que conocíamos a mano. YA NO son la lista que se
// usa: son la RED por si GHL no contesta el catálogo (ver `calendariosDeVenta`).
// El segundo es un duplicado casi homónimo (guion en vez de "|") con 2 citas.
export const CALENDARIOS_VENTA = [
  "ZBDAnmWbsDMFAKls805h", // Llamada de Estrategia | Metacrypto Club
  "xeLDQNZArAbWMkGUaCV3", // Llamada de Estrategia - Metacrypto Club (duplicado)
  "VHxkFpFgBEXR5PlJWeN8", // Admisión con Berni
  "qXHMfM3O3sWphI90W0K2", // Llamada de Admisión | Evento 26/08
];

// El nombre legible de cada calendario, para poder enseñarlo al elegir la
// cita. Sin esto, dos citas del mismo cliente se ven idénticas salvo por la
// hora — y una puede ser una llamada de estrategia y la otra una admisión.
export const NOMBRE_CALENDARIO: Record<string, string> = {
  ZBDAnmWbsDMFAKls805h: "Llamada de Estrategia",
  xeLDQNZArAbWMkGUaCV3: "Llamada de Estrategia",
  VHxkFpFgBEXR5PlJWeN8: "Admisión con Berni",
  qXHMfM3O3sWphI90W0K2: "Admisión del evento 26/08",
};

/** Qué calendarios de GHL pueden haber cerrado una venta, a partir del
 *  catálogo que devuelve GHL. Lo que NO hace es igual de importante:
 *
 *  · No filtra por `activo`. El calendario de un evento se apaga cuando el
 *    evento pasa, y sus citas siguen siendo las que cerraron esas ventas.
 *  · No usa lista blanca. Hasta el 27-ago-2026 los calendarios de venta eran
 *    tres ids escritos a mano, y el día que Berni creó "Llamada de Admisión |
 *    Evento 26/08" sus 40 citas se volvieron invisibles para el OS sin que
 *    nada fallara: Alex veía "este cliente no tiene citas" —indistinguible de
 *    "no vino de agenda"— y la comisión se quedaba sin dueño. Ahora es lista
 *    NEGRA: lo nuevo entra solo, y lo que no es de venta hay que nombrarlo.
 *
 *  Con `catalogo` null o vacío (GHL no contestó) cae a `CALENDARIOS_VENTA`.
 *  Devolver [] aquí sería el fallo silencioso otra vez: cero calendarios son
 *  cero citas, y cero citas en pantalla se leen como "no vino de agenda".
 */
export function calendariosDeVenta(
  catalogo: { id: string; nombre: string | null; activo?: boolean }[] | null,
): { id: string; nombre: string | null }[] {
  const nombreDe = (id: string, n: string | null | undefined) =>
    n?.trim() || NOMBRE_CALENDARIO[id] || null;

  if (!catalogo || catalogo.length === 0) {
    return CALENDARIOS_VENTA.map((id) => ({ id, nombre: nombreDe(id, null) }));
  }
  return catalogo
    .filter((c) => c.id && !CALENDARIOS_NO_VENTA.includes(c.id))
    .map((c) => ({ id: c.id, nombre: nombreDe(c.id, c.nombre) }));
}

/** Qué pasó con la cita, en cristiano. Es el dato que MÁS distingue una cita
 *  de otra: de las 215 citas de venta, 56 (el 26 %) están canceladas. Sin
 *  esto, el selector las ofrece exactamente igual que las que sí ocurrieron y
 *  se puede atribuir una comisión a una llamada que no pasó. */
export type EstadoCita = {
  texto: string;
  /** `ok` la llamada ocurrió · `pendiente` aún no · `malo` no ocurrió */
  tono: "ok" | "pendiente" | "malo";
};

export function estadoDeCita(estado: string | null | undefined): EstadoCita {
  switch (estado) {
    case "showed":
      return { texto: "asistió", tono: "ok" };
    case "confirmed":
      return { texto: "agendada, aún no ha pasado", tono: "pendiente" };
    case "noshow":
      return { texto: "no se presentó", tono: "malo" };
    case "cancelled":
      return { texto: "cancelada", tono: "malo" };
    // `invalid` existe en los datos (1 cita) y cualquier estado nuevo que
    // GHL invente cae aquí: se enseña crudo en vez de esconderlo, porque un
    // estado que no sabemos leer no puede parecerse a uno normal.
    default:
      return { texto: estado ? `estado «${estado}»` : "sin estado", tono: "pendiente" };
  }
}

// Alex y Berni tienen DOS cuentas cada uno en GHL (gmail personal y correo
// corporativo). Las citas ya se reparten entre ambas: 141 al gmail de Alex y
// 6 al corporativo. Sin mapear las dos, sus números salen partidos.
const MIEMBRO_POR_USUARIO_GHL: Record<string, string> = {
  sXWPy4fCRo6yFEeVcODd: "25b94e5d-109d-4f89-87a8-ca17ad40072a", // Alex (gmail)
  N4gTwYQ3fx9HP70lkT9n: "25b94e5d-109d-4f89-87a8-ca17ad40072a", // Alex (corp)
  DmvcKL0fg38HFDLZZRI8: "6cbb5982-6051-4c00-bc98-97310140e23f", // Berni (corp)
  hlQOxNZMgRZWtbahC2c4: "6cbb5982-6051-4c00-bc98-97310140e23f", // Berni (gmail)
  pb9C0LZCk0N2FNrL1feC: "bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1", // Manuel
  ubF4xEEXrP3d7yovZAfH: "1826f965-d12f-4550-b7ac-673326f5f671", // Iker
};

export function miembroDeUsuarioGhl(
  assignedUserId: string | null | undefined,
): string | null {
  return MIEMBRO_POR_USUARIO_GHL[assignedUserId ?? ""] ?? null;
}
