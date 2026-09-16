import { describe, it, expect } from "vitest";
import { clasificarCuota, diasRetraso, saldoTrasAbono, money2 } from "../cuotas";

describe("clasificarCuota", () => {
  it("marca vencida la que venció ayer", () => {
    expect(clasificarCuota("2026-08-04", "2026-08-05")).toBe("vencida");
  });
  it("la que vence hoy NO está vencida", () => {
    expect(clasificarCuota("2026-08-05", "2026-08-05")).toBe("mes");
  });
  it("agrupa en 'mes' lo que vence dentro del mes en curso", () => {
    expect(clasificarCuota("2026-08-30", "2026-08-05")).toBe("mes");
  });
  it("agrupa en 'futura' lo del mes siguiente", () => {
    expect(clasificarCuota("2026-09-01", "2026-08-05")).toBe("futura");
  });
});

describe("diasRetraso", () => {
  it("cuenta los días desde el vencimiento", () => {
    expect(diasRetraso("2026-08-01", "2026-08-05")).toBe(4);
  });
  it("devuelve 0 si aún no venció", () => {
    expect(diasRetraso("2026-08-30", "2026-08-05")).toBe(0);
  });
});

describe("saldoTrasAbono", () => {
  it("resta el abono del importe", () => {
    expect(saldoTrasAbono(500, 300)).toBe(200);
  });
  it("devuelve 0 cuando el abono cubre la cuota", () => {
    expect(saldoTrasAbono(500, 500)).toBe(0);
  });
  it("redondea a 2 decimales sin arrastrar error binario", () => {
    expect(saldoTrasAbono(0.3, 0.1)).toBe(0.2);
  });
});

describe("money2", () => {
  it("conserva los céntimos que money() redondearía", () => {
    // money() usa maximumFractionDigits: 0 y mostraría "201 €" para 200,50.
    expect(money2(200.5)).toContain("200,50");
  });
  it("respeta la divisa", () => {
    expect(money2(100, "USD")).toContain("100,00");
  });
});
