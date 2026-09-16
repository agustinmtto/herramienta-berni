import { describe, it, expect } from "vitest";
import { interpretarErrorEnvio } from "../envio-error";

describe("interpretarErrorEnvio — fallos de Kapso (5xx)", () => {
  it("un 500 con cuerpo vacío dice que fue Kapso y que se reintente", () => {
    // El caso real del 6-ago: Kapso devolvió 500 sin cuerpo JSON porque su
    // base estaba en solo-lectura. El equipo veía "Envío falló (HTTP 500)".
    const { mensaje } = interpretarErrorEnvio(500, "");
    expect(mensaje).toMatch(/Kapso/);
    expect(mensaje).toMatch(/reintenta/i);
  });

  it("un 500 con HTML de Rails no muestra el HTML al equipo", () => {
    const html = "<!DOCTYPE html><html><body>We're sorry, but something went wrong.</body></html>";
    const { mensaje } = interpretarErrorEnvio(500, html);
    expect(mensaje).not.toMatch(/DOCTYPE|html/i);
    expect(mensaje).toMatch(/Kapso/);
  });

  it("tampoco culpa a la plantilla: /api/reply manda texto y adjuntos", () => {
    expect(interpretarErrorEnvio(500, "").mensaje).not.toMatch(/plantilla/i);
  });

  it("un 503 se trata igual que un 500", () => {
    expect(interpretarErrorEnvio(503, "").mensaje).toBe(interpretarErrorEnvio(500, "").mensaje);
  });

  it("un 5xx nunca se atribuye a la plantilla aunque traiga JSON", () => {
    // Un 5xx no es culpa de quien escribe: el consejo sigue siendo reintentar.
    const body = JSON.stringify({ error: { message: "Internal server error" } });
    expect(interpretarErrorEnvio(500, body).mensaje).toMatch(/reintenta/i);
  });
});

describe("interpretarErrorEnvio — rechazos de Meta (4xx)", () => {
  it("muestra el mensaje de Meta tal cual, que sí es accionable", () => {
    const body = JSON.stringify({
      error: { message: "Template name does not exist in the translation", code: 132001 },
    });
    expect(interpretarErrorEnvio(400, body).mensaje).toBe(
      "Template name does not exist in the translation",
    );
  });

  it("sin JSON legible, incluye el status y NO culpa a la plantilla", () => {
    // Este helper también lo usa /api/reply, que manda texto y adjuntos:
    // hablar de "la plantilla" ahí desorienta (pasó con ese cliente el 10-ago).
    const { mensaje } = interpretarErrorEnvio(400, "Bad Request");
    expect(mensaje).toMatch(/400/);
    expect(mensaje).not.toMatch(/plantilla/i);
  });

  it("lee el formato de error propio de Kapso, que es { error: \"texto\" }", () => {
    // Meta manda { error: { message } }; Kapso manda una cadena suelta.
    const body = JSON.stringify({ error: "Phone number is not registered." });
    expect(interpretarErrorEnvio(422, body).mensaje).toBe("Phone number is not registered.");
  });
});

describe("interpretarErrorEnvio — ventana de 24 h", () => {
  const kapso422 = JSON.stringify({
    error: "Cannot send non-template messages outside the 24-hour window.",
    next_steps: "Send a WhatsApp template message to reopen the session.",
  });

  it("reconoce el 422 con que Kapso corta antes de llegar a Meta", () => {
    // Caso real del 10-ago con ese cliente: Kapso ni siquiera llama a Meta, así que
    // el código 131047 nunca aparece y el inbox no ofrecía plantillas.
    const r = interpretarErrorEnvio(422, kapso422);
    expect(r.fueraDeVentana).toBe(true);
    expect(r.mensaje).toMatch(/plantilla/i);
  });

  it("sigue reconociendo el 131047 de Meta", () => {
    const body = JSON.stringify({ error: { message: "Message failed to send", code: 131047 } });
    expect(interpretarErrorEnvio(400, body).fueraDeVentana).toBe(true);
  });

  it("un rechazo cualquiera NO se marca como ventana", () => {
    const body = JSON.stringify({ error: { message: "Invalid parameter", code: 100 } });
    expect(interpretarErrorEnvio(400, body).fueraDeVentana).toBe(false);
  });

  it("una caída de Kapso tampoco es ventana", () => {
    expect(interpretarErrorEnvio(500, "").fueraDeVentana).toBe(false);
  });
});

describe("interpretarErrorEnvio — cuerpo crudo para los logs", () => {
  it("conserva el cuerpo tal cual para poder diagnosticar", () => {
    expect(interpretarErrorEnvio(500, "PG::ReadOnlySqlTransaction").crudo).toBe(
      "PG::ReadOnlySqlTransaction",
    );
  });

  it("marca explícitamente cuando el cuerpo viene vacío", () => {
    // Distinguir "vacío" de "no lo logueamos" ahorra la próxima investigación.
    expect(interpretarErrorEnvio(500, "   ").crudo).toBe("(cuerpo vacío)");
  });

  it("recorta cuerpos enormes para no inundar los logs", () => {
    const { crudo } = interpretarErrorEnvio(500, "x".repeat(2000));
    expect(crudo).toHaveLength(501); // 500 caracteres + el "…"
    expect(crudo.endsWith("…")).toBe(true);
  });
});
