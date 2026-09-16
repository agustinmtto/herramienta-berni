import { describe, it, expect } from "vitest";
import {
  finDeMes, sumaMeses, mesesEntre, rangoDePreset, diasTrazados,
  cobradoPorMes, serieCash, acumuladoDe, comparaRitmo, mesesConDatos,
  pacing, cubreMesEntero, rangoCerrado, fxPorMes, fxDe, clasificaCuotas,
  concentracion, devoluciones, ventasReales, ticketMedio, mixTiers,
  ventasPorMes, porVencer, etiquetaMes, ejeBonito, fechaCorta, etiquetaEje, diasEnRango, ejeConSuelo, etiquetaVisible, familiaDeTier, reparto, cobertura,
} from "../inicio";
import type { PagoInicio, ProgramaInicio, CuotaInicio, PersonaInicio } from "../inicio";

// "Hoy" fijo: 26 de agosto de 2026, mes de 31 días, día 26 transcurrido.
const HOY = "2026-08-26";

const pago = (fecha: string, usd: number, extra: Partial<PagoInicio> = {}): PagoInicio => ({
  fecha, tipo: "nueva", eur: usd / 1.1, usd, nombre: "Alguien", ...extra,
});
let seq = 0;
const prog = (fecha: string, eur: number | null, extra: Partial<ProgramaInicio> = {}): ProgramaInicio => ({
  id: `p${++seq}`, fecha, tier: String(eur), motivo: "nueva_venta", eur, meses: 6,
  nombre: "Alguien", personaId: "x", programaPrevioId: null, conFuente: false,
  fuente: null, metodoPago: null, ...extra,
});
const persona = (id: string, estado = "cliente"): PersonaInicio =>
  ({ id, nombre: id, estado, alta: "2026-01-01", pais: "España" });

describe("calendario", () => {
  it("finDeMes conoce los meses cortos y los bisiestos", () => {
    expect(finDeMes("2026-08")).toBe(31);
    expect(finDeMes("2026-04")).toBe(30);
    expect(finDeMes("2026-02")).toBe(28);
    expect(finDeMes("2024-02")).toBe(29);
  });

  it("sumaMeses cruza el cambio de año en los dos sentidos", () => {
    expect(sumaMeses("2026-08", 6)).toBe("2027-02");
    expect(sumaMeses("2026-01", -1)).toBe("2025-12");
    expect(sumaMeses("2026-08", -11)).toBe("2025-09");
    expect(sumaMeses("2026-12", 1)).toBe("2027-01");
  });

  it("mesesEntre incluye los dos extremos y vacía si van al revés", () => {
    expect(mesesEntre("2026-06-15", "2026-08-26")).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(mesesEntre("2026-08-01", "2026-08-31")).toEqual(["2026-08"]);
    expect(mesesEntre("2026-09-01", "2026-08-26")).toEqual([]);
  });

  it("los presets salen del mes en curso, no de los últimos N días", () => {
    expect(rangoDePreset("mes", HOY, "2025-09-01")).toEqual({ desde: "2026-08-01", hasta: HOY });
    expect(rangoDePreset("3m", HOY, "2025-09-01").desde).toBe("2026-06-01");
    expect(rangoDePreset("12m", HOY, "2025-09-01").desde).toBe("2025-09-01");
    expect(rangoDePreset("anio", HOY, "2025-09-01").desde).toBe("2026-01-01");
    expect(rangoDePreset("todo", HOY, "2025-09-01").desde).toBe("2025-09-01");
  });

  it("diasTrazados corta el mes en curso por hoy y deja enteros los demás", () => {
    expect(diasTrazados("2026-08", HOY)).toBe(26);
    expect(diasTrazados("2026-07", HOY)).toBe(31);
    expect(diasTrazados("2026-02", HOY)).toBe(28);
  });
});

describe("cobrado", () => {
  const pagos = [pago("2026-07-10", 1000), pago("2026-08-05", 2000), pago("2026-08-20", -500)];

  it("las devoluciones restan, como en v_cash_collected", () => {
    const m = cobradoPorMes(pagos, { desde: "2026-01-01", hasta: HOY });
    expect(m.get("2026-08")).toBe(1500);
  });

  it("respeta el rango por los dos extremos", () => {
    const m = cobradoPorMes(pagos, { desde: "2026-08-01", hasta: "2026-08-10" });
    expect(m.get("2026-08")).toBe(2000);
    expect(m.has("2026-07")).toBe(false);
  });
});

describe("serieCash — la pantalla nunca habla del futuro", () => {
  const pagos = [pago("2026-06-10", 1000), pago("2026-08-05", 2000)];

  it("se corta en el mes en curso aunque el filtro pida más", () => {
    const s = serieCash(pagos, { desde: "2026-06-01", hasta: "2026-12-31" }, HOY);
    expect(s.map((b) => b.ym)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("un mes sin cobros aparece con cero, no desaparece", () => {
    const s = serieCash(pagos, { desde: "2026-06-01", hasta: HOY }, HOY);
    expect(s.find((b) => b.ym === "2026-07")?.cob).toBe(0);
  });

  it("un rango enteramente futuro no devuelve nada que pintar", () => {
    expect(serieCash(pagos, { desde: "2026-10-01", hasta: "2026-12-31" }, HOY)).toEqual([]);
  });

  it("un rango cerrado en el pasado no se estira hasta hoy", () => {
    const s = serieCash(pagos, { desde: "2026-06-01", hasta: "2026-06-30" }, HOY);
    expect(s.map((b) => b.ym)).toEqual(["2026-06"]);
  });

  it("marca el mes en curso y le pone sus días transcurridos", () => {
    const s = serieCash(pagos, { desde: "2026-06-01", hasta: HOY }, HOY);
    expect(s.at(-1)).toMatchObject({ ym: "2026-08", enCurso: true, dias: 26 });
    expect(s[0]).toMatchObject({ ym: "2026-06", enCurso: false, dias: 30 });
  });

  it("los días de cada mes se recortan al rango, porque el dinero también", () => {
    // Con 15-jul → 10-ago, julio aporta 17 días de cobros y agosto 10.
    // Dividir entre 31 y 26 daba un ritmo inventado muy por debajo del real.
    const s = serieCash(pagos, { desde: "2026-07-15", hasta: "2026-08-10" }, HOY);
    expect(s.map((b) => [b.ym, b.dias])).toEqual([["2026-07", 17], ["2026-08", 10]]);
  });

  it("un rango de un solo día cuenta un día, no un mes", () => {
    const s = serieCash(pagos, { desde: "2026-08-05", hasta: "2026-08-05" }, HOY);
    expect(s[0].dias).toBe(1);
  });
});

describe("ritmo", () => {
  const pagos = [
    pago("2026-07-05", 100), pago("2026-07-20", 200), pago("2026-07-31", 700),
    pago("2026-08-05", 300), pago("2026-08-26", 100),
  ];

  it("el acumulado crece y arranca en cero", () => {
    const a = acumuladoDe(pagos, "2026-07");
    expect(a[0]).toBe(0);
    expect(a[5]).toBe(100);
    expect(a[20]).toBe(300);
    expect(a[31]).toBe(1000);
    expect(a.length).toBe(32);
  });

  it("compara a igual número de días, no totales contra parciales", () => {
    const r = comparaRitmo(pagos, "2026-08", "2026-07", HOY);
    expect(r.diasA).toBe(26);          // agosto va por el día 26
    expect(r.diasB).toBe(31);          // julio está cerrado
    expect(r.diaComparacion).toBe(26); // se comparan al 26, no al 31
    // Agosto 400 al día 26; julio 300 a esa altura. Sin el corte, 400 vs 1000.
    expect(r.dif).toBeCloseTo((400 - 300) / 300, 6);
  });

  it("entre dos meses cerrados compara al menor de los dos", () => {
    const r = comparaRitmo(pagos, "2026-06", "2026-07", HOY);
    expect(r.diaComparacion).toBe(30);   // junio tiene 30
    expect(r.tocaMesEnCurso).toBe(false); // ninguno es agosto → sin marca de hoy
  });

  it("detecta el mes en curso esté en A o en B", () => {
    expect(comparaRitmo(pagos, "2026-08", "2026-07", HOY).tocaMesEnCurso).toBe(true);
    expect(comparaRitmo(pagos, "2026-02", "2026-08", HOY).tocaMesEnCurso).toBe(true);
  });

  it("sin base de comparación devuelve null en vez de dividir por cero", () => {
    expect(comparaRitmo(pagos, "2026-08", "2026-01", HOY).dif).toBeNull();
  });

  it("lista los meses con datos del más reciente al más antiguo", () => {
    expect(mesesConDatos(pagos)).toEqual(["2026-08", "2026-07"]);
  });
});

describe("pacing", () => {
  const pagos = [
    pago("2026-07-10", 1000), pago("2026-07-28", 5000),
    pago("2026-08-10", 1300),
  ];

  it("proyecta por regla de tres sobre los días transcurridos", () => {
    const p = pacing(pagos, HOY);
    expect(p.delMes).toBe(1300);
    expect(p.dia).toBe(26);
    expect(p.diasMes).toBe(31);
    expect(p.ritmoDiario).toBeCloseTo(50, 6);
    expect(p.proyeccion).toBeCloseTo(1550, 6);
  });

  it("compara contra el mes anterior al MISMO día, no contra su total", () => {
    const p = pacing(pagos, HOY);
    expect(p.mesPrevio).toBe("2026-07");
    expect(p.prevMismoDia).toBe(1000);   // el pago del 28 de julio queda fuera
    expect(p.dif).toBeCloseTo(0.3, 6);
  });

  it("cubreMesEntero exige que el rango arranque el día 1 o antes", () => {
    expect(cubreMesEntero({ desde: "2026-08-01", hasta: HOY }, HOY)).toBe(true);
    expect(cubreMesEntero({ desde: "2025-01-01", hasta: HOY }, HOY)).toBe(true);
    expect(cubreMesEntero({ desde: "2026-08-15", hasta: HOY }, HOY)).toBe(false);
    expect(cubreMesEntero({ desde: "2026-01-01", hasta: "2026-03-31" }, HOY)).toBe(false);
  });

  it("cubreMesEntero también exige que el «hasta» llegue hasta hoy", () => {
    // El fallo bloqueante: mirando solo el MES del «hasta», un corte del día 1
    // al 25 pasaba el filtro y el titular etiquetaba «agosto 2026» una cifra
    // de unos pocos días, con el pacing del mes entero al lado.
    expect(cubreMesEntero({ desde: "2026-08-01", hasta: "2026-08-01" }, HOY)).toBe(false);
    expect(cubreMesEntero({ desde: "2025-09-01", hasta: "2026-08-20" }, HOY)).toBe(false);
    expect(cubreMesEntero({ desde: "2025-09-01", hasta: "2026-08-25" }, HOY)).toBe(false);
    expect(cubreMesEntero({ desde: "2025-09-01", hasta: "2026-12-31" }, HOY)).toBe(true);
  });

  it("rangoCerrado reconoce un rango que termina antes del mes en curso", () => {
    expect(rangoCerrado({ desde: "2026-01-01", hasta: "2026-03-31" }, HOY)).toBe(true);
    expect(rangoCerrado({ desde: "2026-01-01", hasta: HOY }, HOY)).toBe(false);
  });
});

describe("tipo de cambio", () => {
  it("promedia el implícito de cada mes por separado", () => {
    const fx = fxPorMes([
      { fecha: "2026-08-01", tipo: null, eur: 100, usd: 110, nombre: "A" },
      { fecha: "2026-08-02", tipo: null, eur: 100, usd: 112, nombre: "B" },
      { fecha: "2026-05-01", tipo: null, eur: 100, usd: 103, nombre: "C" },
    ]);
    expect(fx.get("2026-08")).toBeCloseTo(1.11, 6);
    expect(fx.get("2026-05")).toBeCloseTo(1.03, 6);
  });

  it("un mes sin pagos cae a la media de los que sí tienen", () => {
    const fx = fxPorMes([{ fecha: "2026-08-01", tipo: null, eur: 100, usd: 110, nombre: "A" }]);
    expect(fxDe(fx, "2027-03")).toBeCloseTo(1.1, 6);
  });

  it("las devoluciones no ensucian el cambio", () => {
    const fx = fxPorMes([
      { fecha: "2026-08-01", tipo: null, eur: 100, usd: 110, nombre: "A" },
      { fecha: "2026-08-02", tipo: "refund", eur: -100, usd: -110, nombre: "B" },
    ]);
    expect(fx.get("2026-08")).toBeCloseTo(1.1, 6);
  });
});

describe("cuotas — vencidas y futuras no son lo mismo", () => {
  const fx = new Map([["2026-08", 1.1], ["2026-09", 1.1]]);
  const cuotas: CuotaInicio[] = [
    { fecha: "2026-08-01", eur: 1000, estado: "pendiente" },  // vencida
    { fecha: "2026-08-10", eur: 500, estado: "pendiente" },   // vencida
    { fecha: "2026-09-14", eur: 2000, estado: "pendiente" },  // futura
    { fecha: "2026-09-20", eur: 100, estado: "pagada" },      // ni una ni otra
    { fecha: "2026-09-25", eur: 300, estado: "anulada" },
  ];

  it("separa por fecha de vencimiento, no las mete en el mismo saco", () => {
    const c = clasificaCuotas(cuotas, fx, HOY);
    expect(c.futuras.n).toBe(1);
    expect(c.futuras.usd).toBeCloseTo(2200, 6);
    expect(c.vencidas.n).toBe(2);
    expect(c.vencidas.usd).toBeCloseTo(1650, 6);
  });

  it("solo cuenta las pendientes: pagadas y anuladas quedan fuera", () => {
    const c = clasificaCuotas(cuotas, fx, HOY);
    expect(c.futuras.n + c.vencidas.n).toBe(3);
  });

  it("señala la vencida más vieja, que es por donde hay que empezar", () => {
    expect(clasificaCuotas(cuotas, fx, HOY).vencidas.masVieja).toBe("2026-08-01");
  });

  it("sin vencidas no inventa una fecha", () => {
    const c = clasificaCuotas([{ fecha: "2026-09-14", eur: 100, estado: "pendiente" }], fx, HOY);
    expect(c.vencidas.masVieja).toBeNull();
    expect(c.vencidas.n).toBe(0);
  });
});

describe("inteligencia", () => {
  const r = { desde: "2026-01-01", hasta: HOY };

  it("la concentración ignora las devoluciones para no inflarse", () => {
    const c = concentracion(
      [pago("2026-08-01", 800, { nombre: "A" }), pago("2026-08-02", 200, { nombre: "B" }),
       pago("2026-08-03", -100, { nombre: "C" })],
      r, 1,
    );
    expect(c.pct).toBeCloseTo(0.8, 6);
    expect(c.nPersonas).toBe(2);
    expect(c.top[0]).toEqual({ nombre: "A", usd: 800 });
  });

  it("la tasa de devolución se mide sobre el bruto, no sobre el neto", () => {
    const d = devoluciones([pago("2026-08-01", 1000), pago("2026-08-02", -100)], r);
    expect(d.bruto).toBe(1000);
    expect(d.devuelto).toBe(100);
    expect(d.tasa).toBeCloseTo(0.1, 6);
  });

  it("el cohorte OG se descarta por TIER, no por importe", () => {
    // Ninguna fila de la base tiene monto 0: los 79 sin importe son NULL —
    // 76 del cohorte OG y 3 ventas de verdad. Filtrar por dinero se comía esas 3.
    const progs = [
      prog("2023-01-01", null, { tier: "OG" }), prog("2023-01-01", null, { tier: "OG" }),
      prog("2026-06-01", 3000), prog("2026-07-01", 2000),
      prog("2026-05-01", null, { tier: "1000" }),      // venta real sin importe
    ];
    const v = ventasReales(progs, { desde: "2020-01-01", hasta: HOY }, HOY);
    expect(v.length).toBe(3);
    expect(v.map((p) => p.tier)).toContain("1000");
  });

  it("una venta sin importe cuenta como venta pero no entra en el promedio", () => {
    const v = [prog("2026-06-01", 3000), prog("2026-07-01", 2000), prog("2026-05-01", null)];
    expect(ticketMedio(v)).toEqual({ media: 2500, sinImporte: 1 });
  });

  it("si NINGUNA venta tiene importe la media es null, no cero", () => {
    // Un «0 €» sería una cifra falsa, y encima contradiría a la barra de tier
    // de al lado, que dice «sin importe».
    expect(ticketMedio([prog("2026-04-01", null)])).toEqual({ media: null, sinImporte: 1 });
    expect(ticketMedio([])).toEqual({ media: null, sinImporte: 0 });
  });

  it("ventasReales no deja pasar nada fechado después de hoy", () => {
    const progs = [prog("2026-08-01", 2000), prog("2026-10-01", 1475)];
    const v = ventasReales(progs, { desde: "2020-01-01", hasta: "2026-12-31" }, HOY);
    expect(v.map((p) => p.fecha)).toEqual(["2026-08-01"]);
  });

  it("el mix de tiers ordena por dinero, no por número de ventas", () => {
    const v = [prog("2026-06-01", 5000), prog("2026-06-02", 1000), prog("2026-06-03", 1000)];
    // La familia sale etiquetada "2000" y no "1000": desde el 10-sep las
    // ventas de 1000/1500/1800/2000 se cuentan como un solo programa, y la
    // etiqueta es el precio de catálogo de esa familia. Lo pidió Berni en
    // CAMBIOS OS, y el orden por dinero —que es lo que prueba este test—
    // sigue siendo el mismo.
    expect(mixTiers(v)).toEqual([
      { tier: "5000", eur: 5000, n: 1 },
      { tier: "2000", eur: 2000, n: 2 },
    ]);
  });

  it("lo que no cabe se agrupa en «otros»: los recuentos deben seguir sumando", () => {
    // 3000 cae en la familia 3500 y 2000/1000 en la familia 2000, así que las
    // cinco ventas son CUATRO barras: 5000, 4000, 3500 y 2000. Con tope 3, las
    // dos últimas se juntan en "otros (2)". El dinero y los recuentos siguen
    // cuadrando, que es lo que este test vigila.
    const v = [5000, 4000, 3000, 2000, 1000].map((e, i) => prog(`2026-06-0${i + 1}`, e));
    const filas = mixTiers(v, 3);
    expect(filas.length).toBe(3);
    expect(filas[2]).toEqual({ tier: "otros (2)", eur: 6000, n: 3 });
    // La suma de las barras es la suma de las ventas. Sin esto, la tarjeta
    // decía 119 ventas mientras el KPI de al lado decía 120.
    expect(filas.reduce((s, f) => s + f.n, 0)).toBe(v.length);
    expect(filas.reduce((s, f) => s + f.eur, 0)).toBe(15000);
  });

  it("las ventas por mes separan upsell de nueva y no se saltan meses vacíos", () => {
    const v = [prog("2026-06-01", 1000), prog("2026-08-01", 2000, { motivo: "upsell" })];
    expect(ventasPorMes(v, { desde: "2026-06-01", hasta: HOY }, HOY)).toEqual([
      { ym: "2026-06", nueva: 1, up: 0 },
      { ym: "2026-07", nueva: 0, up: 0 },
      { ym: "2026-08", nueva: 0, up: 1 },
    ]);
  });

  it("porVencer usa ventana estricta: excluye los que ya terminaron este mes", () => {
    const gente = [persona("x")];
    const progs = [
      prog("2026-02-01", 1000, { meses: 6 }),   // termina 2026-08 = mes en curso → fuera
      prog("2026-03-01", 1000, { meses: 6 }),   // termina 2026-09 → dentro
      prog("2026-04-01", 1000, { meses: 6 }),   // termina 2026-10 → dentro
      prog("2026-05-01", 1000, { meses: 6 }),   // termina 2026-11 → fuera del tope
      prog("2026-05-01", 1000, { meses: null }),// sin duración → fuera
    ];
    expect(porVencer(progs, gente, HOY, 2)).toBe(2);
  });

  it("no es cola de renovación quien ya ascendió ni quien dejó de ser cliente", () => {
    const dentro = prog("2026-03-01", 1000, { meses: 6, id: "A", personaId: "ana" });
    const yaSubio = prog("2026-03-01", 1000, { meses: 6, id: "B", personaId: "beto" });
    const ascenso = prog("2026-08-14", 5000, { meses: 12, motivo: "upsell", programaPrevioId: "B", personaId: "beto" });
    const devuelto = prog("2026-03-01", 1000, { meses: 6, id: "C", personaId: "caro" });
    const gente = [persona("ana"), persona("beto"), persona("caro", "ex_cliente")];
    // Solo `dentro` es una llamada que merece la pena hacer.
    expect(porVencer([dentro, yaSubio, ascenso, devuelto], gente, HOY, 2)).toBe(1);
  });
});

describe("etiquetas y ejes", () => {
  it("etiquetaMes no depende de la zona horaria del proceso", () => {
    expect(etiquetaMes("2026-08")).toBe("ago ’26");
    expect(etiquetaMes("2026-08", true)).toBe("agosto 2026");
    expect(etiquetaMes("2026-01", true)).toBe("enero 2026");
    expect(etiquetaMes("2025-12")).toBe("dic ’25");
  });

  it("un eje de recuento no tiene marcas fraccionarias", () => {
    // "0,25 ventas" no existe. Con max=1 el paso crudo es 0,25.
    expect(ejeBonito(1, true).paso).toBe(1);
    expect(ejeBonito(2, true).paso).toBe(1);
    expect(ejeBonito(30, true).paso % 1).toBe(0);
  });

  it("etiquetaEje no repite marcas ni miente por debajo del millar", () => {
    // Redondear a «k» daba 0k, 1k, 1k, 2k para pasos de 500.
    expect(etiquetaEje(500, 500)).toBe("500");
    expect(etiquetaEje(1500, 500)).toBe("1.500");
    expect(etiquetaEje(20000, 20000)).toBe("20k");
    expect(etiquetaEje(2500, 2500)).toBe("2,5k");
    expect(etiquetaEje(49985, 20000)).toBe("50k");   // no "50,0k"
    expect(etiquetaEje(63296, 20000)).toBe("63,3k");
    expect(etiquetaEje(0, 500)).toBe("0");
  });

  it("ejeBonito sube al siguiente escalón redondo", () => {
    expect(ejeBonito(63295)).toEqual({ top: 80000, paso: 20000 });
    expect(ejeBonito(1000)).toEqual({ top: 1000, paso: 250 });
    expect(ejeBonito(9)).toEqual({ top: 10, paso: 2.5 });
  });

  it("con cero o negativo no revienta ni devuelve NaN", () => {
    expect(ejeBonito(0)).toEqual({ top: 1, paso: 1 });
    expect(ejeBonito(-5)).toEqual({ top: 1, paso: 1 });
  });

  it("el tope siempre cubre el máximo", () => {
    for (const v of [1, 37, 499, 5001, 123456]) {
      const { top } = ejeBonito(v);
      expect(top).toBeGreaterThanOrEqual(v);
    }
  });
});

describe("fechaCorta — inmune a la zona horaria", () => {
  it("el día 1 sigue siendo el día 1, no el último del mes anterior", () => {
    expect(fechaCorta("2026-08-01")).toBe("01 ago 26");
    expect(fechaCorta("2026-01-01")).toBe("01 ene 26");
  });
  it("formatea un día cualquiera y tolera el nulo", () => {
    expect(fechaCorta("2026-12-31")).toBe("31 dic 26");
    expect(fechaCorta(null)).toBe("—");
  });
});

describe("ejeConSuelo — meses en negativo", () => {
  it("sin negativos se comporta como el eje de siempre", () => {
    expect(ejeConSuelo([2843, 63296, 49985])).toEqual({ top: 80000, suelo: 0, paso: 20000 });
  });

  it("un mes negativo no dispara el número de líneas de rejilla", () => {
    // Antes: paso 1 sobre un rango de −42..1 = 44 líneas.
    const { top, suelo, paso } = ejeConSuelo([-42]);
    expect(paso).toBeGreaterThanOrEqual(10);
    expect(suelo).toBeLessThanOrEqual(-42);
    expect(Math.round((top - suelo) / paso)).toBeLessThanOrEqual(8);
  });

  it("mezcla de positivos y negativos: el suelo cubre el peor mes", () => {
    const { top, suelo } = ejeConSuelo([50000, -12000, 30000]);
    expect(top).toBeGreaterThanOrEqual(50000);
    expect(suelo).toBeLessThanOrEqual(-12000);
  });

  it("todo a cero deja un escalón, no un eje de altura nula", () => {
    const { top, suelo } = ejeConSuelo([0, 0]);
    expect(top).toBeGreaterThan(suelo);
  });

  it("todo a cero no produce dos marcas que se rotulen igual", () => {
    const { top, suelo, paso } = ejeConSuelo([0, 0, 0]);
    const marcas = [];
    for (let v = suelo; v <= top + 1e-6; v += paso) marcas.push(etiquetaEje(v, paso));
    expect(new Set(marcas).size).toBe(marcas.length);
  });
});

describe("etiquetaVisible — el mes en curso nunca se queda sin nombre", () => {
  it("la última siempre se dibuja, caiga donde caiga el resto", () => {
    for (let total = 1; total <= 61; total++)
      for (let cada = 1; cada <= 8; cada++)
        expect(etiquetaVisible(total - 1, total, cada)).toBe(true);
  });

  it("dos etiquetas visibles nunca quedan a menos de `cada` de distancia", () => {
    for (let total = 1; total <= 61; total++) {
      for (let cada = 1; cada <= 8; cada++) {
        const vis = [...Array(total).keys()].filter((i) => etiquetaVisible(i, total, cada));
        for (let k = 1; k < vis.length; k++)
          expect(vis[k] - vis[k - 1]).toBeGreaterThanOrEqual(cada);
      }
    }
  });

  it("con hueco de sobra las dibuja todas", () => {
    expect([...Array(5).keys()].filter((i) => etiquetaVisible(i, 5, 1))).toEqual([0, 1, 2, 3, 4]);
  });

  it("el caso que se rompió: 32 columnas cada 3 llega hasta el final", () => {
    const vis = [...Array(32).keys()].filter((i) => etiquetaVisible(i, 32, 3));
    expect(vis.at(-1)).toBe(31);
    expect(vis.at(-2)).toBeLessThanOrEqual(28);
  });

  it("una sola columna se etiqueta", () => {
    expect(etiquetaVisible(0, 1, 5)).toBe(true);
  });
});

describe("familiaDeTier / mixTiers agrupado", () => {
  it("3000 y 3500 son el mismo programa", () => {
    expect(familiaDeTier("3000")).toBe("3500");
    expect(familiaDeTier("3500")).toBe("3500");
  });

  it("1000, 1500, 1800 y 2000 son el mismo programa", () => {
    for (const t of ["1000", "1500", "1800", "2000"]) expect(familiaDeTier(t)).toBe("2000");
  });

  it("un tier que no está en la tabla se queda como está", () => {
    expect(familiaDeTier("5000")).toBe("5000");
    expect(familiaDeTier("8000")).toBe("8000");
  });

  it("sin tier no revienta ni inventa una familia", () => {
    expect(familiaDeTier(null)).toBe("sin tier");
    expect(familiaDeTier("  ")).toBe("sin tier");
  });

  it("mixTiers suma importes Y ventas de toda la familia en una sola barra", () => {
    // Es lo que pidió Berni: "sumemos cantidades y cantidad de ventas".
    const filas = mixTiers([
      { tier: "3500", eur: 3500 }, { tier: "3000", eur: 3000 },
      { tier: "2000", eur: 2000 }, { tier: "1800", eur: 1800 }, { tier: "1000", eur: 1000 },
    ] as any);
    expect(filas.map((f) => f.tier).sort()).toEqual(["2000", "3500"]);
    expect(filas.find((f) => f.tier === "3500")).toMatchObject({ eur: 6500, n: 2 });
    expect(filas.find((f) => f.tier === "2000")).toMatchObject({ eur: 4800, n: 3 });
  });
});

describe("reparto / cobertura", () => {
  const v = [
    { f: "Instagram", e: 3500 }, { f: "Instagram", e: 2000 },
    { f: "WhatsApp", e: 5000 }, { f: null, e: 2000 }, { f: "  ", e: 1000 },
  ];
  const filas = () => reparto(v, (x) => x.f, (x) => x.e);

  it("agrupa por etiqueta y suma dinero y unidades", () => {
    const r = filas();
    expect(r.find((x) => x.clave === "Instagram")).toMatchObject({ eur: 5500, n: 2 });
    expect(r.find((x) => x.clave === "WhatsApp")).toMatchObject({ eur: 5000, n: 1 });
  });

  it("junta null y cadena vacía en una sola fila de «sin atribuir»", () => {
    const sin = filas().filter((x) => x.sinDato);
    expect(sin).toHaveLength(1);
    expect(sin[0]).toMatchObject({ clave: "sin atribuir", eur: 3000, n: 2 });
  });

  it("🔴 «sin atribuir» va SIEMPRE la última, aunque sea la más grande", () => {
    // Es el caso real: hoy la mitad de las ventas no tiene fuente. Si se
    // ordenara por dinero, el hueco encabezaría el gráfico como si fuera un
    // canal, y «sin atribuir» no es un sitio del que vengan clientes.
    const muchas = [{ f: "Instagram", e: 100 }, { f: null, e: 99999 }];
    const r = reparto(muchas, (x) => x.f, (x) => x.e);
    expect(r.map((x) => x.clave)).toEqual(["Instagram", "sin atribuir"]);
  });

  it("las conocidas van ordenadas por dinero", () => {
    expect(filas().filter((x) => !x.sinDato).map((x) => x.clave)).toEqual(["Instagram", "WhatsApp"]);
  });

  it("cobertura dice qué parte del total SÍ tiene el dato", () => {
    expect(cobertura(filas())).toEqual({ con: 3, sin: 2, pct: 60 });
  });

  it("sin nada que repartir, la cobertura no divide por cero", () => {
    expect(cobertura([])).toEqual({ con: 0, sin: 0, pct: 0 });
  });
});
