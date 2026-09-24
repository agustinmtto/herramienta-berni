// Tests de las funciones PURAS del contrato del funnel (docs/11 §5): el
// armado del payload y sobre todo el componer del teléfono desde el selector
// de país — el bug que mandaba "+AR…" al servidor (auditoría v2 #2).

import { describe, expect, test } from "vitest";
import {
  COUNTRIES,
  buildQuizPayload,
  composePhone,
  composePhonePorPais,
  type SourceData,
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

  test("Argentina normaliza el prefijo 15 de celular a 9 y quita el 0 (I11)", () => {
    expect(composePhonePorPais("AR", "153585401429")).toBe("+5493585401429");
    expect(composePhonePorPais("AR", "03585401429")).toBe("+543585401429");
    expect(composePhonePorPais("AR", "93585401429")).toBe("+5493585401429");
  });
});

describe("buildQuizPayload (honeypot v4 M1)", () => {
  const source: SourceData = {
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, referrer: null,
  };

  test("el campo trampa website viaja dentro de lead en completed (llega al endpoint)", () => {
    const payload = buildQuizPayload({
      event: "completed",
      sessionId: "68cf2bd5-7c57-4cd3-9548-9197de2ebc44",
      source,
      stepId: "result",
      stepIndex: 11,
      visited: [],
      contact: {
        name: "Juan",
        email: "juan@example.com",
        phone: "+5493585000000",
        country: "AR",
        consent: true,
        website: "http://bot.com",
      },
      answers: {},
      diagnosisSnapshot: null,
    });
    const lead = payload.lead as { website?: string };
    expect(lead.website).toBe("http://bot.com");
  });
});
