// ============================================================
// Las reglas del texto que el closer edita "como un Word" (spec, decisión 4).
//
// Son tres funciones puras —no tocan ni la base, ni Storage, ni el PDF— y
// viven aparte de `contrato-envio.ts` por una razón muy concreta: ese fichero
// lleva `server-only` y importa con el alias `@/`, que bajo vitest NO resuelve
// en runtime (misma disciplina que `contrato-pdf.ts:2-5`). Metidas allí, la
// única barrera que impide que un `{{importe_total}}` tecleado a mano llegue
// literal al PDF de un cliente no tendría ni un solo test. Aquí sí lo tiene.
//
// Sin importaciones a propósito: lo que no importa nada se puede importar
// desde cualquier sitio.
// ============================================================

/**
 * Los límites de lo que se acepta guardar. No son un formato: son un filtro
 * de accidentes. Un contrato de 200 caracteres no es una edición —es un
 * textarea que se vació con un Ctrl+A y una tecla—, y 60.000 son cinco veces
 * la plantilla entera: lo que pasa de ahí es un pegado de otra cosa.
 *
 * Referencia medida: la plantilla v2 rellena ronda los 9.000 caracteres.
 */
export const LARGO_MIN = 200;
export const LARGO_MAX = 60_000;

/**
 * El texto tal y como se guarda: los saltos de Windows fuera y sin espacio
 * sobrante en los bordes.
 *
 * `\r` se quita aquí y no solo en el renderer porque lo que se compara contra
 * `texto_final` para saber si hubo cambio es ESTA cadena: sin normalizar, el
 * mismo texto guardado desde Windows y desde un Mac se vería como dos textos
 * distintos y regeneraría el PDF sin que nadie hubiera cambiado una palabra.
 */
export function normalizarTexto(texto: string): string {
  return texto.replace(/\r\n?/g, "\n").trim();
}

/**
 * Qué tiene de malo este texto, si tiene algo. `null` es "se puede guardar".
 *
 * 🔴 Lo de `{{` no es una manía de estilo, es la única barrera que hay.
 * `renderizarContratoPDF` NO vuelve a pasar `rellenar()` sobre el cuerpo —lo
 * recibe ya relleno—, así que un `{{importe_total}}` tecleado en el editor
 * NO lanza en ninguna parte: se imprime tal cual en el PDF que firma el
 * cliente. `rellenar()` protege lo que sale de la plantilla; esto protege lo
 * que sale del teclado, y no hay una tercera comprobación más abajo.
 *
 * Se busca `{{` y no `{{clave}}` entero: media llave abierta ya delata la
 * intención, y quien escriba `{{` en un contrato de verdad (no pasa) tiene
 * dónde decirlo.
 *
 * Espera el texto YA pasado por `normalizarTexto`: los límites se miden sobre
 * lo que se va a guardar, no sobre los espacios que el textarea añadió.
 */
export function problemaDelTexto(texto: string): string | null {
  if (texto.length < LARGO_MIN) return "El texto es demasiado corto para ser un contrato.";
  if (texto.length > LARGO_MAX) return "El texto es demasiado largo.";
  if (texto.includes("{{")) return "El texto no puede llevar «{{»: los datos ya van metidos.";
  return null;
}

/**
 * Cierra los huecos que deja un placeholder opcional vacío.
 *
 * Una venta sin bonos deja `{{bonos}}` en blanco, y como es un bloque entero
 * de la plantilla el texto generado se queda con TRES líneas en blanco
 * seguidas donde iba. En el PDF no se ve —`bloques()` (contrato-pdf.ts) parte
 * por línea en blanco y filtra los vacíos—, pero en el textarea sí, y lo
 * primero que hace quien lo abre es borrarlas a mano.
 *
 * 🔴 Que el PDF no cambie no es una suposición: `bloques()` parte con
 * `/\n\s*\n/`, que es greedy y se traga las cuatro líneas de golpe igual que
 * se traga dos. Hay un test que lo fija comparando el texto DIBUJADO de los
 * dos PDF ("compactar el hueco de los bonos no cambia el PDF",
 * contrato-pdf.test.ts). Importa porque el PDF que se sube al generar sale
 * del cuerpo SIN compactar y el que se regenera al guardar sale del
 * compactado: si dejaran de coincidir, editar y volver a dejar el texto como
 * estaba produciría un documento distinto.
 *
 * Solo toca los saltos de 3 en adelante: los de 2 separan párrafos y los de 1
 * son las líneas de una lista (`prestaciones()`), que el renderer respeta.
 */
export function compactarHuecos(texto: string): string {
  return texto.replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
}
