// Lógica pura de la pantalla de Gastos. Sin acceso a datos ni imports de
// runtime: todo entra por parámetros y "hoy" es siempre un argumento, igual
// que en lib/inicio.ts y lib/semana.ts.
//
// Las fechas son cadenas "YYYY-MM-DD" y los meses "YYYY-MM". No se construye
// ni un solo Date para aritmética de calendario: con fechas como texto no hay
// zona horaria que se coma un día y cruce un gasto de mes.
//
// Regla de este módulo (igual que venta-form.ts y persona.ts): NADA de
// imports "@/" en runtime — vitest no resuelve el alias.

/** Lo mínimo que necesita esta lógica de un gasto. */
export type GastoBase = {
  id: string;
  concepto: string;
  categoria: string | null;
  monto: number;
  fecha: string;
  tipo_gasto: string | null;
  metodo_pago: string | null;
  notas: string | null;
};

/** El valor del catálogo que marca un gasto como repetible cada mes. */
export const TIPO_RECURRENTE = "Gasto recurrente";

// Los helpers de mes viven en lib/meses.ts desde que Devoluciones necesita
// los mismos. Se re-exportan para no obligar a cada pantalla a importar de
// dos sitios lo que conceptualmente es una sola cosa.
export { mesDe, etiquetaMes, nombreMes, mesCorto, mesAnterior, mesSiguiente } from "./meses";
import { mesDe, mesAnterior } from "./meses";

/**
 * Los meses que hay que ofrecer, del más reciente al más antiguo.
 *
 * Incluye el mes en curso AUNQUE no tenga ni un gasto, y esa es la parte que
 * importa: hoy es 2 de septiembre y septiembre está a cero. Si el mes en curso
 * no apareciera en la lista, la pantalla escondería justo el hecho que hay que
 * ver — que este mes no se ha cargado nada todavía — y la señal "Gastos
 * incompletos" de Inicio seguiría encendida sin que nadie entienda por qué.
 */
export function mesesDisponibles(gastos: GastoBase[], hoy: string): string[] {
  const set = new Set(gastos.map((g) => mesDe(g.fecha)));
  set.add(mesDe(hoy));
  return [...set].sort().reverse();
}

/** Total y recuento de un conjunto de gastos. */
export function resumen(gastos: GastoBase[]): { n: number; total: number } {
  return {
    n: gastos.length,
    total: gastos.reduce((s, g) => s + Number(g.monto || 0), 0),
  };
}

// Genérica para no perder el tipo de fila que entra: la pantalla trabaja con
// `GastoRow` (que además lleva `divisa`) y si esto devolviera `GastoBase[]`
// habría que castear en cada uso, que es como se cuelan los campos que faltan.
export function delMes<T extends GastoBase>(gastos: T[], mes: string): T[] {
  return gastos.filter((g) => mesDe(g.fecha) === mes);
}

/** Serie mensual completa, del mes más antiguo al más reciente. */
export function serieMensual(
  gastos: GastoBase[],
  hoy: string,
): { mes: string; n: number; total: number }[] {
  return mesesDisponibles(gastos, hoy)
    .slice()
    .reverse()
    .map((mes) => ({ mes, ...resumen(delMes(gastos, mes)) }));
}

/** Reparto por categoría, de mayor a menor. Los sin categoría van a "Otros". */
export function porCategoria(
  gastos: GastoBase[],
): { categoria: string; n: number; total: number }[] {
  const m = new Map<string, { n: number; total: number }>();
  for (const g of gastos) {
    const c = g.categoria || "Otros";
    const prev = m.get(c) ?? { n: 0, total: 0 };
    m.set(c, { n: prev.n + 1, total: prev.total + Number(g.monto || 0) });
  }
  return [...m.entries()]
    .map(([categoria, v]) => ({ categoria, ...v }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Cuánto cambió el gasto respecto al mes anterior.
 *
 * `pct` es null cuando el mes anterior fue 0: dividir daría Infinity y la
 * pantalla pintaría "+∞ %". Un mes que arranca desde cero no tiene variación
 * porcentual que enseñar, tiene un importe.
 */
export function comparativa(
  gastos: GastoBase[],
  mes: string,
): { anterior: string; totalAnterior: number; diff: number; pct: number | null } {
  const anterior = mesAnterior(mes);
  const totalAnterior = resumen(delMes(gastos, anterior)).total;
  const total = resumen(delMes(gastos, mes)).total;
  return {
    anterior,
    totalAnterior,
    diff: total - totalAnterior,
    pct: totalAnterior > 0 ? (total - totalAnterior) / totalAnterior : null,
  };
}

/**
 * El histórico de un mismo concepto: "¿cuánto llevo pagando de esto?".
 *
 * Se compara el concepto normalizado —sin mayúsculas, sin acentos, sin
 * espacios de más— porque lo teclea una persona distinta cada mes y "Google
 * Drive", "google drive" y "Google  Drive" son el mismo gasto. Sin normalizar,
 * el histórico saldría vacío justo en los casos que interesan.
 */
export function normalizaConcepto(c: string): string {
  return (c ?? "")
    .normalize("NFD")
    // Los diacríticos por su rango unicode explícito, no pegados en el
    // fichero: escritos literalmente son invisibles y cualquier editor que
    // recomponga el texto a NFC se los come sin que nadie lo note.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function historialDe<T extends GastoBase>(
  gastos: T[],
  concepto: string,
): T[] {
  const k = normalizaConcepto(concepto);
  if (!k) return [];
  return gastos
    .filter((g) => normalizaConcepto(g.concepto) === k)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/**
 * Cómo ha evolucionado el precio de un concepto entre su cobro más reciente y
 * el anterior. `null` cuando solo hay uno: no hay nada que comparar.
 *
 * Es el dato que convierte una lista en una alarma — una suscripción que sube
 * de 20 a 32 USD no la ve nadie mirando una tabla de 105 filas.
 */
export function variacionPrecio(
  historial: GastoBase[],
): { anterior: number; actual: number; diff: number; pct: number | null } | null {
  if (historial.length < 2) return null;
  const actual = Number(historial[0].monto || 0);
  const anterior = Number(historial[1].monto || 0);
  return {
    anterior,
    actual,
    diff: actual - anterior,
    pct: anterior > 0 ? (actual - anterior) / anterior : null,
  };
}

/**
 * Los recurrentes del mes de referencia que NO están todavía en el mes
 * destino. Es la lista de lo que falta por cargar.
 *
 * 81 de los 105 gastos del negocio son recurrentes y 18 conceptos se repiten
 * cada mes (Google Drive, Zoom, GoHighLevel, los salarios...). Cargarlos a
 * mano son 19 altas en un formulario de siete campos, cada mes. Por eso no se
 * hace: hoy es 2 de septiembre y septiembre está a cero.
 *
 * Se compara por concepto normalizado, no por id: cada mes es una fila nueva.
 * Y se devuelve el gasto del mes de referencia entero, para poder copiar
 * categoría, método e importe sin volver a teclearlos.
 */
export function recurrentesQueFaltan<T extends GastoBase>(
  gastos: T[],
  mesDestino: string,
  mesReferencia: string = mesAnterior(mesDestino),
): T[] {
  const yaEstan = new Set(
    delMes(gastos, mesDestino).map((g) => normalizaConcepto(g.concepto)),
  );
  const vistos = new Set<string>();
  const salida: T[] = [];
  for (const g of delMes(gastos, mesReferencia)) {
    if (g.tipo_gasto !== TIPO_RECURRENTE) continue;
    const k = normalizaConcepto(g.concepto);
    // Un mismo concepto puede aparecer dos veces en el mes de referencia (un
    // cobro partido). Se ofrece una sola vez: duplicarlo al copiar sería
    // meter un gasto que no existe.
    if (!k || yaEstan.has(k) || vistos.has(k)) continue;
    vistos.add(k);
    salida.push(g);
  }
  return salida.sort((a, b) => Number(b.monto || 0) - Number(a.monto || 0));
}

/**
 * El día del mes destino que le toca a un gasto copiado, conservando el día
 * del original. Si el día no existe en el mes destino (un cargo el 31 movido
 * a septiembre), cae al último día del mes en vez de desbordar al siguiente,
 * que es lo que hace `new Date(2026, 8, 31)`.
 */
export function fechaEnMes(fechaOriginal: string, mesDestino: string): string {
  const dia = Number(fechaOriginal.slice(8, 10)) || 1;
  const [a, m] = mesDestino.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mesDestino}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}
