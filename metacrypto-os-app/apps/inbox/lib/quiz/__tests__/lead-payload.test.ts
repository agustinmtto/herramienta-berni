// Tests de las funciones PURAS del contrato del funnel (docs/11 §5): el
// armado del payload y sobre todo el componer del teléfono desde el selector
// de país — el bug que mandaba "+AR…" al servidor (auditoría v2 #2).

import { describe, expect, test } from "vitest";
import {
  COUNTRIES,
  composePhone,
  composePhonePorPais,
} from "@/lib/quiz/lead-payload";

describe("composePhonePorPais (teléfono del selector país+local → E.164)", () => {
  test("resuelve el PREFIJO desde el código, nunca compone con letras", () => {
    for (const pais of COUNTRIES) {
      const tel = composePhonePorPais(pais.code, "3585123456");
      expect(tel).not.toBeNull();
      expect(tel!).toMatch(/^\+[0-9]{8,15}$/);
      expect(tel!.startsWith(`+${pais.prefix}`)).toBe(true);
    }
  });

  test("Argentina deja el prefijo 54 y quita el 0 troncal", () => {
    expect(composePhonePorPais("AR", "01155554444")).toBe("+541155554444");
    expect(composePhonePorPais("AR", "3585123456")).toBe("+543585123456");
  });

  test("país desconocido → null (la UI pide reelegir país, el servidor igual revalida)", () => {
    expect(composePhonePorPais("XX", "1155554444")).toBeNull();
  });

  test("composePhone directo sigue aceptando prefijo (contrato legacy del helper)", () => {
    expect(composePhone("54", "3585123456")).toBe("+543585123456");
    expect(composePhone("1", "5551234567")).toBe("+15551234567");
  });
});
