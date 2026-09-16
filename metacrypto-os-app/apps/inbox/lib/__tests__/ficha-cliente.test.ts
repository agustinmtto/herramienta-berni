import { describe, it, expect } from "vitest";
import {
  resumenDinero, agruparCompras, cupoDe, avisosDe, sumaMeses, esDevolucion,
  type ProgramaFicha, type PagoFicha, type CuotaFicha, type SesionFicha,
} from "../ficha-cliente";

const prog = (p: Partial<ProgramaFicha> & { id: string; fecha_inicio: string }): ProgramaFicha => ({
  tier: "5000", motivo: "nueva_venta", meses_duracion: 12, monto: 5000,
  divisa: "EUR", programa_previo_id: null, ...p,
});

let np = 0;
const pago = (p: Partial<PagoFicha> & { fecha: string }): PagoFicha => ({
  id: `p${++np}`, programa_id: "P1", cuota_id: null, tipo: "payment",
  tipo_detalle: "Primer pago", monto: 1000, divisa: "EUR", usd_recibido: 1080,
  metodo_pago: "Stripe", comprobante_path: null, devolucion_motivo: null, ...p,
});

let nc = 0;
const cuota = (p: Partial<CuotaFicha> & { fecha_vencimiento: string }): CuotaFicha => ({
  id: `c${++nc}`, programa_id: "P1", numero_cuota: 2, monto: 1000,
  divisa: "EUR", estado: "pendiente", ...p,
});

const ses = (p: Partial<SesionFicha> = {}): SesionFicha => ({
  id: `s${Math.random()}`, fecha: "2026-07-01", coach: "Manuel",
  duracion_min: 60, estado_asistencia: "asistio", notas: null, numero: 1, ...p,
});

describe("esDevolucion", () => {
  it("distingue un reembolso de un cobro", () => {
    expect(esDevolucion(pago({ fecha: "2026-08-01", tipo: "refund" }))).toBe(true);
    expect(esDevolucion(pago({ fecha: "2026-08-01" }))).toBe(false);
  });
});

describe("resumenDinero", () => {
  const pagos = [
    pago({ fecha: "2026-02-14", monto: 2000 }),
    pago({ fecha: "2026-06-27", monto: 4000 }),
    pago({ fecha: "2026-08-18", monto: -400, tipo: "refund" }),
  ];
  const cuotas = [
    cuota({ fecha_vencimiento: "2026-09-07", monto: 1000 }),
    cuota({ fecha_vencimiento: "2026-10-07", monto: 500, estado: "anulada" }),
  ];

  it("separa bruto, devuelto y neto", () => {
    const r = resumenDinero(pagos, cuotas);
    expect(r.cobradoBruto).toBe(6000);
    expect(r.devuelto).toBe(400);
    expect(r.neto).toBe(5600);
  });

  // Si saliera negativo, componer "− {devuelto}" en la pantalla restaría dos veces.
  it("devuelve el importe devuelto en positivo", () => {
    expect(resumenDinero(pagos, []).devuelto).toBeGreaterThan(0);
  });

  it("el pendiente solo cuenta cuotas vivas, no las anuladas", () => {
    const r = resumenDinero(pagos, cuotas);
    expect(r.pendiente).toBe(1000);
    expect(r.nCuotasPendientes).toBe(1);
  });

  it("un cliente sin nada da ceros, no NaN", () => {
    expect(resumenDinero([], [])).toEqual({
      cobradoBruto: 0, devuelto: 0, neto: 0, pendiente: 0,
      nCobros: 0, nDevoluciones: 0, nCuotasPendientes: 0,
    });
  });

  it("cuenta cobros y devoluciones por separado", () => {
    const r = resumenDinero(pagos, cuotas);
    expect(r.nCobros).toBe(2);
    expect(r.nDevoluciones).toBe(1);
  });
});

describe("agruparCompras", () => {
  const programas = [
    prog({ id: "P1", tier: "5000", fecha_inicio: "2026-06-27", programa_previo_id: "P0" }),
    prog({ id: "P0", tier: "3000", fecha_inicio: "2026-02-14", meses_duracion: 8 }),
  ];
  const pagos = [
    pago({ id: "pa", programa_id: "P0", fecha: "2026-02-14", monto: 2000 }),
    pago({ id: "pb", programa_id: "P1", fecha: "2026-06-27", monto: 4000 }),
    pago({ id: "pc", programa_id: "P1", fecha: "2026-08-01", monto: 1000, cuota_id: "cx" }),
    pago({ id: "pd", programa_id: "P0", fecha: "2026-08-18", monto: -400, tipo: "refund" }),
  ];
  const cuotas = [
    cuota({ id: "cx", programa_id: "P1", numero_cuota: 2, fecha_vencimiento: "2026-08-01" }),
    cuota({ id: "cy", programa_id: "P1", numero_cuota: 3, fecha_vencimiento: "2026-09-07" }),
  ];

  it("ordena los programas del más reciente al más antiguo", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    expect(b.map((x) => x.programa.tier)).toEqual(["5000", "3000"]);
  });

  it("marca vigente solo el más reciente ya empezado", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    expect(b[0].vigente).toBe(true);
    expect(b[1].vigente).toBe(false);
  });

  it("dice de qué programa ascendió", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    expect(b[0].ascendioDe).toBe("3000");
    expect(b[1].ascendioDe).toBeNull();
  });

  // El defecto de la ficha actual: anunciar como próximo un cobro ya hecho.
  it("una cuota ya cobrada NO se repite como línea pendiente", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    const claves = b[0].lineas.map((l) => l.clave);
    expect(claves).toContain("pago-pc");
    expect(claves).not.toContain("cuota-cx");
  });

  it("la cuota que falta sí sale, con sus días de retraso", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-10");
    const l = b[0].lineas.find((x) => x.clave === "cuota-cy")!;
    expect(l.estado).toBe("pendiente");
    expect(l.retraso).toBe(3);
  });

  it("una cuota que aún no vence tiene retraso negativo", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    expect(b[0].lineas.find((x) => x.clave === "cuota-cy")!.retraso).toBe(-5);
  });

  it("las líneas van en orden cronológico", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    const fechas = b[0].lineas.map((l) => l.fecha);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it("el reembolso sale en su programa y con estado devuelto", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    const l = b[1].lineas.find((x) => x.clave === "pago-pd")!;
    expect(l.estado).toBe("devuelto");
    expect(l.eur).toBe(-400);
  });

  // El total de un programa no puede incluir lo que todavía no se ha cobrado:
  // sería repetir el error de "Total" que esta ficha viene a quitar.
  it("el total del programa NO suma las cuotas por cobrar", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    expect(b[0].total).toBe(5000);
    expect(b[1].total).toBe(1600);
  });

  it("un programa futuro no roba la vigencia al que corre", () => {
    const conFuturo = [...programas, prog({ id: "P2", tier: "8000", fecha_inicio: "2027-01-01" })];
    const b = agruparCompras(conFuturo, pagos, cuotas, "2026-09-02");
    expect(b.find((x) => x.vigente)!.programa.id).toBe("P1");
  });

  it("un cliente sin programas da lista vacía", () => {
    expect(agruparCompras([], [], [], "2026-09-02")).toEqual([]);
  });

  // Bug real: la línea de un pago de cuota decía "Cuota" sin número porque
  // nunca miraba el `numero_cuota` de la cuota que lo generó.
  it("una cuota cobrada muestra su número, no solo 'Cuota'", () => {
    const b = agruparCompras(programas, pagos, cuotas, "2026-09-02");
    const l = b[0].lineas.find((x) => x.clave === "pago-pc")!;
    expect(l.concepto).toBe("Cuota 2");
  });
});

describe("cupoDe", () => {
  it("cuenta solo las sesiones a las que asistió", () => {
    const s = [ses(), ses(), ses({ estado_asistencia: "no_asistio" }), ses({ estado_asistencia: null })];
    expect(cupoDe(s, 4)).toEqual({ incluidas: 4, hechas: 2, pendientes: 2 });
  });

  it("sin cupo definido no inventa un denominador", () => {
    expect(cupoDe([ses()], null)).toEqual({ incluidas: null, hechas: 1, pendientes: null });
  });

  it("pasarse del cupo no da pendientes negativas", () => {
    expect(cupoDe([ses(), ses(), ses()], 2).pendientes).toBe(0);
  });
});

describe("avisosDe", () => {
  const base = {
    cuotas: [] as CuotaFicha[],
    sesiones: [] as SesionFicha[],
    cupo: { incluidas: 4, hechas: 4, pendientes: 0 },
    programa: null as ProgramaFicha | null,
    estrategias: 1,
    telefono: "+34600000000",
  };

  it("un cliente al día no genera ni un aviso", () => {
    expect(avisosDe(base, "2026-09-02")).toEqual([]);
  });

  it("avisa de la cuota que vence pronto", () => {
    const a = avisosDe({ ...base, cuotas: [cuota({ fecha_vencimiento: "2026-09-07" })] }, "2026-09-02");
    expect(a[0].clave).toBe("cuota-proxima");
    expect(a[0].texto).toContain("5 días");
  });

  it("distingue vencida de por vencer", () => {
    const a = avisosDe({ ...base, cuotas: [cuota({ fecha_vencimiento: "2026-08-20" })] }, "2026-09-02");
    expect(a[0].clave).toBe("cuota-vencida");
    expect(a[0].texto).toContain("13 días");
  });

  it("dice 'vence hoy' el mismo día, no '0 días'", () => {
    const a = avisosDe({ ...base, cuotas: [cuota({ fecha_vencimiento: "2026-09-02" })] }, "2026-09-02");
    expect(a[0].texto).toContain("vence hoy");
  });

  // Una cuota a seis meses vista no es trabajo de hoy.
  it("no avisa de una cuota lejana", () => {
    const a = avisosDe({ ...base, cuotas: [cuota({ fecha_vencimiento: "2027-03-01" })] }, "2026-09-02");
    expect(a).toEqual([]);
  });

  it("avisa de las sesiones pasadas sin registrar", () => {
    const a = avisosDe({
      ...base,
      sesiones: [ses({ fecha: "2026-08-30", estado_asistencia: null })],
    }, "2026-09-02");
    expect(a[0].clave).toBe("sesiones-sin-registrar");
  });

  it("una sesión futura sin registrar no es un aviso", () => {
    const a = avisosDe({
      ...base,
      sesiones: [ses({ fecha: "2026-09-20", estado_asistencia: null })],
    }, "2026-09-02");
    expect(a).toEqual([]);
  });

  it("avisa del cupo sin usar cuando el programa se acaba", () => {
    const a = avisosDe({
      ...base,
      cupo: { incluidas: 4, hechas: 3, pendientes: 1 },
      programa: prog({ id: "P1", fecha_inicio: "2025-11-01", meses_duracion: 12 }),
    }, "2026-09-02");
    expect(a[0].clave).toBe("cupo-sin-usar");
    expect(a[0].texto).toContain("1 consultoría");
  });

  it("no avisa del cupo si al programa le queda medio año", () => {
    const a = avisosDe({
      ...base,
      cupo: { incluidas: 4, hechas: 1, pendientes: 3 },
      programa: prog({ id: "P1", fecha_inicio: "2026-06-01", meses_duracion: 12 }),
    }, "2026-09-02");
    expect(a).toEqual([]);
  });

  it("avisa de la falta de teléfono y de estrategia", () => {
    const a = avisosDe({ ...base, telefono: null, estrategias: 0 }, "2026-09-02");
    expect(a.map((x) => x.clave)).toEqual(["sin-telefono", "sin-estrategia"]);
  });

  // Lo que cuesta dinero antes que lo que falta por rellenar.
  it("el dinero va delante de los datos que faltan", () => {
    const a = avisosDe({
      ...base,
      cuotas: [cuota({ fecha_vencimiento: "2026-09-03" })],
      telefono: null,
      estrategias: 0,
    }, "2026-09-02");
    expect(a[0].tono).toBe("atencion");
    expect(a[a.length - 1].tono).toBe("dato");
  });

  it("nunca devuelve más de tres", () => {
    const a = avisosDe({
      ...base,
      cuotas: [cuota({ fecha_vencimiento: "2026-08-01" })],
      sesiones: [ses({ fecha: "2026-08-30", estado_asistencia: null })],
      cupo: { incluidas: 4, hechas: 3, pendientes: 1 },
      programa: prog({ id: "P1", fecha_inicio: "2025-11-01", meses_duracion: 12 }),
      telefono: null,
      estrategias: 0,
    }, "2026-09-02");
    expect(a).toHaveLength(3);
  });
});

describe("sumaMeses", () => {
  it("suma meses conservando el día", () => {
    expect(sumaMeses("2026-06-27", 12)).toBe("2027-06-27");
  });

  it("cruza el año", () => {
    expect(sumaMeses("2026-11-15", 3)).toBe("2027-02-15");
  });

  // `new Date(2026, 0, 31)` + 1 mes daría el 3 de marzo.
  it("un 31 en un mes de 30 cae al último día, no al mes siguiente", () => {
    expect(sumaMeses("2026-08-31", 1)).toBe("2026-09-30");
    expect(sumaMeses("2026-01-31", 1)).toBe("2026-02-28");
  });
});
