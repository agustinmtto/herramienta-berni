import { describe, it, expect } from "vitest";
import {
  importeDe, totalDevuelto, delMes, serieDelAnio, siguienteOrden, ordenar,
  resumenMotivo, ORDEN_INICIAL, type DevolucionBase,
} from "../devoluciones-vista";
import { rangoDeMeses, mesSiguiente, nombreMes, mesCorto } from "../meses";

let n = 0;
const d = (p: Partial<DevolucionBase> & { fecha: string }): DevolucionBase => ({
  devolucion_id: `d${++n}`,
  monto: -100,
  usd_recibido: -100,
  alcance: "total",
  motivo: null,
  persona_nombre: "esa clienta",
  n_efectos: 3,
  ...p,
});

describe("importes", () => {
  // En la base son negativos: es dinero que salió.
  it("devuelve el importe en positivo para poder agregarlo", () => {
    expect(importeDe(d({ fecha: "2026-08-01", usd_recibido: -2314 }))).toBe(2314);
  });

  it("una devolución sin USD cuenta como 0, no como NaN", () => {
    expect(importeDe(d({ fecha: "2026-08-01", usd_recibido: null }))).toBe(0);
  });

  it("suma varias", () => {
    expect(totalDevuelto([
      d({ fecha: "2026-05-01", usd_recibido: -100 }),
      d({ fecha: "2026-05-02", usd_recibido: -50.5 }),
    ])).toBe(150.5);
  });
});

describe("serieDelAnio", () => {
  const ds = [
    d({ fecha: "2026-04-10", usd_recibido: -203.44 }),
    d({ fecha: "2026-06-01", usd_recibido: -5190.63 }),
    d({ fecha: "2026-08-20", usd_recibido: -2314 }),
  ];

  // Es el punto de la pantalla: julio a cero es un hecho, no un hueco.
  it("incluye los meses sin devoluciones en vez de saltárselos", () => {
    const s = serieDelAnio(ds, 2026, "2026-09-02");
    expect(s.map((x) => x.mes)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
      "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
    expect(s.find((x) => x.mes === "2026-07")).toEqual({ mes: "2026-07", n: 0, total: 0 });
  });

  it("corta en el mes en curso si el año está corriendo", () => {
    const s = serieDelAnio(ds, 2026, "2026-09-02");
    expect(s[s.length - 1].mes).toBe("2026-09");
  });

  it("un año pasado se pinta entero, hasta diciembre", () => {
    const s = serieDelAnio([d({ fecha: "2025-03-01" })], 2025, "2026-09-02");
    expect(s[s.length - 1].mes).toBe("2025-12");
  });

  it("agrupa los importes en su mes", () => {
    const s = serieDelAnio(ds, 2026, "2026-09-02");
    expect(s.find((x) => x.mes === "2026-06")).toEqual({
      mes: "2026-06", n: 1, total: 5190.63,
    });
  });

  it("un año sin ninguna devolución sigue dando la rejilla de meses", () => {
    const s = serieDelAnio([], 2026, "2026-09-02");
    expect(s).toHaveLength(9);
    expect(s.every((x) => x.n === 0)).toBe(true);
  });
});

describe("delMes", () => {
  it("no se cuela el último día del mes anterior", () => {
    const ds = [d({ fecha: "2026-05-31" }), d({ fecha: "2026-06-01" })];
    expect(delMes(ds, "2026-06")).toHaveLength(1);
  });
});

describe("siguienteOrden", () => {
  it("invierte si ya se ordena por esa columna", () => {
    expect(siguienteOrden({ col: "fecha", dir: "desc" }, "fecha")).toEqual({
      col: "fecha", dir: "asc",
    });
  });

  // Lo más reciente y lo más caro primero; los nombres, alfabéticos.
  it("una columna nueva arranca en su dirección natural", () => {
    expect(siguienteOrden(ORDEN_INICIAL, "importe").dir).toBe("desc");
    expect(siguienteOrden(ORDEN_INICIAL, "cliente").dir).toBe("asc");
    expect(siguienteOrden(ORDEN_INICIAL, "alcance").dir).toBe("asc");
  });
});

describe("ordenar", () => {
  const ds = [
    d({ devolucion_id: "a", fecha: "2026-05-01", usd_recibido: -100, persona_nombre: "Carlos" }),
    d({ devolucion_id: "b", fecha: "2026-08-01", usd_recibido: -2314, persona_nombre: "Ana" }),
    d({ devolucion_id: "c", fecha: "2026-06-01", usd_recibido: -50, persona_nombre: "Bea", alcance: "sin_clasificar" }),
  ];

  it("no muta la entrada", () => {
    const copia = [...ds];
    ordenar(ds, { col: "importe", dir: "asc" });
    expect(ds).toEqual(copia);
  });

  it("por fecha descendente pone lo más reciente arriba", () => {
    expect(ordenar(ds, { col: "fecha", dir: "desc" })[0].devolucion_id).toBe("b");
  });

  it("por importe descendente pone la más cara arriba", () => {
    expect(ordenar(ds, { col: "importe", dir: "desc" })[0].devolucion_id).toBe("b");
  });

  it("por cliente ordena alfabéticamente en castellano", () => {
    expect(ordenar(ds, { col: "cliente", dir: "asc" }).map((x) => x.persona_nombre))
      .toEqual(["Ana", "Bea", "Carlos"]);
  });

  // Las sin clasificar son trabajo pendiente, no una categoría del alfabeto.
  it("las sin clasificar van primero en las dos direcciones", () => {
    expect(ordenar(ds, { col: "alcance", dir: "asc" })[0].devolucion_id).toBe("c");
    expect(ordenar(ds, { col: "alcance", dir: "desc" })[0].devolucion_id).toBe("c");
  });

  it("dos del mismo día mantienen un orden estable", () => {
    const mismos = [
      d({ devolucion_id: "z", fecha: "2026-05-01" }),
      d({ devolucion_id: "a", fecha: "2026-05-01" }),
    ];
    const r1 = ordenar(mismos, { col: "fecha", dir: "desc" }).map((x) => x.devolucion_id);
    const r2 = ordenar([...mismos].reverse(), { col: "fecha", dir: "desc" }).map((x) => x.devolucion_id);
    expect(r1).toEqual(r2);
  });
});

describe("resumenMotivo", () => {
  it("un motivo corto pasa entero", () => {
    expect(resumenMotivo("Cliente insatisfecho")).toEqual({
      texto: "Cliente insatisfecho", recortado: false,
    });
  });

  it("sin motivo devuelve vacío sin romper", () => {
    expect(resumenMotivo(null)).toEqual({ texto: "", recortado: false });
  });

  it("colapsa los espacios y saltos de línea de un mensaje pegado", () => {
    expect(resumenMotivo("Hola\n\n  Alejandro").texto).toBe("Hola Alejandro");
  });

  // El caso real: un WhatsApp entero en el campo motivo.
  it("recorta por palabra, nunca a mitad", () => {
    const largo = "Hola Alejandro, espero que estes muy bien y que hayas podido descansar estos dias de verano tan intensos";
    const r = resumenMotivo(largo, 40);
    expect(r.recortado).toBe(true);
    expect(r.texto.length).toBeLessThanOrEqual(40);
    expect(largo.startsWith(r.texto)).toBe(true);
    expect(r.texto.endsWith(" ")).toBe(false);
  });

  it("si no hay espacio donde cortar, corta en seco antes que desbordar", () => {
    const r = resumenMotivo("A".repeat(200), 20);
    expect(r.texto).toHaveLength(20);
    expect(r.recortado).toBe(true);
  });
});

describe("helpers de mes compartidos", () => {
  it("avanza de diciembre a enero del año siguiente", () => {
    expect(mesSiguiente("2026-12")).toBe("2027-01");
  });

  it("da el rango completo sin huecos, extremos incluidos", () => {
    expect(rangoDeMeses("2026-11", "2027-02"))
      .toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("un rango invertido da vacío en vez de colgarse", () => {
    expect(rangoDeMeses("2026-06", "2026-01")).toEqual([]);
  });

  it("nombra y abrevia el mes", () => {
    expect(nombreMes("2026-07")).toBe("julio");
    expect(mesCorto("2026-07")).toBe("jul");
  });
});
