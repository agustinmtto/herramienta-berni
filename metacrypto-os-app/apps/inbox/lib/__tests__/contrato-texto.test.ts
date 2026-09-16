import { describe, it, expect } from "vitest";
import { LARGO_MAX, LARGO_MIN, compactarHuecos, normalizarTexto, problemaDelTexto } from "../contrato-texto";

// Las reglas del texto que el closer edita antes de que el contrato salga al
// cliente. Se prueban aquí y no a través de `guardarTextoYRegenerar` porque
// ese fichero lleva `server-only` y alias `@/`: bajo vitest no se puede ni
// importar. Ver la cabecera de `contrato-texto.ts`.

const RELLENO = (n: number) => "a".repeat(n);

describe("normalizarTexto", () => {
  it("convierte los saltos de Windows y recorta los bordes", () => {
    expect(normalizarTexto("\n\n  Hola\r\nmundo\r\n  \n")).toBe("Hola\nmundo");
  });

  it("un \\r suelto también cuenta como salto", () => {
    // Un `\r` que sobreviviera se pintaría DENTRO de la línea en el PDF.
    expect(normalizarTexto("Hola\rmundo")).toBe("Hola\nmundo");
  });

  it("el mismo texto desde Windows y desde Mac se guarda igual", () => {
    // Si no, guardar sin cambiar nada regeneraría el PDF y mataría el enlace
    // del cliente sin que nadie hubiera tocado una palabra.
    expect(normalizarTexto("Uno\r\nDos\r\n\r\nTres")).toBe(normalizarTexto("Uno\nDos\n\nTres"));
  });
});

describe("problemaDelTexto", () => {
  it("un texto normal se puede guardar", () => {
    expect(problemaDelTexto(RELLENO(LARGO_MIN))).toBeNull();
    expect(problemaDelTexto(RELLENO(LARGO_MAX))).toBeNull();
  });

  it("demasiado corto: un textarea vaciado sin querer no es un contrato", () => {
    expect(problemaDelTexto("")).toMatch(/corto/);
    expect(problemaDelTexto(RELLENO(LARGO_MIN - 1))).toMatch(/corto/);
  });

  it("demasiado largo: eso es un pegado de otra cosa", () => {
    expect(problemaDelTexto(RELLENO(LARGO_MAX + 1))).toMatch(/largo/);
  });

  // 🔴 El test que de verdad importa. `renderizarContratoPDF` NO vuelve a
  // pasar `rellenar()` sobre el cuerpo, así que un placeholder tecleado a mano
  // no lanza en ninguna parte: se imprime tal cual en el PDF que firma el
  // cliente. Esta comprobación es la única barrera que hay.
  it("RECHAZA un placeholder tecleado a mano", () => {
    expect(problemaDelTexto(`${RELLENO(LARGO_MIN)} {{importe_total}}`)).toMatch(/\{\{/);
  });

  it("rechaza media llave también: la intención ya está", () => {
    expect(problemaDelTexto(`${RELLENO(LARGO_MIN)} {{`)).toMatch(/\{\{/);
  });

  it("una llave sola no molesta a nadie", () => {
    expect(problemaDelTexto(`${RELLENO(LARGO_MIN)} { importe }`)).toBeNull();
  });
});

describe("compactarHuecos", () => {
  it("cierra el hueco que deja un bloque vacío", () => {
    // Lo que produce la plantilla cuando la venta no lleva bonos.
    expect(compactarHuecos("Uno\n\n\n\nDos")).toBe("Uno\n\nDos");
  });

  it("no toca la separación de párrafos ni los saltos de una lista", () => {
    expect(compactarHuecos("Uno\n\nDos")).toBe("Uno\n\nDos");
    expect(compactarHuecos("a) Uno.\nb) Dos.\nc) Tres.")).toBe("a) Uno.\nb) Dos.\nc) Tres.");
  });

  it("las líneas 'en blanco' con espacios cuentan como en blanco", () => {
    expect(compactarHuecos("Uno\n \n\t\nDos")).toBe("Uno\n\nDos");
  });

  it("no se come la indentación de la línea siguiente", () => {
    expect(compactarHuecos("Uno\n\n\n   Dos")).toBe("Uno\n\n   Dos");
  });

  it("es idempotente", () => {
    const una = compactarHuecos("Uno\n\n\n\n\nDos\n\n\n\nTres");
    expect(compactarHuecos(una)).toBe(una);
  });
});
