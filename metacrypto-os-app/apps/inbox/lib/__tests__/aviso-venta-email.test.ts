import { describe, it, expect } from "vitest";
import { emailAvisoVentaEquipo } from "../email-plantillas";

const ENLACE = "https://metacrypto-inbox.vercel.app/clientes/9f2c1e1e-79b0-4b7a-8f2e-2b1c2a0f0a11";

const CONFIRMAR = () =>
  emailAvisoVentaEquipo({ titulo: "🎉 Nuevo cierre", resumen: "Juan P. · closer: Alex", enlace: ENLACE });

describe("emailAvisoVentaEquipo — forma común", () => {
  it("trae asunto, html y texto, los tres con contenido", () => {
    const { asunto, html, texto } = CONFIRMAR();
    expect(asunto.trim().length).toBeGreaterThan(0);
    expect(html.trim().length).toBeGreaterThan(0);
    expect(texto.trim().length).toBeGreaterThan(0);
  });

  it("el asunto es el título del aviso, tal cual, sin saltos de línea", () => {
    const { asunto } = CONFIRMAR();
    expect(asunto).toBe("🎉 Nuevo cierre");
    expect(asunto).not.toMatch(/[\r\n]/);
  });

  it("el resumen aparece en el HTML y en el texto plano", () => {
    const { html, texto } = CONFIRMAR();
    expect(html).toContain("Juan P. · closer: Alex");
    expect(texto).toContain("Juan P. · closer: Alex");
  });

  it("la versión de texto no lleva etiquetas HTML", () => {
    expect(CONFIRMAR().texto).not.toMatch(/<[a-z/][^>]*>/i);
  });
});

describe("emailAvisoVentaEquipo — con enlace", () => {
  it("pinta el botón y el enlace en claro, en HTML y en texto", () => {
    const { html, texto } = CONFIRMAR();
    expect(html).toContain(ENLACE);
    expect(texto).toContain(ENLACE);
  });
});

describe("emailAvisoVentaEquipo — sin enlace", () => {
  // Mismo criterio que emailConfirmacionSesion: un botón a la nada (recipiente
  // sin PORTAL_BASE_URL o sin destino válido) es peor que ningún botón.
  const SIN_ENLACE = emailAvisoVentaEquipo({ titulo: "🎉 Nuevo cierre", resumen: "Juan P.", enlace: null });

  it("no pinta un botón vacío", () => {
    expect(SIN_ENLACE.html).not.toContain("<a href");
  });

  it("sigue enseñando el aviso igual", () => {
    expect(SIN_ENLACE.html).toContain("Juan P.");
    expect(SIN_ENLACE.texto).toContain("Juan P.");
  });
});

// Defensa en profundidad: `titulo`/`resumen` ya llegan sin monto ni tier
// desde `contenidoAvisoVenta` (lib/push.ts, cubierto en push.test.ts). Esto
// comprueba que el envoltorio del propio template tampoco los introduce.
describe("emailAvisoVentaEquipo — no filtra dinero ni credenciales", () => {
  it("no lleva importes en euros ni dólares", () => {
    const { asunto, html, texto } = CONFIRMAR();
    expect(`${asunto} ${html} ${texto}`).not.toMatch(/[€$]\s?\d|\d\s?(?:€|EUR|USD)/i);
  });

  it('no dice "contraseña" ni "password" ni "clave"', () => {
    const { asunto, html, texto } = CONFIRMAR();
    expect(`${asunto} ${html} ${texto}`.toLowerCase()).not.toMatch(/contrase|password|\bclave\b/);
  });
});
