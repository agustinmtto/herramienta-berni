import { describe, it, expect } from "vitest";
import { homePath } from "../modulos";

describe("homePath", () => {
  it("acceso_total aterriza en el inicio", () => {
    expect(homePath({ acceso_total: true, modulos: null })).toBe("/");
  });

  it("un miembro limitado aterriza en su primera pantalla de trabajo", () => {
    expect(homePath({ acceso_total: false, modulos: ["sesiones", "ventas"] })).toBe("/sesiones");
  });

  // Antes devolvía "/login": sesión válida y ningún sitio al que ir (el
  // propio fichero lo documentaba como callejón). /novedades no exige
  // módulos — es la pantalla donde vive "Activar avisos del OS" y donde un
  // setter sin módulos por fin tiene algo que ver.
  it("un miembro activo sin módulos aterriza en /novedades, no en /login", () => {
    expect(homePath({ acceso_total: false, modulos: [] })).toBe("/novedades");
    expect(homePath({ acceso_total: false, modulos: null })).toBe("/novedades");
  });
});
