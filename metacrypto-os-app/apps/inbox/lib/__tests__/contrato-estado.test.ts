import { describe, it, expect } from "vitest";
import { estadoContrato, CLASE_PILL, type FilaContratoEstado } from "../contrato-estado";

// La fila mínima. Cada caso pisa solo lo que le importa: así un campo nuevo en
// `contratos` no obliga a tocar veinte objetos literales.
function fila(p: Partial<FilaContratoEstado> = {}): FilaContratoEstado {
  return {
    tipo: "venta_nueva_v2",
    estado: "pendiente",
    enviado_cliente_at: null,
    visto_at: null,
    firmado_at: null,
    firma_nombre: null,
    ...p,
  };
}

describe("estadoContrato · el ciclo del contrato v2", () => {
  it("recién generado: sin enviar, sin alarma", () => {
    const e = estadoContrato(fila());
    expect(e.etiqueta).toBe("Sin enviar");
    expect(e.tono).toBe("neutro");
    expect(e.detalle).toContain("Todavía no ha salido a nadie");
  });

  it("enviado al cliente y sin abrir: no promete que lo haya visto", () => {
    const e = estadoContrato(fila({ estado: "enviado_cliente", enviado_cliente_at: "2026-09-16T09:00:00Z" }));
    expect(e.etiqueta).toBe("Enviado al cliente");
    expect(e.tono).toBe("azul");
    expect(e.detalle).toContain("Todavía no consta que lo haya abierto");
  });

  it("abierto: la etiqueta dice el día y el globo dice qué significa de verdad", () => {
    const e = estadoContrato(fila({
      estado: "enviado_cliente",
      enviado_cliente_at: "2026-09-16T09:00:00Z",
      visto_at: "2026-09-17T10:30:00Z",
    }));
    expect(e.etiqueta).toBe("Abierto el 17 sept 26");
    expect(e.tono).toBe("azul");
    // Lo que NO puede prometer: que lo leyera. Ver el comentario del lib.
    expect(e.detalle).toContain("no prueba que lo haya leído");
    expect(e.detalle).toContain("por primera vez");
    // Y nunca un contador de aperturas: 'abierto' se registra en cada carga.
    expect(e.detalle).not.toMatch(/\d+ veces/);
  });

  it("firmado: gana a todo y dice quién firmó", () => {
    const e = estadoContrato(fila({
      estado: "firmado",
      enviado_cliente_at: "2026-09-16T09:00:00Z",
      visto_at: "2026-09-17T10:30:00Z",
      firmado_at: "2026-09-18T11:00:00Z",
      firma_nombre: "esa clienta Etxeberria",
    }));
    expect(e.etiqueta).toBe("Firmado");
    expect(e.tono).toBe("oro");
    expect(e.detalle).toContain("esa clienta Etxeberria");
  });

  it("firmado sin nombre: no deja el globo a medias", () => {
    const e = estadoContrato(fila({ estado: "firmado", firmado_at: "2026-09-18T11:00:00Z", firma_nombre: "   " }));
    expect(e.detalle).toContain("Firmado por el cliente");
  });

  it("firmado_at sin que `estado` se haya movido: sigue siendo Firmado", () => {
    const e = estadoContrato(fila({ estado: "enviado_cliente", firmado_at: "2026-09-18T11:00:00Z" }));
    expect(e.etiqueta).toBe("Firmado");
  });

  it("estado 'firmado' heredado sin firmado_at: no cae al literal en minúsculas", () => {
    const e = estadoContrato(fila({ tipo: "venta_nueva", estado: "firmado" }));
    expect(e.etiqueta).toBe("Firmado");
    expect(e.detalle).toBeNull();
  });
});

describe("estadoContrato · 'pendiente' significa dos cosas distintas", () => {
  // `it.each` y no un bucle dentro de un `it`: con el bucle, los tres tipos
  // comparten un único caso y el fallo no dice cuál de ellos rompió.
  it.each(["venta_nueva", "ampliacion", null])(
    "%s → en el camino viejo, 'pendiente' es que el correo no salió",
    (tipo) => {
      const e = estadoContrato(fila({ tipo, estado: "pendiente" }));
      expect(e.etiqueta).toBe("No salió");
      expect(e.tono).toBe("naranja");
    },
  );

  it("en el camino de la firma es lo normal", () => {
    const e = estadoContrato(fila({ tipo: "venta_nueva_v2", estado: "pendiente" }));
    expect(e.tono).toBe("neutro");
  });

  it("error_envio se funde con el pendiente viejo, en los dos tipos", () => {
    const viejo = estadoContrato(fila({ tipo: "venta_nueva", estado: "error_envio" }));
    const nuevo = estadoContrato(fila({ tipo: "venta_nueva_v2", estado: "error_envio" }));
    expect(viejo).toEqual(nuevo);
    expect(viejo.etiqueta).toBe("No salió");
  });
});

describe("estadoContrato · el camino viejo entero", () => {
  it("enviado es al EQUIPO, y lo dice", () => {
    const e = estadoContrato(fila({ tipo: "venta_nueva", estado: "enviado" }));
    expect(e.etiqueta).toBe("Enviado al equipo");
    expect(e.tono).toBe("verde");
    expect(e.detalle).toContain("Al cliente todavía no");
  });

  it("un estado desconocido se enseña tal cual, sin inventar color", () => {
    const e = estadoContrato(fila({ estado: "loquesea" }));
    expect(e.etiqueta).toBe("loquesea");
    expect(e.tono).toBe("neutro");
    expect(e.detalle).toBeNull();
  });
});

// 🔴 La trampa que este módulo tiene que no volver a pisar. Lo que se formatea
// son instantes (`timestamptz`), y las dos funciones de lib/format fallarían
// cada una a su manera: `dateEs` fija UTC —una firma de las 00:30 de Madrid
// saldría con la fecha de ayer— y `fullTime` usa la zona del proceso, que en
// /contratos es la del SERVIDOR (esa pestaña se renderiza en Vercel, en UTC).
// Estos dos tests caen si alguien las vuelve a meter.
describe("estadoContrato · la hora es la de España, la pinte quien la pinte", () => {
  function conZona<T>(tz: string, f: () => T): T {
    const antes = process.env.TZ;
    process.env.TZ = tz;
    try {
      return f();
    } finally {
      process.env.TZ = antes;
    }
  }

  // 23:30 UTC del 17 son las 01:30 del 18 en Madrid (CEST, +2).
  const casi = { estado: "enviado_cliente", visto_at: "2026-09-17T23:30:00Z" };

  it("el día de la etiqueta es el día español, no el UTC", () => {
    expect(estadoContrato(fila(casi)).etiqueta).toBe("Abierto el 18 sept 26");
  });

  it("y no se mueve con la zona de la máquina que lo renderiza", () => {
    const santiago = conZona("America/Santiago", () => estadoContrato(fila(casi)));
    const utc = conZona("UTC", () => estadoContrato(fila(casi)));
    const madrid = conZona("Europe/Madrid", () => estadoContrato(fila(casi)));
    expect(santiago).toEqual(madrid);
    expect(utc).toEqual(madrid);
  });

  it("el globo de la firma lleva hora, año y de qué país es esa hora", () => {
    const e = estadoContrato(fila({ estado: "firmado", firmado_at: "2026-09-18T09:05:00Z", firma_nombre: "esa clienta" }));
    expect(e.detalle).toBe("Firmado por esa clienta el 18/09/2026 a las 11:05 (hora de España).");
  });
});

describe("CLASE_PILL", () => {
  it("cada tono tiene una clase de las que existen en globals.css", () => {
    expect(Object.values(CLASE_PILL).sort()).toEqual(
      ["pill", "pill blue", "pill gold", "pill green", "pill orange"].sort(),
    );
  });

  it("todo tono que devuelve estadoContrato tiene clase", () => {
    const estados = ["pendiente", "enviado", "error_envio", "enviado_cliente", "firmado", "loquesea"];
    for (const estado of estados) {
      for (const tipo of ["venta_nueva", "venta_nueva_v2"]) {
        const e = estadoContrato(fila({ tipo, estado, visto_at: "2026-09-17T10:30:00Z" }));
        // Aquí el bucle SÍ vale: la aserción es la misma para los doce y lo
        // que se afirma es "ninguno se queda sin clase", no un caso concreto.
        expect(CLASE_PILL[e.tono]).toBeTruthy();
      }
    }
  });
});
