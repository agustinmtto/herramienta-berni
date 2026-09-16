import { money } from "./format";

// ============================================================
// Helpers puros de cuotas. Sin acceso a red ni a la base: se testean solos.
// "hoy" se pasa como parámetro (no se lee del reloj) para que los tests sean
// deterministas y la página pueda calcular todo con una única fecha de corte.
// ============================================================

export type GrupoCuota = "vencida" | "mes" | "futura";

/** Vencida = venció antes de hoy. "mes" = vence dentro del mes en curso. */
export function clasificarCuota(fechaVencimiento: string, hoy: string): GrupoCuota {
  if (fechaVencimiento < hoy) return "vencida";
  return fechaVencimiento.slice(0, 7) === hoy.slice(0, 7) ? "mes" : "futura";
}

/** Días transcurridos desde el vencimiento; 0 si todavía no venció. */
export function diasRetraso(fechaVencimiento: string, hoy: string): number {
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fechaVencimiento}T00:00:00Z`);
  return ms <= 0 ? 0 : Math.round(ms / 86_400_000);
}

/** Saldo que queda en la cuota tras un abono. Redondea a céntimos. */
export function saldoTrasAbono(monto: number, importe: number): number {
  return Math.round((monto - importe) * 100) / 100;
}

/**
 * @deprecated Usa `money` de lib/format. Desde el 2-sep-2026 ya lleva los dos
 * decimales, así que esta función era una copia exacta en otro fichero — que
 * es como se llega a tener tres formas de escribir el mismo importe.
 *
 * Se mantiene como alias para no tocar de golpe sus 8 llamadas ni sus tests.
 * `format.ts` no importa nada, así que este módulo sigue siendo puro y vitest
 * lo resuelve sin alias.
 */
export const money2 = money;
