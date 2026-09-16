import { describe, it, expect } from "vitest";
import { PAISES, FRECUENTES, banderaDe, paisPorIso, etiquetaDe } from "../paises";

describe("banderaDe", () => {
  it("convierte el ISO en la bandera", () => {
    expect(banderaDe("ES")).toBe("🇪🇸");
    expect(banderaDe("PY")).toBe("🇵🇾");
  });

  it("acepta minúsculas", () => {
    expect(banderaDe("py")).toBe("🇵🇾");
  });

  it("un ISO que no son dos letras no inventa bandera", () => {
    expect(banderaDe("XYZ")).toBe("");
    expect(banderaDe("")).toBe("");
    expect(banderaDe("1A")).toBe("");
  });
});

describe("paisPorIso", () => {
  it("encuentra el país", () => {
    expect(paisPorIso("PY")?.nombre).toBe("Paraguay");
    expect(paisPorIso("PY")?.prefijo).toBe("+595");
  });

  it("un ISO desconocido devuelve null en vez de inventar prefijo", () => {
    // Inventar un prefijo es exactamente cómo se construyó +593595000111222.
    expect(paisPorIso("ZZ")).toBeNull();
  });
});

describe("etiquetaDe", () => {
  it("pone el NOMBRE primero, para que el salto por teclado funcione", () => {
    // El <select> nativo hace prefix-match sobre el texto de la opción: con la
    // bandera delante, teclear "par" no llevaría a Paraguay y habría que
    // recorrer casi 200 entradas a mano.
    expect(etiquetaDe({ iso: "PY", nombre: "Paraguay", prefijo: "+595" })).toBe("Paraguay 🇵🇾 (+595)");
  });

  it("'Otro' no lleva bandera ni prefijo", () => {
    expect(etiquetaDe({ iso: "XX", nombre: "Otro", prefijo: "" })).toBe("Otro");
  });
});

describe("PAISES — la lista", () => {
  it("incluye Paraguay, que es el que faltaba y provocó el fallo", () => {
    expect(paisPorIso("PY")).not.toBeNull();
  });

  it("incluye TODOS los países que ya tienen clientes en la base", () => {
    // Valores reales de personas.pais al 11-ago-2026. Ninguno puede faltar, o
    // registrar a ese cliente obliga a elegir un país equivocado.
    const conClientes = [
      "España", "Argentina", "Estados Unidos", "Venezuela", "México", "Colombia",
      "Chile", "El Salvador", "Uruguay", "Bolivia", "Emiratos Árabes Unidos", "Perú",
    ];
    const nombres = new Set(PAISES.map((p) => p.nombre));
    for (const n of conClientes) expect(nombres).toContain(n);
  });

  it("mantiene 'Otro' para lo desconocido", () => {
    expect(PAISES.some((p) => p.nombre === "Otro")).toBe(true);
  });

  it("no repite ISO", () => {
    // El prefijo SÍ se repite legítimamente (+1 lo comparten EE.UU., Canadá y
    // República Dominicana); el ISO no puede.
    const isos = PAISES.map((p) => p.iso);
    expect(new Set(isos).size).toBe(isos.length);
  });

  it("todos los prefijos empiezan por + y solo llevan dígitos detrás", () => {
    for (const p of PAISES) {
      if (p.iso === "XX") continue; // "Otro" no tiene prefijo
      expect(p.prefijo).toMatch(/^\+\d+$/);
    }
  });

  it("los frecuentes van primero y en el orden declarado", () => {
    const cabeza = PAISES.slice(0, FRECUENTES.length).map((p) => p.iso);
    expect(cabeza).toEqual(FRECUENTES);
  });

  it("el resto va en orden alfabético", () => {
    const resto = PAISES.slice(FRECUENTES.length)
      .filter((p) => p.iso !== "XX")
      .map((p) => p.nombre);
    const ordenado = [...resto].sort((a, b) => a.localeCompare(b, "es"));
    expect(resto).toEqual(ordenado);
  });

  it("España es el primero, que es el valor por defecto del formulario", () => {
    expect(PAISES[0].iso).toBe("ES");
  });
});
