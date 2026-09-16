import { describe, it, expect } from "vitest";
import {
  etiquetaAsistencia, consumeCupo, siguienteNumero, pendientesDeCupo,
  resumenCupo, etiquetaOperacion, detectarFichaOperativa,
  MOTIVO_CONGELADO_CATALOGO,
} from "../servicio";
import type { Operacion } from "../servicio";

// Nota real de Joel Gasso (3-ago-2026, Manuel). Se usa tal cual para que los
// tests fallen si alguien cambia el parseo de una forma que no aguanta el
// formato que el equipo escribe de verdad.
const NOTA_JOEL = `CAPITAL TOTAL : 15K - TIENE 6K EN ALTSCOINS QUE NO VA A VENDER..

ENTRADA AL SHORT A MERCADO CON LOS 15K - APALANCAMIENTO 2X - PL: 96K

SE VA A UTILIZAR OKX, ESTA PENDIENTE DE APROBACIÓN DE LA CUENTA PARA EJECUTAR EL SHORT`;

describe("etiquetaAsistencia", () => {
  it("distingue sin registrar de no asistió", () => {
    expect(etiquetaAsistencia(null)).toBe("Sin registrar");
    expect(etiquetaAsistencia("no_asistio")).toBe("No asistió");
  });
  it("nombra las otras dos", () => {
    expect(etiquetaAsistencia("asistio")).toBe("Asistió");
    expect(etiquetaAsistencia("reprogramada")).toBe("Reprogramada");
  });
});

describe("consumeCupo", () => {
  it("sólo una sesión asistida gasta consultoría", () => {
    expect(consumeCupo("asistio")).toBe(true);
    expect(consumeCupo("reprogramada")).toBe(false);
    expect(consumeCupo("no_asistio")).toBe(false);
    expect(consumeCupo(null)).toBe(false);
  });
});

describe("siguienteNumero", () => {
  it("cuenta por cliente, sin importar el coach", () => {
    // Ruben Arroyo: Berni, Manuel, Berni → la siguiente es la 4.
    expect(siguienteNumero([
      { estado_asistencia: "asistio" },
      { estado_asistencia: "asistio" },
      { estado_asistencia: "asistio" },
    ])).toBe(4);
  });
  it("una reprogramada no gasta número", () => {
    expect(siguienteNumero([
      { estado_asistencia: "asistio" },
      { estado_asistencia: "reprogramada" },
      { estado_asistencia: "asistio" },
    ])).toBe(3);
  });
  it("un no-show sí ocupa su hueco en el historial", () => {
    // La sesión existió y se cuenta en el relato aunque no gaste cupo.
    expect(siguienteNumero([
      { estado_asistencia: "asistio" },
      { estado_asistencia: "no_asistio" },
    ])).toBe(3);
  });
  it("el primer cliente empieza en 1", () => {
    expect(siguienteNumero([])).toBe(1);
  });
});

describe("pendientesDeCupo", () => {
  it("nunca es negativo aunque el cliente se haya pasado", () => {
    // Ivan Moreno y Nico Villalón: tier 3000 (2 incluidas), 3 hechas.
    expect(pendientesDeCupo({ incluidas: 2, ajustado: false, hechas: 3 })).toBe(0);
  });
  it("null cuando no hay programa activo: no es lo mismo que cero", () => {
    expect(pendientesDeCupo({ incluidas: null, ajustado: false, hechas: 2 })).toBeNull();
  });
  it("resta normal en el caso corriente", () => {
    expect(pendientesDeCupo({ incluidas: 4, ajustado: false, hechas: 1 })).toBe(3);
  });
});

describe("MOTIVO_CONGELADO_CATALOGO", () => {
  it("es el literal exacto que escribe la migración 0066, no cualquier valor", () => {
    // Fija la CADENA CRUDA, no solo el símbolo. Si alguien cambiara el valor
    // de la constante (p. ej. a "catalogo_2027"), los tests de resumenCupo que
    // comparan con la propia constante seguirían en verde porque los dos lados
    // de la comparación cambiarían juntos — y las 59 fichas congeladas caerían
    // en silencio por la rama de "ajustado a mano". Este test es el único que
    // se entera de ese cambio.
    expect(MOTIVO_CONGELADO_CATALOGO).toBe("catalogo_2026");
  });
});

describe("resumenCupo", () => {
  it("dice cuántas le quedan, en singular cuando es una", () => {
    expect(resumenCupo({ incluidas: 2, ajustado: false, hechas: 1 }))
      .toBe("Lleva 1 sesión de 2 incluidas · le queda 1");
  });
  it("avisa cuando el número está ajustado a mano", () => {
    expect(resumenCupo({ incluidas: 3, ajustado: true, hechas: 1 }))
      .toBe("Lleva 1 sesión de 3 incluidas (ajustado a mano) · le quedan 2");
  });
  it("un ajuste con motivo distinto al del catálogo sigue siendo 'ajustado a mano'", () => {
    // Cualquier motivo que no sea el de la 0066 se trata como ajuste manual
    // real — el CHECK de la migración solo exige que haya motivo si hay
    // ajuste, no que ese motivo sea uno de una lista cerrada.
    expect(resumenCupo({ incluidas: 3, ajustado: true, ajusteMotivo: "otra_razon", hechas: 1 }))
      .toBe("Lleva 1 sesión de 3 incluidas (ajustado a mano) · le quedan 2");
  });
  it("congelado por el catálogo 2026 NO se dice igual que un ajuste a mano", () => {
    // Este es el caso de los 59 clientes que la migración 0066 congela: su
    // cupo es el que contrató, no un recorte ni un error a "arreglar".
    //
    // El motivo va como literal a mano, NO como `MOTIVO_CONGELADO_CATALOGO`:
    // si alguien cambiara el valor de la constante, comparar contra sí misma
    // haría que este test siguiera en verde sin decir nada — el literal es lo
    // que de verdad ata el comportamiento a la cadena que escribe la 0066.
    expect(resumenCupo({
      incluidas: 4, ajustado: true, ajusteMotivo: "catalogo_2026", hechas: 1,
    })).toBe("Lleva 1 sesión de 4 incluidas (congelado al cambiar el catálogo) · le quedan 3");
  });
  it("dice en cuánto se pasó, no un cero seco", () => {
    expect(resumenCupo({ incluidas: 2, ajustado: false, hechas: 3 }))
      .toBe("Lleva 3 sesiones de 2 incluidas · ya se pasó en 1");
  });
  it("sin programa activo no inventa un cupo", () => {
    expect(resumenCupo({ incluidas: null, ajustado: false, hechas: 2 }))
      .toBe("Lleva 2 sesiones · sin programa activo, no se sabe cuántas incluye");
  });
  it("sin número tampoco explica motivos, ni el congelado ni los bonos", () => {
    // El caso de un congelado por la 0066 al que le caduca el programa:
    // `incluidas` vuelve a null (la vista lo garantiza) pero
    // `consultorias_ajuste` sigue escrito en la persona, así que `ajustado`
    // sigue siendo true. Sin número, un "(congelado al cambiar el catálogo)"
    // no explica nada — explica un número que no está — y el desglose de
    // bonos tendría que inventarse una base.
    //
    // Esta es la regla que la tabla de /sesiones replica desde ahora: si
    // `incluidas` es null, ningún chip. Si alguien cambia esto, que lo cambie
    // en los dos sitios a la vez.
    expect(resumenCupo({
      incluidas: null, ajustado: true, ajusteMotivo: MOTIVO_CONGELADO_CATALOGO,
      hechas: 1, extraBonos: 1,
    })).toBe("Lleva 1 sesión · sin programa activo, no se sabe cuántas incluye");
  });
});

describe("etiquetaOperacion", () => {
  const base: Operacion = {
    direccion: "short", activo: "BTC", capital: 5000, apalancamiento: "2x",
    zona_entrada: "64–65,5K", objetivo: "96K", estado: "ordenes_puestas",
  };

  // El separador de miles y el espacio antes del € dependen de los datos de
  // locale del Node que ejecute el test: con ICU completo (Vercel) sale
  // "5.000 €" con espacio duro, y con ICU reducido, "5000 €". Lo que este test
  // protege es QUÉ partes salen y en qué orden, no cómo agrupa los miles el
  // sistema operativo — así que se compara sin puntos ni espacios duros.
  const norm = (s: string) => s.replace(/ /g, " ").replace(/\./g, "");

  it("arma la línea completa", () => {
    expect(norm(etiquetaOperacion(base)))
      .toBe(norm("Short BTC · 5.000 € · 2x · entrada 64–65,5K · objetivo 96K"));
  });
  it("omite lo que no se rellenó", () => {
    expect(norm(etiquetaOperacion({ ...base, zona_entrada: null, objetivo: null })))
      .toBe(norm("Short BTC · 5.000 € · 2x"));
  });
  it("no apalanca una espera", () => {
    // El formulario trae 2x por defecto; arrastrarlo a un "esperar" sería
    // escribir algo que el coach no dijo.
    expect(etiquetaOperacion({
      ...base, direccion: "esperar", activo: null, capital: null,
      zona_entrada: null, objetivo: null,
    })).toBe("Esperar");
  });
  it("acepta el capital como texto del formulario", () => {
    // El coach teclea "15.000", no 15000: si el punto se leyera como decimal
    // la operación diría 15 € en vez de quince mil.
    expect(norm(etiquetaOperacion({ ...base, capital: "15.000", apalancamiento: null,
      zona_entrada: null, objetivo: null }))).toBe(norm("Short BTC · 15.000 €"));
  });
});

describe("detectarFichaOperativa", () => {
  it("lee la nota real de Joel Gasso", () => {
    const t = detectarFichaOperativa(NOTA_JOEL).map((p) => p.texto);
    expect(t).toContain("Short");
    expect(t).toContain("Apalancamiento 2x");
    expect(t).toContain("OKX");
    expect(t).toEqual(expect.arrayContaining(["15K", "6K", "96K"]));
  });
  it("no repite un importe que la nota menciona dos veces", () => {
    // "15K" aparece en la primera y en la segunda línea de la nota de Joel.
    const quinces = detectarFichaOperativa(NOTA_JOEL).filter((p) => p.texto === "15K");
    expect(quinces).toHaveLength(1);
  });
  it("no marca Long en una nota que sólo habla de shorts", () => {
    const t = detectarFichaOperativa(NOTA_JOEL).map((p) => p.texto);
    expect(t).not.toContain("Long");
  });
  it("devuelve lista vacía, no null, cuando no hay nada que leer", () => {
    expect(detectarFichaOperativa("Hablamos de su situación personal")).toEqual([]);
  });
  it("aguanta las 33 sesiones que se quedaron sin nota", () => {
    expect(detectarFichaOperativa(null)).toEqual([]);
    expect(detectarFichaOperativa("")).toEqual([]);
  });
});

/* ============ cupo con bonos del evento ============ */
describe("resumenCupo — bonos del evento", () => {
  it("dice de dónde salen las consultorías extra", () => {
    expect(resumenCupo({ incluidas: 3, ajustado: false, hechas: 1, extraBonos: 2 }))
      .toBe("Lleva 1 sesión de 3 incluidas (+2 por bonos del evento) · le quedan 2");
  });
  it("una sola en singular", () => {
    expect(resumenCupo({ incluidas: 2, ajustado: false, hechas: 0, extraBonos: 1 }))
      .toContain("(+1 por bono del evento)");
  });
  it("el ajuste a mano y los bonos conviven, y se distinguen", () => {
    expect(resumenCupo({ incluidas: 5, ajustado: true, hechas: 0, extraBonos: 2 }))
      .toContain("(ajustado a mano · +2 por bonos del evento)");
  });
  it("el congelado del catálogo y los bonos también conviven", () => {
    // 18 de los 59 congelados tienen además bonos del evento (nota de la
    // migración 0066): el texto no puede confundir uno con otro.
    // Literal a mano, no la constante — mismo motivo que en el test de arriba.
    expect(resumenCupo({
      incluidas: 6, ajustado: true, ajusteMotivo: "catalogo_2026", hechas: 0, extraBonos: 2,
    })).toContain("(congelado al cambiar el catálogo · +2 por bonos del evento)");
  });
  it("sin bonos, el texto de siempre no cambia", () => {
    expect(resumenCupo({ incluidas: 2, ajustado: false, hechas: 1, extraBonos: 0 }))
      .toBe("Lleva 1 sesión de 2 incluidas · le queda 1");
  });
});
