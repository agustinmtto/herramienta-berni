import { describe, expect, it } from "vitest";
import {
  CAMPOS_FORMULARIO,
  construirNota,
  marcaDeNota,
  notaYaExiste,
  valoresDeCampo,
} from "../evento-notas";

describe("valoresDeCampo", () => {
  it("un radio (string) vuelve como lista de uno", () => {
    const campos = [{ id: "A", value: "Entre $10.000 y $25.000" }];
    expect(valoresDeCampo(campos, "A")).toEqual(["Entre $10.000 y $25.000"]);
  });

  it("un checkbox (array) vuelve entero y sin vacíos", () => {
    const campos = [{ id: "A", value: ["Uno", "  ", "Dos", ""] }];
    expect(valoresDeCampo(campos, "A")).toEqual(["Uno", "Dos"]);
  });

  it("campo ausente o sin valor: lista vacía, no revienta", () => {
    expect(valoresDeCampo([{ id: "B", value: "x" }], "A")).toEqual([]);
    expect(valoresDeCampo([{ id: "A" }], "A")).toEqual([]);
    expect(valoresDeCampo(null, "A")).toEqual([]);
  });

  it("un valor no-string (número de GHL) no rompe el tipo", () => {
    expect(valoresDeCampo([{ id: "A", value: 5000 }], "A")).toEqual(["5000"]);
  });
});

describe("notaYaExiste", () => {
  it("encuentra la marca aunque la nota tenga más texto", () => {
    const notas = [{ body: `algo\n${marcaDeNota("cita1")}` }, { body: "otra nota" }];
    expect(notaYaExiste(notas, "cita1")).toBe(true);
  });

  it("una cita distinta no casa (el id forma parte de la marca)", () => {
    const notas = [{ body: marcaDeNota("cita1") }];
    expect(notaYaExiste(notas, "cita2")).toBe(false);
    expect(notaYaExiste(null, "cita1")).toBe(false);
  });
});

describe("construirNota", () => {
  const base = {
    appointmentId: "abc123",
    startTime: "2026-08-26T16:00:00.000Z",
    nombre: "Marta López",
    email: "marta@x.com",
    telefono: "+34600000000",
    customFields: [
      { id: CAMPOS_FORMULARIO[0].id, value: ["Aprender a manejar el riesgo"] },
      { id: CAMPOS_FORMULARIO[2].id, value: "Entre $25.000 y $50.000" },
    ],
  };

  it("lleva todas las preguntas, las respuestas y la marca de idempotencia", () => {
    const nota = construirNota(base);
    for (const c of CAMPOS_FORMULARIO) expect(nota).toContain(c.pregunta);
    expect(nota).toContain("Aprender a manejar el riesgo");
    expect(nota).toContain("Entre $25.000 y $50.000");
    expect(nota).toContain(marcaDeNota("abc123"));
    expect(nota).toContain("Marta López");
  });

  it("una pregunta sin respuesta lo dice, no desaparece", () => {
    const nota = construirNota({ ...base, customFields: [] });
    expect(nota.match(/\(sin respuesta\)/g)?.length).toBe(CAMPOS_FORMULARIO.length);
  });

  it("la hora sale en Madrid (16:00Z de agosto = 18:00)", () => {
    expect(construirNota(base)).toContain("18:00");
  });

  it("una fecha inválida no tumba la nota (queda el crudo)", () => {
    const nota = construirNota({ ...base, startTime: "no-es-fecha" });
    expect(nota).toContain("no-es-fecha");
    expect(nota).toContain(marcaDeNota("abc123"));
  });
});
