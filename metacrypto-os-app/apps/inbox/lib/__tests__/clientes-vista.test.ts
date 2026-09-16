import { describe, it, expect } from "vitest";
import { filtrar, ordenar, ORDEN_INICIAL, type ClienteVista } from "../clientes-vista";

let n = 0;
const c = (p: Partial<ClienteVista> & { fecha_fin: string }): ClienteVista => ({
  id: `c${++n}`, nombre: "Cliente", pais: null, tier: null, coach: null,
  fecha_inicio: null, estado: "cliente", ...p,
});

describe("filtrar", () => {
  // Bug real: el filtro comparaba el texto escrito contra el ISO crudo
  // ("2028-03-03"), pero la celda muestra "03 mar 28" — dos formatos
  // distintos para la misma columna, así que nada de lo que se escribía
  // encontraba la fila.
  it("filtra fecha_fin por el mismo texto que se ve en la celda", () => {
    const cs = [c({ fecha_fin: "2028-03-03" }), c({ fecha_fin: "2026-01-15" })];
    expect(filtrar(cs, { fecha_fin: "03 mar 28" })).toHaveLength(1);
    expect(filtrar(cs, { fecha_fin: "2028-03-03" })).toHaveLength(0);
  });

  it("un cliente sin fecha_fin nunca matchea un filtro de fecha", () => {
    const cs = [c({ fecha_fin: "" })];
    expect(filtrar(cs, { fecha_fin: "mar" })).toHaveLength(0);
  });
});

describe("ordenar", () => {
  // El orden cronológico tiene que seguir comparando el ISO, no el texto
  // mostrado — "03 mar 28" y "15 ene 26" no ordenan bien como texto.
  it("ordena fecha_fin cronológicamente, no alfabéticamente por el texto mostrado", () => {
    const cs = [c({ fecha_fin: "2026-01-15" }), c({ fecha_fin: "2028-03-03" })];
    const o = ordenar(cs, { col: "fecha_fin", dir: "asc" });
    expect(o.map((x) => x.fecha_fin)).toEqual(["2026-01-15", "2028-03-03"]);
  });
});

it("ORDEN_INICIAL ordena por nombre ascendente", () => {
  expect(ORDEN_INICIAL).toEqual({ col: "nombre", dir: "asc" });
});
