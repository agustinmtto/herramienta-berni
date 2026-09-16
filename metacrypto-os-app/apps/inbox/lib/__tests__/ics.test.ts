import { describe, it, expect } from "vitest";
import { icsSesionRecurrente, DIAS_ICS, inicioLocalDeRegla } from "../ics";

// Investigación verificada el 3-sep-2026 (25 agentes). Cada bloque de aquí
// abajo corresponde a un hallazgo que, sin test, se cuela sin dar síntoma.

const BASE = {
  uid: "grupal-domingo@invierteconberni.com",
  resumen: "Sesión grupal con Berni",
  inicio: "2026-09-06T19:00:00",
  duracionMin: 60,
  zona: "Europe/Madrid",
  diaSemana: 0, // domingo
  organizador: "berni@hola.invierteconberni.com",
  dtstamp: "2026-09-03T21:00:00Z",
};

const ics = (extra: Record<string, unknown> = {}) => icsSesionRecurrente({ ...BASE, ...extra });

// Deshace el plegado de 75 octetos, como haría cualquier parser de verdad.
// Sin esto, un test de contenido falla en cuanto la propiedad es larga — y el
// fallo parece del generador cuando en realidad es del test.
const desplegado = (extra: Record<string, unknown> = {}) => ics(extra).replace(/\r\n /g, "");

describe("estructura mínima que exige el RFC 5545", () => {
  it("abre y cierra el VCALENDAR y el VEVENT", () => {
    const s = ics();
    for (const l of ["BEGIN:VCALENDAR", "END:VCALENDAR", "BEGIN:VEVENT", "END:VEVENT"]) {
      expect(s).toContain(l);
    }
  });

  it("lleva VERSION y PRODID, obligatorios a nivel VCALENDAR", () => {
    expect(ics()).toContain("VERSION:2.0");
    expect(ics()).toMatch(/PRODID:.+/);
  });

  it("lleva UID y DTSTAMP, obligatorios siempre", () => {
    const s = ics();
    expect(s).toContain("UID:grupal-domingo@invierteconberni.com");
    expect(s).toContain("DTSTAMP:20260903T210000Z");
  });

  it("lleva DTEND: sin él la sesión se pinta como un instante", () => {
    // Un VEVENT con DTSTART DATE-TIME y sin DTEND "ends on the same calendar
    // date and time of day" — duración cero, y desaparece de la franja.
    expect(ics()).toContain("DTEND;TZID=Europe/Madrid:20260906T200000");
  });
});

describe("🔴 la hora sale de DTSTART, así que cada serie es su propio evento", () => {
  it("el domingo usa BYDAY=SU y su hora", () => {
    const s = ics();
    expect(s).toContain("DTSTART;TZID=Europe/Madrid:20260906T190000");
    expect(s).toContain("RRULE:FREQ=WEEKLY;BYDAY=SU");
  });

  it("el miércoles a las 20:00 es OTRO evento, con su hora y su día", () => {
    // Este es el hallazgo caro: `BYDAY=SU,WE` heredaría las 19:00 del
    // DTSTART del domingo y pondría el miércoles una hora antes en 109
    // calendarios, sin un solo aviso al generar el fichero.
    const s = ics({
      uid: "grupal-miercoles@invierteconberni.com",
      inicio: "2026-09-09T20:00:00",
      diaSemana: 3,
    });
    expect(s).toContain("DTSTART;TZID=Europe/Madrid:20260909T200000");
    expect(s).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE");
  });

  it("nunca mete dos días en la misma regla", () => {
    expect(ics()).not.toMatch(/BYDAY=[A-Z]{2},/);
  });

  it("el mapa de días cubre la semana entera y sin repetidos", () => {
    expect(DIAS_ICS).toEqual(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
  });
});

describe("🔴 zona horaria: hora local con TZID, jamás UTC", () => {
  it("DTSTART va con TZID y sin sufijo Z", () => {
    const s = ics();
    expect(s).toMatch(/DTSTART;TZID=Europe\/Madrid:\d{8}T\d{6}(?!Z)/);
    expect(s).not.toMatch(/DTSTART[^\r\n]*Z\r/);
  });

  it("incluye el bloque VTIMEZONE de la zona", () => {
    // Con TZID pero sin VTIMEZONE, algunos clientes (Outlink de escritorio
    // el más notorio) no saben resolver la zona y caen a la del sistema.
    const s = ics();
    expect(s).toContain("BEGIN:VTIMEZONE");
    expect(s).toContain("TZID:Europe/Madrid");
    expect(s).toContain("BEGIN:DAYLIGHT");
    expect(s).toContain("BEGIN:STANDARD");
  });

  it("con UTC la recurrencia se clavaría al instante: no debe ocurrir", () => {
    // Con `DTSTART:...Z`, en España la sesión se vería a las 19:00 hasta el
    // cambio de hora y a las 18:00 después. El evento tiene que ser siempre
    // a las 19:00 locales.
    expect(ics()).not.toContain("DTSTART:2026");
  });
});

describe("eterno, como pidió Milo", () => {
  it("la recurrencia no tiene fin", () => {
    const s = ics();
    expect(s).not.toContain("UNTIL");
    expect(s).not.toContain("COUNT=");
  });
});

describe("poder cambiar la hora después sin duplicar el evento", () => {
  it("lleva SEQUENCE, que empieza en 0", () => {
    expect(ics()).toContain("SEQUENCE:0");
  });

  it("una revisión sube el SEQUENCE conservando el UID", () => {
    const s = ics({ secuencia: 3 });
    expect(s).toContain("SEQUENCE:3");
    expect(s).toContain("UID:grupal-domingo@invierteconberni.com");
  });

  it("el METHOD es REQUEST", () => {
    expect(ics()).toContain("METHOD:REQUEST");
  });

  it("puede cancelarse la serie entera", () => {
    const s = ics({ cancelar: true });
    expect(s).toContain("METHOD:CANCEL");
    expect(s).toContain("STATUS:CANCELLED");
  });
});

describe("formato: lo que rompe el fichero en silencio", () => {
  it("todas las líneas terminan en CRLF", () => {
    const s = ics();
    const sueltos = s.split("\r\n").filter((l) => l.includes("\n"));
    expect(sueltos).toEqual([]);
  });

  it("ninguna línea pasa de 75 octetos (plegado del RFC)", () => {
    const s = icsSesionRecurrente({
      ...BASE,
      resumen: "Sesión grupal con Berni ".repeat(12),
      descripcion: "Una descripción larguísima ".repeat(20),
    });
    for (const linea of s.split("\r\n")) {
      expect(Buffer.byteLength(linea, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("las líneas plegadas continúan con un espacio", () => {
    const s = icsSesionRecurrente({ ...BASE, resumen: "x".repeat(200) });
    const cont = s.split("\r\n").filter((l) => l.startsWith(" "));
    expect(cont.length).toBeGreaterThan(0);
  });

  it("escapa comas, puntos y coma y saltos de línea del texto", () => {
    // Sin escapar, una coma en el resumen parte la propiedad y el resto del
    // texto se interpreta como otro campo.
    const s = icsSesionRecurrente({
      ...BASE,
      resumen: "Sesión: cripto, bolsa; y más",
      descripcion: "linea1\nlinea2",
    });
    expect(s).toContain("cripto\\, bolsa\\; y más");
    expect(s).toContain("linea1\\nlinea2");
  });
});

describe("el resto del contenido", () => {
  it("el ORGANIZER va en el dominio desde el que se manda", () => {
    expect(ics()).toContain("ORGANIZER:mailto:berni@hola.invierteconberni.com");
  });

  it("el asistente entra como ATTENDEE cuando se le pasa", () => {
    const s = desplegado({ asistente: "milo@neureka.xyz" });
    expect(s).toMatch(/ATTENDEE[^\r\n]*RSVP=TRUE:mailto:milo@neureka\.xyz/);
  });

  it("el enlace de la videollamada va en LOCATION y en la descripción", () => {
    const s = ics({ enlace: "https://us06web.zoom.us/j/123" });
    expect(s).toContain("LOCATION:https://us06web.zoom.us/j/123");
  });

  it("lleva VALARM de 1 hora antes", () => {
    // Apple y Outlook lo respetan; Google usa el aviso por defecto del
    // usuario. Se incluye igual: no cuesta nada y sirve en dos de tres.
    const s = ics();
    expect(s).toContain("BEGIN:VALARM");
    expect(s).toContain("TRIGGER:-PT1H");
  });
});

// `proximaOcurrencia` devuelve un instante UTC; el .ics necesita la hora de
// pared de la zona. El puente entre los dos es donde se cuela un desfase de
// una hora en la semana del cambio horario.
describe("inicioLocalDeRegla — de instante UTC a hora de pared", () => {
  it("en horario de verano de Madrid", () => {
    // Domingo 6-sep-2026, 19:00 Madrid (CEST, +02) = 17:00Z.
    expect(inicioLocalDeRegla("2026-09-06T17:00:00.000Z", "19:00:00", "Europe/Madrid")).toBe(
      "2026-09-06T19:00:00",
    );
  });

  it("en horario de invierno, cuando el offset cambia", () => {
    // Domingo 1-nov-2026, 19:00 Madrid (CET, +01) = 18:00Z. Si el puente
    // usara un offset fijo, aquí saldría una hora bailada.
    expect(inicioLocalDeRegla("2026-11-01T18:00:00.000Z", "19:00:00", "Europe/Madrid")).toBe(
      "2026-11-01T19:00:00",
    );
  });

  it("conserva la hora de la regla, no la del instante", () => {
    // La hora de pared la manda la regla. El instante solo aporta la FECHA
    // de la próxima ocurrencia.
    expect(inicioLocalDeRegla("2026-09-09T18:00:00.000Z", "20:00:00", "Europe/Madrid")).toBe(
      "2026-09-09T20:00:00",
    );
  });

  it("sin hora no hay evento", () => {
    expect(inicioLocalDeRegla("2026-09-06T17:00:00.000Z", null, "Europe/Madrid")).toBeNull();
  });
});
