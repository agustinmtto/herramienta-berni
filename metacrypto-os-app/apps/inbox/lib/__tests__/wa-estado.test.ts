import { describe, it, expect } from "vitest";
import { estadoWa } from "../wa-estado";

// El 2-sep-2026 Meta baneó la WABA de MCC. Durante ~3 h el OS siguió
// aceptando mensajes: Kapso devolvía 200, Meta los tiraba después con
// 131031 "Business Account locked", y como `wa_mensajes.status` se queda
// congelado en "sent", en el inbox se veían enviados. Dos clientes (Alicia y
// Daniel) se quedaron esperando un plan que nadie mandó.
//
// Esto es el interruptor que corta ese camino. El valor de la env var NO es
// un booleano: es el motivo que se le enseña al equipo.

describe("estadoWa — el interruptor de la caída de WhatsApp", () => {
  it("sin la variable, WhatsApp está operativo", () => {
    expect(estadoWa({})).toEqual({ bloqueado: false, motivo: "" });
  });

  it("con un motivo, bloquea y conserva el motivo tal cual", () => {
    const motivo = "Meta baneó la WABA el 2-sep. Escribe desde tu móvil.";
    expect(estadoWa({ WA_BLOQUEADO_MOTIVO: motivo })).toEqual({
      bloqueado: true,
      motivo,
    });
  });

  it("una cadena vacía no bloquea: sin motivo no hay nada que enseñar", () => {
    expect(estadoWa({ WA_BLOQUEADO_MOTIVO: "" }).bloqueado).toBe(false);
  });

  it("solo espacios tampoco bloquea, y el motivo no arrastra el relleno", () => {
    expect(estadoWa({ WA_BLOQUEADO_MOTIVO: "   " }).bloqueado).toBe(false);
  });

  it("recorta el motivo, para que no salga con saltos de línea de Vercel", () => {
    expect(estadoWa({ WA_BLOQUEADO_MOTIVO: "  caído\n" }).motivo).toBe("caído");
  });

  // Filo consciente y documentado: la variable es un MOTIVO, no un booleano.
  // Quien escriba "false" creyendo que apaga el interruptor, lo enciende. Se
  // acepta a propósito porque el fallo cae del lado seguro — bloquea envíos
  // en vez de mandarlos al vacío, que es justo el incidente que motivó esto.
  it('"false" bloquea: es un motivo, no un booleano', () => {
    expect(estadoWa({ WA_BLOQUEADO_MOTIVO: "false" }).bloqueado).toBe(true);
  });

  it("sin argumento lee process.env, que es como lo usa la app", () => {
    const previo = process.env.WA_BLOQUEADO_MOTIVO;
    process.env.WA_BLOQUEADO_MOTIVO = "prueba";
    try {
      expect(estadoWa().bloqueado).toBe(true);
    } finally {
      if (previo === undefined) delete process.env.WA_BLOQUEADO_MOTIVO;
      else process.env.WA_BLOQUEADO_MOTIVO = previo;
    }
  });
});
