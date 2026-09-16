import PDFDocument from "pdfkit";
// Rutas RELATIVAS y sin `server-only`, a propósito: este fichero tiene tests, y
// bajo vitest el alias `@/` no resuelve en runtime. Es la misma disciplina que
// `lib/canales.ts:2-4`. No hace falta el guard de servidor porque acá no entra
// ningún secreto: plantilla + datos → Buffer, y nada más.
import { PLANTILLAS } from "./contratos/plantillas";
import { BLOQUE_FIRMA, PLANTILLA_VENTA_NUEVA_V2 } from "./contratos/plantilla-v2";
import { firmaPngBase64 } from "./contratos/firma";
// Solo el tipo: `import type` se borra al compilar, así que esto NO arrastra
// `contrato-datos.ts` (ni sus importaciones) dentro de este módulo.
import type { TipoContratoVenta } from "./contrato-datos";

// ============================================================
// El PDF del contrato. Portado de `metacrypto-club-cockpit/contratos/
// generar-contrato.mjs`, que produjo los 4 ejemplos que Patricio revisó y
// aprobó el 7-sep. Márgenes, fuente e interlineado se copian TAL CUAL: son lo
// que produce el documento que ya fue aceptado, no una elección de estilo que
// se pueda retocar aquí.
//
// Página y fuente salen medidas del contrato real de esa clienta, no elegidas: A4
// (595×842 pt) y Times-Roman / Times-Bold, que pdfkit trae de fábrica. Sus
// métricas son módulos aparte que pdfkit carga por un atajo interno de su
// package.json (`imports`: `#standard-fonts/*`), con un
// `createRequire(import.meta.url)`.
//
// 🔴 Aquí decía que "el rastreo de dependencias de Next las incluye en el
// despliegue. No hay que configurar nada para que funcionen en Vercel — se
// comprobó antes de escribir esto." Era FALSO, y salió caro: el 2026-09-10
// entraron 5 ventas de prueba en producción y las 5 murieron con
// `Cannot find module '#standard-fonts/Helvetica'`, sin contrato, sin correo
// y sin error en pantalla. Sí hay que configurar dos cosas, y están en
// `next.config.mjs` con el porqué: `serverExternalPackages` y
// `outputFileTracingIncludes`. Ninguna de las dos sola alcanza.
//
// Y es Helvetica, no Times, porque `new PDFDocument()` carga la fuente por
// defecto antes de que este fichero pida Times-Roman.
//
// Ni el texto ni la firma se leen del disco, por lo mismo: un `readFileSync`
// con ruta construida no lo detecta el rastreo, y el fallo aparecería solo en
// producción. Los dos viven en `lib/contratos/`, generados desde el cockpit.
//
// Devuelve un Buffer y no escribe a ningún sitio: en una función serverless no
// hay disco donde dejar el archivo. Quien llama decide qué hacer con él.
//
// 🔵 DESDE EL 16-SEP ESTO SON DOS MITADES y no una función de un tirón, porque
// el contrato v2 se firma dentro del OS: `textoContrato()` da el texto que el
// closer ve y puede editar como un Word, y `renderizarContratoPDF()` lo pinta
// pegándole detrás el bloque de firma, que el closer NO toca — lo pone el
// sistema. `generarContratoPDF()` es la suma exacta de las dos, y lo que
// mantiene honesto que existan por separado.
// ============================================================

// Los mismos valores que `generar-contrato.mjs:24-26`. Aproximados del PDF de
// esa clienta; el único sitio donde se afinan si Berni pide otro margen.
const MARGEN = { top: 100, bottom: 90, left: 85, right: 85 };
const CUERPO = 11;
const INTERLINEA = 1.45;

export type DatosContrato = Record<string, string>;

/** Un bloque por párrafo: el .md separa con línea en blanco. */
function bloques(plantilla: string): string[] {
  return plantilla
    .trim()
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * Deshace el ancho del .md: dentro de un párrafo, los saltos de la plantilla
 * dicen dónde cortó la línea quien la escribió, no dónde tiene que cortarla el
 * PDF. Los separadores de bloque (línea en blanco) se respetan.
 *
 * 🔴 Se llama ANTES de sustituir los placeholders, y ese orden es todo el
 * truco. La lista de la cláusula 1 llega como UN valor con saltos dentro
 * (`prestaciones()`, contrato-datos.ts): si se colapsara después, las líneas
 * a) b) c) acabarían aplastadas en un párrafo —que es justo lo que hacía la
 * versión anterior de este fichero—. Colapsando antes, el único `\n` que
 * sobrevive dentro de un bloque es el que puso un valor, o el que escribió el
 * closer en el editor, y el renderer puede respetarlo sin adivinar de dónde
 * viene.
 *
 * La alternativa que traía el plan —colapsar en el renderer solo los saltos
 * seguidos de indentación— se descartó porque es falsa en este repo: las dos
 * plantillas v1 parten sus párrafos a ~100 caracteres SIN indentar la
 * continuación (15 bloques de cada una), así que habría convertido en listas
 * medio contrato ya emitido.
 *
 * La contrapartida de este orden, escrita para que nadie se la encuentre de
 * golpe: un VALOR que traiga `\n` enruta su bloque entero por la rama de lista
 * del renderer —una línea por renglón, a la izquierda, sin justificar—. Es lo
 * que se quiere para `prestaciones()` y hoy no afecta a nadie más (`parrafoBonos`
 * une con "; ", y `formaPago` y `calendarioCuotas` devuelven una frase), pero
 * quien añada un placeholder multilínea está eligiendo eso, no un párrafo.
 */
function desenvolver(plantilla: string): string {
  return bloques(plantilla)
    .map((b) => b.replace(/\n\s*/g, " "))
    .join("\n\n");
}

/**
 * Los únicos placeholders a los que se les permite venir vacíos, porque su
 * ausencia es un caso real y no un dato perdido: una venta puede no llevar
 * bonos, y un contrato NACE sin la firma del cliente — se emite, se envía, y
 * la firma llega después o no llega.
 *
 * Es una lista y no una convención de nombres a propósito: añadir uno tiene
 * que ser una decisión, no algo que se cuele por llamarse de cierta forma.
 */
const OPCIONALES = new Set(["bonos", "firma_cliente", "firma_evidencia"]);

/**
 * Sustituye `{{placeholder}}` por su valor.
 *
 * Lanza si falta uno, y esto es deliberado: un contrato con un `{{importe_total}}`
 * literal impreso es peor que no generarlo. Quien llama corre dentro de
 * `after()` y captura — la venta ya está cobrada y no puede romperse por esto.
 */
function rellenar(texto: string, datos: DatosContrato): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = datos[k];
    if (v === undefined || (v === "" && !OPCIONALES.has(k))) {
      throw new Error(`Falta el dato "${k}" para el contrato.`);
    }
    return v;
  });
}

/**
 * Qué plantilla usa cada tipo, y si el bloque de firma va aparte.
 *
 * v1 (las dos generadas desde el cockpit): el bloque de firma está DENTRO del
 * texto y no se separa — son contratos ya emitidos, no se firman en el OS, y
 * su salida no puede cambiar.
 * v2: el cuerpo es lo que el closer edita; el bloque de firma lo añade el
 * renderer, para que nadie pueda borrar sin querer la línea donde firma el
 * cliente.
 */
export function plantillaDe(tipo: TipoContratoVenta): { cuerpo: string; firma: string } {
  if (tipo === "venta_nueva_v2") return { cuerpo: PLANTILLA_VENTA_NUEVA_V2, firma: BLOQUE_FIRMA };
  const p = PLANTILLAS[tipo];
  if (!p) throw new Error(`No hay plantilla para el contrato "${tipo}".`);
  return { cuerpo: p, firma: "" };
}

/**
 * La mitad que se guarda y se edita: el cuerpo con los datos ya metidos y sin
 * el ancho del .md, que en un editor de texto solo estorba.
 *
 * Lanza si falta un dato (salvo los OPCIONALES). El bloque de firma vuelve SIN
 * rellenar: `firma_cliente` llega más tarde, cuando el cliente firma, así que
 * rellenarlo aquí congelaría un hueco vacío en el texto guardado.
 */
export function textoContrato(
  tipo: TipoContratoVenta,
  datos: DatosContrato,
): { cuerpo: string; firma: string } {
  const p = plantillaDe(tipo);
  return { cuerpo: rellenar(desenvolver(p.cuerpo), datos), firma: p.firma };
}

/**
 * La mitad que produce el PDF. `cuerpo` ya viene relleno (o editado a mano);
 * `bloqueFirma` se rellena aquí con `datos`.
 *
 * 🔴 `datos` tiene que traer TODO lo que `BLOQUE_FIRMA` pide, no solo los dos
 * campos de la firma. Hoy son cuatro: `firma_cliente` y `firma_evidencia` (que
 * pueden venir vacíos, están en OPCIONALES) y también `cliente_nombre`
 * ("Nombre y apellidos:") y `fecha_firma` ("Fecha de emisión del contrato:"),
 * que NO pueden. Un endpoint de firma que pase solo `{firma_cliente,
 * firma_evidencia}` hace que `rellenar` lance en el peor momento posible: con
 * el cliente mirando el contrato y el dedo en el botón. Lo suyo es guardar el
 * diccionario entero al emitir y volver a pasarlo al firmar.
 *
 * Devuelve un Buffer y no escribe a ningún sitio: en una función serverless no
 * hay disco. Quien llama decide qué hacer con él.
 */
export async function renderizarContratoPDF(
  cuerpo: string,
  bloqueFirma: string,
  datos: DatosContrato,
): Promise<Buffer> {
  // Los saltos de Windows salen de un textarea, no de las plantillas: un
  // `\r` suelto cuenta como carácter y se pintaría dentro de la línea.
  const texto = cuerpo.replace(/\r\n?/g, "\n");

  const doc = new PDFDocument({ size: "A4", margins: MARGEN, autoFirstPage: true });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);
  });

  const ancho = doc.page.width - MARGEN.left - MARGEN.right;
  const firma = Buffer.from(firmaPngBase64(), "base64");
  const gap = CUERPO * (INTERLINEA - 1);

  /**
   * Pinta un bloque. `delSistema` distingue el bloque de firma que añade el
   * renderer del texto que el closer puede editar.
   *
   * 🔴 No es un adorno: las DOS plantillas v1 ya traen una línea
   * "Firma digital:" dentro de su texto (plantillas.ts:135 y 269), que el
   * cliente rellenaba a mano. Si la regla de la firma se aplicara a todo el
   * documento, esos contratos —ya emitidos, y que se regeneran— saldrían con
   * una raya de subrayado que nunca tuvieron. Se descubrió comparando el PDF
   * de un cliente antes y después de este cambio, operador a operador.
   *
   * De paso deja una propiedad sana: por mucho que alguien escriba
   * "Firma digital: Fulano" en el texto editable, no se pinta como una firma.
   */
  const pintar = (b: string, delSistema: boolean) => {
    // La firma del fundador. Va primero porque un bloque de imagen no lleva
    // texto que pintar.
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(b)) {
      doc.moveDown(0.8).image(firma, { width: 190 }).moveDown(0.8);
      return;
    }

    // "### 1. Objeto" → título de cláusula, en negrita y sin justificar.
    const h = b.match(/^###\s+(.*)$/);
    if (h) {
      doc
        .moveDown(1)
        .font("Times-Bold")
        .fontSize(CUERPO)
        .text(h[1], { width: ancho, align: "left" })
        .moveDown(0.75);
      return;
    }

    // "Firma digital: Nombre" → la etiqueta en redonda y el nombre en cursiva.
    // Es lo que hace que un nombre tecleado se lea como una firma y no como un
    // dato más. Sin firmar deja la línea en blanco donde firmará el cliente:
    // el PDF se envía antes de que exista la firma y tiene que leerse entero.
    const f = delSistema ? b.match(/^(Firma digital:)\s*(.*)$/s) : null;
    if (f) {
      const nombre = f[2].trim();
      doc.font("Times-Roman").fontSize(CUERPO).text(`${f[1]} `, { width: ancho, continued: true });
      if (nombre) {
        doc.font("Times-Italic").fontSize(CUERPO + 2).text(nombre, { width: ancho });
      } else {
        doc.font("Times-Roman").fontSize(CUERPO).text("_".repeat(34), { width: ancho });
      }
      doc.moveDown(0.55);
      return;
    }

    // Una lista: una línea por entrada, a la izquierda y sin justificar (una
    // línea corta justificada se estira fea). Los saltos que llegan aquí los
    // puso un valor o el closer — los del .md ya los deshizo `desenvolver()`.
    if (b.includes("\n")) {
      doc.font("Times-Roman").fontSize(CUERPO);
      for (const linea of b.split("\n").map((l) => l.trim()).filter(Boolean)) {
        doc.text(linea, { width: ancho, align: "left", lineGap: gap }).moveDown(0.25);
      }
      doc.moveDown(0.3);
      return;
    }

    // El título del documento: la primera línea del .md, centrada.
    const esTitulo = b.startsWith("CONTRATO DE ");
    doc
      .font(esTitulo ? "Times-Bold" : "Times-Roman")
      .fontSize(esTitulo ? 13 : CUERPO)
      .text(b, { width: ancho, align: esTitulo ? "center" : "justify", lineGap: gap })
      .moveDown(esTitulo ? 1.5 : 0.55);
  };

  // Un bloque que se queda vacío no llega a pintarse: `bloques()` lo filtra
  // después de rellenar. Lo usa el párrafo de bonos —una venta sin bonos no
  // tiene que enseñar un hueco— y la evidencia de una firma que aún no existe.
  for (const b of bloques(texto)) pintar(b, false);
  if (bloqueFirma) {
    for (const b of bloques(rellenar(desenvolver(bloqueFirma), datos))) pintar(b, true);
  }

  doc.end();
  return terminado;
}

/**
 * La función de siempre: tipo + datos → PDF, de un tirón. Ahora es exactamente
 * la suma de las dos mitades.
 *
 * Ojo antes de borrarla por "no la usa nadie": es verdad que producción ya no
 * la llama —`contrato-envio.ts` llama a las dos mitades por separado—, pero no
 * está aquí de recuerdo. El test "generarContratoPDF es exactamente
 * textoContrato + renderizar" compara el texto dibujado de los dos caminos y
 * exige que sea idéntico: es lo que impide que las mitades se separen sin que
 * nadie se entere, y para eso hace falta que la suma exista.
 */
export async function generarContratoPDF(
  tipo: TipoContratoVenta,
  datos: DatosContrato,
): Promise<Buffer> {
  const { cuerpo, firma } = textoContrato(tipo, datos);
  return renderizarContratoPDF(cuerpo, firma, datos);
}
