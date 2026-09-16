// Aritmética de meses en castellano, compartida por las pantallas que se
// ordenan por mes (Gastos, Devoluciones).
//
// Las fechas son cadenas "YYYY-MM-DD" y los meses "YYYY-MM". No se construye
// ni un solo Date para aritmética de calendario: con fechas como texto no hay
// zona horaria que se coma un día y cruce un movimiento de mes. Es la misma
// regla de lib/inicio.ts y lib/semana.ts.
//
// NADA de imports "@/" — vitest no resuelve el alias en los libs.

export const mesDe = (fecha: string): string => (fecha ?? "").slice(0, 7);

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-08" -> "agosto 2026". En minúscula: se usa dentro de frases. */
export function etiquetaMes(mes: string): string {
  const [a, m] = (mes ?? "").split("-");
  const i = Number(m) - 1;
  if (!MESES_ES[i]) return mes;
  return `${MESES_ES[i]} ${a}`;
}

/** Solo el nombre del mes, sin año: "agosto". Para cabeceras y comparativas. */
export function nombreMes(mes: string): string {
  const [, m] = (mes ?? "").split("-");
  return MESES_ES[Number(m) - 1] ?? mes;
}

/** "2026-08" -> "ago". Para los chips, donde no cabe el nombre entero. */
export function mesCorto(mes: string): string {
  const n = nombreMes(mes);
  return n === mes ? mes : n.slice(0, 3);
}

/** El mes anterior. Sin Date: enero retrocede a diciembre del año pasado. */
export function mesAnterior(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

/** El mes siguiente. Diciembre avanza a enero del año que viene. */
export function mesSiguiente(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Todos los meses entre dos, ambos incluidos, sin huecos.
 *
 * Importa que no haya huecos: julio no tuvo ni una devolución, y una serie que
 * salte de junio a agosto miente sobre la forma del año. Un mes a cero es un
 * hecho, no una ausencia de dato.
 */
export function rangoDeMeses(desde: string, hasta: string): string[] {
  if (!desde || !hasta || desde > hasta) return [];
  const salida: string[] = [];
  let m = desde;
  // Tope de seguridad: 1200 meses son cien años. Si una fecha viene corrupta,
  // esto para en vez de colgar la pestaña.
  for (let i = 0; i < 1200 && m <= hasta; i++) {
    salida.push(m);
    m = mesSiguiente(m);
  }
  return salida;
}
