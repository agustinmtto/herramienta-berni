import { describe, it, expect } from "vitest";
import {
  mesDe, etiquetaMes, mesCorto, mesAnterior, mesesDisponibles, resumen, delMes,
  serieMensual, porCategoria, comparativa, normalizaConcepto, historialDe,
  variacionPrecio, recurrentesQueFaltan, fechaEnMes, TIPO_RECURRENTE,
  type GastoBase,
} from "../gastos";

// Fábrica corta: solo se nombran los campos que importan a cada prueba.
let n = 0;
const g = (p: Partial<GastoBase> & { fecha: string }): GastoBase => ({
  id: `g${++n}`,
  concepto: "Zoom",
  categoria: "Software",
  monto: 100,
  tipo_gasto: TIPO_RECURRENTE,
  metodo_pago: "Tarjeta",
  notas: null,
  ...p,
});

describe("meses", () => {
  it("saca el mes de una fecha sin tocar zonas horarias", () => {
    expect(mesDe("2026-08-31")).toBe("2026-08");
  });

  it("etiqueta y abrevia en castellano", () => {
    expect(etiquetaMes("2026-09")).toBe("septiembre 2026");
    expect(mesCorto("2026-09")).toBe("sep");
  });

  it("devuelve el mes tal cual si no es un mes válido", () => {
    expect(etiquetaMes("2026-13")).toBe("2026-13");
  });

  it("retrocede de enero a diciembre del año anterior", () => {
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesAnterior("2026-08")).toBe("2026-07");
  });
});

describe("mesesDisponibles", () => {
  it("ordena del más reciente al más antiguo", () => {
    const gs = [g({ fecha: "2026-05-10" }), g({ fecha: "2026-07-01" })];
    expect(mesesDisponibles(gs, "2026-07-15")).toEqual(["2026-07", "2026-05"]);
  });

  // El caso que motiva la pantalla: hoy es septiembre y septiembre está a cero.
  // Si el mes en curso no sale, la pantalla esconde justo lo que hay que ver.
  it("incluye el mes en curso aunque no tenga ni un gasto", () => {
    const gs = [g({ fecha: "2026-08-10" })];
    expect(mesesDisponibles(gs, "2026-09-02")).toEqual(["2026-09", "2026-08"]);
  });

  it("no duplica el mes en curso si ya tiene gastos", () => {
    const gs = [g({ fecha: "2026-09-01" })];
    expect(mesesDisponibles(gs, "2026-09-02")).toEqual(["2026-09"]);
  });
});

describe("resumen y filtrado por mes", () => {
  it("suma importes y cuenta movimientos", () => {
    expect(resumen([g({ fecha: "2026-08-01", monto: 10 }), g({ fecha: "2026-08-02", monto: 5.5 })]))
      .toEqual({ n: 2, total: 15.5 });
  });

  it("un mes sin gastos da cero, no NaN", () => {
    expect(resumen([])).toEqual({ n: 0, total: 0 });
  });

  it("no se cuela el gasto del último día del mes anterior", () => {
    const gs = [g({ fecha: "2026-07-31" }), g({ fecha: "2026-08-01" })];
    expect(delMes(gs, "2026-08")).toHaveLength(1);
    expect(delMes(gs, "2026-08")[0].fecha).toBe("2026-08-01");
  });
});

describe("serieMensual", () => {
  it("va del mes más antiguo al más reciente e incluye los vacíos del rango conocido", () => {
    const gs = [g({ fecha: "2026-07-01", monto: 100 }), g({ fecha: "2026-08-01", monto: 200 })];
    const s = serieMensual(gs, "2026-09-02");
    expect(s.map((x) => x.mes)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(s.map((x) => x.total)).toEqual([100, 200, 0]);
  });
});

describe("porCategoria", () => {
  it("agrupa, suma y ordena de mayor a menor", () => {
    const gs = [
      g({ fecha: "2026-08-01", categoria: "Software", monto: 50 }),
      g({ fecha: "2026-08-02", categoria: "Ads", monto: 300 }),
      g({ fecha: "2026-08-03", categoria: "Software", monto: 20 }),
    ];
    expect(porCategoria(gs)).toEqual([
      { categoria: "Ads", n: 1, total: 300 },
      { categoria: "Software", n: 2, total: 70 },
    ]);
  });

  it("manda los sin categoría a Otros en vez de perderlos", () => {
    expect(porCategoria([g({ fecha: "2026-08-01", categoria: null, monto: 9 })]))
      .toEqual([{ categoria: "Otros", n: 1, total: 9 }]);
  });
});

describe("comparativa con el mes anterior", () => {
  it("calcula diferencia y porcentaje", () => {
    const gs = [g({ fecha: "2026-07-01", monto: 100 }), g({ fecha: "2026-08-01", monto: 150 })];
    const c = comparativa(gs, "2026-08");
    expect(c.anterior).toBe("2026-07");
    expect(c.diff).toBe(50);
    expect(c.pct).toBeCloseTo(0.5);
  });

  // Sin esto la pantalla pintaría "+∞ %" el primer mes con datos.
  it("no divide por cero: pct es null si el mes anterior fue 0", () => {
    const gs = [g({ fecha: "2026-08-01", monto: 150 })];
    const c = comparativa(gs, "2026-08");
    expect(c.totalAnterior).toBe(0);
    expect(c.pct).toBeNull();
    expect(c.diff).toBe(150);
  });

  it("un mes a cero contra uno con gasto da variación negativa del 100 %", () => {
    const gs = [g({ fecha: "2026-08-01", monto: 100 })];
    const c = comparativa(gs, "2026-09");
    expect(c.pct).toBeCloseTo(-1);
  });
});

describe("normalizaConcepto", () => {
  it("iguala mayúsculas, acentos y espacios de más", () => {
    expect(normalizaConcepto("Google  Drive")).toBe("google drive");
    expect(normalizaConcepto(" FORMACIÓN ")).toBe("formacion");
    expect(normalizaConcepto("formacion")).toBe("formacion");
  });

  it("aguanta el vacío sin reventar", () => {
    expect(normalizaConcepto("")).toBe("");
  });
});

describe("historialDe y variacionPrecio", () => {
  const gs = [
    g({ fecha: "2026-06-01", concepto: "Zoom", monto: 20 }),
    g({ fecha: "2026-07-01", concepto: "zoom", monto: 20 }),
    g({ fecha: "2026-08-01", concepto: "Zoom ", monto: 32 }),
    g({ fecha: "2026-08-02", concepto: "Ads Meta", monto: 500 }),
  ];

  it("junta el mismo concepto aunque esté tecleado distinto, y ordena por fecha desc", () => {
    const h = historialDe(gs, "ZOOM");
    expect(h).toHaveLength(3);
    expect(h[0].fecha).toBe("2026-08-01");
  });

  it("detecta la subida de precio entre los dos últimos cobros", () => {
    const v = variacionPrecio(historialDe(gs, "Zoom"))!;
    expect(v.anterior).toBe(20);
    expect(v.actual).toBe(32);
    expect(v.pct).toBeCloseTo(0.6);
  });

  it("no inventa una variación cuando el concepto solo aparece una vez", () => {
    expect(variacionPrecio(historialDe(gs, "Ads Meta"))).toBeNull();
  });
});

describe("recurrentesQueFaltan", () => {
  const agosto = [
    g({ fecha: "2026-08-01", concepto: "Zoom", monto: 32 }),
    g({ fecha: "2026-08-02", concepto: "Google Drive", monto: 10 }),
    g({ fecha: "2026-08-03", concepto: "Ads Meta", monto: 500, tipo_gasto: "Gasto único" }),
  ];

  it("propone los recurrentes del mes anterior que aún no están", () => {
    const faltan = recurrentesQueFaltan(agosto, "2026-09");
    expect(faltan.map((x) => x.concepto)).toEqual(["Zoom", "Google Drive"]);
  });

  it("ordena por importe: lo caro se revisa primero", () => {
    const faltan = recurrentesQueFaltan(agosto, "2026-09");
    expect(faltan[0].monto).toBeGreaterThan(faltan[1].monto);
  });

  it("deja fuera los gastos únicos: no se repiten por definición", () => {
    expect(recurrentesQueFaltan(agosto, "2026-09").map((x) => x.concepto))
      .not.toContain("Ads Meta");
  });

  // Lo que evita cargar dos veces el mismo recibo si alguien pulsa dos veces.
  it("no propone lo que ya está cargado en el mes destino", () => {
    const gs = [...agosto, g({ fecha: "2026-09-01", concepto: "zoom", monto: 32 })];
    expect(recurrentesQueFaltan(gs, "2026-09").map((x) => x.concepto)).toEqual(["Google Drive"]);
  });

  it("un concepto partido en dos cobros el mes anterior se ofrece una sola vez", () => {
    const gs = [
      g({ fecha: "2026-08-01", concepto: "Salario Haiza", monto: 500 }),
      g({ fecha: "2026-08-15", concepto: "Salario Haiza", monto: 500 }),
    ];
    expect(recurrentesQueFaltan(gs, "2026-09")).toHaveLength(1);
  });

  it("si el mes anterior está vacío no propone nada", () => {
    expect(recurrentesQueFaltan([], "2026-09")).toEqual([]);
  });
});

describe("fechaEnMes", () => {
  it("conserva el día del mes original", () => {
    expect(fechaEnMes("2026-08-15", "2026-09")).toBe("2026-09-15");
  });

  // `new Date(2026, 8, 31)` daría el 1 de octubre: el gasto se iría de mes.
  it("un día 31 en un mes de 30 cae al último día, no al mes siguiente", () => {
    expect(fechaEnMes("2026-08-31", "2026-09")).toBe("2026-09-30");
  });

  it("respeta febrero", () => {
    expect(fechaEnMes("2026-01-30", "2026-02")).toBe("2026-02-28");
  });

  it("un día ilegible cae al día 1 en vez de producir una fecha inválida", () => {
    expect(fechaEnMes("2026-08", "2026-09")).toBe("2026-09-01");
  });
});
