// Helpers puros del formulario Nueva venta (sin server-only: los usa el client).
export type CuotaDraft = { monto: number; fecha: string };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** true si el string es una fecha ISO (YYYY-MM-DD) que existe en el calendario. */
export function esFechaISO(iso: string): boolean {
  if (!ISO_RE.test(iso ?? "")) return false;
  const [y, mo, d] = iso.split("-").map(Number);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= lastDay;
}

/**
 * Suma meses a una fecha ISO (UTC), ajustando al último día si el mes destino es más corto.
 * Devuelve "" si la fecha de entrada no es un ISO válido (el input date del form puede
 * estar vacío mientras el usuario edita — antes esto lanzaba RangeError y rompía el render).
 */
export function addMonths(iso: string, m: number): string {
  if (!esFechaISO(iso)) return "";
  const [y, mo, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, mo - 1 + m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * N cuotas mensuales sobre (valorTotal - cobroHoy) en EUROS ENTEROS;
 * la última absorbe la diferencia para que la suma cuadre exacta con el restante.
 * (Alex puede editar cada fila después si el trato lleva céntimos.)
 */
export function generarCuotas(valorTotal: number, cobroHoy: number, n: number, fechaPago: string): CuotaDraft[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  // Fecha de pago vacía o malformada → no hay base para calcular vencimientos.
  if (!esFechaISO(fechaPago)) return [];
  const restante = Math.max(0, (valorTotal || 0) - (cobroHoy || 0));
  const base = Math.floor(restante / n);
  const out: CuotaDraft[] = [];
  for (let i = 1; i <= n; i++) {
    const monto = i === n ? Math.round((restante - base * (n - 1)) * 100) / 100 : base;
    out.push({ monto, fecha: addMonths(fechaPago, i) });
  }
  return out;
}

/**
 * Prefijo + número → E.164. null si no queda un número utilizable.
 *
 * Todo lo de aquí existe por el mismo motivo: **un teléfono mal formado no
 * falla, miente.** WhatsApp lo acepta y lo da por entregado sin que llegue a
 * nadie, así que el error sólo se descubre cuando el cliente dice que no
 * recibió nada. Dos casos reales, por las dos puertas opuestas:
 *
 * - **Falta prefijo:** `+593595000111222` (un cliente). El selector no tenía
 *   Paraguay, se eligió Ecuador y se pegó el número entero detrás. Por eso sin
 *   prefijo de país (la opción "Otro") el número tiene que traer el suyo con
 *   `+` o `00`, y un número pelado no se guarda.
 * - **Sobra prefijo:** `+972972500111222` (otro cliente, 12-ago-2026).
 *   El número ya venía con el 972 de Israel y se le puso otro encima. Resultado:
 *   WhatsApp abrió dos conversaciones, la buena quedó sin cliente asociado y la
 *   bienvenida salió al número inventado.
 *
 * De ahí las dos reglas: si el número declara su país (`+`/`00`) manda él, y si
 * viene en dígitos pelados empezando por el prefijo elegido se descuenta sólo
 * cuando lo que queda detrás sigue siendo un número completo.
 */
export function telefonoE164(prefijo: string, numero: string): string | null {
  const crudo = (numero || "").trim();
  const num = crudo.replace(/\D/g, "");
  if (!num) return null;
  const pre = (prefijo || "").replace(/\D/g, "");

  // El número ya declara su país (lo escribió con `+` o con `00`). Antes esto
  // se ignoraba cuando había prefijo seleccionado: el `replace(/\D/g,"")` de
  // arriba se comía el `+` y el prefijo se pegaba encima igual. Así nació
  // +972972500111222 (otro cliente, 12-ago-2026) — y el caso del `00`
  // era peor todavía, porque los dos ceros se quedaban dentro del número:
  // "+34" + "0034620111444" = +340034620111444.
  const declaraPais = crudo.startsWith("+") || num.startsWith("00");
  if (declaraPais) {
    const internacional = num.startsWith("00") ? num.slice(2) : num;
    return internacional.length >= 8 ? `+${internacional}` : null;
  }

  if (pre) {
    // Dígitos pelados que empiezan por el prefijo del país elegido. Aquí no hay
    // declaración explícita, así que hace falta un criterio para distinguir
    // "972500111222" (Israel con su prefijo ya puesto) de un número nacional
    // que casualmente empieza igual que su país.
    //
    // El criterio es la longitud de lo que queda detrás: un país + su número
    // completo deja 9 dígitos o más; un número nacional que empieza por su
    // propio código deja menos. Ejemplos reales del catálogo:
    //   +972 972500111222 → detrás quedan 9  → el prefijo estaba duplicado
    //   +52  5212345678   → detrás quedan 8  → el 52 es parte del número
    //   +972 972345678    → detrás quedan 6  → nacional israelí, intacto
    //
    // Conservador a propósito: ante la duda NO se toca el número. Duplicar un
    // prefijo crea un teléfono que no existe, pero recortarlo mal destruye uno
    // que sí — y WhatsApp da ambos por entregados sin que lleguen a nadie.
    if (num.startsWith(pre) && num.length - pre.length >= 9) return `+${num}`;
    return `+${pre}${num}`;
  }

  // Sin prefijo y sin `+`/`00`: no hay forma de adivinar el país.
  return null;
}
