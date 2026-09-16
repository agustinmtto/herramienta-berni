import { describe, it, expect, afterEach, vi } from "vitest";
import {
  hoyMadrid, puedeVerImportes, partirTimeline, agruparPorMes,
  dateEsMadrid, monthLabelMadrid,
} from "../timeline";
import type { EventoTimeline } from "../timeline";

const ev = (over: Partial<EventoTimeline>): EventoTimeline => ({
  persona_id: "p1", fecha: "2026-08-01T10:00:00+00:00", dia: "2026-08-01",
  tipo: "pago", titulo: "Cobro registrado", detalle: null, importe: 100, ref_id: "r1",
  ...over,
});

describe("hoyMadrid", () => {
  it("a las 23:30 UTC de agosto ya es el día siguiente en Madrid", () => {
    // Madrid va en UTC+2 en agosto: 23:30Z = 01:30 del día siguiente.
    expect(hoyMadrid(new Date("2026-08-05T23:30:00Z"))).toBe("2026-08-06");
  });
  it("a las 00:30 UTC sigue siendo el mismo día en Madrid", () => {
    expect(hoyMadrid(new Date("2026-08-06T00:30:00Z"))).toBe("2026-08-06");
  });
  it("devuelve el formato YYYY-MM-DD", () => {
    expect(hoyMadrid(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15");
  });
});

// dateEs()/monthLabel() de lib/format.ts no fijan zona horaria y por eso
// dependen del TZ del proceso — con una TZ negativa un `dia` como
// "2026-08-01" se puede leer como "31 jul". dateEsMadrid/monthLabelMadrid
// existen para no repetir ese bug en esta pantalla; cada test fuerza
// explícitamente una TZ negativa (América) para probar que, a diferencia de
// dateEs/monthLabel, no les afecta.
describe("dateEsMadrid / monthLabelMadrid con TZ negativa", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("dateEsMadrid no retrocede un día bajo TZ negativa (caso que falla hoy con dateEs)", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(dateEsMadrid("2026-08-01")).toBe("01 ago 26");
  });

  it("monthLabelMadrid no retrocede de mes ni de año bajo TZ negativa (1 de enero)", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(monthLabelMadrid("2026-01-01")).toBe("ene 2026");
  });

  it("dateEsMadrid devuelve — con día nulo (paridad con dateEs)", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(dateEsMadrid(null)).toBe("—");
  });

  it("monthLabelMadrid en un mes cualquiera bajo TZ negativa", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(monthLabelMadrid("2026-08-01")).toBe("ago 2026");
  });

  it("dateEsMadrid es correcto también bajo TZ positiva (no rompe el caso ya bueno)", () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    expect(dateEsMadrid("2026-08-01")).toBe("01 ago 26");
  });
});

describe("puedeVerImportes", () => {
  it("acceso total ve los importes", () => {
    expect(puedeVerImportes({ acceso_total: true, modulos: null })).toBe(true);
  });
  it("el módulo ingresos abre los importes", () => {
    expect(puedeVerImportes({ acceso_total: false, modulos: ["clientes", "ingresos"] })).toBe(true);
  });
  it("clientes + inbox NO ve los importes (caso Manuel)", () => {
    expect(puedeVerImportes({ acceso_total: false, modulos: ["clientes", "inbox"] })).toBe(false);
  });
  it("sin módulos no ve los importes", () => {
    expect(puedeVerImportes({ acceso_total: false, modulos: null })).toBe(false);
  });
});

describe("partirTimeline", () => {
  const hoy = "2026-08-06";
  it("lo que vence después de hoy va a Próximo", () => {
    const r = partirTimeline([ev({ dia: "2026-09-01", tipo: "cuota" })], hoy);
    expect(r.proximo).toHaveLength(1);
    expect(r.historia).toHaveLength(0);
  });
  it("lo de hoy cuenta como historia, no como próximo", () => {
    const r = partirTimeline([ev({ dia: hoy })], hoy);
    expect(r.historia).toHaveLength(1);
    expect(r.proximo).toHaveLength(0);
  });
  it("los eventos sin fecha se apartan y no rompen el orden", () => {
    const r = partirTimeline([ev({ dia: null, fecha: null, tipo: "sesion" })], hoy);
    expect(r.sinFecha).toHaveLength(1);
    expect(r.historia).toHaveLength(0);
    expect(r.proximo).toHaveLength(0);
  });
  it("la historia va de más reciente a más antigua", () => {
    const r = partirTimeline(
      [ev({ dia: "2026-06-03", ref_id: "viejo" }), ev({ dia: "2026-08-01", ref_id: "nuevo" })],
      hoy,
    );
    expect(r.historia.map((e) => e.ref_id)).toEqual(["nuevo", "viejo"]);
  });
  it("lo próximo va de más cercano a más lejano", () => {
    const r = partirTimeline(
      [ev({ dia: "2026-09-02", ref_id: "lejos" }), ev({ dia: "2026-09-01", ref_id: "cerca" })],
      hoy,
    );
    expect(r.proximo.map((e) => e.ref_id)).toEqual(["cerca", "lejos"]);
  });
  it("desempata eventos del mismo día usando fecha (historia más reciente primero)", () => {
    const r = partirTimeline(
      [
        ev({ dia: "2026-06-03", ref_id: "viejo", fecha: "2026-06-03T08:00:00+00:00" }),
        ev({ dia: "2026-06-03", ref_id: "nuevo", fecha: "2026-06-03T20:00:00+00:00" }),
      ],
      hoy,
    );
    expect(r.historia.map((e) => e.ref_id)).toEqual(["nuevo", "viejo"]);
  });
  it("desempata eventos del mismo día usando fecha (próximo más cercano primero)", () => {
    const r = partirTimeline(
      [
        ev({ dia: "2026-09-01", ref_id: "tarde", fecha: "2026-09-01T20:00:00+00:00" }),
        ev({ dia: "2026-09-01", ref_id: "mañana", fecha: "2026-09-01T08:00:00+00:00" }),
      ],
      hoy,
    );
    expect(r.proximo.map((e) => e.ref_id)).toEqual(["mañana", "tarde"]);
  });
  it("trata fecha nula como más antigua en historia", () => {
    const r = partirTimeline(
      [
        ev({ dia: "2026-06-03", ref_id: "conFecha", fecha: "2026-06-03T20:00:00+00:00" }),
        ev({ dia: "2026-06-03", ref_id: "sinFecha", fecha: null }),
      ],
      hoy,
    );
    expect(r.historia.map((e) => e.ref_id)).toEqual(["conFecha", "sinFecha"]);
  });
  it("trata fecha nula como más antigua incluso si entra primero en historia", () => {
    const r = partirTimeline(
      [
        ev({ dia: "2026-06-03", ref_id: "sinFecha", fecha: null }),
        ev({ dia: "2026-06-03", ref_id: "conFecha", fecha: "2026-06-03T20:00:00+00:00" }),
      ],
      hoy,
    );
    expect(r.historia.map((e) => e.ref_id)).toEqual(["conFecha", "sinFecha"]);
  });
  it("trata fecha nula como menos próxima en próximo (va después)", () => {
    const r = partirTimeline(
      [
        ev({ dia: "2026-09-01", ref_id: "conFecha", fecha: "2026-09-01T08:00:00+00:00" }),
        ev({ dia: "2026-09-01", ref_id: "sinFecha", fecha: null }),
      ],
      hoy,
    );
    expect(r.proximo.map((e) => e.ref_id)).toEqual(["conFecha", "sinFecha"]);
  });
  it("trata fecha nula como menos próxima incluso si entra primero en próximo", () => {
    const r = partirTimeline(
      [
        ev({ dia: "2026-09-01", ref_id: "sinFecha", fecha: null }),
        ev({ dia: "2026-09-01", ref_id: "conFecha", fecha: "2026-09-01T08:00:00+00:00" }),
      ],
      hoy,
    );
    expect(r.proximo.map((e) => e.ref_id)).toEqual(["conFecha", "sinFecha"]);
  });
});

describe("agruparPorMes", () => {
  it("agrupa por mes conservando el orden recibido", () => {
    const r = agruparPorMes([
      ev({ dia: "2026-08-02", ref_id: "a" }),
      ev({ dia: "2026-08-01", ref_id: "b" }),
      ev({ dia: "2026-06-03", ref_id: "c" }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].mes).toBe("2026-08");
    expect(r[0].eventos.map((e) => e.ref_id)).toEqual(["a", "b"]);
    expect(r[1].mes).toBe("2026-06");
  });
  it("ignora los eventos sin día", () => {
    expect(agruparPorMes([ev({ dia: null })])).toHaveLength(0);
  });
  it("fusiona meses no contiguos en un único grupo", () => {
    const r = agruparPorMes([
      ev({ dia: "2026-08-02", ref_id: "a" }),
      ev({ dia: "2026-06-03", ref_id: "c" }),
      ev({ dia: "2026-08-01", ref_id: "b" }),
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].mes).toBe("2026-08");
    expect(r[0].eventos.map((e) => e.ref_id)).toEqual(["a", "b"]);
    expect(r[1].mes).toBe("2026-06");
    expect(r[1].eventos.map((e) => e.ref_id)).toEqual(["c"]);
  });
});
