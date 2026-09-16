import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import {
  generarContratoPDF,
  plantillaDe,
  renderizarContratoPDF,
  textoContrato,
} from "../contrato-pdf";
import { PLANTILLAS } from "../contratos/plantillas";
import { BLOQUE_FIRMA } from "../contratos/plantilla-v2";
import { compactarHuecos } from "../contrato-texto";

// Los mismos datos de los ejemplos que Patricio revisó y aprobó el 7-sep
// (`metacrypto-club-cockpit/contratos/*/ejemplos/datos-*.json`).
const VENTA_NUEVA = {
  cliente_nombre: "un cliente",
  bonos: "",
  duracion_meses: "12",
  importe_total: "8.000",
  metodo_pago: "Stripe",
  forma_pago:
    "PAGO EN 4 CUOTAS de 2.000€ cada una: la primera hoy, y las tres siguientes los días 07/10/2026, 07/11/2026 y 07/12/2026.",
  fecha_firma: "07/09/2026",
};

const AMPLIACION = {
  cliente_nombre: "una clienta",
  bonos: "",
  programa_previo_importe: "3.000",
  programa_nuevo_importe: "5.000",
  duracion_meses: "12",
  fecha_inicio: "1 de agosto de 2026",
  fecha_fin: "3 de septiembre de 2027",
  importe_ampliacion: "2.000",
  calendario_cuotas:
    "en 2 cuotas de 1.000€ cada una (primera cuota inmediata, segunda cuota al mes siguiente)",
  n_cuotas: "2",
  metodo_pago: "STRIPE",
  fecha_firma: "01-08-2026",
};

describe("generarContratoPDF", () => {
  // 🔴 Lo que esto protege es que la firma se EMBEBE de verdad en el PDF.
  //
  // El original lo comprobaba por el PESO: "más de 20 KB, porque la firma pesa
  // ~34 KB". Era un buen sustituto mientras la firma viviera en el código,
  // pero aquí no vive —`lib/contratos/firma.ts` explica por qué— y el trazo de
  // relleno pesa 200 bytes, así que ese umbral suspendía a un PDF perfecto.
  //
  // Bajar el número habría dejado un test que pasa siempre y no afirma nada.
  // En vez de eso se comprueba LA PROPIEDAD DIRECTAMENTE: que el PDF lleva un
  // XObject de imagen. Es lo que el peso intentaba insinuar, dicho sin rodeos,
  // y además no depende de cuál sea la firma cargada.
  //
  // (Medido: con el relleno, este PDF pesa 6.905 bytes y trae `/XObject` y
  // `/Image`. Sin ninguna imagen no traería ninguno de los dos.)
  const llevaImagen = (buf: Buffer) => {
    // latin1 y no utf8: el PDF es binario y utf8 destruiría bytes sueltos.
    // Las claves de la estructura son ASCII, así que sobreviven intactas.
    const crudo = buf.toString("latin1");
    return crudo.includes("/XObject") && crudo.includes("/Image");
  };

  it("produce un PDF de verdad para venta nueva, con la firma dentro", async () => {
    const buf = await generarContratoPDF("venta_nueva", VENTA_NUEVA);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(llevaImagen(buf)).toBe(true);
  });

  it("produce un PDF de verdad para ampliación, con la firma dentro", async () => {
    const buf = await generarContratoPDF("ampliacion", AMPLIACION);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    // La misma comprobación que la de venta nueva, y por el mismo motivo — lo
    // señaló el revisor: una regresión que rompiera el embed de la imagen solo
    // en esta plantilla habría pasado el test igual.
    expect(llevaImagen(buf)).toBe(true);
  });

  // 🔴 El guard que de verdad importa. Un contrato que sale con
  // "{{importe_total}}" impreso es peor que uno que no se genera: el primero
  // llega a tres bandejas y a un cliente, el segundo deja un error en consola.
  it("LANZA si falta un dato, en vez de imprimir el placeholder", async () => {
    const { importe_total: _, ...incompleto } = VENTA_NUEVA;
    await expect(generarContratoPDF("venta_nueva", incompleto as never)).rejects.toThrow(
      /importe_total/,
    );
  });

  it("LANZA si un dato viene vacío", async () => {
    await expect(
      generarContratoPDF("venta_nueva", { ...VENTA_NUEVA, cliente_nombre: "" }),
    ).rejects.toThrow(/cliente_nombre/);
  });

  it("no queda ningún placeholder sin sustituir en las plantillas usadas", () => {
    // Comprueba lo contrario del test anterior: que los datos de ejemplo cubren
    // TODOS los placeholders de su plantilla. Si mañana se le añade uno al .md
    // y no a los datos, esto lo señala.
    for (const [tipo, datos] of [
      ["venta_nueva", VENTA_NUEVA],
      ["ampliacion", AMPLIACION],
    ] as const) {
      const usados = new Set(
        [...PLANTILLAS[tipo].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
      );
      for (const p of usados) expect(Object.keys(datos)).toContain(p);
    }
  });

  it("las dos plantillas llegaron enteras desde el cockpit", () => {
    // Marcadores del principio y del final de cada documento: si el export
    // recortó el texto, esto se cae.
    expect(PLANTILLAS.venta_nueva).toContain("CONTRATO DE PRESTACIÓN DE SERVICIOS FORMATIVOS");
    expect(PLANTILLAS.venta_nueva).toContain("### 9. Aceptación");
    expect(PLANTILLAS.ampliacion).toContain("CONTRATO DE AMPLIACIÓN DE SERVICIOS FORMATIVOS");
    expect(PLANTILLAS.ampliacion).toContain("### 2. Período de Vigencia");
    // Las comillas tipográficas y el € sobrevivieron al paso por TypeScript.
    expect(PLANTILLAS.venta_nueva).toContain("“EL INSTRUCTOR”");
    expect(PLANTILLAS.venta_nueva).toContain("€");
  });
});

// Los datos de una venta v2: los mismos de arriba más lo que solo existe en la
// plantilla nueva. Las prestaciones llegan como UN valor con saltos dentro —
// así las devuelve `prestaciones()` en contrato-datos.ts—, y la firma llega
// vacía porque el contrato nace sin firmar.
const V2 = {
  ...VENTA_NUEVA,
  prestaciones: "a) Uno.\nb) Dos.\nc) Tres.",
  firma_cliente: "",
  firma_evidencia: "",
};

const EVIDENCIA =
  "Firmado electrónicamente el 16/09/2026 a las 10:00 (Europe/Madrid) desde la IP 1.2.3.4.";

/**
 * El texto que de verdad quedó pintado en el PDF, una entrada por línea.
 *
 * Hace falta porque las dos alternativas baratas —comparar tamaños, o
 * conformarse con que no lanzó— no distinguen "la lista salió en tres líneas"
 * de "la lista salió aplastada en un párrafo", que es justo lo que este cambio
 * tiene que arreglar. Un test que no sabe distinguir las dos cosas no está
 * probando nada.
 *
 * pdfkit escribe cada línea como un array `[<hex> kern <hex>…] TJ` dentro de un
 * flujo comprimido: se descomprime, se decodifica el hex (WinAnsi, que para las
 * fuentes estándar coincide con latin1) y cada TJ es una línea.
 *
 * 🔴 En un párrafo JUSTIFICADO pdfkit reparte los espacios como
 * desplazamientos, así que el texto extraído sale sin ellos
 * ("secelebraelpresente"). Por eso todo lo que se compara pasa por
 * `sinEspacios`. Las líneas alineadas a la izquierda sí los conservan.
 */
function lineasDelPDF(pdf: Buffer): string[] {
  const crudo = pdf.toString("latin1"); // latin1 = 1 byte por carácter: los índices valen como offsets
  const lineas: string[] = [];
  for (const m of crudo.matchAll(/stream\r?\n/g)) {
    const ini = (m.index ?? 0) + m[0].length;
    const fin = crudo.indexOf("endstream", ini);
    let flujo: string;
    try {
      flujo = inflateSync(pdf.subarray(ini, fin)).toString("latin1");
    } catch {
      continue;
    }
    // Solo los flujos de página: la firma del fundador es un PNG que también
    // descomprime, y sus píxeles no son texto.
    if (!flujo.startsWith("1 0 0 -1 0 ")) continue;
    for (const tj of flujo.matchAll(/\[(.*?)\]\s*TJ/gs)) {
      let linea = "";
      for (const hex of tj[1].matchAll(/<([0-9a-fA-F]*)>/g)) {
        linea += Buffer.from(hex[1], "hex").toString("latin1");
      }
      if (linea) lineas.push(linea);
    }
  }
  // Si pdfkit cambiara cómo escribe el texto, esto se queda a cero y todos los
  // tests que lo usan pasarían en verde sin mirar nada. Mejor romperlo aquí.
  if (!lineas.length) throw new Error("No se pudo leer el texto del PDF.");
  return lineas;
}

const sinEspacios = (s: string) => s.replace(/\s+/g, "");

describe("textoContrato — la mitad que Alex edita", () => {
  it("v1: el cuerpo es la plantilla entera rellena y no hay bloque aparte", () => {
    const { cuerpo, firma } = textoContrato("venta_nueva", VENTA_NUEVA);
    expect(cuerpo).toContain("un cliente");
    expect(cuerpo).toContain("Firmado electrónicamente");
    expect(firma).toBe("");
    expect(cuerpo).not.toMatch(/\{\{/);
  });

  it("v2: el cuerpo NO lleva el bloque de firma, y el bloque viene sin rellenar", () => {
    const { cuerpo, firma } = textoContrato("venta_nueva_v2", V2);
    expect(cuerpo).not.toContain("Firmado electrónicamente");
    expect(cuerpo).toContain("a) Uno.\nb) Dos.\nc) Tres.");
    expect(firma).toBe(BLOQUE_FIRMA);
    expect(cuerpo).not.toMatch(/\{\{/);
  });

  // 🔴 El test que sostiene todo el diseño. El cuerpo que se guarda y se edita
  // lleva los saltos de la LISTA (los puso un valor) y no lleva los del .md
  // (los puso el ancho con el que alguien escribió la plantilla). Si se
  // colapsaran los dos, la lista sale en un párrafo; si no se colapsara
  // ninguno, cada renglón del .md sale como una línea suelta.
  it("el cuerpo conserva los saltos de la lista y deshace los del .md", () => {
    const { cuerpo } = textoContrato("venta_nueva_v2", V2);
    expect(cuerpo).toContain("a) Uno.\nb) Dos.\nc) Tres.");
    expect(cuerpo).toContain(
      "se celebra el presente contrato de prestación de servicios formativos, conforme a las siguientes cláusulas:",
    );
  });

  it("LANZA si falta un dato, igual que antes", () => {
    const { importe_total: _, ...incompleto } = VENTA_NUEVA;
    expect(() => textoContrato("venta_nueva", incompleto as never)).toThrow(/importe_total/);
  });
});

describe("renderizarContratoPDF — la mitad que firma el cliente", () => {
  it("v2 sin firmar y firmado producen PDFs distintos, y los dos son PDF", async () => {
    const { cuerpo, firma } = textoContrato("venta_nueva_v2", V2);
    const sinFirmar = await renderizarContratoPDF(cuerpo, firma, V2);
    const firmado = await renderizarContratoPDF(cuerpo, firma, {
      ...V2,
      firma_cliente: "un cliente",
      firma_evidencia: EVIDENCIA,
    });
    expect(sinFirmar.subarray(0, 5).toString()).toBe("%PDF-");
    expect(firmado.subarray(0, 5).toString()).toBe("%PDF-");
    expect(firmado.length).toBeGreaterThan(sinFirmar.length);

    // Lo que de verdad los diferencia, mirando el texto pintado y no el tamaño:
    // el sin firmar enseña la línea en blanco donde firmará; el firmado, la
    // evidencia. Y la evidencia NO puede asomar en el que no está firmado.
    const sin = lineasDelPDF(sinFirmar).join("\n");
    const con = lineasDelPDF(firmado).join("\n");
    expect(sinEspacios(sin)).toContain(sinEspacios("Firma digital:"));
    expect(sin).toMatch(/_{10,}/);
    expect(sinEspacios(sin)).not.toContain(sinEspacios("desde la IP"));
    expect(sinEspacios(con)).toContain(sinEspacios(EVIDENCIA));
    expect(con).not.toMatch(/_{10,}/);
  });

  it("el nombre firmado va en cursiva; el sin firmar no gasta cursiva", async () => {
    // La cursiva se comprueba en los recursos del PDF y no a ojo: si el nombre
    // se pintara en redonda, Times-Italic no se llegaría a embeber.
    const { cuerpo, firma } = textoContrato("venta_nueva_v2", V2);
    const sinFirmar = await renderizarContratoPDF(cuerpo, firma, V2);
    const firmado = await renderizarContratoPDF(cuerpo, firma, {
      ...V2,
      firma_cliente: "un cliente",
      firma_evidencia: EVIDENCIA,
    });
    expect(firmado.toString("latin1")).toContain("Times-Italic");
    expect(sinFirmar.toString("latin1")).not.toContain("Times-Italic");
  });

  it("la lista de prestaciones se pinta una línea por prestación", async () => {
    const { cuerpo, firma } = textoContrato("venta_nueva_v2", V2);
    const lineas = lineasDelPDF(await renderizarContratoPDF(cuerpo, firma, V2)).map(sinEspacios);
    expect(lineas).toContain("a)Uno.");
    expect(lineas).toContain("b)Dos.");
    expect(lineas).toContain("c)Tres.");
    // Y no las tres en el mismo renglón, que es como salían antes de partir el
    // generador: el placeholder se rellenaba después de aplastar el bloque.
    expect(lineas.some((l) => l.includes("a)Uno.b)Dos."))).toBe(false);
  });

  it("firma_cliente vacío NO lanza (está en OPCIONALES) pero un dato de verdad SÍ", async () => {
    const { cuerpo, firma } = textoContrato("venta_nueva_v2", V2);
    // Los dos casos juntos a propósito: el primero solo demuestra algo si el
    // segundo demuestra que `rellenar` sigue vigilando el bloque de firma.
    await expect(renderizarContratoPDF(cuerpo, firma, V2)).resolves.toBeInstanceOf(Buffer);
    // 🔴 Los DOS que `BLOQUE_FIRMA` necesita además de la firma, y que el
    // endpoint de firma tiene que acordarse de pasar: `cliente_nombre`
    // ("Nombre y apellidos:") y `fecha_firma` ("Fecha de emisión del
    // contrato:"). Si llegan vacíos, `rellenar` lanza justo cuando el cliente
    // pulsa firmar, con el contrato ya delante. Que se caiga aquí y no allí.
    for (const campo of ["cliente_nombre", "fecha_firma"] as const) {
      await expect(
        renderizarContratoPDF(cuerpo, firma, { ...V2, [campo]: "" }),
      ).rejects.toThrow(new RegExp(campo));
    }
  });

  it("un texto editado a mano, sin placeholders, se renderiza sin lanzar", async () => {
    const { cuerpo, firma } = textoContrato("venta_nueva_v2", V2);
    const editado = cuerpo.replace("a) Uno.", "a) Uno, y además otra cosa que añadió Alex.");
    const buf = await renderizarContratoPDF(editado, firma, V2);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(lineasDelPDF(buf).map(sinEspacios)).toContain(
      sinEspacios("a) Uno, y además otra cosa que añadió Alex."),
    );
  });

  // 🔴 El PDF que se sube al generar sale del cuerpo TAL CUAL; el que se
  // regenera al guardar una edición sale del cuerpo compactado
  // (`compactarHuecos`, contrato-texto.ts), que cierra las tres líneas en
  // blanco que deja una venta sin bonos. Si los dos no produjeran lo mismo,
  // abrir el editor y guardar sin cambiar nada daría un documento distinto
  // del que se mandó — y el cliente firmaría algo que no leyó.
  it("compactar el hueco de los bonos no cambia el PDF", async () => {
    const { cuerpo, firma } = textoContrato("venta_nueva_v2", V2);
    // V2 no lleva bonos: el hueco tiene que existir de verdad, o este test no
    // está comparando nada.
    expect(cuerpo).toMatch(/\n{3,}/);
    const compacto = compactarHuecos(cuerpo);
    expect(compacto).not.toMatch(/\n{3,}/);
    expect(lineasDelPDF(await renderizarContratoPDF(compacto, firma, V2))).toEqual(
      lineasDelPDF(await renderizarContratoPDF(cuerpo, firma, V2)),
    );
  });

  it("generarContratoPDF es exactamente textoContrato + renderizar", async () => {
    const a = await generarContratoPDF("venta_nueva", VENTA_NUEVA);
    const { cuerpo, firma } = textoContrato("venta_nueva", VENTA_NUEVA);
    const b = await renderizarContratoPDF(cuerpo, firma, VENTA_NUEVA);
    // pdfkit mete la fecha de creación en el PDF: se compara el tamaño, no los
    // bytes. Y el texto pintado, que es lo que no puede cambiar.
    expect(Math.abs(a.length - b.length)).toBeLessThan(64);
    expect(lineasDelPDF(a)).toEqual(lineasDelPDF(b));
  });
});

describe("plantillaDe", () => {
  it("v2 separa cuerpo y firma; v1 no", () => {
    expect(plantillaDe("venta_nueva_v2").firma).toBe(BLOQUE_FIRMA);
    expect(plantillaDe("venta_nueva").firma).toBe("");
    expect(plantillaDe("ampliacion").firma).toBe("");
  });

  it("un tipo sin plantilla lanza", () => {
    expect(() => plantillaDe("extension" as never)).toThrow(/extension/);
  });
});

describe("los contratos ya emitidos salen exactamente igual", () => {
  // 🔴 Este es el guard de la regresión que este cambio podía provocar, y el
  // motivo de que el colapso del ancho del .md ocurra ANTES de rellenar.
  //
  // El renderer pinta un bloque con saltos como lista (una línea por renglón,
  // a la izquierda). Las plantillas v1 vienen partidas a ~100 caracteres SIN
  // indentar las continuaciones — 15 bloques de cada una—, así que si un solo
  // salto del .md sobreviviera hasta el renderer, esos párrafos dejarían de
  // justificarse y los contratos ya emitidos se regenerarían distintos.
  // 🔴 La regresión que este cambio sí provocó, y que ningún test del plan
  // habría visto: las DOS plantillas v1 ya traen su propia línea
  // "Firma digital:" (plantillas.ts:135 y 269), la que el cliente rellenaba a
  // mano. La primera versión del renderer aplicaba la regla de la firma a todo
  // el documento y les estampaba una raya de subrayado que nunca tuvieron.
  // Solo la pinta el bloque que añade el sistema.
  it("la línea de firma que ya traía el texto v1 NO se convierte en una raya", async () => {
    for (const [tipo, datos] of [
      ["venta_nueva", VENTA_NUEVA],
      ["ampliacion", AMPLIACION],
    ] as const) {
      const texto = lineasDelPDF(await generarContratoPDF(tipo, datos)).join("\n");
      expect(sinEspacios(texto)).toContain(sinEspacios("Firma digital:"));
      expect(texto).not.toMatch(/_{10,}/);
    }
  });

  it("ningún bloque de una plantilla v1 llega al renderer con saltos dentro", () => {
    for (const [tipo, datos] of [
      ["venta_nueva", VENTA_NUEVA],
      ["ampliacion", AMPLIACION],
    ] as const) {
      const { cuerpo } = textoContrato(tipo, datos);
      const conSalto = cuerpo
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean)
        .filter((b) => b.includes("\n"));
      expect(conSalto).toEqual([]);
    }
  });
});
