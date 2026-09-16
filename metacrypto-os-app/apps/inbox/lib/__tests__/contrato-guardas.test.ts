import { describe, it, expect } from "vitest";
import { bloqueoRecorregir, plantillaRegenerable, type FilaRecorregir } from "../contrato-guardas";

// Las guardas de `recorregirContrato`. Se prueban aquí y no a través de la
// función que las usa porque `contrato-envio.ts` lleva `server-only` y alias
// `@/`: bajo vitest no se puede ni importar. Ver la cabecera de
// `contrato-guardas.ts`.

const AHORA = new Date("2026-09-16T12:00:00.000Z");
const VIVO = "2026-11-15T12:00:00.000Z"; // dentro de los 60 días
const CADUCADO = "2026-09-01T12:00:00.000Z";

/** Una fila v1 recién emitida: ninguna columna del ciclo de firma tocada. */
function fila(x: Partial<FilaRecorregir> = {}): FilaRecorregir {
  return {
    tipo: "venta_nueva",
    estado: "enviado",
    firmado_at: null,
    enviado_cliente_at: null,
    token_expira_at: null,
    texto_generado: null,
    texto_final: null,
    ...x,
  };
}

/** Una v2 en pie: generada, sin firmar, sin editar y sin enlace enviado. */
function v2(x: Partial<FilaRecorregir> = {}): FilaRecorregir {
  return fila({ tipo: "venta_nueva_v2", texto_generado: "CUERPO", texto_final: "CUERPO", ...x });
}

describe("bloqueoRecorregir · la v1 sigue recorrigiéndose como siempre", () => {
  it("una venta nueva recién emitida no encuentra ninguna guarda", () => {
    expect(bloqueoRecorregir(fila(), AHORA)).toBeNull();
  });

  it("una ampliación tampoco", () => {
    expect(bloqueoRecorregir(fila({ tipo: "ampliacion" }), AHORA)).toBeNull();
  });

  it("una v1 con texto guardado igual al generado tampoco: nadie la editó", () => {
    // `generarContrato` escribe los dos iguales al nacer, y lo hace para TODOS
    // los tipos. Que existan no significa que se haya tocado el documento.
    expect(bloqueoRecorregir(fila({ texto_generado: "X", texto_final: "X" }), AHORA)).toBeNull();
  });

  it("una fila histórica sin tipo se trata como v1: es lo que es", () => {
    // Anteriores a la CHECK; todas son de la plantilla vieja.
    expect(bloqueoRecorregir(fila({ tipo: null }), AHORA)).toBeNull();
  });

  it("los cuatro estados por los que pasa una v1 la dejan recorregir", () => {
    for (const estado of ["pendiente", "enviado", "error_envio", "enviado_cliente"]) {
      expect(bloqueoRecorregir(fila({ estado }), AHORA), estado).toBeNull();
    }
  });
});

describe("bloqueoRecorregir · firmado", () => {
  it("un contrato firmado no se regenera", () => {
    expect(bloqueoRecorregir(v2({ firmado_at: "2026-09-16T10:00:00.000Z" }), AHORA)?.motivo).toBe("firmado");
  });

  it("firmado gana a todo lo demás a la vez", () => {
    const f = v2({
      firmado_at: "2026-09-16T10:00:00.000Z",
      texto_final: "EDITADO A MANO",
      enviado_cliente_at: "2026-09-16T09:00:00.000Z",
      token_expira_at: VIVO,
    });
    expect(bloqueoRecorregir(f, AHORA)?.motivo).toBe("firmado");
  });

  it("una cadena vacía en firmado_at también para: es una fecha, no un booleano", () => {
    // Con `if (f.firmado_at)` este caso se cuela hasta el final. Mismo fallo
    // que `estadoDelEnlace` cerró en su día.
    expect(bloqueoRecorregir(v2({ firmado_at: "" }), AHORA)?.motivo).toBe("firmado");
  });

  it("estado 'firmado' sin fecha también para: es lo que la pestaña enseña", () => {
    // `contrato-estado.ts:125` pinta "Firmado" mirando los dos campos, porque
    // 'firmado' existe en la CHECK desde la 0004 y hasta la 0065 no lo escribía
    // nadie. Si una pantalla la da por firmada, esto no puede regenerarla.
    expect(bloqueoRecorregir(fila({ estado: "firmado" }), AHORA)?.motivo).toBe("firmado");
    expect(bloqueoRecorregir(v2({ estado: "firmado" }), AHORA)?.motivo).toBe("firmado");
  });

  it("aunque fuera una v1, un contrato firmado no se regenera", () => {
    // No puede ocurrir hoy (firmar exige v2), pero si ocurriera, negarse sigue
    // siendo la respuesta: la guarda no está gateada por tipo a propósito.
    expect(bloqueoRecorregir(fila({ firmado_at: "2026-09-16T10:00:00.000Z" }), AHORA)?.motivo).toBe("firmado");
  });
});

describe("bloqueoRecorregir · editado a mano", () => {
  it("el texto guardado difiere del generado: regenerar lo borraría", () => {
    expect(bloqueoRecorregir(v2({ texto_final: "OTRA COSA" }), AHORA)?.motivo).toBe("editado");
  });

  it("deshacer los cambios devuelve el permiso: ya no hay edición que perder", () => {
    expect(bloqueoRecorregir(v2({ texto_final: "CUERPO", texto_generado: "CUERPO" }), AHORA)?.motivo).toBe(
      "plantilla_nueva",
    );
  });

  it("texto guardado sin original con el que compararlo cuenta como editado", () => {
    // Falla hacia el lado seguro: no se puede demostrar que salga de la
    // plantilla, y negarse no destruye nada.
    expect(bloqueoRecorregir(v2({ texto_generado: null, texto_final: "ALGO" }), AHORA)?.motivo).toBe("editado");
  });

  it("un generado sin texto final no es una edición", () => {
    expect(bloqueoRecorregir(fila({ texto_generado: "ALGO", texto_final: null }), AHORA)).toBeNull();
  });

  it("editado gana al enlace vivo: explica mejor qué se perdería", () => {
    const f = v2({ texto_final: "EDITADO", enviado_cliente_at: "2026-09-15T12:00:00.000Z", token_expira_at: VIVO });
    expect(bloqueoRecorregir(f, AHORA)?.motivo).toBe("editado");
  });

  it("…y con el enlace vivo dice ADEMÁS que habrá que reenviarlo", () => {
    // El motivo que gana es el que menos dice de los dos: se funde la
    // información en vez de reordenar las guardas.
    const f = v2({ texto_final: "EDITADO", enviado_cliente_at: "2026-09-15T12:00:00.000Z", token_expira_at: VIVO });
    expect(bloqueoRecorregir(f, AHORA)?.error).toContain("volver a enviárselo");
  });

  it("sin enlace vivo no menciona ningún reenvío que nadie tiene que hacer", () => {
    expect(bloqueoRecorregir(v2({ texto_final: "EDITADO" }), AHORA)?.error).not.toContain("enviár");
  });
});

describe("bloqueoRecorregir · el enlace que el cliente tiene en la mano", () => {
  const enviado = { enviado_cliente_at: "2026-09-15T12:00:00.000Z" };

  it("enviado y vigente: no se regenera por debajo del cliente", () => {
    expect(bloqueoRecorregir(v2({ ...enviado, token_expira_at: VIVO }), AHORA)?.motivo).toBe("enlace_vivo");
  });

  it("el mensaje dice qué hacer, no solo que no", () => {
    const b = bloqueoRecorregir(v2({ ...enviado, token_expira_at: VIVO }), AHORA);
    expect(b?.error).toContain("«Editar»");
    expect(b?.error).toContain("enviarle el enlace");
  });

  it("caducado ya no frena: ese enlace no le sirve a nadie", () => {
    expect(bloqueoRecorregir(v2({ ...enviado, token_expira_at: CADUCADO }), AHORA)?.motivo).toBe("plantilla_nueva");
  });

  it("enviado pero sin caducidad registrada tampoco frena: el enlace no está en pie", () => {
    expect(bloqueoRecorregir(v2({ ...enviado, token_expira_at: null }), AHORA)?.motivo).toBe("plantilla_nueva");
  });

  it("caducidad justo en el segundo de corte: caducado (el corte está incluido)", () => {
    const f = v2({ ...enviado, token_expira_at: AHORA.toISOString() });
    expect(bloqueoRecorregir(f, AHORA)?.motivo).toBe("plantilla_nueva");
  });

  it("una fecha de caducidad corrupta no deja pasar por el lado equivocado", () => {
    // NaN: `estadoDelEnlace` lo trata como no activo. Aquí eso significa "no
    // hay enlace que proteger", no "adelante con todo": la guarda de plantilla
    // sigue estando detrás.
    expect(bloqueoRecorregir(v2({ ...enviado, token_expira_at: "pasado mañana" }), AHORA)?.motivo).toBe(
      "plantilla_nueva",
    );
  });

  it("un token vivo sobre una v1 también frena, aunque hoy no pueda existir", () => {
    const f = fila({ ...enviado, token_expira_at: VIVO });
    expect(bloqueoRecorregir(f, AHORA)?.motivo).toBe("enlace_vivo");
  });
});

describe("bloqueoRecorregir · la plantilla que este camino no sabe regenerar", () => {
  it("una v2 limpia tampoco se recorrige: saldría con la plantilla anterior", () => {
    expect(bloqueoRecorregir(v2(), AHORA)?.motivo).toBe("plantilla_nueva");
  });

  it("es lista BLANCA: un tipo nuevo que nadie ha previsto se bloquea solo", () => {
    // El ternario al que protege esta guarda manda a "venta_nueva" todo lo que
    // no sea "ampliacion". Si esto nombrara solo a la v2, un `ampliacion_v2`
    // reabriría la cadena entera y en silencio.
    expect(bloqueoRecorregir(fila({ tipo: "ampliacion_v2" }), AHORA)?.motivo).toBe("plantilla_nueva");
    expect(bloqueoRecorregir(fila({ tipo: "venta_nueva_v3" }), AHORA)?.motivo).toBe("plantilla_nueva");
    expect(bloqueoRecorregir(fila({ tipo: "loquesea" }), AHORA)?.motivo).toBe("plantilla_nueva");
  });

  it("y lo dice sin hablar de plantillas internas ni de tipos", () => {
    const b = bloqueoRecorregir(v2(), AHORA);
    expect(b?.error).not.toContain("venta_nueva_v2");
    expect(b?.error).toContain("«Editar»");
  });

  it("y cuenta lo que YA pasó: los bonos están guardados y el contrato, marcado", () => {
    // El modal guarda los bonos antes de llamar. Sin esta frase, el closer lee
    // "no se puede" sobre un cambio que sí se hizo.
    const b = bloqueoRecorregir(v2(), AHORA);
    expect(b?.error).toContain("Los bonos ya han quedado guardados");
    expect(b?.error).toContain("desactualizado");
  });
});

describe("bloqueoRecorregir · la tabla entera", () => {
  // Las condiciones, en todas las combinaciones que importan, con el resultado
  // escrito a mano una por una. Si alguien reordena las guardas, esta tabla es
  // la que lo cuenta.
  const casos: [string, FilaRecorregir, string | null][] = [
    ["v1 · limpia", fila(), null],
    ["v1 · con texto igual al generado", fila({ texto_generado: "X", texto_final: "X" }), null],
    ["v1 · sin tipo (histórica)", fila({ tipo: null }), null],
    ["v1 · firmada (imposible hoy)", fila({ firmado_at: "2026-09-16T10:00:00.000Z" }), "firmado"],
    ["v1 · estado firmado sin fecha", fila({ estado: "firmado" }), "firmado"],
    ["tipo desconocido", fila({ tipo: "ampliacion_v2" }), "plantilla_nueva"],
    ["v2 · limpia", v2(), "plantilla_nueva"],
    ["v2 · editada", v2({ texto_final: "OTRO" }), "editado"],
    [
      "v2 · enlace vivo",
      v2({ enviado_cliente_at: "2026-09-15T12:00:00.000Z", token_expira_at: VIVO }),
      "enlace_vivo",
    ],
    [
      "v2 · editada + enlace vivo",
      v2({ texto_final: "OTRO", enviado_cliente_at: "2026-09-15T12:00:00.000Z", token_expira_at: VIVO }),
      "editado",
    ],
    ["v2 · firmada", v2({ firmado_at: "2026-09-16T10:00:00.000Z" }), "firmado"],
    [
      "v2 · firmada + editada + enlace vivo",
      v2({
        firmado_at: "2026-09-16T10:00:00.000Z",
        texto_final: "OTRO",
        enviado_cliente_at: "2026-09-15T12:00:00.000Z",
        token_expira_at: VIVO,
      }),
      "firmado",
    ],
    [
      "v2 · enlace caducado",
      v2({ enviado_cliente_at: "2026-09-15T12:00:00.000Z", token_expira_at: CADUCADO }),
      "plantilla_nueva",
    ],
  ];

  for (const [nombre, f, esperado] of casos) {
    it(`${nombre} → ${esperado ?? "adelante"}`, () => {
      expect(bloqueoRecorregir(f, AHORA)?.motivo ?? null).toBe(esperado);
    });
  }

  it("siempre que frena, trae un mensaje que un closer puede leer", () => {
    for (const [nombre, f] of casos) {
      const b = bloqueoRecorregir(f, AHORA);
      if (!b) continue;
      expect(b.error.length, nombre).toBeGreaterThan(40);
      // Ni códigos ni nombres de columna: esto se lee en mitad de una venta.
      expect(b.error, nombre).not.toMatch(/_at\b|null|undefined|PGRST/);
    }
  });
});

// `plantillaRegenerable` se exportó el 16-sep para que la pestaña /contratos
// deje de tener su propia copia de esta lista (la tenía escrita como lista
// NEGRA: `tipo !== "venta_nueva_v2"`). Estos tests son de la lista, no de la
// guarda: si alguien añade un tipo de plantilla y no lo mete aquí, el default
// es negarse, que es el lado correcto.
describe("plantillaRegenerable", () => {
  it.each([
    ["venta_nueva", true],
    ["ampliacion", true],
    [null, true],           // fila histórica sin tipo: es v1
    [undefined, true],
    ["venta_nueva_v2", false],
    ["ampliacion_v2", false],   // no existe todavía; el día que exista, no
    ["cualquier_cosa", false],
  ] as const)("%s → %s", (tipo, esperado) => {
    expect(plantillaRegenerable(tipo)).toBe(esperado);
  });

  it("es lista blanca: un tipo nuevo cae del lado de negarse, sin tocar nada", () => {
    expect(plantillaRegenerable("renovacion_v3")).toBe(false);
  });
});
