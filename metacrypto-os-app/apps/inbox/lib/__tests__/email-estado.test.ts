import { describe, it, expect } from "vitest";
import { estadoDesdeEvento, caducado } from "../email-estado";

// Los valores vienen de la documentación de Resend (event-types), no de
// memoria: sent · delivered · bounced · delivery_delayed · failed · opened ·
// clicked · complained · scheduled · received · suppressed.

describe("estadoDesdeEvento — traducir a lo que el OS necesita saber", () => {
  it("delivered es entrega confirmada", () => {
    expect(estadoDesdeEvento("delivered")).toBe("entregado");
  });

  it("opened y clicked también prueban la entrega", () => {
    // No se puede abrir lo que no llegó. Tratarlos como "pendiente" dejaría
    // filas colgadas para siempre en el caso MÁS favorable posible.
    expect(estadoDesdeEvento("opened")).toBe("entregado");
    expect(estadoDesdeEvento("clicked")).toBe("entregado");
  });

  it("bounced es rechazo permanente del servidor del cliente", () => {
    expect(estadoDesdeEvento("bounced")).toBe("rebotado");
  });

  it("complained NO se confunde con un rebote", () => {
    // Llegó, y el cliente lo marcó como spam. Es lo contrario de un rebote
    // —la entrega funcionó— y para la reputación del dominio es la señal
    // MÁS grave que existe. Colapsarlo en "rebotado" perdería justo el dato
    // por el que hay que llamar a esa persona.
    expect(estadoDesdeEvento("complained")).toBe("quejado");
  });

  it("failed y suppressed son no-entrega, y son finales", () => {
    expect(estadoDesdeEvento("failed")).toBe("rechazado");
    // `suppressed` = Resend lo bloqueó, casi siempre porque esa dirección ya
    // rebotó antes. Nunca salió.
    expect(estadoDesdeEvento("suppressed")).toBe("rechazado");
  });

  it("sent, delivery_delayed y scheduled siguen pendientes", () => {
    for (const e of ["sent", "delivery_delayed", "scheduled"]) {
      expect(estadoDesdeEvento(e)).toBeNull();
    }
  });

  it("un evento que Resend invente mañana no cambia nada", () => {
    // Lista blanca: un valor desconocido deja la fila como estaba y se
    // vuelve a mirar. Adivinar sería peor.
    expect(estadoDesdeEvento("teleported")).toBeNull();
    expect(estadoDesdeEvento("")).toBeNull();
    expect(estadoDesdeEvento(null)).toBeNull();
  });

  it("no se deja engañar por el prefijo del webhook ni por mayúsculas", () => {
    expect(estadoDesdeEvento("email.delivered")).toBe("entregado");
    expect(estadoDesdeEvento("Delivered")).toBe("entregado");
  });
});

describe("caducado — dejar de preguntar por lo que ya no se puede saber", () => {
  const ahora = new Date("2026-09-10T12:00:00Z");

  it("una fila de hace una hora no está caducada", () => {
    expect(caducado("2026-09-10T11:00:00Z", ahora)).toBe(false);
  });

  it("a los tres días se deja de preguntar", () => {
    // El plan gratuito de Resend retiene 30 días, pero un correo que a los
    // tres días no ha resuelto no va a resolver. Seguir preguntando gasta
    // llamadas para siempre.
    expect(caducado("2026-09-06T12:00:00Z", ahora)).toBe(true);
  });

  it("justo en el límite todavía no caduca", () => {
    expect(caducado("2026-09-07T12:00:01Z", ahora)).toBe(false);
  });

  it("una fecha ilegible se trata como caducada, no como reciente", () => {
    // Si se tratara como reciente, esa fila se consultaría en cada pasada
    // para siempre. Caducar es el error barato.
    expect(caducado("no es una fecha", ahora)).toBe(true);
    expect(caducado(null, ahora)).toBe(true);
  });
});
