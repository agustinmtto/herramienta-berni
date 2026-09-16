import { describe, it, expect } from "vitest";
import {
  BONOS_EVENTO,
  CLAVES_BONOS,
  FACTOR_BONO_DURACION,
  normalizarBonos,
  extraConsultorias,
  aplicaBonoDuracion,
  mesesConBonoDuracion,
  mesesConBono,
  resumenBonos,
  bonosAplicables,
  podarBonos,
  bonosLibres,
} from "../bonos";

describe("catálogo", () => {
  it("son los 4 bonos que Alex ofreció en el evento", () => {
    expect(CLAVES_BONOS).toEqual([
      "consultoria_berni",
      "consultoria_manuel",
      "duracion_50",
      "discord_portafolio",
    ]);
  });
  it("cada bono tiene etiqueta para el formulario", () => {
    for (const b of BONOS_EVENTO) expect(b.etiqueta.length).toBeGreaterThan(0);
  });
});

describe("normalizarBonos", () => {
  it("deja pasar las claves conocidas", () => {
    expect(normalizarBonos(["consultoria_berni", "duracion_50"]))
      .toEqual(["consultoria_berni", "duracion_50"]);
  });
  it("descarta claves inventadas — el array llega de un form", () => {
    expect(normalizarBonos(["consultoria_berni", "bono_pirata"]))
      .toEqual(["consultoria_berni"]);
  });
  it("descarta la clave vieja duracion_9m — ya no existe", () => {
    expect(normalizarBonos(["duracion_9m"])).toEqual([]);
  });
  it("deduplica", () => {
    expect(normalizarBonos(["duracion_50", "duracion_50"])).toEqual(["duracion_50"]);
  });
  it("ordena según el catálogo, no según llegó el form", () => {
    expect(normalizarBonos(["discord_portafolio", "consultoria_berni"]))
      .toEqual(["consultoria_berni", "discord_portafolio"]);
  });
  it("sin bonos devuelve array vacío", () => {
    expect(normalizarBonos([])).toEqual([]);
    expect(normalizarBonos(null)).toEqual([]);
  });
});

describe("extraConsultorias", () => {
  it("cada consultoría de bono suma una al cupo", () => {
    expect(extraConsultorias(["consultoria_berni"])).toBe(1);
    expect(extraConsultorias(["consultoria_berni", "consultoria_manuel"])).toBe(2);
  });
  it("los bonos que no son consultoría no tocan el cupo", () => {
    expect(extraConsultorias(["duracion_50", "discord_portafolio"])).toBe(0);
  });
  it("sin bonos, cero", () => {
    expect(extraConsultorias([])).toBe(0);
  });
});

// ============================================================
// La regla de Berni, 26-ago-2026 (WhatsApp), que corrige la del 25:
//   "No hay programa de 1800€: 2000, 3500 y 5000.
//    El bono de 50% más de tiempo es en todos.
//    El de 2000 que son 6 meses pasa a 9 meses.
//    Los otros dos que son de 1 año, pasan de 12 meses a 18."
// El bono ya no depende del TIER sino de la DURACIÓN: por eso ninguna de estas
// funciones vuelve a recibir un id de tier.
// ============================================================
describe("mesesConBonoDuracion — los tres casos que dijo Berni", () => {
  it("el de 2.000 € (6 meses) pasa a 9", () => {
    expect(mesesConBonoDuracion(6)).toBe(9);
  });
  it("el de 3.500 € (1 año) pasa a 18", () => {
    expect(mesesConBonoDuracion(12)).toBe(18);
  });
  it("el de 5.000 € (1 año) pasa a 18", () => {
    expect(mesesConBonoDuracion(12)).toBe(18);
  });
  it("es un +50 %, no un salto a 9", () => {
    expect(FACTOR_BONO_DURACION).toBe(1.5);
    expect(mesesConBonoDuracion(8)).toBe(12);
    expect(mesesConBonoDuracion(4)).toBe(6);
  });
  it("una duración impar redondea HACIA ARRIBA — nunca se entrega de menos", () => {
    expect(mesesConBonoDuracion(3)).toBe(5); // 4,5 → 5
    expect(mesesConBonoDuracion(7)).toBe(11); // 10,5 → 11
  });
  it("sin duración (vitalicio/OG) no inventa meses", () => {
    expect(mesesConBonoDuracion(null)).toBe(null);
  });
  it("una duración absurda se devuelve tal cual en vez de propagar un NaN", () => {
    expect(mesesConBonoDuracion(0)).toBe(0);
    expect(mesesConBonoDuracion(NaN)).toBeNaN();
  });
});

describe("aplicaBonoDuracion — depende de la duración, no del tier", () => {
  it("aplica a cualquier programa que tenga duración", () => {
    expect(aplicaBonoDuracion(6)).toBe(true);
    expect(aplicaBonoDuracion(12)).toBe(true);
    expect(aplicaBonoDuracion(8)).toBe(true);
  });
  it("no aplica a un programa sin duración — no hay nada que alargar", () => {
    expect(aplicaBonoDuracion(null)).toBe(false);
    expect(aplicaBonoDuracion(undefined)).toBe(false);
    expect(aplicaBonoDuracion(0)).toBe(false);
  });
});

describe("mesesConBono", () => {
  it("el programa de 6 meses con el bono pasa a 9", () => {
    expect(mesesConBono(6, ["duracion_50"])).toBe(9);
  });
  it("el de 12 meses con el bono pasa a 18", () => {
    expect(mesesConBono(12, ["duracion_50"])).toBe(18);
  });
  it("sin el bono se queda como estaba, sea cual sea el tier", () => {
    expect(mesesConBono(6, ["consultoria_berni"])).toBe(6);
    expect(mesesConBono(12, [])).toBe(12);
  });
  it("la clave vieja duracion_9m NO alarga nada", () => {
    expect(mesesConBono(6, ["duracion_9m"])).toBe(6);
  });
  it("sin duración base no inventa meses aunque el bono esté marcado", () => {
    expect(mesesConBono(null, ["duracion_50"])).toBe(null);
  });
});

describe("resumenBonos", () => {
  it("describe el efecto en el cupo para la ficha", () => {
    expect(resumenBonos(["consultoria_berni", "consultoria_manuel"]))
      .toContain("2 consultorías");
  });
  it("el de duración se resume como +50 %, no como '9 meses'", () => {
    expect(resumenBonos(["duracion_50"])).toContain("50");
    expect(resumenBonos(["duracion_50"])).not.toContain("9 meses");
  });
  it("sin bonos no dice nada", () => {
    expect(resumenBonos([])).toBe("");
  });
});

describe("bonosAplicables", () => {
  it("en cualquier programa con duración se ofrecen los 4", () => {
    expect(bonosAplicables(6)).toHaveLength(4);
    expect(bonosAplicables(12)).toHaveLength(4);
  });
  it("sin duración, el de duración ni se ofrece", () => {
    expect(bonosAplicables(null)).toEqual([
      "consultoria_berni",
      "consultoria_manuel",
      "discord_portafolio",
    ]);
  });
});

describe("podarBonos", () => {
  it("cambiar de tier ya NO quita el bono de duración — aplica en todos", () => {
    expect(podarBonos(12, ["consultoria_berni", "duracion_50"]))
      .toEqual(["consultoria_berni", "duracion_50"]);
    expect(podarBonos(6, ["consultoria_berni", "duracion_50"]))
      .toEqual(["consultoria_berni", "duracion_50"]);
  });
  it("solo lo quita si el programa no tiene duración", () => {
    expect(podarBonos(null, ["consultoria_berni", "duracion_50"]))
      .toEqual(["consultoria_berni"]);
  });
});

describe("bonos escritos a mano", () => {
  it("se reconocen por el prefijo y se limpian", () => {
    expect(bonosLibres(["consultoria_berni", "libre:  Grupo   de señales "])).toEqual([
      "Grupo de señales",
    ]);
    expect(bonosLibres(["libre:   "])).toEqual([]);
    expect(bonosLibres(null)).toEqual([]);
  });

  it("no se cuelan como clave del catálogo", () => {
    // Si `normalizarBonos` los dejara pasar, `extraConsultorias` y
    // `mesesConBono` tendrían que defenderse de ellos en cada llamada.
    expect(normalizarBonos(["libre:Consultoría extra"])).toEqual([]);
    expect(extraConsultorias(["libre:consultoria_berni"])).toBe(0);
  });

  it("una venta con SOLO un bono escrito a mano se ve en la ficha", () => {
    expect(resumenBonos(["libre:Grupo de señales"])).toBe("Grupo de señales");
  });
});
