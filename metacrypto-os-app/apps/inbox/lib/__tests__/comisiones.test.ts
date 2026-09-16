import { describe, it, expect } from "vitest";
import {
  comisionesDePago, agruparPorPersona, actividadPorRol, entraEnCierre, ATRIBUCION_CORTE,
  ajusteDeDevolucion,
  TASA_SETTER, TASA_CLOSER, TASA_COACH,
  type PagoAtribuido, type QuienCobra,
} from "../comisiones";

const DANI = "11111111-1111-1111-1111-111111111111";
const ALEX = "22222222-2222-2222-2222-222222222222";
const MANU = "33333333-3333-3333-3333-333333333333";
const BERNI = "44444444-4444-4444-4444-444444444444";

// `usd_recibido` refleja por defecto el mismo número que `monto` para que los
// tests de reparto (quién cobra, qué tasa) sigan leyéndose con cifras
// redondas. Los tests de DIVISA de más abajo los separan a propósito — que es
// donde se comprueba que la base es el dólar y no el euro.
function pago(over: Partial<PagoAtribuido> = {}): PagoAtribuido {
  const base = { monto: 1000, usd_recibido: 1000 };
  return {
    pago_id: "p1", ...base, motivo: "nueva_venta",
    setter_id: DANI, closer_id: ALEX, upsell_por_id: null,
    atribuido: true, fuente_confirmada: true, programa_id: "g1",
    // Un `monto` a medida sin `usd_recibido` dejaría el dólar en 1000 y el
    // test mediría otra cosa de la que cree. Se mueven juntos salvo que la
    // llamada diga explícitamente lo contrario.
    ...(over.monto != null && over.usd_recibido === undefined
      ? { usd_recibido: over.monto }
      : {}),
    ...over,
  };
}

// El caso por defecto de casi todos los tests: todo el mundo cobra. En
// producción este argumento NO tiene valor por defecto — un `noCobran`
// opcional le pagaría a Berni cada vez que alguien se olvidara de pasarlo.
// Aquí el default solo evita repetir el mismo conjunto vacío 20 veces; los
// tests de "quién cobra" de más abajo lo pasan explícito.
const TODOS: QuienCobra = { noCobran: new Set() };
const calcular = (p: PagoAtribuido, quien: QuienCobra = TODOS) =>
  comisionesDePago(p, quien);

describe("comisionesDePago — compra nueva", () => {
  it("paga setter 5% y closer 10%", () => {
    const { lineas, incidencias } = calcular(pago());
    expect(incidencias).toEqual([]);
    expect(lineas).toHaveLength(2);
    expect(lineas.find((l) => l.rol === "setter")).toMatchObject({
      team_member_id: DANI, tasa: TASA_SETTER, importe: 50,
    });
    expect(lineas.find((l) => l.rol === "closer")).toMatchObject({
      team_member_id: ALEX, tasa: TASA_CLOSER, importe: 100,
    });
  });

  it("sin setter solo paga al closer — no inventa un setter", () => {
    // Es el caso del AutoSetter: 42 agendas, la fuente #1, y no tiene persona.
    const { lineas } = calcular(pago({ setter_id: null }));
    expect(lineas).toHaveLength(1);
    expect(lineas[0].rol).toBe("closer");
  });

  it("redondea a dos decimales", () => {
    const { lineas } = calcular(pago({ monto: 333.33 }));
    expect(lineas.find((l) => l.rol === "setter")!.importe).toBe(16.67);
    expect(lineas.find((l) => l.rol === "closer")!.importe).toBe(33.33);
  });
});

describe("comisionesDePago — ascensión", () => {
  it("el 10% es del coach y de NADIE más: ni setter ni closer", () => {
    // Berni, 12-ago-2026: "Alex no se lleva un 10% del upsell por esa venta,
    // pero sí que se llevaría el 18% al final del mes". El setter tampoco:
    // cobró cuando trajo al cliente (decisión del 7-ago).
    //
    // El caso que este test protege: `pago()` trae closer_id=ALEX. Antes del
    // 12-ago el closer cobraba fuera del `switch`, así que una ascensión de
    // 1.000 € pagaba 100 € a Alex además de los 100 € del coach — el doble
    // de comisión sobre el mismo dinero.
    const { lineas, incidencias } = calcular(
      pago({ motivo: "upsell", upsell_por_id: MANU }),
    );
    expect(incidencias).toEqual([]);
    expect(lineas.map((l) => l.rol)).toEqual(["coach"]);
    expect(lineas[0]).toMatchObject({
      team_member_id: MANU, tasa: TASA_COACH, importe: 100,
    });
  });

  it("ascensión sin autor no paga a nadie, y la marca", () => {
    // Es el caso real de "las extensiones que hicimos nosotros sin contar
    // con Manuel": nadie cobra. Que el closer conste no cambia nada.
    const { lineas, incidencias } = calcular(
      pago({ motivo: "upsell", upsell_por_id: null }),
    );
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([
      { pago_id: "p1", motivo: "ascension_sin_autor" },
    ]);
  });
});

describe("comisionesDePago — renovación (extensión)", () => {
  // `tipo_venta='extension'` genera `motivo='renovacion'` (ver
  // 0014_ventas_form.sql). Antes de este fix, `esAscension = motivo ===
  // "upsell"` mandaba "renovacion" por la rama de compra nueva: setter 5% +
  // closer 10%. Es la misma situación económica que la ascensión (cliente
  // existente, lo genera el servicio) — Berni decidió que el setter no
  // cobra en ese caso; ver la nota de "pendiente de confirmar" en
  // docs/comisiones.md, porque él habló de ascensiones, no de renovaciones.
  // El 12-ago Berni cerró el otro extremo: en una extensión el 10% es de
  // Manuel, "no manejamos la opción de que no se lo lleve".
  it("paga igual que una ascensión: SOLO coach, ni setter ni closer", () => {
    const { lineas, incidencias } = calcular(
      pago({ motivo: "renovacion", upsell_por_id: MANU }),
    );
    expect(incidencias).toEqual([]);
    expect(lineas.map((l) => l.rol)).toEqual(["coach"]);
    expect(lineas[0]).toMatchObject({
      team_member_id: MANU, tasa: TASA_COACH, importe: 100,
    });
  });

  it("renovación sin quién la hizo no paga a nadie, y la marca", () => {
    const { lineas, incidencias } = calcular(
      pago({ motivo: "renovacion", upsell_por_id: null }),
    );
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([
      { pago_id: "p1", motivo: "ascension_sin_autor" },
    ]);
  });
});

describe("comisionesDePago — motivo sin reconocer", () => {
  it("un motivo null (dato roto: programa_id existe pero sin motivo) se marca, no se adivina", () => {
    const { lineas, incidencias } = calcular(
      pago({ motivo: null }),
    );
    // No se paga nada: sin motivo no se sabe si esto es una compra nueva
    // (donde el closer cobra) o una ascensión (donde no). Inventar la línea
    // sería peor que dejarla sin pagar hasta arreglar el dato.
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([
      { pago_id: "p1", motivo: "motivo_no_reconocido" },
    ]);
  });
});

describe("comisionesDePago — casos que NO se calculan", () => {
  it("una venta sin atribuir no genera nada, y se marca", () => {
    const { lineas, incidencias } = calcular(pago({ atribuido: false }));
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([{ pago_id: "p1", motivo: "sin_atribuir" }]);
  });

  it("una fuente sin confirmar no genera nada, y se marca", () => {
    // Un source_id nuevo entra con confirmado=false: hasta que Berni lo
    // valide, pagar sobre él sería pagarle a quien el sistema supone.
    const { lineas, incidencias } = calcular(
      pago({ fuente_confirmada: false }),
    );
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([
      { pago_id: "p1", motivo: "fuente_sin_confirmar" },
    ]);
  });

  it("un pago sin programa no genera nada, y se marca", () => {
    const { lineas, incidencias } = calcular(
      pago({ programa_id: null }),
    );
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([{ pago_id: "p1", motivo: "sin_programa" }]);
  });

  it("un pago sin programa se marca UNA vez, no encadena incidencias", () => {
    const { incidencias } = calcular(
      pago({ programa_id: null, atribuido: false, fuente_confirmada: false }),
    );
    expect(incidencias).toHaveLength(1);
    expect(incidencias[0].motivo).toBe("sin_programa");
  });
});

describe("comisionesDePago — sin closer", () => {
  it("sin closer en compra nueva: sigue habiendo línea de setter Y aparece la incidencia", () => {
    const { lineas, incidencias } = calcular(
      pago({ closer_id: null }),
    );
    expect(lineas.map((l) => l.rol).sort()).toEqual(["setter"]);
    expect(lineas.find((l) => l.rol === "setter")).toMatchObject({
      team_member_id: DANI, tasa: TASA_SETTER, importe: 50,
    });
    expect(incidencias).toEqual([{ pago_id: "p1", motivo: "sin_closer" }]);
  });

  it("en una ascensión NO se marca sin_closer: quién cerró es irrelevante", () => {
    // `sin_closer` existe para avisar de una comisión que falta. En una
    // ascensión el closer no cobra, así que no falta nada — marcarlo llenaría
    // el informe de incidencias que nadie tiene que resolver.
    const { lineas, incidencias } = calcular(
      pago({ motivo: "upsell", upsell_por_id: MANU, closer_id: null }),
    );
    expect(incidencias).toEqual([]);
    expect(lineas.map((l) => l.rol)).toEqual(["coach"]);
  });

  it("ascensión sin closer Y sin autor: solo la incidencia del autor", () => {
    const { lineas, incidencias } = calcular(
      pago({ motivo: "upsell", upsell_por_id: null, closer_id: null }),
    );
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([
      { pago_id: "p1", motivo: "ascension_sin_autor" },
    ]);
  });
});

describe("comisionesDePago — quién cobra y quién no", () => {
  // La regla es POR PERSONA, no por rol: Berni y Manuel son los dos `coach` y
  // solo Manuel cobra. Berni, 12-ago-2026: "si lo cierro yo, no se lo lleva
  // nadie (...) porque al final lo que queda para la empresa al final de mes
  // es para mí". Migración 0038.
  const SIN_BERNI: QuienCobra = { noCobran: new Set([BERNI]) };

  it("el caso real: Berni cierra una venta y no cobra los 350 €", () => {
    // Maurizio Jiménez, 3.500 €, 6-ago, cerrada por Berni. Es la venta que
    // tenía la bandeja bloqueada.
    const { lineas } = calcular(
      pago({ monto: 3500, closer_id: BERNI, setter_id: null }),
      SIN_BERNI,
    );
    const closer = lineas.find((l) => l.rol === "closer")!;
    expect(closer.importe).toBe(0);
    expect(closer.tasa).toBe(0);
  });

  it("la línea NO desaparece: base intacta, para no perder la actividad", () => {
    // Decisión de Milo: un cero visible se lee como una regla; una línea que
    // falta no se distingue de un cálculo roto. `actividadPorRol` se
    // construye desde las líneas, así que borrarla borraría también que
    // Berni cerró esa venta.
    const { lineas } = calcular(pago({ monto: 3500, closer_id: BERNI }), SIN_BERNI);
    const closer = lineas.find((l) => l.rol === "closer")!;
    expect(closer.base).toBe(3500);
    expect(closer.team_member_id).toBe(BERNI);
    expect(actividadPorRol(lineas).find((a) => a.team_member_id === BERNI)).toMatchObject({
      rol: "closer", ventas: 1, cash: 3500,
    });
  });

  it("no se resuelve por rol: Manuel SÍ cobra su ascensión aunque Berni no", () => {
    // Los dos son `coach`. Si esto se hubiera implementado por rol, o cobran
    // los dos o no cobra ninguno.
    const { lineas } = calcular(
      pago({ motivo: "upsell", upsell_por_id: MANU, closer_id: BERNI }),
      SIN_BERNI,
    );
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatchObject({ rol: "coach", team_member_id: MANU, importe: 100 });
  });

  it("no contamina a los demás: quien sí cobra sigue cobrando en el mismo pago", () => {
    const { lineas } = calcular(pago({ closer_id: BERNI, setter_id: DANI }), SIN_BERNI);
    expect(lineas.find((l) => l.rol === "closer")!.importe).toBe(0);
    expect(lineas.find((l) => l.rol === "setter")!.importe).toBe(50);
  });

  it("el total del mes no cuenta los ceros", () => {
    const lineas = [
      ...calcular(pago({ closer_id: BERNI, setter_id: DANI }), SIN_BERNI).lineas,
      ...calcular(pago({ pago_id: "p2", closer_id: ALEX, setter_id: DANI }), SIN_BERNI).lineas,
    ];
    const total = agruparPorPersona(lineas);
    expect(total.find((t) => t.team_member_id === BERNI)).toMatchObject({ total: 0, n: 1 });
    expect(total.find((t) => t.team_member_id === ALEX)!.total).toBe(100);
    expect(total.find((t) => t.team_member_id === DANI)!.total).toBe(100);
  });
});

describe("entraEnCierre", () => {
  it("una venta de antes del corte, sin cuota pendiente, es histórico — no entra", () => {
    expect(entraEnCierre({ fecha_inicio: "2026-07-31", tieneCuotaPendiente: false })).toBe(false);
  });

  it("una venta justo en el corte SÍ entra", () => {
    expect(entraEnCierre({ fecha_inicio: ATRIBUCION_CORTE, tieneCuotaPendiente: false })).toBe(true);
  });

  it("una venta después del corte entra, tenga o no cuota pendiente", () => {
    expect(entraEnCierre({ fecha_inicio: "2026-08-15", tieneCuotaPendiente: false })).toBe(true);
    expect(entraEnCierre({ fecha_inicio: "2026-08-15", tieneCuotaPendiente: true })).toBe(true);
  });

  it("una venta de antes del corte CON cuota pendiente entra igual — su cobro futuro sí devenga comisión", () => {
    expect(entraEnCierre({ fecha_inicio: "2026-05-01", tieneCuotaPendiente: true })).toBe(true);
  });
});

describe("agruparPorPersona", () => {
  it("suma por persona y cuenta las líneas", () => {
    const a = calcular(pago()).lineas;
    const b = calcular(pago({ pago_id: "p2", monto: 500 })).lineas;
    const total = agruparPorPersona([...a, ...b]);
    expect(total.find((t) => t.team_member_id === DANI)).toEqual({
      team_member_id: DANI, total: 75, n: 2,
    });
    expect(total.find((t) => t.team_member_id === ALEX)).toEqual({
      team_member_id: ALEX, total: 150, n: 2,
    });
  });

  it("no arrastra errores de coma flotante", () => {
    const l = [
      ...calcular(pago({ monto: 0.1 })).lineas,
      ...calcular(pago({ pago_id: "p2", monto: 0.2 })).lineas,
    ];
    const setter = agruparPorPersona(l).find((t) => t.team_member_id === DANI)!;
    expect(setter.total).toBe(0.02);
  });
});

describe("actividadPorRol", () => {
  it("separa el mismo miembro por rol: Alex cierra y también setea", () => {
    const l = [
      ...calcular(pago({ closer_id: ALEX, setter_id: ALEX })).lineas,
      ...calcular(pago({ pago_id: "p2", monto: 2000, closer_id: ALEX, setter_id: DANI })).lineas,
    ];
    const act = actividadPorRol(l);
    const closer = act.find((a) => a.team_member_id === ALEX && a.rol === "closer")!;
    expect(closer).toMatchObject({ ventas: 2, cash: 3000, ticket: 1500 });
    const setter = act.find((a) => a.team_member_id === ALEX && a.rol === "setter")!;
    expect(setter).toMatchObject({ ventas: 1, cash: 1000, ticket: 1000 });
  });

  it("cuenta ventas y calcula el ticket medio por rol", () => {
    const l = [
      ...calcular(pago({ monto: 1000 })).lineas,
      ...calcular(pago({ pago_id: "p2", monto: 500 })).lineas,
      ...calcular(pago({ pago_id: "p3", monto: 333.33 })).lineas,
    ];
    const closer = actividadPorRol(l).find((a) => a.team_member_id === ALEX && a.rol === "closer")!;
    expect(closer.ventas).toBe(3);
    expect(closer.cash).toBe(1833.33);
    expect(closer.ticket).toBe(611.11);
  });

  it("sin líneas, no hay actividad", () => {
    expect(actividadPorRol([])).toEqual([]);
  });
});

describe("la base es el DÓLAR cobrado, no el euro firmado", () => {
  // El corazón del cambio pedido por Berni el 14-ago. Antes de 0040 la base
  // era `monto` (EUR) y este test habría dado 100 en vez de 110.
  it("comisiona sobre usd_recibido aunque el monto en euros sea otro", () => {
    const { lineas } = calcular(pago({ monto: 1000, usd_recibido: 1100 }));
    expect(lineas.find((l) => l.rol === "closer")).toMatchObject({ base: 1100, importe: 110 });
    expect(lineas.find((l) => l.rol === "setter")).toMatchObject({ base: 1100, importe: 55 });
  });

  it("la base de la línea NO es el importe en euros", () => {
    const { lineas } = calcular(pago({ monto: 3500, usd_recibido: 3750.5 }));
    for (const l of lineas) expect(l.base).not.toBe(3500);
    for (const l of lineas) expect(l.base).toBe(3750.5);
  });

  // Con el ratio real de la base (≈1,072): 149 pagos, 256.514,83 € y
  // 286.653,38 $. Comisionar en euros pagaría ~11 % de menos.
  it("un mes entero: el dólar y el euro no dan lo mismo", () => {
    const enUsd = calcular(pago({ monto: 256514.83, usd_recibido: 286653.38 }));
    const closerUsd = enUsd.lineas.find((l) => l.rol === "closer")!.importe;
    expect(closerUsd).toBeCloseTo(28665.34, 2);
    expect(closerUsd).toBeGreaterThan(25651.48); // lo que habría pagado en €
  });
});

describe("incidencia sin_usd", () => {
  it("un pago sin usd_recibido no comisiona a nadie y se marca", () => {
    const { lineas, incidencias } = calcular(pago({ usd_recibido: null }));
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([{ pago_id: "p1", motivo: "sin_usd" }]);
  });

  // Nunca caer al euro: es la decisión de fondo. Un fallback silencioso
  // pagaría un ~7 % de menos sin que salte nada, y el informe seguiría
  // pareciendo correcto — el peor de los fallos posibles en dinero que se
  // paga a personas.
  it("NO cae al importe en euros cuando falta el dólar", () => {
    const { lineas } = calcular(pago({ monto: 1000, usd_recibido: null }));
    expect(lineas).toHaveLength(0);
  });

  // Va por delante de la atribución: sin base no hay comisión para nadie, y
  // se arregla en otro sitio (el registro del pago, no la bandeja).
  it("sin USD manda sobre sin_atribuir", () => {
    const { incidencias } = calcular(pago({ usd_recibido: null, atribuido: false }));
    expect(incidencias).toEqual([{ pago_id: "p1", motivo: "sin_usd" }]);
  });

  it("pero sin_programa sigue mandando sobre sin USD", () => {
    const { incidencias } = calcular(pago({ usd_recibido: null, programa_id: null }));
    expect(incidencias).toEqual([{ pago_id: "p1", motivo: "sin_programa" }]);
  });

  // La vista filtra los reembolsos (0034), pero si uno se colara por otra vía
  // generaría una comisión NEGATIVA que resta del informe sin avisar.
  it("un importe negativo se marca en vez de restar", () => {
    const { lineas, incidencias } = calcular(pago({ usd_recibido: -1500 }));
    expect(lineas).toEqual([]);
    expect(incidencias).toEqual([{ pago_id: "p1", motivo: "sin_usd" }]);
  });

  it("cero es un importe válido: comisiona cero, no es incidencia", () => {
    const { lineas, incidencias } = calcular(pago({ usd_recibido: 0 }));
    expect(incidencias).toEqual([]);
    expect(lineas.every((l) => l.importe === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Contraste contra PRODUCCIÓN. Los tres pagos atribuidos de agosto de 2026,
// copiados de v_pagos_atribuidos el 14-ago. No es un caso inventado: es el
// cierre que Berni va a pagar el 30-ago.
//
// Julio no se puede reproducir aquí — tiene 0 pagos atribuidos por el corte
// del 1-ago (ATRIBUCION_CORTE): sus comisiones se pagaron a mano y no se
// recalculan. Lo que sí cuadra de julio es el denominador: 60.508,80 USD,
// idéntico a la cifra de docs/comisiones.md.
// ---------------------------------------------------------------------------
describe("contraste con los pagos reales de agosto de 2026", () => {
  const JUAN = "juan", ALEX2 = "alex";
  const reales: PagoAtribuido[] = [
    { pago_id: "jaime",     monto: 3500, usd_recibido: 4044.0 },
    { pago_id: "christian", monto: 3500, usd_recibido: 3834.04 },
    { pago_id: "pago-3",     monto: 2000, usd_recibido: 2313.81 },
  ].map((p) => ({
    ...p, motivo: "nueva_venta" as const, programa_id: `g-${p.pago_id}`,
    setter_id: JUAN, closer_id: ALEX2, upsell_por_id: null,
    atribuido: true, fuente_confirmada: true,
  }));

  const lineas = reales.flatMap((p) => calcular(p).lineas);

  it("no deja ninguna incidencia", () => {
    expect(reales.flatMap((p) => calcular(p).incidencias)).toEqual([]);
  });

  it("Alex cobra 1.019,18 USD de closing, no los 900 € del importe firmado", () => {
    const alex = agruparPorPersona(lineas).find((t) => t.team_member_id === ALEX2)!;
    expect(alex.total).toBe(1019.18);
    // Lo que habría pagado la regla vieja sobre euros: 350+350+200.
    expect(alex.total).not.toBe(900);
  });

  it("Juan cobra 509,59 USD de setting, no los 450 € de antes", () => {
    const juan = agruparPorPersona(lineas).find((t) => t.team_member_id === JUAN)!;
    expect(juan.total).toBe(509.59);
    expect(juan.total).not.toBe(450);
  });

  // 178,77 USD de más en solo tres pagos (119,18 de Alex + 59,59 de Juan)
  // frente a lo que habría pagado la regla vieja sobre euros: 900 + 450.
  // Sobre un mes entero es la diferencia entre pagar bien y pagar de menos,
  // y nadie lo habría notado mirando el informe.
  it("comisionar en euros habría pagado 178,77 USD de menos en estos tres", () => {
    const total = agruparPorPersona(lineas).reduce((s, t) => s + t.total, 0);
    expect(Math.round(total * 100) / 100).toBe(1528.77);
    const enEuros = 900 + 450; // 10% y 5% sobre 3500+3500+2000
    expect(Math.round((total - enEuros) * 100) / 100).toBe(178.77);
  });

  it("el cash del mes que sale de estas líneas es el dólar cobrado", () => {
    const cash = reales.reduce((s, p) => s + (p.usd_recibido ?? 0), 0);
    expect(Math.round(cash * 100) / 100).toBe(10191.85);
  });
});

// ---------------------------------------------------------------------------
// Reversión de comisión por devolución (spec 2026-08-21).
// Berni, 21-ago: "las comisiones simplemente desaparecen" y "se resta en este".
// ---------------------------------------------------------------------------
describe("ajusteDeDevolucion", () => {
  it("revierte entera una compra nueva: closer 10% y setter 5% en negativo", () => {
    const p = pago({ usd_recibido: 1000 });
    const r = ajusteDeDevolucion(p, -1000, TODOS);
    expect(r.sinAjuste).toBeUndefined();
    expect(r.lineas.find((l) => l.team_member_id === ALEX)!.importe).toBe(-100);
    expect(r.lineas.find((l) => l.team_member_id === DANI)!.importe).toBe(-50);
  });

  it("escala la reversión por la proporción devuelta", () => {
    const p = pago({ usd_recibido: 1000 });
    const r = ajusteDeDevolucion(p, -400, TODOS);
    expect(r.lineas.find((l) => l.team_member_id === ALEX)!.importe).toBe(-40);
    expect(r.lineas.find((l) => l.team_member_id === DANI)!.importe).toBe(-20);
  });

  it("acepta el usd devuelto en positivo o en negativo — cuenta el valor absoluto", () => {
    const p = pago({ usd_recibido: 1000 });
    expect(ajusteDeDevolucion(p, 400, TODOS).lineas[0].importe).toBe(
      ajusteDeDevolucion(p, -400, TODOS).lineas[0].importe,
    );
  });

  it("nunca revierte más del 100% aunque el importe devuelto sea mayor", () => {
    const p = pago({ usd_recibido: 1000 });
    const r = ajusteDeDevolucion(p, -5000, TODOS);
    expect(r.lineas.find((l) => l.team_member_id === ALEX)!.importe).toBe(-100);
  });

  it("una ascensión solo revierte al coach", () => {
    const p = pago({ motivo: "upsell", upsell_por_id: MANU, usd_recibido: 1000 });
    const r = ajusteDeDevolucion(p, -1000, TODOS);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].team_member_id).toBe(MANU);
    expect(r.lineas[0].importe).toBe(-100);
  });

  it("quien no cobra comisión genera línea a cero, no a menos cero", () => {
    const p = pago({ closer_id: BERNI, usd_recibido: 1000 });
    const r = ajusteDeDevolucion(p, -1000, { noCobran: new Set([BERNI]) });
    const berni = r.lineas.find((l) => l.team_member_id === BERNI)!;
    expect(berni.importe).toBe(0);
    expect(Object.is(berni.importe, -0)).toBe(false);
  });

  it("venta anterior al corte y sin atribuir: no hay ajuste, y se dice por qué", () => {
    const p = pago({ atribuido: false, usd_recibido: 1000 });
    const r = ajusteDeDevolucion(p, -1000, TODOS, "2026-06-08");
    expect(r.lineas).toEqual([]);
    expect(r.sinAjuste).toBe("venta_anterior_al_corte");
  });

  it("venta posterior al corte y sin atribuir: eso sí es sin_atribuir", () => {
    const p = pago({ atribuido: false, usd_recibido: 1000 });
    const r = ajusteDeDevolucion(p, -1000, TODOS, "2026-08-15");
    expect(r.sinAjuste).toBe("sin_atribuir");
  });

  it("un pago original sin dólares no genera ajuste", () => {
    const p = pago({ usd_recibido: null });
    const r = ajusteDeDevolucion(p, -500, TODOS);
    expect(r.lineas).toEqual([]);
    expect(r.sinAjuste).toBe("sin_usd");
  });

  it("devolver cero no genera líneas ni incidencia", () => {
    const r = ajusteDeDevolucion(pago({ usd_recibido: 1000 }), 0, TODOS);
    expect(r.lineas).toEqual([]);
    expect(r.sinAjuste).toBeUndefined();
  });

  it("redondea a céntimos sin arrastrar coma flotante", () => {
    const p = pago({ usd_recibido: 333.33 });
    const r = ajusteDeDevolucion(p, -111.11, TODOS);
    expect(r.lineas.find((l) => l.team_member_id === ALEX)!.importe).toBe(-11.11);
  });
});
