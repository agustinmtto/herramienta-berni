import { describe, it, expect } from "vitest";
import { previsualizar, faltanVariables, resumenUnaLinea } from "../plantilla-preview";

// Cuerpo real de `recordatorio_1h_es`, aprobada en Meta.
const R1H =
  "¡{{nombre}}, tu sesión es en 1 hora! ⏰\n\nTe esperamos a las {{hora}} con {{coach}}.\n\nEnlace para unirte: {{link}}\n\n¡Nos vemos dentro!";

describe("previsualizar", () => {
  it("sustituye las variables que tienen valor", () => {
    const out = previsualizar(R1H, { nombre: "Alan", hora: "19:00", coach: "Manuel", link: "https://x.co/a" });
    expect(out).toContain("¡Alan, tu sesión es en 1 hora!");
    expect(out).toContain("a las 19:00 con Manuel");
    expect(out).toContain("https://x.co/a");
    expect(out).not.toContain("{{");
  });

  // El caso de la lista del picker: ahí solo se conoce el nombre del cliente.
  // Sin marcador, la previsualización diría "Te esperamos a las  con ." y
  // parecería una plantilla rota en vez de una a medio rellenar.
  it("marca lo que falta como [variable] en vez de dejar un hueco", () => {
    const out = previsualizar(R1H, { nombre: "Alan" });
    expect(out).toContain("¡Alan, tu sesión es en 1 hora!");
    expect(out).toContain("a las [hora] con [coach]");
    expect(out).toContain("Enlace para unirte: [link]");
  });

  it("una variable presente pero vacía se marca igual que una ausente", () => {
    expect(previsualizar("Hola {{nombre}}", { nombre: "" })).toBe("Hola [nombre]");
    expect(previsualizar("Hola {{nombre}}", { nombre: "   " })).toBe("Hola [nombre]");
  });

  it("tolera espacios dentro de las llaves", () => {
    expect(previsualizar("Hola {{ nombre }}", { nombre: "Alan" })).toBe("Hola Alan");
  });

  it("sustituye todas las apariciones de la misma variable", () => {
    expect(previsualizar("{{n}} y {{n}}", { n: "x" })).toBe("x y x");
  });

  it("un cuerpo sin variables se devuelve tal cual", () => {
    expect(previsualizar("Sin variables.", {})).toBe("Sin variables.");
  });

  // Un valor que contiene "$&" o "$1" es sintaxis de reemplazo de String.replace.
  // Con un string como segundo argumento, "$&" se expandiría al propio match y
  // pintaría "{{nombre}}" en la previsualización. Por eso se usa una función.
  it("un valor con $& no se interpreta como patrón de reemplazo", () => {
    expect(previsualizar("Hola {{nombre}}", { nombre: "$& raro" })).toBe("Hola $& raro");
  });
});

describe("faltanVariables", () => {
  it("lista solo las que siguen vacías", () => {
    expect(faltanVariables(["nombre", "hora", "link"], { nombre: "Alan", hora: "  " }))
      .toEqual(["hora", "link"]);
  });
  it("vacío cuando está todo relleno", () => {
    expect(faltanVariables(["a"], { a: "x" })).toEqual([]);
  });
});

describe("resumenUnaLinea", () => {
  it("colapsa los saltos de línea en separadores visibles", () => {
    expect(resumenUnaLinea("Hola\n\nQué tal")).toBe("Hola · Qué tal");
  });
  it("recorta lo que no cabe y marca el corte", () => {
    const out = resumenUnaLinea("a".repeat(200), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });
  it("no toca lo que ya cabe", () => {
    expect(resumenUnaLinea("corto", 20)).toBe("corto");
  });
});
