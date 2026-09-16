import { describe, it, expect } from "vitest";
import {
  paresVisibles, traducirNovedad,
  type EventoAuditoria, type Nombres,
} from "../novedades";
import type { UserPerms } from "../modulos";
// Para componer los esperados: Intl separa cifra y símbolo con no-break
// space — fijar eso a mano en un literal es fijar un detalle de ICU.
import { money } from "../format";

// Perfiles reales del equipo (3-sep-2026).
const JEFE: UserPerms = { acceso_total: true, modulos: null };
const COACH: UserPerms = { acceso_total: false, modulos: ["clientes", "inbox", "sesiones"] };
const SETTER: UserPerms = { acceso_total: false, modulos: [] };
const FINANZAS: UserPerms = { acceso_total: false, modulos: ["ingresos", "cuotas", "gastos"] };
// Quien registra ventas y, por el mismo módulo, tiene la pestaña /contratos.
const CLOSER: UserPerms = { acceso_total: false, modulos: ["ventas", "clientes"] };

const NOMBRES: Nombres = {
  miembroPorId: new Map([["m-alex", "Alex"], ["m-manuel", "Manuel"]]),
  personaPorId: new Map([["p-juan", "Juan P."]]),
  personaPorCuotaId: new Map([["c-1", "Juan P."]]),
};

const ev = (parcial: Partial<EventoAuditoria>): EventoAuditoria => ({
  id: "a-1", entidad: "venta", entidad_id: "prog-1", accion: "alta",
  autor_id: "m-alex", datos: {}, created_at: "2026-09-03T15:00:00Z", ...parcial,
});

// La forma EXACTA que escribe crearVenta (Task 7 del plan / spec §Datos).
const DATOS_VENTA = {
  persona_id: "p-juan", nombre: "Juan P.", tipo: "nueva",
  pago_monto: 3000, valor_total: 5000, divisa: "EUR", autor_venta_id: "m-alex",
};

describe("paresVisibles", () => {
  it("acceso_total ve los 9 pares de la lista blanca", () => {
    expect(paresVisibles(JEFE)).toHaveLength(9);
  });

  it("un miembro sin módulos ve venta y contrato firmado — las dos son \"todos\"", () => {
    expect(paresVisibles(SETTER)).toEqual([
      { entidad: "venta", accion: "alta" },
      { entidad: "contrato", accion: "firmado" },
    ]);
  });

  it("un coach ve venta y sesiones, no cuotas", () => {
    const pares = paresVisibles(COACH).map((p) => p.entidad);
    expect(pares).toContain("venta");
    expect(pares).toContain("sesion");
    expect(pares).not.toContain("cuota");
  });
});

describe("traducirNovedad — venta", () => {
  it("con módulo de dinero: nombre, monto y closer", () => {
    const n = traducirNovedad(ev({ datos: DATOS_VENTA }), JEFE, NOMBRES);
    expect(n?.frase).toBe(`Nueva venta — Juan P. · ${money(3000, "EUR")} · closer: Alex`);
  });

  it("sin módulo de dinero: nombre pelado, ni monto ni closer ni tier", () => {
    const n = traducirNovedad(ev({ datos: DATOS_VENTA }), COACH, NOMBRES);
    expect(n?.frase).toBe("Nueva venta — Juan P.");
    expect(n?.frase).not.toMatch(/[0-9]/);
  });

  it("una ascensión acredita 'por', no 'closer'", () => {
    const d = { ...DATOS_VENTA, tipo: "ascension", nombre: "", autor_venta_id: "m-manuel" };
    const n = traducirNovedad(ev({ datos: d }), JEFE, NOMBRES);
    expect(n?.frase).toBe(`Ascensión — Juan P. · ${money(3000, "EUR")} · por Manuel`);
  });

  it("el nombre vacío del upsell se resuelve por persona_id", () => {
    const d = { ...DATOS_VENTA, tipo: "extension", nombre: "" };
    const n = traducirNovedad(ev({ datos: d }), COACH, NOMBRES);
    expect(n?.frase).toBe("Extensión — Juan P.");
  });

  it("un setter sin módulos ve la venta pelada y sin link", () => {
    const n = traducirNovedad(ev({ datos: DATOS_VENTA }), SETTER, NOMBRES);
    expect(n?.frase).toBe("Nueva venta — Juan P.");
    expect(n?.url).toBeNull();
  });

  it("quien puede ver clientes recibe el link a la ficha", () => {
    const n = traducirNovedad(ev({ datos: DATOS_VENTA }), COACH, NOMBRES);
    expect(n?.url).toBe("/clientes/p-juan");
  });
});

describe("traducirNovedad — contrato generado", () => {
  // La forma EXACTA que escribe `generarContrato` (contrato-envio.ts): sin
  // `nombre`, así que el cliente se resuelve por `persona_id`.
  const e = ev({ entidad: "contrato", entidad_id: "ctr-1", accion: "generado",
    datos: { persona_id: "p-juan", programa_id: "prog-1", tipo: "venta_nueva_v2" } });

  // 🔴 Esta fila es lo que sustituyó al correo interno automático al equipo
  // (spec 2026-09-15, decisión 3). Antes se escribía en `auditoria` y el
  // centro de novedades la descartaba por no estar en la lista blanca: se
  // había quitado un correo prometiendo una campana que no sonaba.
  it("suena en la campana de quien tiene ventas, con link a /contratos", () => {
    const n = traducirNovedad(e, CLOSER, NOMBRES);
    expect(n?.frase).toBe("Contrato generado — Juan P.");
    expect(n?.url).toBe("/contratos");
    expect(n?.autor).toBe("Alex");
  });

  it("no enseña ni dinero ni de qué plantilla salió", () => {
    const n = traducirNovedad(e, JEFE, NOMBRES);
    expect(n?.frase).toBe("Contrato generado — Juan P.");
    expect(n?.frase).not.toMatch(/[0-9]/);
    expect(n?.frase).not.toMatch(/v2|venta_nueva|ampliacion/);
  });

  // A diferencia de la firma, que es "todos": un contrato generado es trabajo
  // esperando, no una celebración.
  it("quien no tiene ventas no la ve", () => {
    expect(traducirNovedad(e, SETTER, NOMBRES)).toBeNull();
    expect(traducirNovedad(e, COACH, NOMBRES)).toBeNull();
  });
});

describe("traducirNovedad — contrato firmado", () => {
  const e = ev({ entidad: "contrato", entidad_id: "ctr-1", accion: "firmado", autor_id: null,
    datos: { persona_id: "p-juan", nombre: "Juan P.", firma_nombre: "Juan Pérez" } });
  it("lo ve todo el equipo, sin dinero, con link a la ficha si puede", () => {
    const jefe = traducirNovedad(e, JEFE, NOMBRES);
    expect(jefe?.frase).toBe("Contrato firmado — Juan P.");
    expect(jefe?.url).toBe("/clientes/p-juan");
    expect(jefe?.autor).toBeNull();
    const setter = traducirNovedad(e, SETTER, NOMBRES);
    expect(setter?.frase).toBe("Contrato firmado — Juan P.");
    expect(setter?.url).toBeNull();
  });
});

describe("traducirNovedad — cuota (datos reales de 0017: sin persona_id)", () => {
  const DATOS_CUOTA = {
    antes: { monto: 500, estado: "pendiente" },
    despues: { monto: 500, estado: "pagada" },
    pago_id: "pg-1", importe: 500, metodo_pago: "transferencia",
  };

  it("nombra al cliente vía personaPorCuotaId (entidad_id = id de cuota)", () => {
    const e = ev({ entidad: "cuota", accion: "pago", entidad_id: "c-1", id: "a-2", datos: DATOS_CUOTA });
    const n = traducirNovedad(e, FINANZAS, NOMBRES);
    expect(n?.frase).toBe(`Cuota cobrada — Juan P. · ${money(500, "EUR")}`);
  });

  it("quien no tiene cuotas no la ve", () => {
    const e = ev({ entidad: "cuota", accion: "pago", entidad_id: "c-1", datos: DATOS_CUOTA });
    expect(traducirNovedad(e, COACH, NOMBRES)).toBeNull();
  });
});

describe("traducirNovedad — devolución", () => {
  // La base guarda el eur de una devolución EN NEGATIVO (es dinero que sale).
  // "Devolución — X · -2000 €" es doble negación: se enseña el valor absoluto.
  it("enseña el importe en absoluto, sin doble negación", () => {
    const e = ev({
      entidad: "devolucion", accion: "devolucion_registrada", entidad_id: "pg-9",
      datos: { persona_id: "p-juan", eur: -2000, alcance: "total" },
    });
    const n = traducirNovedad(e, JEFE, NOMBRES);
    expect(n?.frase).toBe(`Devolución — Juan P. · ${money(2000, "EUR")}`);
  });
});

describe("traducirNovedad — gasto y divisa", () => {
  it("el gasto se pinta en su divisa (USD), no en euros", () => {
    const e = ev({ entidad: "gasto", accion: "alta", entidad_id: "g-1", datos: { concepto: "Zoom", monto: 60, divisa: "USD", mes: "2026-09" } });
    const n = traducirNovedad(e, FINANZAS, NOMBRES);
    expect(n?.frase).toContain("60,00");
    expect(n?.frase).toContain("US$");
    expect(n?.frase).not.toContain("€");
  });
});

describe("traducirNovedad — robustez", () => {
  it("evento fuera de la lista blanca → null (persona/edicion es traza, no novedad)", () => {
    expect(traducirNovedad(ev({ entidad: "persona", accion: "edicion" }), JEFE, NOMBRES)).toBeNull();
  });

  it("datos malformado no revienta: degrada la frase", () => {
    const n = traducirNovedad(ev({ datos: "basura" }), JEFE, NOMBRES);
    expect(n?.frase).toContain("Nueva venta");
  });

  it("nombre irresoluble → 'un cliente'", () => {
    const d = { ...DATOS_VENTA, nombre: "", persona_id: "p-borrada" };
    const n = traducirNovedad(ev({ datos: d }), COACH, NOMBRES);
    expect(n?.frase).toBe("Nueva venta — un cliente");
  });

  it("autor humano de la fila sale de autor_id", () => {
    const n = traducirNovedad(ev({ datos: DATOS_VENTA }), JEFE, NOMBRES);
    expect(n?.autor).toBe("Alex");
  });
});
