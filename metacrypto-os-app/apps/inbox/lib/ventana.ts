// La ventana de 24 h de WhatsApp: lógica pura, sin acceso a datos.
//
// Regla de Meta: solo se puede escribir libremente durante 24 h desde el
// ÚLTIMO MENSAJE DEL CLIENTE. Enviar una plantilla no abre la ventana —
// solo la abre que conteste él. Fuera de ella únicamente entran plantillas.
//
// Vive aquí, y no dentro de un componente, porque lo usan dos sitios: el
// servidor al pintar el hilo y el navegador para bloquear el compositor en
// cuanto vence, aunque el chat lleve horas abierto (10-ago-2026: la página
// se había pintado antes del vencimiento, el aviso nunca apareció y el
// primer intento de escribir se comió el error de Meta).

export const VENTANA_24H_MS = 24 * 3600 * 1000;

function instante(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** ¿Hay que bloquear el envío libre? Sin entrante o fecha ilegible → sí (lado seguro). */
export function ventanaCerrada(ultimoEntranteAt: string | null | undefined, ahora: Date): boolean {
  const t = instante(ultimoEntranteAt);
  if (t === null) return true;
  return ahora.getTime() - t > VENTANA_24H_MS;
}

/** Milisegundos hasta que venza. 0 si ya venció → no hay nada que programar. */
export function msHastaCierre(ultimoEntranteAt: string | null | undefined, ahora: Date): number {
  const t = instante(ultimoEntranteAt);
  if (t === null) return 0;
  return Math.max(0, t + VENTANA_24H_MS - ahora.getTime());
}

/** "9 ago a las 11:29" en hora de Madrid, para que el aviso diga cuándo fue. */
export function momentoEnMadrid(iso: string | null | undefined): string | null {
  const t = instante(iso);
  if (t === null) return null;
  const d = new Date(t);
  const zona = "Europe/Madrid";
  const dia = new Intl.DateTimeFormat("es-ES", { timeZone: zona, day: "numeric", month: "short" }).format(d);
  const hora = new Intl.DateTimeFormat("es-ES", {
    timeZone: zona,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${dia} a las ${hora}`;
}
