import { describe, it, expect } from "vitest";
import {
  proximaOcurrencia,
  motivoNoProgramable,
  esAudienciaConocida,
  horaParaPlantilla,
  type ReglaRecurrente,
} from "../recurrentes";

// Recordatorio de calendario: en 2026, el 27-ago es jueves, el 30-ago domingo,
// el 2-sep miércoles. El horario de verano europeo termina el 25-oct-2026.

describe("proximaOcurrencia", () => {
  it("desde un jueves, la sesión del domingo cae 3 días después (verano: 19:00 Madrid = 17:00Z)", () => {
    const r = proximaOcurrencia(0, "19:00", "Europe/Madrid", new Date("2026-08-27T10:00:00Z"));
    expect(r).toBe("2026-08-30T17:00:00.000Z");
  });

  it("el mismo domingo por la mañana, la ocurrencia es esa misma tarde", () => {
    const r = proximaOcurrencia(0, "19:00", "Europe/Madrid", new Date("2026-08-30T10:00:00Z"));
    expect(r).toBe("2026-08-30T17:00:00.000Z");
  });

  it("el mismo domingo ya pasada la hora, salta a la semana siguiente", () => {
    const r = proximaOcurrencia(0, "19:00", "Europe/Madrid", new Date("2026-08-30T17:30:00Z"));
    expect(r).toBe("2026-09-06T17:00:00.000Z");
  });

  it("justo en el instante de la sesión, la ocurrencia sigue siendo la de hoy", () => {
    const r = proximaOcurrencia(0, "19:00", "Europe/Madrid", new Date("2026-08-30T17:00:00Z"));
    expect(r).toBe("2026-08-30T17:00:00.000Z");
  });

  it("en invierno el mismo reloj de pared da otro instante (19:00 Madrid = 18:00Z)", () => {
    const r = proximaOcurrencia(0, "19:00", "Europe/Madrid", new Date("2026-01-05T10:00:00Z"));
    expect(r).toBe("2026-01-11T18:00:00.000Z");
  });

  it("la semana del cambio de hora usa el offset del día de la sesión, no el de hoy", () => {
    // El 21-oct Madrid va en +02:00; el domingo 25-oct (fin del DST) a las
    // 19:00 ya va en +01:00. Calcular con el offset de hoy daría 17:00Z.
    const r = proximaOcurrencia(0, "19:00", "Europe/Madrid", new Date("2026-10-21T10:00:00Z"));
    expect(r).toBe("2026-10-25T18:00:00.000Z");
  });

  it("el día en curso se decide en la zona, no en UTC (sábado 22:30Z ya es domingo en Madrid)", () => {
    const r = proximaOcurrencia(0, "19:00", "Europe/Madrid", new Date("2026-08-29T22:30:00Z"));
    expect(r).toBe("2026-08-30T17:00:00.000Z");
  });

  it("la sesión del miércoles con hora y minutos", () => {
    const r = proximaOcurrencia(3, "18:30", "Europe/Madrid", new Date("2026-08-27T10:00:00Z"));
    expect(r).toBe("2026-09-02T16:30:00.000Z");
  });

  it("acepta el formato time de Postgres (HH:MM:SS)", () => {
    const r = proximaOcurrencia(0, "19:00:00", "Europe/Madrid", new Date("2026-08-27T10:00:00Z"));
    expect(r).toBe("2026-08-30T17:00:00.000Z");
  });

  it("sin hora no hay ocurrencia", () => {
    expect(proximaOcurrencia(0, null, "Europe/Madrid", new Date("2026-08-27T10:00:00Z"))).toBeNull();
  });

  it("una hora mal formada no revienta: devuelve null", () => {
    expect(proximaOcurrencia(0, "a las 7", "Europe/Madrid", new Date("2026-08-27T10:00:00Z"))).toBeNull();
    expect(proximaOcurrencia(0, "25:00", "Europe/Madrid", new Date("2026-08-27T10:00:00Z"))).toBeNull();
  });

  it("una zona que Intl no reconoce devuelve null en vez de caer a otra en silencio", () => {
    expect(proximaOcurrencia(0, "19:00", "Madrid", new Date("2026-08-27T10:00:00Z"))).toBeNull();
  });

  it("un día de la semana fuera de 0-6 devuelve null", () => {
    expect(proximaOcurrencia(7, "19:00", "Europe/Madrid", new Date("2026-08-27T10:00:00Z"))).toBeNull();
    expect(proximaOcurrencia(-1, "19:00", "Europe/Madrid", new Date("2026-08-27T10:00:00Z"))).toBeNull();
  });
});

const REGLA_COMPLETA: ReglaRecurrente = {
  id: "r1",
  dia_semana: 0,
  hora: "19:00:00",
  zona: "Europe/Madrid",
  coach_id: "6cbb5982-6051-4c00-bc98-97310140e23f", // Berni
  enlace: "https://us02web.zoom.us/j/811",
  plantilla_nombre: "recordatorio_1h_es",
  audiencia: "todos",
  activa: true,
  duracion_min: 60,
};

describe("motivoNoProgramable", () => {
  it("una regla completa no tiene motivo", () => {
    expect(motivoNoProgramable(REGLA_COMPLETA)).toBeNull();
  });
  it("sin hora", () => {
    expect(motivoNoProgramable({ ...REGLA_COMPLETA, hora: null })).toBe("sin hora");
  });
  it("sin enlace de Zoom", () => {
    expect(motivoNoProgramable({ ...REGLA_COMPLETA, enlace: null })).toBe("sin enlace de Zoom");
  });
  it("zona horaria inválida", () => {
    expect(motivoNoProgramable({ ...REGLA_COMPLETA, zona: "Madrid" })).toBe("zona horaria inválida");
  });
  it("audiencia desconocida: mejor no enviar a nadie que inventar a quién", () => {
    expect(motivoNoProgramable({ ...REGLA_COMPLETA, audiencia: "vip" })).toBe("audiencia desconocida");
  });
  it("coach sin mapear: la plantilla dice 'con {{coach}}' y no se inventa un nombre", () => {
    expect(motivoNoProgramable({ ...REGLA_COMPLETA, coach_id: "otro-uuid" })).toBe("coach sin nombre");
    expect(motivoNoProgramable({ ...REGLA_COMPLETA, coach_id: null })).toBe("coach sin nombre");
  });
});

describe("esAudienciaConocida", () => {
  it("hoy solo existe 'todos' (los clientes activos con teléfono)", () => {
    expect(esAudienciaConocida("todos")).toBe(true);
    expect(esAudienciaConocida("tier_5000")).toBe(false);
    expect(esAudienciaConocida("")).toBe(false);
  });
});

describe("horaParaPlantilla", () => {
  it("en Madrid la hora sale con la coletilla, para que un cliente de América no se confunda", () => {
    expect(horaParaPlantilla("2026-08-30T17:00:00.000Z", "Europe/Madrid")).toBe(
      "19:00 (hora de España)",
    );
  });
  it("en otra zona la coletilla es la propia zona", () => {
    expect(horaParaPlantilla("2026-08-30T17:00:00.000Z", "America/Mexico_City")).toBe(
      "11:00 (America/Mexico_City)",
    );
  });
});

// ============================================================
// Los OG fuera de los avisos recurrentes (decisión de Milo, 3-sep-2026).
//
// Hoy ya no les llega nada, pero POR ACCIDENTE: los 76 son `estado
// 'archivado'` y ninguno tiene teléfono ni email, así que el filtro
// `estado=eq.cliente` de `audienciaTodos` los deja fuera sin querer.
//
// Eso es frágil de una forma medida: el 3-sep se rellenaron 26 emails desde
// GHL. Ese backfill filtró por `estado=eq.cliente` y no tocó ningún OG — pero
// reactivar a uno, o ampliar el backfill, los mete en la audiencia sin que
// salte nada. Aquí la exclusión pasa a ser una regla que se puede leer, en
// vez de un efecto lateral de tener los datos incompletos.
// ============================================================
import { excluidoDeAvisos, filtrarAudiencia } from "../recurrentes";

describe("excluidoDeAvisos — el cohorte OG no recibe avisos recurrentes", () => {
  it("un OG queda fuera", () => {
    expect(excluidoDeAvisos("OG")).toBe(true);
  });

  it("los tiers de pago entran", () => {
    for (const t of ["1000", "1500", "1800", "2000", "2500", "3000", "3500", "5000", "8000"]) {
      expect(excluidoDeAvisos(t)).toBe(false);
    }
  });

  it("sin tier conocido NO se excluye: la duda no puede callar un aviso", () => {
    // Un cliente de pago cuyo programa aún no está en la vista recibiría cero
    // avisos si la ausencia de dato se tratara como exclusión. El coste de
    // los dos errores no es simétrico: un OG de más molesta, un cliente de
    // pago de menos es un fallo de servicio.
    expect(excluidoDeAvisos(null)).toBe(false);
    expect(excluidoDeAvisos("")).toBe(false);
  });

  it("no se deja engañar por mayúsculas ni espacios", () => {
    expect(excluidoDeAvisos(" og ")).toBe(true);
    expect(excluidoDeAvisos("Og")).toBe(true);
  });
});

describe("filtrarAudiencia — aplica la regla a la lista entera", () => {
  const gente = [
    { id: "p1", nombre: "Ana" },
    { id: "p2", nombre: "OG Pepe" },
    { id: "p3", nombre: "Luis" },
  ];

  it("saca a los OG y deja al resto, en el mismo orden", () => {
    const r = filtrarAudiencia(gente, new Map([["p2", "OG"], ["p1", "3000"]]));
    expect(r.enviar.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("devuelve a los excluidos, para que se puedan contar y registrar", () => {
    // Si el filtro solo devolviera la lista buena, la exclusión sería otro
    // silencio. El cron tiene que poder decir "3 OG omitidos".
    const r = filtrarAudiencia(gente, new Map([["p2", "OG"]]));
    expect(r.excluidos.map((p) => p.id)).toEqual(["p2"]);
  });

  it("sin mapa de tiers no excluye a nadie", () => {
    const r = filtrarAudiencia(gente, new Map());
    expect(r.enviar).toHaveLength(3);
    expect(r.excluidos).toHaveLength(0);
  });
});
