// Formato para la UI (es-ES).

export function displayName(persona: { nombre: string | null } | null, telefono: string): string {
  return persona?.nombre?.trim() || telefono || "Desconocido";
}

// Resuelve el `autor` de un mensaje saliente (UUID de team_member) a su nombre.
// "equipo" / null / sin match → "Equipo". Usado en el hilo y en la lista de conversaciones.
export function resolveAutorNombre(
  autor: string | null,
  team: { id: string; nombre: string }[],
): string {
  if (!autor) return "Equipo";
  return team.find((t) => t.id === autor)?.nombre ?? "Equipo";
}

export function shortTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7) return d.toLocaleDateString("es-ES", { weekday: "short" });
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * El dinero del OS. Siempre con céntimos.
 *
 * Hasta el 2-sep-2026 esto redondeaba a euros enteros y convivía con otras
 * DOS funciones que sí los mostraban (`moneyExacta` y `money2`, idénticas
 * entre sí y en ficheros distintos). El resultado: el mismo pago de 751,50 €
 * se pintaba "752 €" en /atribucion y "751,50 €" en /comisiones. Para quien
 * cuadra contra Stripe a las once de la noche, dos pantallas del mismo
 * sistema que no coinciden no es un detalle de estilo, es una razón para
 * desconfiar de las dos.
 *
 * Y el redondeo no solo desentonaba, mentía por acumulación: tres líneas de
 * 250,50 € se pintaban como 251 € cada una —753 € a simple vista— contra un
 * total real de 751,50 € que a su vez se veía como 752 €.
 *
 * Decisión de Milo, 2-sep-2026: céntimos en todas las pantallas. Cambia el
 * aspecto de todas las cifras del OS, así que hay que avisar al equipo.
 */
export function money(n: number | null | undefined, divisa = "EUR"): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: divisa,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

/**
 * @deprecated Usa `money`, que desde el 2-sep-2026 ya lleva los dos
 * decimales. Se mantiene como alias porque la usa /comisiones (15 llamadas),
 * que lleva otra sesión en paralelo: borrarla ahora sería romperle el
 * fichero. Cuando esa pantalla migre a `money`, esta línea se va.
 */
export const moneyExacta = money;

export function num(n: number | null | undefined): string {
  return new Intl.NumberFormat("es-ES").format(Number(n ?? 0));
}

/**
 * "2026-08-01" -> "ago 2026".
 *
 * `timeZone: "UTC"` NO es decorativo. Una cadena "YYYY-MM-DD" la interpreta
 * `new Date()` como medianoche UTC, y al formatearla sin fijar la zona se
 * pinta en la del proceso: en cualquier zona negativa cae al día —y aquí al
 * MES— anterior. Comprobado el 2-sep-2026 en America/Santiago (UTC−4):
 * monthLabel("2026-08-01") devolvía "jul 2026".
 *
 * En Vercel el reloj es UTC y no se nota, pero estas funciones también corren
 * en el navegador: quien abra el OS desde América veía todas las fechas
 * corridas un día. Es la misma trampa que ya está documentada en
 * cuotas/page.tsx y en VentaForm, resuelta aquí de una vez para todas.
 */
export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
}

/**
 * "2026-09-07" -> "07 sept 26". Devuelve "—" si no hay fecha: se pinta en
 * tablas donde una celda vacía se leería como "falta un dato".
 *
 * `timeZone: "UTC"` por lo mismo que `monthLabel`: sin fijarla, en
 * America/Santiago esta función devolvía "06 sept 26" para el 7 de
 * septiembre. Una fecha de calendario no tiene hora y no debe moverse con la
 * zona de quien la mira — un vencimiento es el día que es en todas partes.
 *
 * `shortTime` y `fullTime` NO llevan esto a propósito: esos sí son marcas de
 * tiempo reales (cuándo llegó un mensaje) y deben verse en la hora local de
 * quien lee.
 */
export function dateEs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC",
  });
}

// Color por persona (Berni, CO-2): mismo team_member siempre con el mismo
// color, sin mantener una lista a mano — un hash simple del id elige entre
// la paleta de pills ya existente.
const COLORES_PERSONA = ["green", "yellow", "orange", "red", "blue", "purple", "gold"];

// Paleta fija de consultores (SE-4): mismo color en Sesiones y en Comisiones
// para la misma persona, a propósito FUERA de verde/rojo/azul/naranja — esos
// ya significan asistencia/origen en la misma fila. IDs confirmados contra
// `team_members` el 7-sep-2026; quien no esté aquí cae al hash genérico.
const CONSULTOR_COLOR: Record<string, string> = {
  "bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1": "c-manuel",
  "6cbb5982-6051-4c00-bc98-97310140e23f": "c-berni",
  "25b94e5d-109d-4f89-87a8-ca17ad40072a": "c-alex",
  "1826f965-d12f-4550-b7ac-673326f5f671": "c-iker",
  "0f7861a9-f340-4a26-b3af-5316ff01b352": "c-dani",
};

export function colorPersona(id: string): string {
  if (CONSULTOR_COLOR[id]) return CONSULTOR_COLOR[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLORES_PERSONA[Math.abs(h) % COLORES_PERSONA.length];
}

// Color por número de sesión (Berni, feedback SE-5): 1 verde, 2 amarilla, 3
// naranja, 4 roja, 5 azul. De la 6 en adelante se repite el ciclo en vez de
// añadir una clase de pill nueva por cada número que aparezca.
const COLORES_SESION = ["green", "yellow", "orange", "red", "blue"];
export function colorSesion(numero: number | null | undefined): string {
  if (!numero || numero < 1) return "";
  return COLORES_SESION[(numero - 1) % COLORES_SESION.length];
}
