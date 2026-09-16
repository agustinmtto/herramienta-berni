// Lógica pura de la pantalla de Devoluciones: agrupar por mes, ordenar y
// resumir el motivo. Sin acceso a datos ni imports "@/" — vitest no resuelve
// el alias en los libs.
//
// El nombre lleva "-vista" para no chocar con la lógica de negocio de una
// devolución (qué anula, qué comisión revierte), que vive en el RPC.

import { mesDe, rangoDeMeses } from "./meses";

export type DevolucionBase = {
  devolucion_id: string;
  fecha: string;
  monto: number;
  usd_recibido: number | null;
  alcance: string;
  motivo: string | null;
  persona_nombre: string;
  n_efectos: number;
};

/**
 * Los importes de una devolución son NEGATIVOS en la base: es dinero que
 * salió. Para agregarlos y compararlos se usa el valor absoluto, y la
 * pantalla dice "devuelto" en vez de pintar un menos delante de cada cifra.
 */
export const importeDe = (d: DevolucionBase): number =>
  Math.abs(Number(d.usd_recibido ?? 0));

export function totalDevuelto(ds: DevolucionBase[]): number {
  return ds.reduce((s, d) => s + importeDe(d), 0);
}

export function delMes<T extends { fecha: string }>(ds: T[], mes: string): T[] {
  return ds.filter((d) => mesDe(d.fecha) === mes);
}

/**
 * La serie mensual del año, SIN huecos y con los meses vacíos incluidos.
 *
 * Julio no tuvo ni una devolución. Una serie que salte de junio a agosto
 * miente sobre la forma del año: un mes a cero es un hecho —no se devolvió
 * nada— y es justo lo que se quiere ver al preguntar "¿cuándo hubo
 * devoluciones?".
 *
 * Se acota al año pedido y, si el año está en curso, se corta en el mes de
 * hoy: pintar octubre a diciembre en blanco sugiere que ya se sabe que serán
 * cero.
 */
export function serieDelAnio(
  ds: DevolucionBase[],
  anio: number,
  hoy: string,
): { mes: string; n: number; total: number }[] {
  const finReal = mesDe(hoy).startsWith(String(anio)) ? mesDe(hoy) : `${anio}-12`;
  const conDatos = ds.map((d) => mesDe(d.fecha)).filter(Boolean).sort();
  // Arranca en enero salvo que haya devoluciones antes de lo esperado; el
  // primer mes con dato manda si es anterior.
  const desde = conDatos[0] && conDatos[0] < `${anio}-01` ? conDatos[0] : `${anio}-01`;
  const hasta = conDatos.length && conDatos[conDatos.length - 1] > finReal
    ? conDatos[conDatos.length - 1]
    : finReal;
  return rangoDeMeses(desde, hasta).map((mes) => {
    const delM = delMes(ds, mes);
    return { mes, n: delM.length, total: totalDevuelto(delM) };
  });
}

/* ---------------- Ordenación de la tabla ---------------- */

export type ColumnaOrden = "fecha" | "cliente" | "importe" | "alcance";
export type Direccion = "asc" | "desc";

/** El estado inicial: lo más reciente arriba, que es lo que se viene a ver. */
export const ORDEN_INICIAL: { col: ColumnaOrden; dir: Direccion } = {
  col: "fecha",
  dir: "desc",
};

/**
 * Al pulsar una cabecera: si ya se ordena por ella, invierte; si no, empieza
 * por su dirección natural.
 *
 * "Natural" no es siempre ascendente. En fechas e importes lo que se busca
 * primero es lo más reciente y lo más caro, así que arrancan en descendente;
 * un cliente se busca por orden alfabético.
 */
export function siguienteOrden(
  actual: { col: ColumnaOrden; dir: Direccion },
  col: ColumnaOrden,
): { col: ColumnaOrden; dir: Direccion } {
  if (actual.col === col) {
    return { col, dir: actual.dir === "asc" ? "desc" : "asc" };
  }
  return { col, dir: col === "cliente" || col === "alcance" ? "asc" : "desc" };
}

/**
 * Ordena sin mutar la entrada.
 *
 * Las devoluciones "sin clasificar" son las que esperan una decisión, así que
 * al ordenar por alcance van SIEMPRE primero, en las dos direcciones: son
 * trabajo pendiente, no una categoría más del alfabeto. Es la misma idea que
 * el orden actual de la tabla, que hoy las sube a mano.
 */
export function ordenar<T extends DevolucionBase>(
  ds: T[],
  { col, dir }: { col: ColumnaOrden; dir: Direccion },
): T[] {
  const signo = dir === "asc" ? 1 : -1;
  return [...ds].sort((a, b) => {
    if (col === "alcance") {
      const pa = a.alcance === "sin_clasificar" ? 0 : 1;
      const pb = b.alcance === "sin_clasificar" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return signo * a.alcance.localeCompare(b.alcance, "es");
    }
    if (col === "cliente") {
      return signo * (a.persona_nombre ?? "").localeCompare(b.persona_nombre ?? "", "es");
    }
    if (col === "importe") {
      return signo * (importeDe(a) - importeDe(b));
    }
    // Fecha. El desempate por id mantiene el orden estable entre renders
    // cuando dos devoluciones caen el mismo día.
    const f = a.fecha.localeCompare(b.fecha);
    return f !== 0 ? signo * f : a.devolucion_id.localeCompare(b.devolucion_id);
  });
}

/* ---------------- El motivo ---------------- */

/**
 * Un motivo cabe en una celda o no cabe.
 *
 * En los datos reales conviven un motivo de catálogo ("Migración Airtable —
 * devolución de programa") y un mensaje de WhatsApp entero pegado en el campo
 * ("Hola Alejandro, espero que estés muy bien..."). El segundo no se puede
 * pintar en una columna, pero tampoco se puede tirar: es literalmente el
 * "por qué" de la devolución, que es lo que se viene a leer.
 *
 * Así que se corta por palabra —nunca a mitad— y quien llama ofrece el resto.
 */
export function resumenMotivo(
  motivo: string | null,
  limite = 90,
): { texto: string; recortado: boolean } {
  const m = (motivo ?? "").trim().replace(/\s+/g, " ");
  if (!m) return { texto: "", recortado: false };
  if (m.length <= limite) return { texto: m, recortado: false };
  const corte = m.slice(0, limite);
  const ultimoEspacio = corte.lastIndexOf(" ");
  return {
    texto: (ultimoEspacio > limite * 0.6 ? corte.slice(0, ultimoEspacio) : corte).trimEnd(),
    recortado: true,
  };
}
