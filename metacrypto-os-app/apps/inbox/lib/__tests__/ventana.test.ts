import { describe, it, expect } from "vitest";
import { ventanaCerrada, msHastaCierre, momentoEnMadrid } from "../ventana";

// Caso real (ese cliente, 10-ago-2026): último entrante el 9-ago 09:29:29 UTC.
const ULTIMO = "2026-08-09T09:29:29+00:00";

describe("ventanaCerrada", () => {
  it("está abierta justo antes de cumplirse las 24 h", () => {
    expect(ventanaCerrada(ULTIMO, new Date("2026-08-10T09:29:00Z"))).toBe(false);
  });

  it("está cerrada justo después", () => {
    expect(ventanaCerrada(ULTIMO, new Date("2026-08-10T09:30:00Z"))).toBe(true);
  });

  it("a las 11:01 del 10-ago ya estaba cerrada (el intento que falló)", () => {
    expect(ventanaCerrada(ULTIMO, new Date("2026-08-10T11:01:05Z"))).toBe(true);
  });

  it("sin ningún mensaje entrante nunca hubo ventana", () => {
    expect(ventanaCerrada(null, new Date("2026-08-10T11:01:05Z"))).toBe(true);
  });

  it("una fecha ilegible se trata como cerrada, que es el lado seguro", () => {
    // Mejor bloquear de más que dejar mandar algo que Meta va a rechazar.
    expect(ventanaCerrada("no es una fecha", new Date())).toBe(true);
  });
});

describe("msHastaCierre — para programar el bloqueo automático", () => {
  it("devuelve lo que queda cuando la ventana sigue abierta", () => {
    const ms = msHastaCierre(ULTIMO, new Date("2026-08-10T08:29:29Z"));
    expect(ms).toBe(3600 * 1000); // justo una hora
  });

  it("devuelve 0 si ya venció, para no programar nada", () => {
    expect(msHastaCierre(ULTIMO, new Date("2026-08-10T11:01:05Z"))).toBe(0);
  });

  it("devuelve 0 si no hay entrante", () => {
    expect(msHastaCierre(null, new Date())).toBe(0);
  });
});

describe("momentoEnMadrid — para que el aviso diga cuándo fue", () => {
  it("convierte a hora de Madrid, no deja la UTC", () => {
    // 09:29 UTC en agosto son las 11:29 en Madrid (UTC+2).
    const txt = momentoEnMadrid(ULTIMO);
    expect(txt).toMatch(/11:29/);
    expect(txt).toMatch(/9/);
    expect(txt).toMatch(/ago/i);
  });

  it("sin fecha no inventa nada", () => {
    expect(momentoEnMadrid(null)).toBeNull();
  });

  it("una fecha ilegible tampoco", () => {
    expect(momentoEnMadrid("cualquier cosa")).toBeNull();
  });
});
