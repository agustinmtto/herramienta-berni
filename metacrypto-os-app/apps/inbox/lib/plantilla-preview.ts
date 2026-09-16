// ============================================================
// Sustitución de variables de una plantilla de WhatsApp, para previsualizar.
//
// Regla de este módulo: NADA de imports "@/" en runtime (vitest no resuelve
// el alias). Aquí no hace falta ninguno: es una función de texto.
//
// Existe porque el picker del inbox enseñaba solo el nombre técnico de la
// plantilla (`recordatorio_1h_es`) y había que elegirla a ciegas para ver qué
// decía. Berni, 14-ago-2026: "me gustaría que se pudiera ver la
// previsualización de la plantilla como tal y no solamente el nombre".
// ============================================================

/**
 * Rellena `{{variable}}` con lo que haya en `valores`.
 *
 * Lo que falta NO se sustituye por vacío: se marca como `[variable]`. Un hueco
 * vacío en la previsualización se lee como un mensaje que dice
 * "Únete desde este enlace:  " y parece que la plantilla está rota; el
 * marcador dice la verdad — ese dato todavía no se ha rellenado. Y en la
 * lista, donde solo se conoce el nombre del cliente, es lo que convierte la
 * previsualización en algo legible en vez de en una frase mutilada.
 */
export function previsualizar(body: string, valores: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, nombre: string) => {
    const v = valores[nombre];
    // `?? ""` no vale: una variable presente pero vacía (el input que el
    // operador aún no ha tecleado) debe marcarse igual que una ausente.
    return v != null && v.trim() !== "" ? v : `[${nombre}]`;
  });
}

/** ¿Queda algo por rellenar? Sirve para desactivar el botón de enviar. */
export function faltanVariables(
  variables: string[],
  valores: Record<string, string>,
): string[] {
  return variables.filter((v) => (valores[v] ?? "").trim() === "");
}

/**
 * Resumen de una línea para la lista: sin saltos de línea y recortado.
 *
 * Los saltos se colapsan a "·" en vez de a un espacio: las plantillas usan
 * la línea en blanco como separación de párrafos, y aplanarlas a espacios
 * pega el saludo con el cuerpo en un muro ilegible.
 */
export function resumenUnaLinea(texto: string, max = 120): string {
  const plano = texto.replace(/\s*\n+\s*/g, " · ").trim();
  return plano.length <= max ? plano : `${plano.slice(0, max - 1).trimEnd()}…`;
}
