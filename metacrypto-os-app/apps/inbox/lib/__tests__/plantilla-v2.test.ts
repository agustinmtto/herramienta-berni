import { describe, it, expect } from "vitest";
import { PLANTILLA_VENTA_NUEVA_V2, BLOQUE_FIRMA } from "../contratos/plantilla-v2";
import { PLANTILLAS } from "../contratos/plantillas";

describe("plantilla v2 — lo que Paula y Milo cerraron el 14-sep", () => {
  it("la cláusula 1 sale del catálogo, no de números a mano", () => {
    expect(PLANTILLA_VENTA_NUEVA_V2).toContain("{{prestaciones}}");
    expect(PLANTILLA_VENTA_NUEVA_V2).not.toMatch(/4 consultorías/);
    expect(PLANTILLA_VENTA_NUEVA_V2).not.toMatch(/1 sesión de consultoría/);
  });

  it("no nombra a Manuel ni usa 'coach' ni 'mentoría'", () => {
    for (const t of [PLANTILLA_VENTA_NUEVA_V2, BLOQUE_FIRMA]) {
      expect(t).not.toMatch(/Manuel/);
      expect(t).not.toMatch(/coach/i);
      expect(t).not.toMatch(/mentor[íi]a/i);
    }
  });

  it("el cuerpo NO lleva el bloque de firma: lo añade el renderer", () => {
    expect(PLANTILLA_VENTA_NUEVA_V2).not.toContain("Firmado electrónicamente");
    expect(PLANTILLA_VENTA_NUEVA_V2).not.toContain("![firma");
  });

  it("el bloque de firma lleva los cuatro placeholders y la firma del fundador", () => {
    for (const p of ["{{cliente_nombre}}", "{{fecha_firma}}", "{{firma_cliente}}", "{{firma_evidencia}}"]) {
      expect(BLOQUE_FIRMA).toContain(p);
    }
    expect(BLOQUE_FIRMA).toMatch(/^!\[[^\]]*\]\([^)]+\)$/m);
  });

  it("conserva las cláusulas 2 a 9 de la plantilla vigente, letra por letra", () => {
    // Los dos extremos del trozo que NO puede cambiar, y que existen en las dos
    // plantillas: el título de la cláusula 2 y la última frase de la 9.
    //
    // El borde de cierre es un marcador propio y no "donde empieza el bloque de
    // firma" a propósito: en la v2 ese bloque ya no está, así que un
    // `indexOf("Fecha de ")` devolvería -1 y `slice(x, -1)` recortaría el final
    // del cuerpo entero en vez de parar en un límite real. El test pasaría por
    // accidente y fallaría el día que alguien tocase un salto de línea.
    const ABRE = "### 2. Naturaleza del Servicio";
    const CIERRA = "expresamente todas sus cláusulas.";

    const clausulas2a9 = (t: string) => {
      const a = t.indexOf(ABRE);
      const b = t.indexOf(CIERRA);
      // Si un marcador desaparece, eso ya es el fallo: sin esto, el -1 volvería
      // a colarse por la puerta de atrás.
      expect(a, `no encuentro el inicio de la cláusula 2: "${ABRE}"`).toBeGreaterThan(-1);
      expect(b, `no encuentro el final de la cláusula 9: "${CIERRA}"`).toBeGreaterThan(-1);
      return t.slice(a, b + CIERRA.length);
    };

    expect(clausulas2a9(PLANTILLA_VENTA_NUEVA_V2)).toBe(clausulas2a9(PLANTILLAS.venta_nueva));
  });
});
