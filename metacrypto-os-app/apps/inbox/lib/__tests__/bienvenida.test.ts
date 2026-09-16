import { describe, it, expect } from "vitest";
import { evaluarBienvenida, puedeEnviarBienvenida, BIENVENIDA_DESDE } from "../bienvenida";

const base = {
  created_at: "2026-08-10T10:00:00+00:00",
  telefono_e164: "+34600111222",
  tiene_compra_nueva: true,
  bienvenida_enviada: false,
};

describe("evaluarBienvenida", () => {
  it("un cliente nuevo con compra y teléfono está pendiente", () => {
    expect(evaluarBienvenida(base)).toEqual({ pendiente: true, motivo: "pendiente" });
  });
  it("si ya se envió, no está pendiente", () => {
    expect(evaluarBienvenida({ ...base, bienvenida_enviada: true }))
      .toEqual({ pendiente: false, motivo: "enviada" });
  });
  it("un cliente anterior al corte queda fuera", () => {
    expect(evaluarBienvenida({ ...base, created_at: "2026-07-30T10:00:00+00:00" }))
      .toEqual({ pendiente: false, motivo: "historico" });
  });
  it("el día del corte SÍ entra", () => {
    expect(evaluarBienvenida({ ...base, created_at: `${BIENVENIDA_DESDE}T00:05:00+00:00` }).pendiente)
      .toBe(true);
  });
  it("madrugada del corte en Madrid (pero día anterior en UTC) es pendiente", () => {
    // created_at = "2026-08-05T22:30:00+00:00" es 2026-08-06 00:30 en Madrid (zona +2 en agosto)
    // El corte es 2026-08-06, así que debe ser pendiente, no histórico
    expect(evaluarBienvenida({ ...base, created_at: "2026-08-05T22:30:00+00:00" }))
      .toEqual({ pendiente: true, motivo: "pendiente" });
  });
  it("fecha vacía se trata como histórico (lado seguro)", () => {
    // Una fecha corrupta debe quedar FUERA del marcado. Marcar de menos es mejor
    // que marcar de más (envío real a cliente que no toca).
    expect(evaluarBienvenida({ ...base, created_at: "" }))
      .toEqual({ pendiente: false, motivo: "historico" });
  });
  it("fecha no parseable se trata como histórico (lado seguro)", () => {
    expect(evaluarBienvenida({ ...base, created_at: "not-a-date" }))
      .toEqual({ pendiente: false, motivo: "historico" });
  });
  it("sin compra nueva no aplica (ascensión o extensión)", () => {
    expect(evaluarBienvenida({ ...base, tiene_compra_nueva: false }))
      .toEqual({ pendiente: false, motivo: "sin_compra_nueva" });
  });
  it("sin teléfono no se puede enviar", () => {
    expect(evaluarBienvenida({ ...base, telefono_e164: null }))
      .toEqual({ pendiente: false, motivo: "sin_telefono" });
  });
  it("'enviada' gana sobre 'sin teléfono': si ya llegó, no hay nada que hacer", () => {
    expect(evaluarBienvenida({ ...base, telefono_e164: null, bienvenida_enviada: true }).motivo)
      .toBe("enviada");
  });
});

describe("puedeEnviarBienvenida", () => {
  it("acceso total puede", () => {
    expect(puedeEnviarBienvenida({ acceso_total: true, modulos: null })).toBe(true);
  });
  it("el módulo clientes basta (caso Manuel)", () => {
    expect(puedeEnviarBienvenida({ acceso_total: false, modulos: ["clientes", "inbox"] })).toBe(true);
  });
  it("el módulo ventas también basta", () => {
    expect(puedeEnviarBienvenida({ acceso_total: false, modulos: ["ventas"] })).toBe(true);
  });
  it("solo inbox no basta", () => {
    expect(puedeEnviarBienvenida({ acceso_total: false, modulos: ["inbox"] })).toBe(false);
  });
});
