import { describe, it, expect } from "vitest";
import {
  normalizar, invitadosExternos, parsearResumen, clasificar, emparejar, duracionMin, aFila, resumenEnTexto,
  type ReunionFathom, type MiembroMin, type PersonaMin,
} from "../fathom";

// El equipo real, con los roles que hay en la base. El tipo de llamada sale de
// AQUÍ y no de una lista de correos en el código: el día que entre otro closer
// funciona solo.
const EQUIPO: MiembroMin[] = [
  { email: "berni@invierteconberni.com", rol: "coach" },
  { email: "iker@invierteconberni.com", rol: "coach" },
  { email: "manuel@invierteconberni.com", rol: "coach" },
  { email: "alejandro@invierteconberni.com", rol: "closer" },
  { email: "companera.personal@gmail.com", rol: "setter" },
  { email: "milo@neureka.xyz", rol: "admin" },
];

const PERSONAS: PersonaMin[] = [
  { id: "p1", nombre: "Christian Arenas", email: "christian@ejemplo.com" },
  { id: "p2", nombre: "Adrián Moreno Fonts", email: "adrian@ejemplo.com" },
  { id: "p3", nombre: "Juan Martin", email: null },
  { id: "p4", nombre: "Claudio mendonca", email: null },
];

function reunion(p: Partial<ReunionFathom> = {}): ReunionFathom {
  return {
    recording_id: 1,
    title: "Una llamada",
    recorded_by: { name: "Berni", email: "berni@invierteconberni.com", team: "Consultores" },
    calendar_invitees: [
      { name: "Berni", email: "berni@invierteconberni.com", is_external: false },
      { name: "Cliente", email: "christian@ejemplo.com", is_external: true },
    ],
    ...p,
  };
}

describe("normalizar", () => {
  it("quita tildes, signos y mayúsculas para poder comparar nombres a mano", () => {
    // El título lo escribe una persona en el calendario: llega "Adrián" y
    // "Adrian", "Mendonca" y "mendonca".
    expect(normalizar("Adrián Moreno Fonts")).toEqual(["adrian", "moreno", "fonts"]);
    expect(normalizar("Alicia Rodriguez O’Brien")).toEqual(["alicia", "rodriguez", "o", "brien"]);
    expect(normalizar(null)).toEqual([]);
  });
});

describe("invitadosExternos", () => {
  it("se fía de is_external, que lo dice Fathom, y no del dominio del correo", () => {
    expect(invitadosExternos(reunion())).toEqual([{ nombre: "Cliente", email: "christian@ejemplo.com" }]);
  });
  it("una reunión sin invitados no revienta", () => {
    expect(invitadosExternos(reunion({ calendar_invitees: null }))).toEqual([]);
  });
});

describe("clasificar", () => {
  it("un coach con alguien de fuera es una consultoría", () => {
    expect(clasificar(reunion(), EQUIPO)).toBe("servicio");
  });

  it("un closer con alguien de fuera es una llamada de venta", () => {
    const m = reunion({ recorded_by: { name: "Alex", email: "alejandro@invierteconberni.com" } });
    expect(clasificar(m, EQUIPO)).toBe("venta");
  });

  it("un setter también cuenta como venta", () => {
    const m = reunion({ recorded_by: { name: "Paula", email: "companera.personal@gmail.com" } });
    expect(clasificar(m, EQUIPO)).toBe("venta");
  });

  it("🔴 sin NINGÚN invitado externo es interna, aunque la grabe un coach", () => {
    // El caso real que obliga a esta regla: "FERNANDO REUSCH IVANNA", grabada
    // por el closer, once minutos, cero externos. El título lleva el nombre de
    // un cliente pero la llamada NO fue con él: era un debrief interno.
    // Si `interna` no ganara, se le colgaría una sesión a Fernando.
    const m = reunion({
      title: "FERNANDO REUSCH IVANNA",
      calendar_invitees: [{ email: "alejandro@invierteconberni.com", is_external: false }],
    });
    expect(clasificar(m, EQUIPO)).toBe("interna");
  });

  it("quien no está en el equipo es interna: no sabemos qué es, y no se adivina", () => {
    const m = reunion({ recorded_by: { name: "Alguien", email: "desconocido@otra.com" } });
    expect(clasificar(m, EQUIPO)).toBe("interna");
  });

  it("el correo se compara sin mayúsculas ni espacios", () => {
    const m = reunion({ recorded_by: { name: "Alex", email: "  Alejandro@InvierteConBerni.com " } });
    expect(clasificar(m, EQUIPO)).toBe("venta");
  });
});

describe("emparejar", () => {
  it("por correo del invitado externo: es una igualdad exacta y manda", () => {
    expect(emparejar(reunion(), PERSONAS)).toEqual({ personaId: "p1", via: "correo" });
  });

  it("el correo gana al título aunque el título apunte a otro cliente", () => {
    // Si los dos dicen cosas distintas, la que no escribió nadie a mano gana.
    const m = reunion({ title: "Juan Martin" });
    expect(emparejar(m, PERSONAS)).toEqual({ personaId: "p1", via: "correo" });
  });

  it("por título cuando el invitado externo no tiene correo conocido", () => {
    const m = reunion({
      title: "Sesión Juan Martin",
      calendar_invitees: [{ email: "otro@nadie.com", is_external: true }],
    });
    expect(emparejar(m, PERSONAS)).toEqual({ personaId: "p3", via: "titulo" });
  });

  it("🔴 un nombre suelto NO empareja: exige nombre y apellido", () => {
    // "Juan - Berni" es un título real. Sin esta regla se lo llevaría el primer
    // Juan de la base, que con 207 clientes es jugar a la lotería con el cupo
    // de consultorías de alguien.
    const m = reunion({
      title: "Juan - Berni",
      calendar_invitees: [{ email: "otro@nadie.com", is_external: true }],
    });
    expect(emparejar(m, PERSONAS)).toBeNull();
  });

  it("empareja aunque el título traiga tildes y el cliente no, o al revés", () => {
    const m = reunion({
      title: "Adrian Moreno Fonts",
      calendar_invitees: [{ email: "otro@nadie.com", is_external: true }],
    });
    expect(emparejar(m, PERSONAS)).toEqual({ personaId: "p2", via: "titulo" });
  });

  it("una weekly no empareja con nadie", () => {
    const m = reunion({ title: "WEEKLY METACRYPTO", calendar_invitees: [] });
    expect(emparejar(m, PERSONAS)).toBeNull();
  });
});

describe("duracionMin", () => {
  it("mide la grabación, que es lo que duró de verdad", () => {
    const m = reunion({
      recording_start_time: "2026-09-08T14:02:33Z",
      recording_end_time: "2026-09-08T15:09:30Z",
    });
    expect(duracionMin(m)).toBe(67);
  });

  it("descarta la 'Fathom Demo', que Fathom siembra con dos meses de duración", () => {
    const m = reunion({
      recording_start_time: "2021-09-16T00:00:00Z",
      recording_end_time: "2026-09-16T00:00:00Z",
    });
    expect(duracionMin(m)).toBeNull();
  });

  it("sin marcas de grabación devuelve null, no un cero que parezca real", () => {
    expect(duracionMin(reunion({ recording_start_time: null, recording_end_time: null }))).toBeNull();
  });
});

describe("aFila", () => {
  it("no decide ni el cliente ni el tipo: eso lo hace quien tiene el equipo delante", () => {
    const f = aFila(reunion()) as Record<string, unknown>;
    expect(f).not.toHaveProperty("persona_id");
    expect(f).not.toHaveProperty("tipo");
    expect(f.grabado_por_email).toBe("berni@invierteconberni.com");
  });

  it("cae a meeting_title y a scheduled_start_time cuando falta lo primero", () => {
    const f = aFila(reunion({
      title: null, meeting_title: "Título de respaldo",
      recording_start_time: null, scheduled_start_time: "2026-09-08T14:00:00Z",
    }));
    expect(f.titulo).toBe("Título de respaldo");
    expect(f.inicio).toBe("2026-09-08T14:00:00Z");
  });
});

describe("resumenEnTexto", () => {
  it("quita los enlaces con marca de tiempo y deja el texto legible", () => {
    // Fathom envuelve CADA frase en un enlace a su segundo de la grabación.
    // Dentro de Fathom sirve; pegado en las notas de una sesión es ilegible.
    const md = "## Puntos clave\n\n  - [**Iker se une al equipo** para gestionar España.](https://fathom.video/share/abc?tab=summary&timestamp=104.0)";
    expect(resumenEnTexto(md)).toBe("## Puntos clave\n\n  - **Iker se une al equipo** para gestionar España.");
  });

  it("un resumen vacío da una cadena vacía, no 'null'", () => {
    expect(resumenEnTexto(null)).toBe("");
  });
});

describe("parsearResumen", () => {
  it("reconoce títulos, viñetas y párrafos", () => {
    const b = parsearResumen("## Puntos clave\n\n  - Una cosa\n\nUn párrafo suelto");
    expect(b.map((x) => x.tipo)).toEqual(["titulo", "vineta", "parrafo"]);
    expect(b[0].texto[0].texto).toBe("Puntos clave");
  });

  it("saca la negrita de dentro de un enlace y conserva el salto a la grabación", () => {
    // Es la forma exacta de CADA viñeta de Fathom.
    const b = parsearResumen("- [**Iker se une** al equipo.](https://fathom.video/share/a?timestamp=104.0)");
    expect(b[0].texto[0]).toEqual({
      texto: "Iker se une", negrita: true, enlace: "https://fathom.video/share/a?timestamp=104.0",
    });
    expect(b[0].texto[1].texto).toBe(" al equipo.");
  });

  it("🔴 descarta un href que no sea http, para que no llegue un javascript: a un <a>", () => {
    const b = parsearResumen("- [pincha aquí](javascript:alert(1))");
    expect(b[0].texto[0]).toEqual({ texto: "pincha aquí", negrita: false, enlace: null });
  });

  it("el texto sin formato sobrevive entero", () => {
    const b = parsearResumen("Habló de **BTC** y de nada más");
    expect(b[0].texto.map((t) => t.texto).join("")).toBe("Habló de BTC y de nada más");
  });

  it("un resumen vacío da una lista vacía", () => {
    expect(parsearResumen(null)).toEqual([]);
  });
});
