// Tests unitarios de las libs del quiz portado (docs/11 Fase B).
// Port de test/unit.config-engine.test.mjs y test/security.test.mjs del
// prototipo (node:test → vitest) + tests nuevos del contrato (lead-payload,
// lead-validate). Los de integración contra la base están en lead-route.test.ts.

import { describe, expect, test } from "vitest";
import {
  buildAllocationResponse,
  progressFor,
  progressMessageFor,
  questions,
  wizardConfig,
} from "../question-config";
import { buildDiagnosis } from "../engine";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "../whatsapp";
import { isRateLimited, resetRateLimiter, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "../rate-limit";
import { composePhone, buildContractAnswers, buildQuizPayload } from "../lead-payload";
import { normalizePhoneE164, validateLeadContract, mapRpcError } from "../lead-validate";

// ── config ───────────────────────────────────────────────────────────────────
describe("config", () => {
  test("las 8 preguntas diagnósticas + contacto tienen IDs y etapas únicas", () => {
    expect(questions).toHaveLength(9);
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    expect(new Set(questions.map((q) => q.trackingId)).size).toBe(questions.length);
    expect(questions.slice(0, 8).map((q) => q.trackingId)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
  });

  test("los IDs estables de opciones son únicos dentro de cada pregunta y coinciden con la definición publicada", () => {
    // IDs esperados: los mismos que inserta 0068_quiz_leads.sql en
    // quiz_versiones.definicion. Si alguien cambia un ID acá sin publicar una
    // versión nueva, el backend rechazaría TODAS las respuestas (docs/11 §5).
    const esperados: Record<string, string[]> = {
      situation: ["exposure_full_unclear", "exposure_high_undeployed", "exposure_waiting_ready", "exposure_none"],
      challenge: ["pain_buy", "pain_timing", "pain_allocation", "pain_risk", "pain_plan", "pain_concentration"],
      capital: ["capital_lt_10k", "capital_10k_25k", "capital_25k_50k", "capital_50k_100k", "capital_100k_250k", "capital_gt_250k"],
      horizon: ["horizon_lt_6m", "horizon_6m_12m", "horizon_1_2y", "horizon_cycle_3y", "horizon_5y_plus"],
      drawdown: ["drawdown_sell_all", "drawdown_sell_partial", "drawdown_hold", "drawdown_buy_more"],
      influence: ["decision_own_system", "decision_advisor", "decision_social", "decision_news", "decision_price_reaction", "decision_none"],
      rules: ["rules_clear_system", "rules_inconsistent", "rules_improvising", "rules_none"],
    };
    for (const [id, options] of Object.entries(esperados)) {
      const question = questions.find((q) => q.id === id)!;
      expect(question.options!.map((o) => o.optionId)).toEqual(options);
    }
  });

  test("la composición expone cuatro activos y seis rangos", () => {
    const allocation = questions.find((q) => q.id === "allocation")!;
    expect(allocation.assets!.map((a) => a.id)).toEqual(["btc", "eth", "alts", "stables"]);
    for (const asset of allocation.assets!) expect(asset.ranges).toHaveLength(6);
  });

  test("la respuesta de composición mantiene el formato textual y los tags por activo", () => {
    const allocation = questions.find((q) => q.id === "allocation")!;
    const selections = Object.fromEntries(allocation.assets!.map((asset, index) => [asset.id, asset.ranges[index]]));
    const response = buildAllocationResponse(allocation, selections);
    expect(response!.answer).toBe("BTC: 0% · ETH: 1-10% · ALT: 10-25% · USD: 25-50%");
    expect(response!.tags).toEqual(["btc-zero", "eth-minimal", "alts-low", "stables-medium"]);
    expect(buildAllocationResponse(allocation, { btc: allocation.assets![0].ranges[0] })).toBeNull();
  });

  test("las opciones de challenge mapean a videos existentes", () => {
    const videoIds = new Set(wizardConfig.videos.items.map((v) => v.id));
    const challenge = questions.find((q) => q.id === wizardConfig.videoSelectorQuestionId)!;
    expect(videoIds.size).toBe(3);
    for (const option of challenge.options!) expect(videoIds.has(option.video!)).toBe(true);
  });

  test("la pregunta de contacto es la última", () => {
    expect(questions.at(-1)!.type).toBe("contact");
    expect(questions.at(-1)!.trackingId).toBe("contact");
  });

  test("la barra de progreso psicológica no cambió", () => {
    expect(Array.from({ length: 9 }, (_, i) => progressFor(i, 8))).toEqual([18, 34, 46, 52, 62, 73, 86, 93, 97]);
    expect(progressMessageFor(6, 8)).toBe("Casi terminamos");
    expect(progressMessageFor(7, 8)).toBe("Última pregunta");
  });

  test("el CTA final promete el video personalizado", () => {
    expect(wizardConfig.finalCta.whatsappNumber).toBe("5493585401429");
    expect(wizardConfig.finalCta.button).toBe("Recibir mi video por WhatsApp");
    expect(wizardConfig.finalCta.text).toMatch(/video.*WhatsApp/i);
    expect(wizardConfig.diagnosisDocument.disclaimer).toMatch(/no constituye asesoramiento financiero/i);
  });
});

// ── engine ───────────────────────────────────────────────────────────────────
describe("engine", () => {
  test("los rangos de capital desde 10k califican como caliente", () => {
    expect(buildDiagnosis([{ tags: ["hot-cap"] }]).hot).toBe(true);
    expect(buildDiagnosis([{ tags: ["cap-low"] }]).hot).toBe(false);
  });

  test("el diagnóstico produce las cuatro secciones canónicas", () => {
    const diagnosis = buildDiagnosis([{ tags: ["decision-social", "rules-none"], title: "x", answer: "y" }]);
    expect(diagnosis.sections.map((s) => s.title)).toEqual([
      "Tu situación real",
      "El desajuste principal",
      "La señal que no conviene ignorar",
      "Tu plan de acción",
    ]);
    const body = diagnosis.sections[1].body as { text: string };
    expect(body.text).toMatch(/sin un sistema estable/i);
  });

  test("el plan de acción es determinístico y nunca vacío", () => {
    const diagnosis = buildDiagnosis([{ tags: ["rules-none", "pain-risk", "decision-news"], title: "x", answer: "y" }]);
    expect(diagnosis.sections[3].items!.length).toBeGreaterThanOrEqual(3);
    expect(buildDiagnosis([]).sections[3].items!.length).toBeGreaterThanOrEqual(1);
  });
});

// ── engine: perfiles representativos (regresión) ─────────────────────────────
// Fija los 4 perfiles de la auditoría de readiness (docs/14) para que un cambio
// en las reglas no pueda entregar un diagnóstico contradictorio o vacío. Cada
// perfil mapea a los tags reales que producen sus respuestas de opción múltiple.
describe("engine — perfiles A–D", () => {
  const body = (d: ReturnType<typeof buildDiagnosis>, i: number) => d.sections[i].body as { kind: string; text: string };

  // Todo perfil debe ser coherente: 4 secciones, textos presentes y plan no vacío.
  const coherente = (d: ReturnType<typeof buildDiagnosis>) => {
    expect(d.sections).toHaveLength(4);
    expect(d.cta).toBe(true);
    // Sección 0 ("Tu situación real") es un resumen en string; las secciones 1 y 2
    // son {kind, text}; la 3 son pasos. Ningún texto puede quedar vacío/undefined.
    expect(typeof d.sections[0].body).toBe("string");
    expect((d.sections[0].body as string).length).toBeGreaterThan(0);
    expect(body(d, 1).text.length).toBeGreaterThan(0);
    expect(body(d, 2).text.length).toBeGreaterThan(0);
    expect(d.sections[3].items!.length).toBeGreaterThanOrEqual(1);
  };

  test("Perfil A — capital alto + mala gestión de riesgo → caliente y plan con regla de riesgo", () => {
    const d = buildDiagnosis([{ tags: ["hot-cap", "pain-risk", "rules-none"], title: "x", answer: "y" }]);
    coherente(d);
    expect(d.hot).toBe(true);
    expect(d.sections[3].items!.join(" ")).toMatch(/caer/i); // regla de riesgo
    expect(d.sections[3].items!.join(" ")).toMatch(/regla concreta/i); // falta de reglas
  });

  test("Perfil B — capital bajo + mucha exposición a altcoins → warning de concentración/altcoins", () => {
    const d = buildDiagnosis([{ tags: ["cap-low", "alts-dominant"], title: "x", answer: "y" }]);
    coherente(d);
    expect(d.hot).toBe(false);
    expect(body(d, 1).kind).toBe("warning");
    expect(body(d, 1).text).toMatch(/concentración/i);
    expect(body(d, 2).kind).toBe("warning");
    expect(body(d, 2).text).toMatch(/altcoins/i);
  });

  test("Perfil C — sin sistema de decisión → warning de desajuste 'sin sistema'", () => {
    const d = buildDiagnosis([{ tags: ["decision-none", "rules-none"], title: "x", answer: "y" }]);
    coherente(d);
    expect(d.hot).toBe(false);
    expect(body(d, 1).kind).toBe("warning");
    expect(body(d, 1).text).toMatch(/sin un sistema estable/i);
  });

  test("Perfil D — conservador + poca liquidez → señal de exposición y reserva de liquidez", () => {
    const d = buildDiagnosis([{ tags: ["exposure-full", "drawdown-reduce"], title: "x", answer: "y" }]);
    coherente(d);
    expect(d.hot).toBe(false);
    expect(body(d, 2).kind).toBe("info");
    expect(body(d, 2).text).toMatch(/completamente expuesto/i);
    expect(d.sections[3].items!.join(" ")).toMatch(/reserva de liquidez/i);
  });
});

// ── whatsapp ─────────────────────────────────────────────────────────────────
describe("whatsapp", () => {
  test("el mensaje incluye nombre, respuestas y video sin datos de contacto", () => {
    const message = buildWhatsAppMessage({
      name: "Ana",
      answers: [{ pregunta: "¿Qué te cuesta?", respuesta: "Gestionar el riesgo" }],
      requestedVideo: "Cómo invertir con reglas",
    });
    expect(message).toMatch(/Nombre: Ana/);
    expect(message).toMatch(/Gestionar el riesgo/);
    expect(message).toMatch(/video: Cómo invertir con reglas/i);
    expect(message).not.toMatch(/email|teléfono/i);
  });

  test("la URL apunta al número configurado y preserva acentos", () => {
    const url = buildWhatsAppUrl({ number: "+54 9 3585 401429", name: "Álvaro", answers: [] });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("wa.me");
    expect(parsed.pathname).toBe("/5493585401429");
    expect(parsed.searchParams.get("text")).toMatch(/Nombre: Álvaro/);
  });

  test("el destino es solo dígitos ante input hostil", () => {
    const url = buildWhatsAppUrl({ number: "+549&?foo=bar https://evil.com#x 115851234", name: "x", answers: [] });
    expect(new URL(url).origin).toBe("https://wa.me");
    expect(new URL(url).pathname.split("/")[1].replace(/\D/g, "")).toBe("549115851234".replace(/\D/g, ""));
  });

  test("el mensaje va completamente URL-encoded", () => {
    const url = buildWhatsAppUrl({
      number: "549115851234",
      name: 'Ana "<img onerror=alert(1)>" & ? # %\njavascript:',
      answers: [{ pregunta: "<script>alert(1)</script>?", respuesta: '<img src=x onerror="&?#">' }],
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://wa.me");
    expect(parsed.search).not.toMatch(/[\r\n]/);
    expect(parsed.searchParams.get("text")).toContain("Ana");
  });
});

// ── rate limit ───────────────────────────────────────────────────────────────
describe("rate limiter", () => {
  test("permite requests por debajo del máximo", () => {
    resetRateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(isRateLimited("unit-ip", { max: 3, windowMs: 1000 }).limited).toBe(false);
    }
  });

  test("bloquea al superar el máximo y recupera tras la ventana", async () => {
    resetRateLimiter();
    for (let i = 0; i < 3; i++) isRateLimited("burst-ip", { max: 3, windowMs: 50 });
    expect(isRateLimited("burst-ip", { max: 3, windowMs: 50 }).limited).toBe(true);
    await new Promise((r) => setTimeout(r, 70));
    expect(isRateLimited("burst-ip", { max: 3, windowMs: 50 }).limited).toBe(false);
  });

  test("el límite es por clave (por IP)", () => {
    resetRateLimiter();
    for (let i = 0; i < 3; i++) isRateLimited("ip-a", { max: 3, windowMs: 1000 });
    expect(isRateLimited("ip-a", { max: 3, windowMs: 1000 }).limited).toBe(true);
    expect(isRateLimited("ip-b", { max: 3, windowMs: 1000 }).limited).toBe(false);
  });

  test("exporta los valores por defecto", () => {
    expect(RATE_LIMIT_MAX).toBe(30); // v4 I13: subido de 10 para no bloquear el completed
    expect(RATE_LIMIT_WINDOW_MS).toBe(60000);
  });
});

// ── contrato: payload y validación ───────────────────────────────────────────
describe("lead-payload", () => {
  test("composePhone arma E.164 con prefijo y limpia el troncal argentino", () => {
    expect(composePhone("54", "9 3585 000000")).toBe("+5493585000000");
    expect(composePhone("54", "011 5555 5555")).toBe("+541155555555");
    expect(composePhone("34", "600 000 000")).toBe("+34600000000");
  });

  test("buildContractAnswers mapea con IDs estables y orders 1..n", () => {
    const answers = {
      situation: { answer: "a", tags: [], optionId: "exposure_none", answeredAt: "2026-09-21T10:00:00.000Z" },
      capital: { answer: "b", tags: [], optionId: "capital_10k_25k", optionValue: { currency: "USD", min: 10000, max: 25000, min_inclusive: true, max_inclusive: false }, answeredAt: "2026-09-21T10:01:00.000Z" },
      allocation: {
        answer: "BTC: 50-75%",
        tags: ["btc-high"],
        selections: {
          btc: { id: "high", label: "50-75%" },
          eth: { id: "zero", label: "0%" },
          alts: { id: "zero", label: "0%" },
          stables: { id: "zero", label: "0%" },
        },
        answeredAt: "2026-09-21T10:02:00.000Z",
      },
    };
    const contract = buildContractAnswers(answers, ["situation", "challenge", "allocation", "capital", "horizon", "drawdown", "influence", "rules"]);
    expect(contract).toHaveLength(3);
    expect(contract.find((c) => c.question_id === "situation")).toMatchObject({ answer_id: "exposure_none", order: 1, type: "single_choice" });
    expect(contract.find((c) => c.question_id === "capital")).toMatchObject({ answer_id: "capital_10k_25k", order: 4, type: "range", value: { currency: "USD", min: 10000, max: 25000 } });
    const allocation = contract.find((c) => c.question_id === "allocation")!;
    expect(allocation.type).toBe("allocation");
    expect(allocation.answer_id).toBeNull();
    expect(allocation.value).toEqual([
      { asset_id: "btc", level: "high" },
      { asset_id: "eth", level: "zero" },
      { asset_id: "alts", level: "zero" },
      { asset_id: "stables", level: "zero" },
    ]);
  });

  test("buildQuizPayload: completed lleva lead + consentimiento versionado + diagnóstico; started no lleva lead", () => {
    const base = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      source: { utm_source: "ig", utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, referrer: null },
      stepId: "start",
      stepIndex: 0,
      visited: ["start"],
    };
    const started = buildQuizPayload({ event: "started", ...base });
    expect(started).toMatchObject({ schema_version: 1, event: "started", quiz_version: "diagnostico-cripto-v1-a" });
    expect(started.lead).toBeUndefined();
    expect(started.answers).toEqual([]); // sin respuestas aún, pero el campo viaja

    const completed = buildQuizPayload({
      event: "completed",
      ...base,
      contact: { name: "Juan", email: "JUAN@x.com", phone: "+5493585000000", country: "AR", consent: true },
      answers: {},
      diagnosisSnapshot: { version: "diagnostico-v1", result: { sections: [] } },
    });
    expect(completed.lead).toMatchObject({ name: "Juan", email: "juan@x.com", phone: "+5493585000000", country: "AR" });
    expect((completed.lead as { consent: { accepted: boolean; version: string } }).consent).toMatchObject({ accepted: true, version: "contacto-v1" });
    expect(completed.diagnosis).toMatchObject({ version: "diagnostico-v1" });
  });
});

describe("lead-validate", () => {
  const validCompleted = {
    schema_version: 1,
    quiz_version: "diagnostico-cripto-v1-a",
    session_id: "68cf2bd5-7c57-4cd3-9548-9197de2ebc44",
    event: "completed",
    occurred_at: "2026-09-21T15:40:00.000Z",
    progress: { step_id: "result", step_index: 9 },
    lead: {
      name: "Juan",
      email: "juan@example.com",
      phone: "+5493585000000",
      country: "AR",
      consent: { accepted: true, version: "contacto-v1", accepted_at: "2026-09-21T15:39:40.000Z" },
    },
    answers: [
      {
        question_id: "situation",
        type: "single_choice",
        question_text: "¿Qué describe mejor tu situación?",
        order: 1,
        answer_id: "exposure_none",
        answer_text: "Estoy completamente fuera del mercado",
        value: null,
        answered_at: "2026-09-21T15:32:00.000Z",
      },
    ],
  };

  test("acepta un completed válido y normaliza email", () => {
    const r = validateLeadContract(validCompleted);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const lead = r.payload.lead as { email: string };
      expect(lead.email).toBe("juan@example.com");
    }
  });

  test("rechaza campo inesperado, sesión inválida, evento inválido y schema erróneo", () => {
    expect(validateLeadContract({ ...validCompleted, extra: 1 })).toMatchObject({ ok: false, reason: "unexpected_field" });
    expect(validateLeadContract({ ...validCompleted, session_id: "no" })).toMatchObject({ ok: false, reason: "bad_session_id" });
    expect(validateLeadContract({ ...validCompleted, event: "flash" })).toMatchObject({ ok: false, reason: "bad_event" });
    expect(validateLeadContract({ ...validCompleted, schema_version: 2 })).toMatchObject({ ok: false, reason: "bad_schema_version" });
  });

  test("completed sin lead o sin consentimiento explícito se rechaza", () => {
    const { lead, ...sinLead } = validCompleted as Record<string, unknown>;
    expect(validateLeadContract(sinLead)).toMatchObject({ ok: false, reason: "bad_lead" });
    expect(
      validateLeadContract({ ...validCompleted, lead: { ...(validCompleted.lead as object), consent: { accepted: false, version: "contacto-v1" } } })
    ).toMatchObject({ ok: false, reason: "bad_consent" });
  });

  test("started con lead se rechaza (lead_in_non_completed)", () => {
    expect(validateLeadContract({ ...validCompleted, event: "started" })).toMatchObject({ ok: false, reason: "lead_in_non_completed" });
  });

  test("honeypot: website rellenado devuelve honeypot (la ruta responde 200 falso)", () => {
    expect(validateLeadContract({ ...validCompleted, website: "http://spam" })).toMatchObject({ ok: false, reason: "honeypot" });
  });

  test("normalizePhoneE164 exige E.164 realista", () => {
    expect(normalizePhoneE164("+54 9 3585 000000")).toBe("+5493585000000");
    expect(normalizePhoneE164("5493585000000")).toBe("+5493585000000");
    expect(normalizePhoneE164("12345")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
  });

  test("mapRpcError traduce los códigos del RPC a HTTP honestos", () => {
    expect(mapRpcError("quiz_leads/pregunta_ajena: capital")).toEqual({ status: 422, code: "pregunta_ajena" });
    expect(mapRpcError("quiz_leads/contacto_incompleto")).toEqual({ status: 400, code: "contacto_incompleto" });
    expect(mapRpcError("otra cosa")).toEqual({ status: 502, code: "internal_error" });
    expect(mapRpcError(null)).toEqual({ status: 502, code: "internal_error" });
  });
});
