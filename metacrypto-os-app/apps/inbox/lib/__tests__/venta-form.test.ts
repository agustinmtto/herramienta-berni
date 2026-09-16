import { describe, it, expect } from "vitest";
import {
  estadoInicial, reducer, camposDeVenta, motivoBloqueo, planDeCobro,
  duplicadoDe, candidatosDe, llaveSelector, hoyDe, ordenarTiersPorPrecio,
  type EstadoVenta, type Accion, type TierMin, type Contexto, type Atribucion,
} from "../venta-form";

const TIERS: TierMin[] = [
  { id: "3000", meses_default: 6 },
  { id: "6000", meses_default: 12 },
  { id: "1500", meses_default: null },
];

const inicial = (fecha = "2026-08-13") => estadoInicial(TIERS, fecha);
const d = (e: EstadoVenta, ...acciones: Accion[]) => acciones.reduce((s, a) => reducer(s, a, TIERS), e);

const CTX: Contexto = {
  programas: [
    { id: "p1", tier: "3000", motivo: "compra", fecha_inicio: "2026-01-10", monto: 3000 },
    { id: "p2", tier: "OG", motivo: "compra", fecha_inicio: "2025-05-01", monto: 0 },
  ],
  total_pagado: 3000,
  cuotas_pendientes: [],
};
const ATRIB: Atribucion = { sourceId: "s1", setterId: "set1", closerId: "clo1", ghlAppointmentId: "cita1" };

/* ============ hoyDe ============ */
describe("hoyDe", () => {
  it("usa la fecha LOCAL, no UTC (a las 00:30 en UTC+2, toISOString daba el día anterior)", () => {
    expect(hoyDe(new Date(2026, 7, 13, 0, 30))).toBe("2026-08-13");
    expect(hoyDe(new Date(2026, 0, 1, 23, 59))).toBe("2026-01-01");
  });
  it("rellena mes y día a dos dígitos", () => {
    expect(hoyDe(new Date(2026, 8, 5, 12, 0))).toBe("2026-09-05");
  });
});

/* ============ estadoInicial ============ */
describe("estadoInicial", () => {
  it("los defaults son contrato", () => {
    const e = inicial();
    expect(e.tipo).toBe("nueva");
    expect(e.nueva).toEqual({ nombre: "", email: "", iso: "ES", telefono: "" });
    expect(e.existente).toEqual({ personaId: "", busqueda: "", ctx: null, programaPrevio: "" });
    // El id del tier ES el precio en euros.
    expect(e.programa).toEqual({ tier: "3000", valorTotal: 3000, meses: 6, fechaInicio: "2026-08-13" });
    expect(e.cobro).toEqual({
      pagoMonto: 0, pagoFecha: "2026-08-13", metodo: "Stripe", usdRecibido: "", nCuotas: 0, cuotas: [],
    });
    expect(e.comision).toEqual({ atribucion: null, upsellPor: "" });
  });
  it("metodo_pago arranca en Stripe: el servidor NO valida ese campo, un vacío se guardaría sin error", () => {
    expect(inicial().cobro.metodo).toBe("Stripe");
  });
  it("usd_recibido arranca en string vacío, no en 0: '' significa «no aplica»", () => {
    expect(inicial().cobro.usdRecibido).toBe("");
  });
  it("las dos fechas arrancan iguales pero son independientes", () => {
    const e = d(inicial(), { t: "editarPagoFecha", valor: "2026-09-01" });
    expect(e.programa.fechaInicio).toBe("2026-08-13");
    expect(e.cobro.pagoFecha).toBe("2026-09-01");
  });
  it("sin tiers no revienta", () => {
    const e = estadoInicial([], "2026-08-13");
    expect(e.programa).toEqual({ tier: "", valorTotal: 0, meses: 6, fechaInicio: "2026-08-13" });
  });
  it("meses_default null cae en 6", () => {
    expect(estadoInicial([{ id: "1500", meses_default: null }], "2026-08-13").programa.meses).toBe(6);
  });
});

/* ============ EL CABLE: camposDeVenta ============ */
describe("camposDeVenta — lista de claves congelada", () => {
  // 24 claves llegan a crearVenta; 22 salen de aquí. Las otras dos vienen
  // del DOM y no pueden salir de un objeto: `comprobante` (un File) y
  // `agenda` ("on", el radio de SelectorAgenda — ruido inerte que nadie lee,
  // pero que está en el cable y ahí se queda).
  it("compra nueva manda exactamente 23 claves", () => {
    expect(Object.keys(camposDeVenta(inicial())).sort()).toEqual([
      "atribuido", "closer_id", "cuotas", "email", "fecha_inicio", "ghl_appointment_id",
      "meses_duracion", "metodo_pago", "nombre", "pago_fecha", "pago_monto", "pais_iso",
      "persona_id", "programa_previo_id", "setter_id", "source_id", "telefono", "tier",
      "tipo_venta", "upsell_por_id", "usd_recibido", "valor_total", "bonos",
    ].sort());
  });

  it("ascensión y extensión OMITEN email, pais_iso y telefono (sus inputs no se renderizan)", () => {
    for (const tipo of ["ascension", "extension"] as const) {
      const campos = camposDeVenta(d(inicial(), { t: "cambiarTipo", tipo }));
      expect(Object.keys(campos)).not.toContain("email");
      expect(Object.keys(campos)).not.toContain("pais_iso");
      expect(Object.keys(campos)).not.toContain("telefono");
      expect(Object.keys(campos)).toHaveLength(20);
    }
  });

  it("el ORDEN de las claves se conserva (fd.set sobreescribe en su sitio; las nuevas se añaden al final)", () => {
    // Las que ya venían del DOM por name=, primero; luego las que solo
    // existían como fd.set, en el orden en que se ponían.
    expect(Object.keys(camposDeVenta(inicial()))).toEqual([
      "email", "pais_iso", "telefono", "tier", "valor_total", "fecha_inicio", "meses_duracion",
      "pago_monto", "metodo_pago", "usd_recibido", "pago_fecha",
      "tipo_venta", "persona_id", "programa_previo_id", "nombre", "cuotas",
      "source_id", "setter_id", "closer_id", "ghl_appointment_id", "upsell_por_id", "atribuido",
      "bonos",
    ]);
  });
});

describe("camposDeVenta — compra nueva", () => {
  it("el estado inicial produce el cable de siempre", () => {
    expect(camposDeVenta(inicial())).toEqual({
      email: "", pais_iso: "ES", telefono: "",
      tier: "3000", valor_total: "3000", fecha_inicio: "2026-08-13", meses_duracion: "6",
      pago_monto: "", metodo_pago: "Stripe", usd_recibido: "", pago_fecha: "2026-08-13",
      tipo_venta: "nueva", persona_id: "", programa_previo_id: "", nombre: "", cuotas: "[]",
      source_id: "", setter_id: "", closer_id: "", ghl_appointment_id: "",
      upsell_por_id: "", atribuido: "false", bonos: "[]",
    });
  });

  it("persona_id, programa_previo_id y upsell_por_id van SIEMPRE vacíos en compra nueva", () => {
    // Aunque el estado del comprador existente esté sucio (no debería, pero
    // es la última línea de defensa contra la contaminación cruzada).
    const sucio: EstadoVenta = {
      ...inicial(),
      existente: { personaId: "X", busqueda: "Juan", ctx: CTX, programaPrevio: "p1" },
      comision: { atribucion: null, upsellPor: "team1" },
    };
    const c = camposDeVenta(sucio);
    expect(c.persona_id).toBe("");
    expect(c.programa_previo_id).toBe("");
    expect(c.upsell_por_id).toBe("");
    expect(c.nombre).toBe(""); // el nombre sale del comprador NUEVO, no de la búsqueda
  });

  it("el teléfono viaja CRUDO: la normalización a E.164 ocurre solo en el servidor", () => {
    const e = d(inicial(),
      { t: "editarNueva", campo: "iso", valor: "MX" },
      { t: "editarNueva", campo: "telefono", valor: " 55 1234 5678 " });
    expect(camposDeVenta(e).telefono).toBe(" 55 1234 5678 ");
    expect(camposDeVenta(e).pais_iso).toBe("MX");
  });

  it("el nombre viaja sin trim, tal cual se teclea", () => {
    const e = d(inicial(), { t: "editarNueva", campo: "nombre", valor: "  Ana  " });
    expect(camposDeVenta(e).nombre).toBe("  Ana  ");
  });
});

describe("camposDeVenta — los casos que se rompen en silencio", () => {
  it("usd_recibido vacío manda '' y NO '0' (con estado numérico, Number('') sería 0)", () => {
    expect(camposDeVenta(inicial()).usd_recibido).toBe("");
  });

  it("usd_recibido conserva el string RAW: '10.50' no se convierte en '10.5'", () => {
    const e = d(inicial(), { t: "editarUsdRecibido", valor: "10.50" });
    expect(camposDeVenta(e).usd_recibido).toBe("10.50");
  });

  it("metodo_pago nunca va vacío", () => {
    expect(camposDeVenta(inicial()).metodo_pago).toBe("Stripe");
    const e = d(inicial(), { t: "editarMetodo", valor: "Crypto" });
    expect(camposDeVenta(e).metodo_pago).toBe("Crypto");
  });

  it("atribuido es el STRING 'true'/'false'; un booleano dejaría todas las ventas en la bandeja", () => {
    expect(camposDeVenta(inicial()).atribuido).toBe("false");
    const e = d(inicial(), { t: "elegirAtribucion", atribucion: ATRIB });
    expect(camposDeVenta(e).atribuido).toBe("true");
    expect(typeof camposDeVenta(e).atribuido).toBe("string");
  });

  it("«No vino de agenda» decide (atribuido true) aunque todos los ids vayan vacíos", () => {
    const e = d(inicial(), {
      t: "elegirAtribucion",
      atribucion: { sourceId: null, setterId: null, closerId: null, ghlAppointmentId: null },
    });
    const c = camposDeVenta(e);
    expect(c.atribuido).toBe("true");
    expect([c.source_id, c.setter_id, c.closer_id, c.ghl_appointment_id]).toEqual(["", "", "", ""]);
  });

  it("valor_total y pago_monto se pintan vacíos cuando son 0 (value={x || ''})", () => {
    const e = d(inicial(), { t: "editarValorTotal", valor: 0 });
    expect(camposDeVenta(e).valor_total).toBe("");
    expect(camposDeVenta(e).pago_monto).toBe("");
  });

  it("los decimales pasan por el round-trip de Number igual que el input: 3000.50 → '3000.5'", () => {
    const e = d(inicial(),
      { t: "editarValorTotal", valor: Number("3000.50") },
      { t: "editarPagoMonto", valor: Number("1000.50") });
    expect(camposDeVenta(e).valor_total).toBe("3000.5");
    expect(camposDeVenta(e).pago_monto).toBe("1000.5");
  });

  it("meses_duracion borrado manda '0', no '' (comportamiento actual, no se arregla aquí)", () => {
    const e = d(inicial(), { t: "editarMeses", valor: Number("") });
    expect(camposDeVenta(e).meses_duracion).toBe("0");
  });

  it("cuotas es un JSON con SOLO monto y fecha, monto por Number", () => {
    const e = d(inicial(),
      { t: "editarPagoMonto", valor: 1000 },
      { t: "fijarNCuotas", n: 2 });
    const cuotas = JSON.parse(camposDeVenta(e).cuotas);
    expect(cuotas).toHaveLength(2);
    for (const c of cuotas) {
      expect(Object.keys(c)).toEqual(["monto", "fecha"]);
      expect(typeof c.monto).toBe("number");
    }
  });

  it("sin cuotas manda '[]', nunca '' ni ausente", () => {
    expect(camposDeVenta(inicial()).cuotas).toBe("[]");
  });
});

describe("camposDeVenta — ascensión y extensión", () => {
  const conCliente = (tipo: "ascension" | "extension") =>
    d(inicial(),
      { t: "cambiarTipo", tipo },
      { t: "teclearBusqueda", valor: "Jua" },
      { t: "elegirCliente", personaId: "per1", nombre: "Juan Pérez" },
      { t: "contextoCargado", personaId: "per1", ctx: CTX });

  it("el nombre es el TEXTO TECLEADO en el buscador (que elegirCliente deja en el nombre del cliente)", () => {
    expect(camposDeVenta(conCliente("ascension")).nombre).toBe("Juan Pérez");
  });

  it("persona_id y programa_previo_id viajan con lo elegido", () => {
    const c = camposDeVenta(conCliente("ascension"));
    expect(c.persona_id).toBe("per1");
    expect(c.programa_previo_id).toBe("p1");
    expect(c.tipo_venta).toBe("ascension");
  });

  it("upsell_por_id viaja solo si NO es compra nueva", () => {
    const e = d(conCliente("ascension"), { t: "elegirUpsellPor", id: "team9" });
    expect(camposDeVenta(e).upsell_por_id).toBe("team9");
    // El mismo estado, cambiado a compra nueva, lo vacía.
    expect(camposDeVenta({ ...e, tipo: "nueva" }).upsell_por_id).toBe("");
  });

  it("los cuatro ids de atribución viajan como strings, vacíos si no se decidió", () => {
    const e = d(conCliente("extension"), { t: "elegirAtribucion", atribucion: ATRIB });
    const c = camposDeVenta(e);
    expect(c).toMatchObject({
      source_id: "s1", setter_id: "set1", closer_id: "clo1", ghl_appointment_id: "cita1", atribuido: "true",
    });
  });
});

/* ============ RESETS: qué se limpia y qué NO ============ */
describe("R1 — cambiar de tipo", () => {
  const sucio = () => d(inicial(),
    { t: "editarNueva", campo: "nombre", valor: "Ana" },
    { t: "editarNueva", campo: "email", valor: "a@b.c" },
    { t: "editarNueva", campo: "iso", valor: "MX" },
    { t: "editarNueva", campo: "telefono", valor: "555" },
    { t: "elegirTier", id: "6000" },
    { t: "editarPagoMonto", valor: 2000 },
    { t: "fijarNCuotas", n: 2 },
    { t: "cambiarTipo", tipo: "ascension" },
    { t: "teclearBusqueda", valor: "Juan" },
    { t: "elegirCliente", personaId: "per1", nombre: "Juan" },
    { t: "contextoCargado", personaId: "per1", ctx: CTX },
    { t: "elegirAtribucion", atribucion: ATRIB },
    { t: "elegirUpsellPor", id: "team1" });

  it("limpia el comprador existente entero y la comisión", () => {
    const e = d(sucio(), { t: "cambiarTipo", tipo: "extension" });
    expect(e.existente).toEqual({ personaId: "", busqueda: "", ctx: null, programaPrevio: "" });
    expect(e.comision).toEqual({ atribucion: null, upsellPor: "" });
  });

  it("NO toca el comprador nuevo, ni el programa, ni el cobro", () => {
    const antes = sucio();
    const e = d(antes, { t: "cambiarTipo", tipo: "extension" });
    expect(e.nueva).toEqual(antes.nueva);
    expect(e.programa).toEqual(antes.programa);
    expect(e.cobro).toEqual(antes.cobro);
  });

  it("una atribución del cliente anterior NO puede viajar en la venta nueva (sella atribucion_at)", () => {
    const e = d(sucio(), { t: "cambiarTipo", tipo: "nueva" });
    expect(camposDeVenta(e).atribuido).toBe("false");
    expect(camposDeVenta(e).ghl_appointment_id).toBe("");
  });
});

describe("R2 — elegirCliente", () => {
  const base = () => d(inicial(),
    { t: "cambiarTipo", tipo: "ascension" },
    { t: "teclearBusqueda", valor: "Juan" },
    { t: "elegirCliente", personaId: "per1", nombre: "Juan Pérez" },
    { t: "contextoCargado", personaId: "per1", ctx: CTX },
    { t: "elegirAtribucion", atribucion: ATRIB },
    { t: "elegirUpsellPor", id: "team1" });

  it("cambiar de cliente limpia ctx, programa previo, atribución y upsell", () => {
    const e = d(base(), { t: "elegirCliente", personaId: "per2", nombre: "Juana Ruiz" });
    expect(e.existente).toEqual({ personaId: "per2", busqueda: "Juana Ruiz", ctx: null, programaPrevio: "" });
    expect(e.comision).toEqual({ atribucion: null, upsellPor: "" });
  });

  it("NO toca el comprador nuevo ni el cobro", () => {
    const antes = base();
    const e = d(antes, { t: "elegirCliente", personaId: "per2", nombre: "Juana" });
    expect(e.nueva).toEqual(antes.nueva);
    expect(e.cobro).toEqual(antes.cobro);
  });

  it("deja la búsqueda con el nombre del cliente elegido", () => {
    expect(base().existente.busqueda).toBe("Juan Pérez");
  });
});

describe("contextoCargado — la guardia de la carrera", () => {
  it("descarta la respuesta de un cliente que ya no es el elegido", () => {
    const e = d(inicial(),
      { t: "cambiarTipo", tipo: "ascension" },
      { t: "elegirCliente", personaId: "A", nombre: "Cliente A" },
      { t: "elegirCliente", personaId: "B", nombre: "Cliente B" },
      // El fetch de A resuelve tarde: no puede pegar el contexto de A al id de B.
      { t: "contextoCargado", personaId: "A", ctx: CTX });
    expect(e.existente.personaId).toBe("B");
    expect(e.existente.ctx).toBeNull();
    expect(e.existente.programaPrevio).toBe("");
  });

  it("acepta la respuesta del cliente que sí está elegido", () => {
    const e = d(inicial(),
      { t: "cambiarTipo", tipo: "ascension" },
      { t: "elegirCliente", personaId: "A", nombre: "Cliente A" },
      { t: "contextoCargado", personaId: "A", ctx: CTX });
    expect(e.existente.ctx).toEqual(CTX);
    expect(e.existente.programaPrevio).toBe("p1");
  });

  it("en extensión precarga el tier del programa más reciente si es vendible", () => {
    const e = d(inicial(),
      { t: "cambiarTipo", tipo: "extension" },
      { t: "elegirCliente", personaId: "A", nombre: "A" },
      { t: "contextoCargado", personaId: "A", ctx: CTX });
    expect(e.programa.tier).toBe("3000");
    expect(e.programa.valorTotal).toBe(3000);
  });

  it("NO precarga un tier no vendible (OG es vitalicio y no está en la lista)", () => {
    const soloOG: Contexto = { ...CTX, programas: [CTX.programas[1]] };
    const e = d(inicial(),
      { t: "elegirTier", id: "6000" },
      { t: "cambiarTipo", tipo: "extension" },
      { t: "elegirCliente", personaId: "A", nombre: "A" },
      { t: "contextoCargado", personaId: "A", ctx: soloOG });
    // El select se quedaría desincronizado si se seteara "OG": se deja el que había.
    expect(e.programa.tier).toBe("6000");
  });

  it("en ascensión NO precarga tier aunque el programa de origen sea vendible", () => {
    const e = d(inicial(),
      { t: "elegirTier", id: "6000" },
      { t: "cambiarTipo", tipo: "ascension" },
      { t: "elegirCliente", personaId: "A", nombre: "A" },
      { t: "contextoCargado", personaId: "A", ctx: CTX });
    expect(e.programa.tier).toBe("6000");
  });
});

describe("R3 — elegirTier", () => {
  it("el id del tier ES el precio, y arrastra los meses por defecto", () => {
    const e = d(inicial(), { t: "elegirTier", id: "6000" });
    expect(e.programa).toMatchObject({ tier: "6000", valorTotal: 6000, meses: 12 });
  });

  it("recalcula las cuotas SOLO si ya había un plan montado", () => {
    const sinPlan = d(inicial(), { t: "elegirTier", id: "6000" });
    expect(sinPlan.cobro.cuotas).toEqual([]);

    const conPlan = d(inicial(),
      { t: "editarPagoMonto", valor: 1000 },
      { t: "fijarNCuotas", n: 2 },
      { t: "elegirTier", id: "6000" });
    // 6000 - 1000 = 5000 en 2 cuotas; si no recalculara quedarían las de 3000.
    expect(conPlan.cobro.cuotas.map((c) => c.monto)).toEqual([2500, 2500]);
  });

  it("NO toca nCuotas (la invariante nCuotas===0 ⟺ cuotas===[] la mantienen los otros)", () => {
    const e = d(inicial(), { t: "fijarNCuotas", n: 3 }, { t: "elegirTier", id: "6000" });
    expect(e.cobro.nCuotas).toBe(3);
    expect(e.cobro.cuotas).toHaveLength(3);
  });

  it("un tier sin meses_default cae en 6", () => {
    expect(d(inicial(), { t: "elegirTier", id: "1500" }).programa.meses).toBe(6);
  });
});

describe("editarValorTotal — la asimetría deliberada", () => {
  it("escribir el total a mano NO regenera las cuotas (por eso salta el descuadre)", () => {
    const conPlan = d(inicial(), { t: "editarPagoMonto", valor: 1000 }, { t: "fijarNCuotas", n: 2 });
    const e = d(conPlan, { t: "editarValorTotal", valor: 9000 });
    expect(e.cobro.cuotas).toEqual(conPlan.cobro.cuotas);
    expect(planDeCobro(e).descuadre).toBe(true);
  });
});

describe("R4/R6 — cuotas", () => {
  it("fijarNCuotas regenera el plan sobre el restante", () => {
    const e = d(inicial(), { t: "editarPagoMonto", valor: 1200 }, { t: "fijarNCuotas", n: 3 });
    expect(e.cobro.nCuotas).toBe(3);
    expect(e.cobro.cuotas.reduce((s, c) => s + c.monto, 0)).toBeCloseTo(1800, 2);
  });

  it("cambiar el cobro de hoy regenera el plan", () => {
    const e = d(inicial(), { t: "fijarNCuotas", n: 2 }, { t: "editarPagoMonto", valor: 1000 });
    expect(e.cobro.cuotas.map((c) => c.monto)).toEqual([1000, 1000]);
  });

  it("cambiar la fecha de pago mueve los vencimientos", () => {
    const e = d(inicial(),
      { t: "editarPagoMonto", valor: 1000 },
      { t: "fijarNCuotas", n: 2 },
      { t: "editarPagoFecha", valor: "2026-01-31" });
    expect(e.cobro.cuotas.map((c) => c.fecha)).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("quitar una fila resincroniza nCuotas con la longitud real", () => {
    const e = d(inicial(),
      { t: "editarPagoMonto", valor: 1000 },
      { t: "fijarNCuotas", n: 3 },
      { t: "quitarCuota", i: 0 });
    expect(e.cobro.nCuotas).toBe(2);
    expect(e.cobro.cuotas).toHaveLength(2);
  });

  it("quitar la última fila deja la invariante nCuotas===0 ⟺ cuotas===[]", () => {
    const e = d(inicial(),
      { t: "editarPagoMonto", valor: 1000 },
      { t: "fijarNCuotas", n: 1 },
      { t: "quitarCuota", i: 0 });
    expect(e.cobro.nCuotas).toBe(0);
    expect(e.cobro.cuotas).toEqual([]);
  });

  it("editar una fila a mano solo toca esa fila", () => {
    const e = d(inicial(),
      { t: "editarPagoMonto", valor: 1000 },
      { t: "fijarNCuotas", n: 2 },
      { t: "editarCuotaMonto", i: 1, valor: 1234.56 },
      { t: "editarCuotaFecha", i: 1, valor: "2026-12-01" });
    expect(e.cobro.cuotas[1]).toEqual({ monto: 1234.56, fecha: "2026-12-01" });
    expect(e.cobro.cuotas[0].monto).toBe(1000);
  });
});

describe("R5 — teclear en el buscador", () => {
  it("limpia SOLO personaId; no amplía a ctx, programaPrevio ni comisión", () => {
    const antes = d(inicial(),
      { t: "cambiarTipo", tipo: "ascension" },
      { t: "elegirCliente", personaId: "per1", nombre: "Juan" },
      { t: "contextoCargado", personaId: "per1", ctx: CTX },
      { t: "elegirAtribucion", atribucion: ATRIB });
    const e = d(antes, { t: "teclearBusqueda", valor: "Jua" });
    expect(e.existente.personaId).toBe("");
    expect(e.existente.ctx).toEqual(CTX);
    expect(e.existente.programaPrevio).toBe("p1");
    expect(e.comision.atribucion).toEqual(ATRIB);
    // …y por eso motivoBloqueo tiene que seguir siendo la red que impide guardar.
    expect(motivoBloqueo(e)).toBe("Elige el cliente en la lista de sugerencias");
  });
});

/* ============ motivoBloqueo ============ */
describe("motivoBloqueo — las mismas condiciones de siempre", () => {
  it("compra nueva no bloquea NUNCA (hay que poder guardar ventas raras)", () => {
    expect(motivoBloqueo(inicial())).toBeNull();
    const vacio = d(inicial(), { t: "editarValorTotal", valor: 0 });
    expect(motivoBloqueo(vacio)).toBeNull();
  });

  it("ni el descuadre ni la atribución sin decidir bloquean", () => {
    const e = d(inicial(), { t: "editarPagoMonto", valor: 5 });
    expect(planDeCobro(e).descuadre).toBe(true);
    expect(motivoBloqueo(e)).toBeNull();
  });

  it("ascensión: falta cliente → cargando contexto → falta programa → desbloqueado", () => {
    let e = d(inicial(), { t: "cambiarTipo", tipo: "ascension" });
    expect(motivoBloqueo(e)).toBe("Elige el cliente en la lista de sugerencias");
    e = d(e, { t: "elegirCliente", personaId: "per1", nombre: "Juan" });
    expect(motivoBloqueo(e)).toBe("Cargando los programas de ese cliente…");
    e = d(e, { t: "contextoCargado", personaId: "per1", ctx: { ...CTX, programas: [] } });
    expect(motivoBloqueo(e)).toBe("Elige desde qué programa asciende");
    e = d(e, { t: "elegirProgramaPrevio", id: "p1" });
    expect(motivoBloqueo(e)).toBeNull();
  });

  it("extensión dice «Elige qué programa se extiende»", () => {
    const e = d(inicial(),
      { t: "cambiarTipo", tipo: "extension" },
      { t: "elegirCliente", personaId: "per1", nombre: "Juan" },
      { t: "contextoCargado", personaId: "per1", ctx: { ...CTX, programas: [] } });
    expect(motivoBloqueo(e)).toBe("Elige qué programa se extiende");
  });
});

/* ============ planDeCobro ============ */
describe("planDeCobro", () => {
  it("un céntimo de diferencia NO es descuadre (generarCuotas redondea la última cuota)", () => {
    const e = d(inicial(), { t: "editarValorTotal", valor: 1000 }, { t: "editarPagoMonto", valor: 999.995 });
    expect(planDeCobro(e).descuadre).toBe(false);
  });

  it("dos céntimos sí lo son", () => {
    const e = d(inicial(), { t: "editarValorTotal", valor: 1000 }, { t: "editarPagoMonto", valor: 999.97 });
    expect(planDeCobro(e).descuadre).toBe(true);
  });

  it("un plan generado cuadra exacto", () => {
    const e = d(inicial(), { t: "editarPagoMonto", valor: 1000 }, { t: "fijarNCuotas", n: 7 });
    const { totalPlan, descuadre } = planDeCobro(e);
    expect(totalPlan).toBeCloseTo(3000, 2);
    expect(descuadre).toBe(false);
  });
});

/* ============ candidatosDe / duplicadoDe / llaveSelector ============ */
const CLIENTES = [
  { nombre: "Juan Pérez", email: "juan@x.com", telefono_e164: "+34620000001" },
  { nombre: "Juana Ruiz", email: "juana@x.com", telefono_e164: "+34620000002" },
  { nombre: null, email: "sin@x.com", telefono_e164: null },
];

describe("candidatosDe", () => {
  it("necesita 2 caracteres", () => {
    expect(candidatosDe(CLIENTES, "j")).toEqual([]);
    expect(candidatosDe(CLIENTES, " ju ")).toHaveLength(2);
  });
  it("filtra solo por nombre y aguanta nombres null", () => {
    expect(candidatosDe(CLIENTES, "sin@x.com")).toEqual([]);
    expect(candidatosDe(CLIENTES, "ruiz").map((c) => c.nombre)).toEqual(["Juana Ruiz"]);
  });
  it("corta en 8", () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ nombre: `Ana ${i}`, email: null, telefono_e164: null }));
    expect(candidatosDe(muchos, "ana")).toHaveLength(8);
  });
});

describe("duplicadoDe", () => {
  it("el teléfono manda: es UNIQUE y el RPC reutiliza esa persona", () => {
    const r = duplicadoDe(CLIENTES, { nombre: "Juana Ruiz", email: "", iso: "ES", telefono: "620000001" });
    expect(r).toMatchObject({ porTelefono: true });
    expect(r!.cliente.nombre).toBe("Juan Pérez");
  });
  it("sin teléfono, casa por nombre o email exactos", () => {
    expect(duplicadoDe(CLIENTES, { nombre: " juan pérez ", email: "", iso: "ES", telefono: "" }))
      .toMatchObject({ porTelefono: false });
    expect(duplicadoDe(CLIENTES, { nombre: "", email: "JUANA@X.COM", iso: "ES", telefono: "" }))
      .toMatchObject({ porTelefono: false });
  });
  it("un nombre parcial NO es duplicado", () => {
    expect(duplicadoDe(CLIENTES, { nombre: "Juan", email: "", iso: "ES", telefono: "" })).toBeNull();
  });
  it("el formulario vacío no avisa de nada", () => {
    expect(duplicadoDe(CLIENTES, { nombre: "", email: "", iso: "ES", telefono: "" })).toBeNull();
  });
});

describe("llaveSelector", () => {
  it("en compra nueva busca por email/teléfono, nunca por personaId", () => {
    const e = d(inicial(),
      { t: "editarNueva", campo: "email", valor: "  ana@x.com " },
      { t: "editarNueva", campo: "telefono", valor: "620000003" });
    expect(llaveSelector(e)).toEqual({
      personaId: null, email: "ana@x.com", telefono: "+34620000003",
    });
  });
  it("los vacíos se normalizan a null (una cadena vacía ya ocultó el selector una vez)", () => {
    expect(llaveSelector(inicial())).toEqual({ personaId: null, email: null, telefono: null });
    const asc = d(inicial(), { t: "cambiarTipo", tipo: "ascension" });
    expect(llaveSelector(asc)).toEqual({ personaId: null, email: null, telefono: null });
  });
  it("en ascensión/extensión busca por personaId y nada más", () => {
    const e = d(inicial(),
      { t: "editarNueva", campo: "email", valor: "ana@x.com" },
      { t: "cambiarTipo", tipo: "ascension" },
      { t: "elegirCliente", personaId: "per1", nombre: "Juan" });
    expect(llaveSelector(e)).toEqual({ personaId: "per1", email: null, telefono: null });
  });
});

/* ============ cambiar de comprador limpia la atribución ============ */

describe("editarNueva — corregir el email cambia de contacto en GHL", () => {
  // El agujero que destapó la revisión adversarial del 13-ago, y que existía
  // desde el principio: en compra nueva se podía elegir la cita del cliente A,
  // corregir el email al de B, y guardar con la atribución de A. El selector
  // pintaba las citas de B sin ningún radio marcado —parecía "sin decidir"—
  // pero al guardar viajaban el setter y el closer de A, `atribucion_at` se
  // sellaba, y /atribucion (que filtra por `atribucion_at is null`) ya no
  // volvía a enseñar esa venta jamás.
  //
  // En ascensión y extensión `motivoBloqueo` frena mientras no haya cliente;
  // en compra nueva devuelve null SIEMPRE. No había ninguna otra red.
  const conAtribucion = () =>
    d(inicial(), { t: "editarNueva", campo: "email", valor: "a@ejemplo.com" },
      { t: "elegirAtribucion", atribucion: ATRIB });

  it("cambiar el email la borra", () => {
    const e = conAtribucion();
    expect(e.comision.atribucion).toEqual(ATRIB);
    const tras = d(e, { t: "editarNueva", campo: "email", valor: "b@ejemplo.com" });
    expect(tras.comision.atribucion).toBeNull();
  });

  it("cambiar el teléfono o el país también, que son parte de la llave", () => {
    for (const campo of ["telefono", "iso"] as const) {
      const tras = d(conAtribucion(), { t: "editarNueva", campo, valor: "X" });
      expect(tras.comision.atribucion, campo).toBeNull();
    }
  });

  it("corregir el NOMBRE no la borra: no es la llave del selector", () => {
    // Borrarla al arreglar una tilde sería castigar un typo — y obligaría a
    // volver a elegir la cita sin ningún motivo.
    const tras = d(conAtribucion(), { t: "editarNueva", campo: "nombre", valor: "Rubén" });
    expect(tras.comision.atribucion).toEqual(ATRIB);
  });

  it("no viaja la atribución vieja al cable tras corregir el email", () => {
    // La comprobación que de verdad importa: qué llega a crearVenta.
    const tras = d(conAtribucion(), { t: "editarNueva", campo: "email", valor: "b@ejemplo.com" });
    const fd = camposDeVenta(tras);
    expect(fd.setter_id).toBe("");
    expect(fd.closer_id).toBe("");
    expect(fd.source_id).toBe("");
    expect(fd.ghl_appointment_id).toBe("");
    expect(fd.atribuido).toBe("false");
  });
});

/* ============ bonos del evento 26/08 ============ */
// TIERS reales, los que Berni confirmó el 26-ago: 2000 (6 meses), 3500 y 5000
// (1 año). El 1800 NO está a propósito — dejó de venderse el 30-jul y era
// justo el que la versión anterior de estos tests daba por vivo.
const TIERS_BONOS: TierMin[] = [
  { id: "2000", meses_default: 6 },
  { id: "3500", meses_default: 12 },
  { id: "5000", meses_default: 12 },
];
const b = (e: EstadoVenta, ...acciones: Accion[]) =>
  acciones.reduce((s, a) => reducer(s, a, TIERS_BONOS), e);
const conTier = (tier: string) =>
  b(estadoInicial(TIERS_BONOS, "2026-08-26"), { t: "elegirTier", id: tier });

describe("bonos — el interruptor maestro", () => {
  it("marca los 4 de una en CUALQUIER tier", () => {
    for (const tier of ["2000", "3500", "5000"]) {
      expect(b(conTier(tier), { t: "marcarBonosEvento", puesto: true }).bonos).toEqual([
        "consultoria_berni", "consultoria_manuel", "duracion_50", "discord_portafolio",
      ]);
    }
  });
  // Los tres números que dijo Berni, uno por tier. El de 18 es el que importa:
  // 6 × 1,5 también da 9, así que sin este caso un "poner siempre 9" pasaría.
  it("el de 2.000 € pasa de 6 a 9 meses", () => {
    expect(b(conTier("2000"), { t: "marcarBonosEvento", puesto: true }).programa.meses).toBe(9);
  });
  it("el de 3.500 € pasa de 12 a 18 meses", () => {
    expect(b(conTier("3500"), { t: "marcarBonosEvento", puesto: true }).programa.meses).toBe(18);
  });
  it("el de 5.000 € pasa de 12 a 18 meses", () => {
    expect(b(conTier("5000"), { t: "marcarBonosEvento", puesto: true }).programa.meses).toBe(18);
  });
  it("el bono NUNCA acorta el programa", () => {
    for (const tier of ["2000", "3500", "5000"]) {
      const base = conTier(tier).programa.meses;
      const con = b(conTier(tier), { t: "marcarBonosEvento", puesto: true }).programa.meses;
      expect(con).toBeGreaterThan(base);
    }
  });
  it("apagarlo los quita todos y devuelve la duración del tier", () => {
    const e = b(conTier("5000"),
      { t: "marcarBonosEvento", puesto: true },
      { t: "marcarBonosEvento", puesto: false });
    expect(e.bonos).toEqual([]);
    expect(e.programa.meses).toBe(12);
  });
});

describe("bonos — casilla a casilla", () => {
  it("marcar y desmarcar la misma casilla vuelve al principio", () => {
    const e = b(conTier("2000"),
      { t: "alternarBono", clave: "consultoria_berni" },
      { t: "alternarBono", clave: "consultoria_berni" });
    expect(e.bonos).toEqual([]);
  });
  it("el de duración sube un 50 % al marcarlo y devuelve el tier al quitarlo", () => {
    const puesto = b(conTier("2000"), { t: "alternarBono", clave: "duracion_50" });
    expect(puesto.programa.meses).toBe(9);
    expect(b(puesto, { t: "alternarBono", clave: "duracion_50" }).programa.meses).toBe(6);
  });
  it("y en el de un año, 12 → 18 → 12", () => {
    const puesto = b(conTier("5000"), { t: "alternarBono", clave: "duracion_50" });
    expect(puesto.programa.meses).toBe(18);
    expect(b(puesto, { t: "alternarBono", clave: "duracion_50" }).programa.meses).toBe(12);
  });
  it("marcarlo dos veces seguidas no compone 12 → 18 → 27", () => {
    const e = b(conTier("5000"),
      { t: "alternarBono", clave: "duracion_50" },
      { t: "alternarBono", clave: "duracion_50" },
      { t: "alternarBono", clave: "duracion_50" });
    expect(e.programa.meses).toBe(18);
  });
  it("los bonos que no son de duración no tocan los meses", () => {
    const e = b(conTier("2000"), { t: "alternarBono", clave: "discord_portafolio" });
    expect(e.programa.meses).toBe(6);
  });
  it("se guardan en el orden del catálogo, no en el que se hizo clic", () => {
    const e = b(conTier("2000"),
      { t: "alternarBono", clave: "discord_portafolio" },
      { t: "alternarBono", clave: "consultoria_berni" });
    expect(e.bonos).toEqual(["consultoria_berni", "discord_portafolio"]);
  });
});

describe("bonos — cambiar de tier después de marcarlos", () => {
  // El caso que se cuela solo: Alex marca los bonos y DESPUÉS corrige el tier.
  it("el bono de duración SOBREVIVE al cambio de tier y recalcula sobre el nuevo", () => {
    const e = b(conTier("2000"),
      { t: "marcarBonosEvento", puesto: true },
      { t: "elegirTier", id: "5000" });
    expect(e.bonos).toContain("duracion_50");
    expect(e.programa.meses).toBe(18);
  });
  it("y al revés: del de un año al de 6 meses baja de 18 a 9, no se queda en 18", () => {
    const e = b(conTier("5000"),
      { t: "marcarBonosEvento", puesto: true },
      { t: "elegirTier", id: "2000" });
    expect(e.programa.meses).toBe(9);
  });
  it("los otros tres bonos también sobreviven al cambio de tier", () => {
    const e = b(conTier("2000"),
      { t: "marcarBonosEvento", puesto: true },
      { t: "elegirTier", id: "3500" });
    expect(e.bonos).toEqual([
      "consultoria_berni", "consultoria_manuel", "duracion_50", "discord_portafolio",
    ]);
  });
  it("ir y volver de tier deja el mismo número que no haberse movido", () => {
    const ida = b(conTier("2000"),
      { t: "marcarBonosEvento", puesto: true },
      { t: "elegirTier", id: "5000" },
      { t: "elegirTier", id: "2000" });
    const quieto = b(conTier("2000"), { t: "marcarBonosEvento", puesto: true });
    expect(ida.programa.meses).toBe(quieto.programa.meses);
    expect(ida.bonos).toEqual(quieto.bonos);
  });
});

describe("bonos — lo que viaja al servidor", () => {
  it("sin bonos viaja un array vacío, nunca undefined", () => {
    expect(camposDeVenta(conTier("2000")).bonos).toBe("[]");
  });
  it("con bonos viaja el JSON de las claves", () => {
    const e = b(conTier("2000"), { t: "marcarBonosEvento", puesto: true });
    expect(JSON.parse(camposDeVenta(e).bonos)).toEqual([
      "consultoria_berni", "consultoria_manuel", "duracion_50", "discord_portafolio",
    ]);
  });
  it("la duración que viaja es la del bono, no la del tier", () => {
    expect(camposDeVenta(b(conTier("2000"), { t: "marcarBonosEvento", puesto: true }))
      .meses_duracion).toBe("9");
    expect(camposDeVenta(b(conTier("5000"), { t: "marcarBonosEvento", puesto: true }))
      .meses_duracion).toBe("18");
  });
  it("18 meses caben en el límite de 24 que valida el server action", () => {
    const meses = Number(camposDeVenta(
      b(conTier("5000"), { t: "marcarBonosEvento", puesto: true })).meses_duracion);
    expect(meses).toBeLessThanOrEqual(24);
  });
});

// ---------------------------------------------------------------------------
// El orden del desplegable de tiers.
//
// `getTiersVendibles` pide `order=id.asc` y la columna es `text`, así que
// PostgREST devuelve el catálogo ordenado como palabras: el "10000" cae entre
// el "1000" y el "1500". Esta suite fija el orden que el operador ve en
// /nueva-venta, que es por precio. No es cosmética: el 10.000 € pegado al
// 1.000 € en la lista con la que se cierran todas las ventas es un clic
// equivocado esperando a pasar.
// ---------------------------------------------------------------------------
describe("ordenarTiersPorPrecio", () => {
  // Los siete vendibles que deja el catálogo 2026 (0066), en el orden EXACTO
  // en el que PostgREST los devuelve hoy con `order=id.asc` sobre `text`.
  const COMO_LLEGAN = ["1000", "10000", "1500", "2000", "2500", "3500", "5000"]
    .map((id) => ({ id, nombre: id, meses_default: 12 }));

  it("pone el 10.000 € al final y no en el segundo puesto", () => {
    expect(ordenarTiersPorPrecio(COMO_LLEGAN).map((t) => t.id))
      .toEqual(["1000", "1500", "2000", "2500", "3500", "5000", "10000"]);
  });

  it("no toca el array que recibe", () => {
    const copia = [...COMO_LLEGAN];
    ordenarTiersPorPrecio(COMO_LLEGAN);
    expect(COMO_LLEGAN).toEqual(copia);
  });

  it("un id no numérico se va al final en vez de dejar el orden al azar", () => {
    // `OG` no llega al desplegable (`id=neq.OG`), pero el orden no depende de
    // ese filtro: un id nuevo que no sea un número no puede colarse en medio.
    const conOG = [...COMO_LLEGAN, { id: "OG", nombre: "OG", meses_default: null }];
    expect(ordenarTiersPorPrecio(conOG).map((t) => t.id))
      .toEqual(["1000", "1500", "2000", "2500", "3500", "5000", "10000", "OG"]);
  });

  it("aguanta el catálogo completo, activos y retirados juntos", () => {
    const todos = ["8000", "3000", "1800", "1000", "10000", "1500", "2000", "2500", "3500", "5000"]
      .map((id) => ({ id, nombre: id, meses_default: 12 }));
    expect(ordenarTiersPorPrecio(todos).map((t) => t.id)).toEqual(
      ["1000", "1500", "1800", "2000", "2500", "3000", "3500", "5000", "8000", "10000"]);
  });
});
