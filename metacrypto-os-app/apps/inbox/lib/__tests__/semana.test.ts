import { describe, it, expect } from "vitest";
import {
  semanaDe, semanaAnterior, semanaSiguiente, etiquetaSemana, parseSemanaParam,
  resumenSemana, deltaPct, etiquetaMotivo,
} from "../semana";
import type { PagoSemana, VentaSemana } from "../semana";

describe("semanaDe", () => {
  it("desde un lunes devuelve ese lunes y su domingo", () => {
    expect(semanaDe("2026-08-03")).toEqual({ desde: "2026-08-03", hasta: "2026-08-09" });
  });
  it("desde un miércoles devuelve la misma semana", () => {
    expect(semanaDe("2026-08-05")).toEqual({ desde: "2026-08-03", hasta: "2026-08-09" });
  });
  it("desde un domingo devuelve esa semana, no la siguiente", () => {
    expect(semanaDe("2026-08-09")).toEqual({ desde: "2026-08-03", hasta: "2026-08-09" });
  });
  it("cruza el cambio de mes", () => {
    expect(semanaDe("2026-08-01")).toEqual({ desde: "2026-07-27", hasta: "2026-08-02" });
  });
  it("cruza el cambio de año", () => {
    expect(semanaDe("2026-01-01")).toEqual({ desde: "2025-12-29", hasta: "2026-01-04" });
  });
});

describe("navegación", () => {
  const s = { desde: "2026-08-03", hasta: "2026-08-09" };
  it("semanaAnterior retrocede siete días", () => {
    expect(semanaAnterior(s)).toEqual({ desde: "2026-07-27", hasta: "2026-08-02" });
  });
  it("semanaSiguiente avanza siete días", () => {
    expect(semanaSiguiente(s)).toEqual({ desde: "2026-08-10", hasta: "2026-08-16" });
  });
  it("es reversible", () => {
    expect(semanaSiguiente(semanaAnterior(s))).toEqual(s);
  });
  it("es reversible cruzando el cambio de año", () => {
    const fin = { desde: "2025-12-29", hasta: "2026-01-04" };
    expect(semanaAnterior(semanaSiguiente(fin))).toEqual(fin);
  });
});

describe("etiquetaSemana", () => {
  it("dentro del mismo mes no repite el mes", () => {
    expect(etiquetaSemana({ desde: "2026-08-03", hasta: "2026-08-09" })).toBe("3 – 9 ago 2026");
  });
  it("a caballo entre dos meses nombra los dos", () => {
    expect(etiquetaSemana({ desde: "2026-07-27", hasta: "2026-08-02" })).toBe("27 jul – 2 ago 2026");
  });
  it("a caballo entre dos años nombra los dos", () => {
    expect(etiquetaSemana({ desde: "2025-12-29", hasta: "2026-01-04" }))
      .toBe("29 dic 2025 – 4 ene 2026");
  });
});

describe("parseSemanaParam", () => {
  const hoy = "2026-08-12"; // miércoles
  it("sin parámetro cae a la semana de hoy", () => {
    expect(parseSemanaParam(undefined, hoy)).toEqual({ desde: "2026-08-10", hasta: "2026-08-16" });
  });
  it("con una fecha válida devuelve esa semana", () => {
    expect(parseSemanaParam("2026-08-05", hoy)).toEqual({ desde: "2026-08-03", hasta: "2026-08-09" });
  });
  it("con basura cae a la semana de hoy", () => {
    expect(parseSemanaParam("la-semana-pasada", hoy)).toEqual({ desde: "2026-08-10", hasta: "2026-08-16" });
  });
  it("con una fecha imposible cae a la semana de hoy en vez de rodar de mes", () => {
    // Date.UTC(2026, 12, 45) no da NaN: rueda a 2027-01-14. Sin comprobar el
    // viaje de ida y vuelta, esa basura llegaría a las consultas como si fuera
    // una fecha buena.
    expect(parseSemanaParam("2026-13-45", hoy)).toEqual({ desde: "2026-08-10", hasta: "2026-08-16" });
  });
});

// Igual que el fixture de comisiones: el dólar acompaña al euro salvo que el
// test diga otra cosa, para que los casos de reparto sigan con cifras redondas.
const pago = (over: Partial<PagoSemana>): PagoSemana => ({
  id: "pg1", fecha: "2026-08-05", tipo: "nueva", tipo_detalle: "Pago único",
  monto: 1000, usd_recibido: 1000, persona: { id: "p1", nombre: "Cliente Uno" },
  ...(over.monto != null && over.usd_recibido === undefined
    ? { usd_recibido: over.monto }
    : {}),
  ...over,
});
const venta = (over: Partial<VentaSemana>): VentaSemana => ({
  id: "pr1", fecha_inicio: "2026-08-05", motivo: "nueva_venta", tier: "2000",
  monto: 2000, persona: { id: "p1", nombre: "Cliente Uno" }, ...over,
});

describe("resumenSemana", () => {
  it("suma el cash collected y cuenta los pagos", () => {
    const r = resumenSemana([pago({ monto: 1000 }), pago({ id: "pg2", monto: 1500 })], []);
    expect(r.cashCollected).toBe(2500);
    expect(r.nPagos).toBe(2);
  });

  it("suma la facturación y calcula el ticket medio", () => {
    const r = resumenSemana([], [venta({ monto: 2000 }), venta({ id: "pr2", monto: 3500 })]);
    expect(r.facturacion).toBe(5500);
    expect(r.nVentas).toBe(2);
    expect(r.ticketMedio).toBe(2750);
  });

  it("sin ventas el ticket medio es null, no cero ni NaN", () => {
    const r = resumenSemana([pago({})], []);
    expect(r.ticketMedio).toBeNull();
    expect(r.facturacion).toBe(0);
  });

  it("agrupa la facturación por motivo, de mayor a menor", () => {
    const r = resumenSemana([], [
      venta({ id: "a", motivo: "upsell", monto: 1000 }),
      venta({ id: "b", motivo: "nueva_venta", monto: 3500 }),
      venta({ id: "c", motivo: "nueva_venta", monto: 2000 }),
    ]);
    expect(r.porMotivo).toEqual([
      { motivo: "nueva_venta", importe: 5500, n: 2 },
      { motivo: "upsell", importe: 1000, n: 1 },
    ]);
  });

  it("no inventa motivos cuando no hay ventas", () => {
    expect(resumenSemana([], []).porMotivo).toEqual([]);
  });

  it("cuadra con la semana real del 3 al 9 de agosto de 2026", () => {
    // Cifras cruzadas a mano contra Supabase al levantar la spec.
    const pagos = [1000, 1500, 600, 3500, 2000, 3500].map((m, i) =>
      pago({ id: `pg${i}`, monto: m }));
    const ventas = [2000, 1500, 3500, 2000, 3500].map((m, i) =>
      venta({ id: `pr${i}`, monto: m }));
    const r = resumenSemana(pagos, ventas);
    expect(r.cashCollected).toBe(12100);
    expect(r.nPagos).toBe(6);
    expect(r.facturacion).toBe(12500);
    expect(r.nVentas).toBe(5);
    expect(r.ticketMedio).toBe(2500);
  });
});

describe("deltaPct", () => {
  it("calcula la variación porcentual", () => {
    expect(deltaPct(120, 100)).toBe(20);
  });
  it("con caída da negativo", () => {
    expect(deltaPct(80, 100)).toBe(-20);
  });
  it("sin semana anterior con dinero devuelve null en vez de infinito", () => {
    expect(deltaPct(500, 0)).toBeNull();
  });
});

describe("etiquetaMotivo", () => {
  it("traduce los motivos del catálogo", () => {
    expect(etiquetaMotivo("nueva_venta")).toBe("Nueva");
    expect(etiquetaMotivo("upsell")).toBe("Ascensión");
    expect(etiquetaMotivo("renovacion")).toBe("Extensión");
  });
  it("un motivo desconocido se muestra tal cual en vez de desaparecer", () => {
    expect(etiquetaMotivo("motivo_futuro")).toBe("motivo_futuro");
  });
});

describe("resumenSemana — el cash en dólares (14-ago-2026)", () => {
  it("suma usd_recibido aparte del euro: son dos números distintos", () => {
    const r = resumenSemana(
      [pago({ monto: 1000, usd_recibido: 1072 }),
       pago({ id: "pg2", monto: 1500, usd_recibido: 1608 })],
      [],
    );
    expect(r.cashCollected).toBe(2500);
    expect(r.cashUsd).toBe(2680);
    expect(r.nSinUsd).toBe(0);
  });

  // Un pago sin el dato no se cuenta como 0 en silencio: el total en dólares
  // saldría más bajo de lo real y parecería correcto. `nSinUsd` es lo que
  // permite a la pantalla decir "este número está incompleto".
  it("marca cuántos pagos no tienen dólar", () => {
    const r = resumenSemana(
      [pago({ monto: 1000, usd_recibido: 1072 }),
       pago({ id: "pg2", monto: 1500, usd_recibido: null })],
      [],
    );
    expect(r.cashUsd).toBe(1072);
    expect(r.nSinUsd).toBe(1);
    expect(r.nPagos).toBe(2);
  });

  it("la facturación NO se convierte: la venta se firma en euros", () => {
    const r = resumenSemana([], [venta({ monto: 3500 })]);
    expect(r.facturacion).toBe(3500);
    expect(r.cashUsd).toBe(0);
  });

  it("una semana sin pagos da cero, no NaN", () => {
    const r = resumenSemana([], []);
    expect(r.cashUsd).toBe(0);
    expect(r.nSinUsd).toBe(0);
  });
});
