import { describe, it, expect } from "vitest";
import { decidirDestinatarios } from "../canales";

// Esta regla decide si un contrato sale al equipo, a un buzón de pruebas, o no
// sale. Los tres casos, y sobre todo el tercero: antes, "no se pudo leer"
// acababa significando "manda al equipo de verdad".
describe("decidirDestinatarios", () => {
  const TRES = "a@x.com, b@y.com ,c@z.com";

  it("modo apagado: al equipo de verdad", () => {
    expect(decidirDestinatarios("off", TRES, "otra@cosa.com")).toEqual([]);
  });

  it("modo encendido: a las direcciones de la tabla, limpias", () => {
    expect(decidirDestinatarios("on", TRES, undefined)).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("modo encendido y sin direcciones: NO se manda", () => {
    // Lo peligroso sería caer al equipo creyendo que estamos en prueba.
    expect(decidirDestinatarios("on", "", undefined)).toBeNull();
    expect(decidirDestinatarios("on", "  , ,", undefined)).toBeNull();
  });

  it("ajuste ilegible y sin respaldo: NO se manda", () => {
    expect(decidirDestinatarios(null, null, undefined)).toBeNull();
    expect(decidirDestinatarios("cualquier-cosa", null, "")).toBeNull();
  });

  it("ajuste ilegible pero con la variable de entorno puesta: usa el respaldo", () => {
    // El caso de local, donde la tabla puede no existir todavía.
    expect(decidirDestinatarios(null, null, "local@x.com")).toEqual(["local@x.com"]);
  });

  it("el respaldo NO rescata un modo apagado ni uno encendido", () => {
    // Si el modo se leyó bien, manda el modo. La variable solo cubre el hueco.
    expect(decidirDestinatarios("off", null, "local@x.com")).toEqual([]);
    expect(decidirDestinatarios("on", "tabla@x.com", "local@x.com")).toEqual(["tabla@x.com"]);
  });
});
