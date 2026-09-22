// Tests de integración de POST /api/lead (docs/11 Fase B): el handler real de
// Next contra el Supabase LOCAL, igual que quiz-leads-rpc.test.ts. Se saltan
// solos si la base no está arriba. La ruta se importa directo (route handler =
// función), sin levantar next dev; "server-only" queda stubbeado en
// vitest.config.ts para que lib/supabase sea importable desde node.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(join(__dirname, "..", "..", "..", ".env.local"), "utf8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}

// Las env las lee lib/supabase.ts AL IMPORTAR el módulo: hay que setearlas
// ANTES del import dinámico de la ruta. El límite propio evita que los otros
// tests de esta suite (mismo IP de test) agoten el rate limit real.
const ENV = loadEnvLocal();
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? ENV.SUPABASE_URL ?? "";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ENV.SUPABASE_SERVICE_ROLE_KEY ?? "";
process.env.LEAD_RATE_LIMIT_MAX = "1000";

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const { POST } = await import("@/app/api/lead/route");
const { resetRateLimiter } = await import("@/lib/quiz/rate-limit");

let reachable = false;
if (URL_BASE && KEY) {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    reachable = r.status < 500;
  } catch {
    reachable = false;
  }
}

const HOST = "localhost:3000";
const SESSIONS: string[] = [];
const EMAILS: string[] = [];

function session(n: number): string {
  const id = `0000bead-0000-4000-8000-${String(n).padStart(12, "0")}`;
  SESSIONS.push(id);
  return id;
}
function email(n: number): string {
  const e = `quiz-route-${n}@test.local`;
  EMAILS.push(e);
  return e;
}

function call(body: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
  // Host explícito: undici NO lo agrega solo y sameOrigin() lo necesita.
  return POST(
    new Request("http://localhost:3000/api/lead", {
      method: "POST",
      headers: { "content-type": "application/json", host: HOST, ...extraHeaders },
      body: JSON.stringify(body),
    })
  );
}

async function cleanup(): Promise<void> {
  if (SESSIONS.length) {
    await fetch(`${URL_BASE}/rest/v1/diagnostico_envios?session_id=in.(${SESSIONS.join(",")})`, {
      method: "DELETE",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
  }
  if (EMAILS.length) {
    await fetch(`${URL_BASE}/rest/v1/personas?email=in.(${EMAILS.map((e) => `"${e}"`).join(",")})`, {
      method: "DELETE",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
  }
}

const d = reachable ? describe : describe.skip;

d("POST /api/lead (integración local, docs/11 Fase B)", () => {
  beforeAll(() => {
    resetRateLimiter();
  });
  afterAll(async () => {
    await cleanup();
  });

  test("completed válido persiste y responde ok con submission_id", async () => {
    const payload = {
      schema_version: 1,
      quiz_version: "diagnostico-cripto-v1-a",
      session_id: session(1),
      event: "completed",
      occurred_at: "2026-09-21T15:40:00.000Z",
      source: { utm_source: "instagram", utm_medium: "organic", utm_campaign: "fase-b", utm_content: null, utm_term: null, referrer: "https://instagram.com/" },
      progress: { step_id: "result", step_index: 10 },
      lead: {
        name: "Lead de prueba ruta",
        email: email(1),
        phone: "+5493585000002",
        country: "AR",
        consent: { accepted: true, version: "contacto-v1", accepted_at: "2026-09-21T15:39:40.000Z" },
      },
      answers: [
        { question_id: "situation", type: "single_choice", question_text: "situación", order: 1, answer_id: "exposure_none", answer_text: "Fuera del mercado", value: null, answered_at: "2026-09-21T15:32:00.000Z" },
        { question_id: "challenge", type: "single_choice", question_text: "desafío", order: 2, answer_id: "pain_risk", answer_text: "Riesgo", value: null, answered_at: "2026-09-21T15:33:00.000Z" },
        { question_id: "allocation", type: "allocation", question_text: "distribución", order: 3, answer_id: null, answer_text: "BTC: 50-75%", value: [{ asset_id: "btc", level: "high" }, { asset_id: "eth", level: "zero" }, { asset_id: "alts", level: "zero" }, { asset_id: "stables", level: "zero" }], answered_at: "2026-09-21T15:34:00.000Z" },
        { question_id: "capital", type: "range", question_text: "capital", order: 4, answer_id: "capital_50k_100k", answer_text: "50-100k", value: { currency: "USD", min: 50000, max: 100000, min_inclusive: true, max_inclusive: false }, answered_at: "2026-09-21T15:35:00.000Z" },
        { question_id: "horizon", type: "single_choice", question_text: "horizonte", order: 5, answer_id: "horizon_cycle_3y", answer_text: "ciclo", value: null, answered_at: "2026-09-21T15:36:00.000Z" },
        { question_id: "drawdown", type: "single_choice", question_text: "caída", order: 6, answer_id: "drawdown_hold", answer_text: "mantener", value: null, answered_at: "2026-09-21T15:37:00.000Z" },
        { question_id: "influence", type: "single_choice", question_text: "influencia", order: 7, answer_id: "decision_own_system", answer_text: "sistema", value: null, answered_at: "2026-09-21T15:38:00.000Z" },
        { question_id: "rules", type: "single_choice", question_text: "reglas", order: 8, answer_id: "rules_clear_system", answer_text: "claras", value: null, answered_at: "2026-09-21T15:39:00.000Z" },
      ],
      diagnosis: { version: "diagnostico-v1", result: { hot: true, sections: [] } },
      client_context: { locale: "es-AR", timezone: "America/Argentina/Cordoba" },
    };

    const res = await call(payload);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; submission_id: string | null; persona_id?: unknown };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("completed");
    expect(body.submission_id).not.toBeNull();
    expect(body.persona_id).toBeUndefined(); // docs/11 §5: nunca exponer persona_id

    // Verificación de persistencia: caliente + contacto capturado
    const check = await fetch(`${URL_BASE}/rest/v1/diagnostico_envios?session_id=eq.${payload.session_id}&select=estado,es_lead_caliente,email_capturado,utm_campaign`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const rows = (await check.json()) as { estado: string; es_lead_caliente: boolean; email_capturado: string; utm_campaign: string }[];
    expect(rows[0]).toMatchObject({
      estado: "completed",
      es_lead_caliente: true, // capital 50k-100k > 10k
      email_capturado: email(1),
      utm_campaign: "fase-b",
    });
  });

  test("started sin lead persiste el inicio del recorrido", async () => {
    const res = await call({
      schema_version: 1,
      quiz_version: "diagnostico-cripto-v1-a",
      session_id: session(2),
      event: "started",
      progress: { step_id: "start", step_index: 0 },
      source: { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, referrer: null },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("started");
  });

  test("dropped por sendBeacon persiste el abandono", async () => {
    const res = await call({
      schema_version: 1,
      quiz_version: "diagnostico-cripto-v1-a",
      session_id: session(3),
      event: "dropped",
      progress: { step_id: "capital", step_index: 4 },
      answers: [
        { question_id: "situation", type: "single_choice", question_text: "situación", order: 1, answer_id: "exposure_none", answer_text: "Fuera", value: null, answered_at: "2026-09-21T15:32:00.000Z" },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("dropped");
  });

  test("honeypot responde 200 falso sin persistir nada", async () => {
    const res = await call({
      schema_version: 1,
      quiz_version: "diagnostico-cripto-v1-a",
      session_id: session(4),
      event: "started",
      progress: { step_id: "start", step_index: 0 },
      website: "http://bot.com",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ignored");

    const check = await fetch(`${URL_BASE}/rest/v1/diagnostico_envios?session_id=eq.${session(4)}&select=id`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    expect(await check.json()).toHaveLength(0);
  });

  test("payload inválido: rechazos honestos sin exponer detalles", async () => {
    const base = {
      schema_version: 1,
      quiz_version: "diagnostico-cripto-v1-a",
      session_id: session(5),
      event: "started",
      progress: { step_id: "start", step_index: 0 },
    };
    expect((await call({ ...base, campo_ajeno: 1 })).status).toBe(400);
    expect((await call({ ...base, session_id: "no-uuid" })).status).toBe(400);
    expect((await call({ ...base, quiz_version: "version-inexistente" })).status).toBe(400);
    expect((await call({ ...base, event: "reventado" })).status).toBe(400);
    expect((await call({ ...base, lead: { name: "x" } })).status).toBe(400);
    expect((await call("no es json")).status).toBe(400);
  });

  test("cuerpo demasiado grande → 413", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json", host: HOST },
        body: JSON.stringify({ data: "x".repeat(70 * 1024) }),
      })
    );
    expect(res.status).toBe(413);
  });

  test("origin cruzado → 403", async () => {
    const res = await call(
      {
        schema_version: 1,
        quiz_version: "diagnostico-cripto-v1-a",
        session_id: session(6),
        event: "started",
        progress: { step_id: "start", step_index: 0 },
      },
      { origin: "https://evil.example" }
    );
    expect(res.status).toBe(403);
  });

  // Gates del endurecimiento (paridad con el standalone): content-type 415 y
  // headers de tamaño chequiados antes de leer el body.
  test("content-type distinto de JSON → 415", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/lead", {
        method: "POST",
        headers: { "content-type": "text/plain", host: HOST },
        body: "{}",
      })
    );
    expect(res.status).toBe(415);
  });

  test("content-type ausente → 415", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/lead", {
        method: "POST",
        headers: { host: HOST },
        body: "{}",
      })
    );
    expect(res.status).toBe(415);
  });

  test("content-length mentiroso (header > 64 KB) → 413 antes de leer el body", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json", host: HOST, "content-length": String(128 * 1024) },
        body: "{}",
      })
    );
    expect(res.status).toBe(413);
  });

  test("los tipos del contrato del cliente coinciden con la definición publicada (regresión tipo_incorrecto)", async () => {
    // Regresión del bug real: el cliente mandaba capital como single_choice y
    // la definición publicada dice range → el RPC rechazaba TODO completed.
    // Este test compara SIEMPRE el cliente contra la definición de la base.
    const { buildContractAnswers } = await import("@/lib/quiz/lead-payload");
    const { questions } = await import("@/lib/quiz/question-config");
    const answers = Object.fromEntries(
      questions.filter((q) => q.type !== "contact").map((q) => [q.id, { answer: "x", tags: [] }])
    );
    const contract = buildContractAnswers(answers, questions.filter((q) => q.type !== "contact").map((q) => q.id));

    const defRes = await fetch(`${URL_BASE}/rest/v1/quiz_versiones?codigo=eq.diagnostico-cripto-v1-a&select=definicion`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const [version] = (await defRes.json()) as { definicion: { questions: { id: string; type: string }[] } }[];
    for (const answer of contract) {
      const defQuestion = version.definicion.questions.find((q) => q.id === answer.question_id);
      expect(defQuestion).toBeDefined();
      expect(answer.type).toBe(defQuestion!.type); // si difiere → tipo_incorrecto en el RPC
    }
  });

  test("origin propio pasa el chequeo", async () => {
    const res = await call(
      {
        schema_version: 1,
        quiz_version: "diagnostico-cripto-v1-a",
        session_id: session(7),
        event: "started",
        progress: { step_id: "start", step_index: 0 },
      },
      { origin: "http://localhost:3000" }
    );
    expect(res.status).toBe(200);
  });
});
