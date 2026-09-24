// Tests de integraciÃ³n del mÃ³dulo de leads (docs/11 Â§2â€“Â§9) contra el Supabase
// LOCAL por PostgREST, igual que la app (service_role, solo servidor).
//
// Corren cuando la base local estÃ¡ arriba (docs/10) y se saltan solos si no
// lo estÃ¡ â€” igual que lib/__tests__/numero-emisor.test.ts salta lo que no
// encuentra. Nunca apuntan a producciÃ³n: la URL sale de apps/inbox/.env.local.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, test } from "vitest";

// â”€â”€ entorno local â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function loadEnvLocal(): Record<string, string> {
  try {
    const raw = readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8");
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

const ENV = loadEnvLocal();
const URL_BASE = process.env.SUPABASE_URL ?? ENV.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ENV.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? ENV.SUPABASE_ANON_KEY ?? "";
const HDRS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

let reachable = false;
// GUARDA ANTI-PRODUCCIÃ“N: los suites gated son destructivos (DELETE de filas
// de prueba). Solo corren contra el Supabase LOCAL â€” si alguien apunta
// SUPABASE_URL a otro entorno, se saltan con un aviso claro, jamÃ¡s corren.
const esLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/i.test(URL_BASE ?? "");
if (URL_BASE && KEY && !esLocal) {
  console.warn(`[quiz-leads-rpc] SUPABASE_URL no es local (${URL_BASE}): los tests de integraciÃ³n NO corren.`);
}
if (URL_BASE && KEY && esLocal) {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/`, { headers: HDRS });
    reachable = r.status < 500;
  } catch {
    reachable = false;
  }
}

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const QUIZ = "diagnostico-cripto-v1-a";
// VersiÃ³n de prueba (solo tests) con una pregunta multiple_choice: los huecos
// de selecciÃ³n vacÃ­a/ids duplicados son de la funciÃ³n genÃ©rica de validaciÃ³n
// y la versiÃ³n vigente no declara ese tipo.
const MC_VERSION = "quiz-leads-mc-test";
const SESSIONS: string[] = [];
const EMAILS: string[] = [];
const PROGRAMA_IDS: string[] = [];

function session(n: number): string {
  const id = `0000c0de-0000-4000-8000-${String(n).padStart(12, "0")}`;
  SESSIONS.push(id);
  return id;
}

function email(n: number): string {
  const e = `quiz-rpc-${n}@test.local`;
  EMAILS.push(e);
  return e;
}

function payload(partial: Record<string, unknown>) {
  return { schema_version: 1, quiz_version: QUIZ, ...partial };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: HDRS,
    body: JSON.stringify(args),
  });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, body };
}

async function rest(method: string, table: string, query: string, json?: unknown) {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?${query}`, {
    method,
    headers: { ...HDRS, Prefer: "return=representation" },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, body };
}

async function envio(sessionId: string) {
  const r = await rest("GET", "diagnostico_envios", `session_id=eq.${sessionId}&select=*`);
  return r.body?.[0] ?? null;
}

// Respuestas mÃ­nimas que satisfacen las 8 preguntas requeridas de la versiÃ³n
// vigente; el rango de capital queda parametrizable por test.
function respuestasCompletas(capitalAnswerId: string) {
  const capital = {
    capital_lt_10k: { min: 0, max: 10000 },
    capital_10k_25k: { min: 10000, max: 25000 },
    capital_25k_50k: { min: 25000, max: 50000 },
    capital_50k_100k: { min: 50000, max: 100000 },
    capital_100k_250k: { min: 100000, max: 250000 },
    capital_gt_250k: { min: 250000, max: null },
  }[capitalAnswerId]!;
  return [
    { question_id: "situation", type: "single_choice", question_text: "situaciÃ³n", order: 1, answer_id: "exposure_full_unclear", answer_text: "100% expuesto", value: null, answered_at: "2026-09-21T10:00:00Z" },
    { question_id: "challenge", type: "single_choice", question_text: "desafÃ­o", order: 2, answer_id: "pain_risk", answer_text: "Gestionar el riesgo", value: null, answered_at: "2026-09-21T10:01:00Z" },
    { question_id: "allocation", type: "allocation", question_text: "distribuciÃ³n", order: 3, answer_id: null, answer_text: "BTC: 50-75%", value: [{ asset_id: "btc", level: "high" }, { asset_id: "eth", level: "low" }, { asset_id: "alts", level: "minimal" }, { asset_id: "stables", level: "medium" }], answered_at: "2026-09-21T10:02:00Z" },
    { question_id: "capital", type: "range", question_text: "capital", order: 4, answer_id: capitalAnswerId, answer_text: "rango", value: { currency: "USD", ...capital, min_inclusive: true, max_inclusive: capital.max !== null }, answered_at: "2026-09-21T10:03:00Z" },
    { question_id: "horizon", type: "single_choice", question_text: "horizonte", order: 5, answer_id: "horizon_cycle_3y", answer_text: "ciclo completo", value: null, answered_at: "2026-09-21T10:04:00Z" },
    { question_id: "drawdown", type: "single_choice", question_text: "caÃ­da", order: 6, answer_id: "drawdown_hold", answer_text: "mantengo", value: null, answered_at: "2026-09-21T10:05:00Z" },
    { question_id: "influence", type: "single_choice", question_text: "influencia", order: 7, answer_id: "decision_own_system", answer_text: "reglas propias", value: null, answered_at: "2026-09-21T10:06:00Z" },
    { question_id: "rules", type: "single_choice", question_text: "reglas", order: 8, answer_id: "rules_clear_system", answer_text: "sistema claro", value: null, answered_at: "2026-09-21T10:07:00Z" },
  ];
}

function completedPayload(opts: { sessionId: string; email: string; capital: string; diagnosis?: boolean }) {
  return payload({
    session_id: opts.sessionId,
    event: "completed",
    occurred_at: "2026-09-21T10:08:00Z",
    source: { utm_source: "instagram", utm_medium: "organic", utm_campaign: "test", utm_content: null, utm_term: null, referrer: "https://instagram.com/" },
    progress: { step_id: "result", step_index: 11 },
    lead: {
      name: "Lead de prueba RPC",
      email: opts.email,
      phone: "+5493585000001",
      country: "AR",
      consent: { accepted: true, version: "contacto-v1", accepted_at: "2026-09-21T10:07:30Z" },
    },
    answers: respuestasCompletas(opts.capital),
    ...(opts.diagnosis ? { diagnosis: { version: "diagnostico-v1", result: { secciones: ["prueba"] } } } : {}),
  });
}

async function limpiar() {
  if (SESSIONS.length) {
    await rest("DELETE", "diagnostico_envios", `session_id=in.(${SESSIONS.join(",")})`);
  }
  // la versiÃ³n de prueba se elimina despuÃ©s de sus envÃ­os (FK de quiz_version_id)
  await rest("DELETE", "quiz_versiones", `codigo=eq.${MC_VERSION}`);
  if (PROGRAMA_IDS.length) {
    await rest("DELETE", "programas", `id=in.(${PROGRAMA_IDS.join(",")})`);
  }
  if (EMAILS.length) {
    await rest("DELETE", "personas", `email=in.(${EMAILS.map((e) => `"${e}"`).join(",")})`);
  }
}

// Clona la definiciÃ³n vigente, le agrega una pregunta multiple_choice y la
// publica como versiÃ³n de pruebas (estado active, mismo funnel).
async function crearVersionMultiChoice() {
  const src = await rest("GET", "quiz_versiones", `codigo=eq.${QUIZ}&select=funnel,definicion`);
  const def = src.body[0].definicion;
  def.questions.push({
    id: "extras", type: "multiple_choice", required: false,
    text: "Â¿QuÃ© te interesarÃ­a recibir?",
    options: [{ id: "mc_a", text: "OpciÃ³n A" }, { id: "mc_b", text: "OpciÃ³n B" }],
  });
  const r = await rest("POST", "quiz_versiones", "select=id", {
    codigo: MC_VERSION,
    funnel: src.body[0].funnel,
    variante: "control",
    version: 2,
    estado: "active",
    publicada_at: new Date().toISOString(),
    definicion: def,
  });
  if (r.status !== 201) throw new Error(`no se pudo publicar la versiÃ³n de pruebas: ${r.status} ${JSON.stringify(r.body)}`);
}

// â”€â”€ suite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const d = reachable || process.env.LEAD_TESTS_REQUIRE_DB === "1" ? describe : describe.skip;

d("quiz leads RPC (integraciÃ³n local, docs/11)", () => {
  beforeAll(async () => {
    // I12: en CI (LEAD_TESTS_REQUIRE_DB=1) la suite gated es OBLIGATORIA — si la
    // base local no está, falla en vez de omitirse (verde falso sin base).
    if (!reachable) {
      throw new Error("Supabase local no está disponible y LEAD_TESTS_REQUIRE_DB=1: la suite de integración no puede omitirse.");
    }
    await limpiar();
    await crearVersionMultiChoice();
  });

  afterAll(async () => {
    await limpiar();
  });

  test("la versiÃ³n vigente del quiz estÃ¡ publicada y activa", async () => {
    const r = await rest("GET", "quiz_versiones", `codigo=eq.${QUIZ}&select=codigo,estado,version`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].estado).toBe("active");
    expect(r.body[0].version).toBe(1);
  });

  test("completed crea envÃ­o + respuestas + persona lead con telÃ©fono NULL y flag caliente", async () => {
    const s = session(1);
    const r = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(1), capital: "capital_10k_25k", diagnosis: true }) });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.status).toBe("completed");

    const e = await envio(s);
    expect(e.estado).toBe("completed");
    expect(e.finished_at).not.toBeNull();
    expect(e.persona_id).not.toBeNull();
    expect(e.es_lead_caliente).toBe(true);
    expect(e.qualification_rule_version).toBe("hot-lead-v1");
    expect(e.capital_min_usd).toBe(10000);
    expect(e.capital_max_usd).toBe(25000);
    expect(e.utm_source).toBe("instagram");
    expect(e.diagnosis_version).toBe("diagnostico-v1");
    expect(e.diagnosis_result).toEqual({ secciones: ["prueba"] });
    expect(e.consentimiento_version).toBe("contacto-v1");

    const persona = await rest("GET", "personas", `id=eq.${e.persona_id}&select=estado,telefono_e164,email,nombre`);
    expect(persona.body[0].estado).toBe("lead");
    expect(persona.body[0].telefono_e164).toBeNull(); // docs/11 Â§2
    expect(persona.body[0].email).toBe("quiz-rpc-1@test.local");
    expect(persona.body[0].nombre).toBe("Lead de prueba RPC");

    const respuestas = await rest("GET", "diagnostico_respuestas", `envio_id=eq.${e.id}&select=question_id,question_order&order=question_order.asc`);
    expect(respuestas.body).toHaveLength(8);
    expect(respuestas.body[0].question_id).toBe("situation");
    expect(respuestas.body[7].question_id).toBe("rules");
  });

  test("capital bajo el umbral produce flag frÃ­o, no NULL ni verdadero", async () => {
    const s = session(2);
    const r = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(2), capital: "capital_lt_10k" }) });
    expect(r.status).toBe(200);
    const e = await envio(s);
    expect(e.es_lead_caliente).toBe(false);
    expect(e.capital_min_usd).toBe(0);
  });

  test("reintentar el mismo session_id no duplica ni re-crea persona", async () => {
    const s = session(3);
    const mail = email(3);
    const p1 = completedPayload({ sessionId: s, email: mail, capital: "capital_50k_100k" });
    const r1 = await rpc("registrar_diagnostico", { p_payload: p1 });
    const r2 = await rpc("registrar_diagnostico", { p_payload: p1 });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.submission_id).toBe(r1.body.submission_id);

    const envios = await rest("GET", "diagnostico_envios", `session_id=eq.${s}&select=id`);
    expect(envios.body).toHaveLength(1);
    const personas = await rest("GET", "personas", `email=eq.${mail}&select=id`);
    expect(personas.body).toHaveLength(1);
  });

  test("un beacon tardÃ­o no degrada un envÃ­o completed", async () => {
    const s = session(4);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(4), capital: "capital_100k_250k" }) });
    const r = await rpc("registrar_diagnostico", {
      p_payload: payload({ session_id: s, event: "dropped", occurred_at: "2026-09-21T11:00:00Z", progress: { step_id: "q5", step_index: 4 } }),
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("completed"); // devuelve el estado existente
    const e = await envio(s);
    expect(e.estado).toBe("completed");
    expect(e.dropped_at).toBeNull();
  });

  test("started â†’ progress â†’ dropped persiste el abandono sin persona", async () => {
    const s = session(5);
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) });
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "progress", occurred_at: "2026-09-21T09:01:00Z", progress: { step_id: "capital", step_index: 4 } }) });
    const r = await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "dropped", occurred_at: "2026-09-21T09:02:00Z", progress: { step_id: "capital", step_index: 4 } }) });
    expect(r.status).toBe(200);
    const e = await envio(s);
    expect(e.estado).toBe("dropped");
    expect(e.dropped_at).not.toBeNull();
    expect(e.last_step_id).toBe("capital");
    expect(e.persona_id).toBeNull();
    expect(e.es_lead_caliente).toBeNull();
  });

  test("dropped puede completarse despuÃ©s (y entonces sÃ­ crea persona)", async () => {
    const s = session(6);
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) });
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "dropped", occurred_at: "2026-09-21T09:01:00Z", progress: { step_id: "q2", step_index: 2 } }) });
    const r = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(6), capital: "capital_25k_50k" }) });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("completed");
    const e = await envio(s);
    expect(e.estado).toBe("completed");
    expect(e.persona_id).not.toBeNull();
  });

  test("validaciones: versiÃ³n desconocida, pregunta ajena, contacto incompleto, telÃ©fono invÃ¡lido", async () => {
    const s = session(7);
    const rVersion = await rpc("registrar_diagnostico", { p_payload: payload({ quiz_version: "no-existe", session_id: s, event: "started", progress: { step_id: "start", step_index: 0 } }) });
    expect(rVersion.status).toBeGreaterThanOrEqual(400);
    expect(rVersion.body.message).toContain("quiz_version_desconocida");

    const rPregunta = await rpc("registrar_diagnostico", {
      p_payload: payload({ session_id: session(8), event: "started", progress: { step_id: "start", step_index: 0 }, answers: [{ question_id: "pregunta_inexistente", type: "single_choice", question_text: "x", order: 1, answer_id: "y", answer_text: "y", value: null }] }),
    });
    expect(rPregunta.body.message).toContain("pregunta_ajena");

    const sinLead = completedPayload({ sessionId: session(9), email: email(9), capital: "capital_10k_25k" }) as Record<string, unknown>;
    delete sinLead.lead;
    const rContacto = await rpc("registrar_diagnostico", { p_payload: sinLead });
    expect(rContacto.body.message).toContain("contacto_incompleto");

    const malTel = completedPayload({ sessionId: session(10), email: email(10), capital: "capital_10k_25k" }) as Record<string, any>;
    malTel.lead.phone = "12345";
    const rTel = await rpc("registrar_diagnostico", { p_payload: malTel });
    expect(rTel.body.message).toContain("telefono_invalido");

    const sesionMala = await rpc("registrar_diagnostico", { p_payload: payload({ session_id: "no-es-uuid", event: "started", progress: { step_id: "start", step_index: 0 } }) });
    expect(sesionMala.status).toBeGreaterThanOrEqual(400);
  });

  test("dos sesiones simultÃ¡neas del mismo contacto crean UNA sola persona", async () => {
    const mail = email(20);
    const resultados = await Promise.all([
      rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: session(21), email: mail, capital: "capital_gt_250k" }) }),
      rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: session(22), email: mail, capital: "capital_gt_250k" }) }),
    ]);
    expect(resultados.every((r) => r.status === 200)).toBe(true);
    const personas = await rest("GET", "personas", `email=eq.${mail}&select=id`);
    expect(personas.body).toHaveLength(1);
    // el segundo envÃ­o reutiliza el lead del primero
    const e1 = await envio(sessionIds[21]);
    const e2 = await envio(sessionIds[22]);
    expect(e1.persona_id).not.toBeNull();
    expect(e2.persona_id).toBe(e1.persona_id);
  });

  test("vincular: mismo telÃ©fono â†’ ok; distinto â†’ rechaza sin confirmar y ok con confirmar (docs/11 Â§9.1)", async () => {
    const s = session(30);
    const mail = email(30);
    const alta = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_10k_25k" }) });
    expect(alta.status).toBe(200);
    const e = await envio(s);
    const leadId = e.persona_id as string;

    // cliente con telÃ©fono DISTINTO al del quiz (+5493585000001)
    const clienteEmail = mail.replace("quiz-rpc-", "cliente-");
    EMAILS.push(clienteEmail); // para el cleanup (evita 409 por telÃ©fono en re-runs)
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente final prueba", email: clienteEmail, telefono_e164: "+5491100009999", divisa_preferida: "USD" });
    expect(cliente.status).toBe(201);
    const clienteId = cliente.body[0].id;
    const programa = await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" });
    expect(programa.status).toBe(201);
    PROGRAMA_IDS.push(programa.body[0].id);

    // sin confirmar â†’ rechazo por telÃ©fonos distintos
    const v0 = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId });
    expect(v0.status).toBeGreaterThanOrEqual(400);
    expect(v0.body.message).toContain("telefono_no_coincide");

    // con confirmar â†’ pasa
    const v1 = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    expect(v1.status).toBe(200);
    expect(v1.body.envios_reasignados).toBeGreaterThanOrEqual(1);

    const eTras = await envio(s);
    expect(eTras.persona_id).toBe(clienteId);
    const leadTras = await rest("GET", "personas", `id=eq.${leadId}&select=estado,telefono_e164`);
    expect(leadTras.body[0].estado).toBe("archivado");
    expect(leadTras.body[0].telefono_e164).toBeNull();

    // auditorÃ­a: la vinculaciÃ³n quedÃ³ registrada con envio_ids y confirmado
    const audit = await rest("GET", "auditoria", `entidad=eq.persona&accion=eq.vinculacion&entidad_id=eq.${leadId}&select=datos&order=created_at.desc&limit=1`);
    expect(audit.body[0].datos.envios_reasignados).toBeGreaterThanOrEqual(1);
    expect(audit.body[0].datos.confirmado).toBe(true);
    expect(audit.body[0].datos.telefono_lead).toBe("+5493585000001");

    // idempotente: repetir no rompe ni duplica
    const v2 = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    expect(v2.status).toBe(200);
    expect(v2.body.envios_reasignados).toBe(0);
  });

  test("vincular: MISMO telÃ©fono en quiz y cliente â†’ pasa sin confirmaciÃ³n", async () => {
    const s = session(31);
    const mail = email(31);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_25k_50k" }) });
    const e = await envio(s);
    const leadId = e.persona_id as string;
    const tel = e.telefono_e164_capturado as string;

    const clienteEmail = mail.replace("quiz-rpc-", "clientemismo-");
    EMAILS.push(clienteEmail);
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente mismo tel", email: clienteEmail, telefono_e164: tel, divisa_preferida: "USD" });
    const clienteId = cliente.body[0].id;
    PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);

    const v = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId });
    expect(v.status).toBe(200); // sin p_confirmar: telÃ©fonos iguales no friccionan
    expect(v.body.envios_reasignados).toBeGreaterThanOrEqual(1);
  });

  test("desvincular_lead revierte la vinculaciÃ³n exactamente (docs/11 Â§9.3)", async () => {
    const s = session(32);
    const mail = email(32);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_10k_25k" }) });
    const e = await envio(s);
    const leadId = e.persona_id as string;

    const clienteEmail = mail.replace("quiz-rpc-", "rollback-");
    EMAILS.push(clienteEmail);
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente rollback", email: clienteEmail, telefono_e164: "+5493585000002", divisa_preferida: "USD" });
    const clienteId = cliente.body[0].id;
    PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);

    await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    expect((await envio(s)).persona_id).toBe(clienteId);

    // rollback
    const d = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d.status).toBe(200);
    expect(d.body.envios_restaurados).toBeGreaterThanOrEqual(1);

    const eRestaurado = await envio(s);
    expect(eRestaurado.persona_id).toBe(leadId); // el envÃ­o volviÃ³ al temporal
    const leadRestaurado = await rest("GET", "personas", `id=eq.${leadId}&select=estado`);
    expect(leadRestaurado.body[0].estado).toBe("lead"); // el temporal volviÃ³ a lead

    // segunda desvinculaciÃ³n â†’ nada que revertir
    const d2 = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d2.status).toBeGreaterThanOrEqual(400);
    expect(d2.body.message).toContain("nada_que_desvincular");
  });

  // â•â•â• bloqueantes corregidos (docs/11 Â§5â€“Â§9) â€” validaciÃ³n de cada fix â•â•â•

  test("(B1) el capital se sella desde la DEFINICIÃ“N aunque el cliente mande importes falsos", async () => {
    const s = session(50);
    const p = completedPayload({ sessionId: s, email: email(50), capital: "capital_10k_25k", diagnosis: true }) as Record<string, any>;
    // answer_id VÃLIDO + value falsificado: el hueco que guardaba datos truchos.
    (p.answers as any[])[3].value = { currency: "USD", min: 999999, max: 5 };
    const r = await rpc("registrar_diagnostico", { p_payload: p });
    expect(r.status).toBe(200);

    const e = await envio(s);
    // importes persistidos = los de la opciÃ³n elejida, no los del cliente
    expect(e.capital_min_usd).toBe(10000);
    expect(e.capital_max_usd).toBe(25000);
    expect(e.es_lead_caliente).toBe(true); // el flag sigue siendo del answer_id validado

    const resp = await rest("GET", "diagnostico_respuestas", `envio_id=eq.${e.id}&question_id=eq.capital&select=answer_text,answer_value`);
    expect(resp.body[0].answer_text).toBe("Entre 10.000 y 25.000 USD"); // texto de la definiciÃ³n
    expect(resp.body[0].answer_value).toMatchObject({ min: 10000, max: 25000 });
  });

  test("(B4) una sesiÃ³n existente no se revalida contra otra versiÃ³n del quiz", async () => {
    const s = session(51);
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) });
    const r = await rpc("registrar_diagnostico", {
      p_payload: payload({ quiz_version: MC_VERSION, session_id: s, event: "progress", occurred_at: "2026-09-21T09:01:00Z", progress: { step_id: "situation", step_index: 1 } }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.message).toContain("version_conflictada");
    // el envÃ­o sigue en su versiÃ³n original, sin tocar
    const e = await envio(s);
    expect(e.estado).toBe("started");
    expect(e.quiz_version_id).not.toBeNull();
  });

  test("(B5) completed sin nombre, sin version de consentimiento o con fecha basura â†’ contacto_incompleto", async () => {
    const base = completedPayload({ sessionId: session(52), email: email(52), capital: "capital_10k_25k" });

    const sinNombre = JSON.parse(JSON.stringify(base));
    sinNombre.session_id = session(53);
    sinNombre.lead.name = "   ";
    const rNombre = await rpc("registrar_diagnostico", { p_payload: sinNombre });
    expect(rNombre.body.message).toContain("contacto_incompleto");

    const sinVersion = JSON.parse(JSON.stringify(base));
    sinVersion.session_id = session(54);
    sinVersion.lead.consent.version = null;
    const rVersion = await rpc("registrar_diagnostico", { p_payload: sinVersion });
    expect(rVersion.body.message).toContain("contacto_incompleto");

    const conFechaBasura = JSON.parse(JSON.stringify(base));
    conFechaBasura.session_id = session(55);
    conFechaBasura.lead.consent.accepted_at = "ayer";
    const rFecha = await rpc("registrar_diagnostico", { p_payload: conFechaBasura });
    expect(rFecha.body.message).toContain("contacto_incompleto");

    // (M9) la fecha de aceptaciÃ³n en el FUTURO tambiÃ©n es contrato invÃ¡lido
    const conFechaFutura = JSON.parse(JSON.stringify(base));
    conFechaFutura.session_id = session(66);
    conFechaFutura.lead.consent.accepted_at = "2099-01-01T00:00:00Z";
    const rFuturo = await rpc("registrar_diagnostico", { p_payload: conFechaFutura });
    expect(rFuturo.body.message).toContain("contacto_incompleto");
  });

  test("(B6) allocation con activos duplicados â†’ rechazada", async () => {
    const s = session(56);
    const p = completedPayload({ sessionId: s, email: email(56), capital: "capital_10k_25k" }) as Record<string, any>;
    // btc repetido, stables ausente: el largo "cuadra", la data no
    (p.answers as any[])[2].value = [{ asset_id: "btc", level: "high" }, { asset_id: "btc", level: "zero" }, { asset_id: "eth", level: "low" }, { asset_id: "alts", level: "medium" }];
    const r = await rpc("registrar_diagnostico", { p_payload: p });
    expect(r.body.message).toContain("allocation_duplicada");
  });

  test("(B6) multiple_choice vacÃ­a o con ids repetidos â†’ rechazada", async () => {
    const s1 = session(57);
    const vacia = payload({ quiz_version: MC_VERSION, session_id: s1, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "extras", step_index: 8 },
      answers: [{ question_id: "extras", type: "multiple_choice", question_text: "extras", order: 1, answer_id: null, answer_text: "", value: { ids: [] }, answered_at: null }] });
    const rVacia = await rpc("registrar_diagnostico", { p_payload: vacia });
    expect(rVacia.body.message).toContain("seleccion_vacia");

    const s2 = session(58);
    const repetida = payload({ quiz_version: MC_VERSION, session_id: s2, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "extras", step_index: 8 },
      answers: [{ question_id: "extras", type: "multiple_choice", question_text: "extras", order: 1, answer_id: null, answer_text: "", value: { ids: ["mc_a", "mc_a"] }, answered_at: null }] });
    const rRepetida = await rpc("registrar_diagnostico", { p_payload: repetida });
    expect(rRepetida.body.message).toContain("respuestas_duplicadas");
  });

  test("(B6) la misma pregunta repetida en el payload â†’ rechazada", async () => {
    const s = session(59);
    const base = respuestasCompletas("capital_10k_25k");
    base.push({ ...base[0], order: 9 }); // situation dos veces, ambas "vÃ¡lidas"
    const r = await rpc("registrar_diagnostico", {
      p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "result", step_index: 11 }, answers: base }),
    });
    expect(r.body.message).toContain("respuestas_duplicadas");
  });

  test("(B3) vincular sobre un lead ya vinculado NO devuelve ok con OtRO cliente", async () => {
    const s = session(60);
    const mail = email(60);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_10k_25k" }) });
    const e = await envio(s);
    const leadId = e.persona_id as string;

    const mkCliente = async (prefijo: string, tel: string) => {
      const correo = mail.replace("quiz-rpc-", prefijo);
      EMAILS.push(correo);
      const c = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: `Cliente ${prefijo}`, email: correo, telefono_e164: tel, divisa_preferida: "USD" });
      const id = c.body[0].id as string;
      PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: id, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);
      return id;
    };
    const clienteA = await mkCliente("vinc-a-", "+5491199990001");
    const clienteB = await mkCliente("vinc-b-", "+5491199990002");

    await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteA, p_confirmar: true });

    // el lead ya estÃ¡ archivado con A: pasar B no puede devolver ok
    const vConOtro = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteB, p_confirmar: true });
    expect(vConOtro.status).toBeGreaterThanOrEqual(400);
    expect(vConOtro.body.message).toContain("lead_vinculado_a_otro_cliente");

    // y el eco legÃ­timo del cliente correcto sigue siendo idempotente
    const vMismo = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteA, p_confirmar: true });
    expect(vMismo.status).toBe(200);
  });

  test("(B2) dos leads vinculados a un cliente: cada rollback revierte LA SUYA", async () => {
    const mkLead = async (n: number) => {
      const s = session(n);
      await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(n), capital: "capital_25k_50k" }) });
      return (await envio(s)).persona_id as string;
    };
    const leadA = await mkLead(61);
    const leadB = await mkLead(62);

    const mailCliente = email(70);
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente dos leads", email: mailCliente, telefono_e164: "+5491100008888", divisa_preferida: "USD" });
    const clienteId = cliente.body[0].id;
    PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);

    await rpc("vincular_lead_convertido", { p_lead_id: leadA, p_cliente_id: clienteId, p_confirmar: true });
    await rpc("vincular_lead_convertido", { p_lead_id: leadB, p_cliente_id: clienteId, p_confirmar: true });
    expect(await rest("GET", "diagnostico_envios", `persona_id=eq.${clienteId}&select=id`)).toBeTruthy();

    // primera desvinculaciÃ³n (la UI manda solo el cliente): revierte la ÃšLTIMA no revertida (lead B)
    const d1 = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d1.status).toBe(200);
    expect(d1.body.lead_id).toBe(leadB);

    // si el operador desvincula por lead (botÃ³n del detalle del envÃ­o), revierte a A y no a B
    const d2 = await rpc("desvincular_lead", { p_cliente_id: clienteId, p_lead_id: leadA });
    expect(d2.status).toBe(200);
    expect(d2.body.lead_id).toBe(leadA);

    // ya no queda ninguna pendiente para este cliente
    const d3 = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d3.status).toBeGreaterThanOrEqual(400);
    expect(d3.body.message).toContain("nada_que_desvincular");

    // y la auditorÃ­a de la vinculaciÃ³n de A quedÃ³ marcada como revertida
    const auditA = await rest("GET", "auditoria", `accion=eq.vinculacion&entidad_id=eq.${leadA}&select=datos&order=created_at.desc&limit=1`);
    expect(auditA.body[0].datos.revertido).toBe(true);
  });

  test("(Â§9.4) descartar_lead pasa el lead a 'descartado', no es vincular-able y audita", async () => {
    const s = session(63);
    const mail = email(63);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_lt_10k" }) });
    const leadId = ((await envio(s)).persona_id) as string;

    const d1 = await rpc("descartar_lead", { p_lead_id: leadId });
    expect(d1.status).toBe(200);
    expect(d1.body.estado).toBe("descartado");
    expect((await rest("GET", "personas", `id=eq.${leadId}&select=estado`)).body[0].estado).toBe("descartado");

    // idempotente
    const d2 = await rpc("descartar_lead", { p_lead_id: leadId });
    expect(d2.status).toBe(200);

    // fuera del ciclo comercial: no se vincula mÃ¡s
    const intento = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: session(64) });
    expect(intento.status).toBeGreaterThanOrEqual(400);
    expect(intento.body.message).toContain("lead_invalido");

    const audit = await rest("GET", "auditoria", `accion=eq.descarte&entidad_id=eq.${leadId}&select=datos`);
    expect(audit.body.length).toBeGreaterThanOrEqual(1);
  });

  test("(M8) retry/beacon tardÃ­o sobre un envÃ­o completed: devuelve el resultado sin revalidar", async () => {
    const s = session(65);
    const alta = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(65), capital: "capital_10k_25k" }) });
    expect(alta.status).toBe(200);
    expect(alta.body.submission_id).not.toBeNull();

    // progress con respuestas INVALIDAS sobre el completed: no revalida ni toca
    const progres = payload({ session_id: s, event: "progress", occurred_at: "2026-09-21T12:00:00Z", progress: { step_id: "rules", step_index: 7 },
      answers: [{ question_id: "pregunta_ajena", type: "single_choice", question_text: "x", order: 1, answer_id: "x", answer_text: "", value: null, answered_at: null }] });
    const rProgres = await rpc("registrar_diagnostico", { p_payload: progres });
    expect(rProgres.status).toBe(200);
    expect(rProgres.body.status).toBe("completed");
    expect(rProgres.body.submission_id).toBe(alta.body.submission_id);

    // retry de completed SIN consent (basura en el lead): idempotencia, no error
    const retry = completedPayload({ sessionId: s, email: email(65), capital: "capital_lt_10k" }) as Record<string, unknown>;
    delete retry.lead;
    const rRetry = await rpc("registrar_diagnostico", { p_payload: retry });
    expect(rRetry.status).toBe(200);
    expect(rRetry.body.status).toBe("completed");

    // y el envÃ­o quedÃ³ intacto: sigue siendo el original, sin degradar
    const e = await envio(s);
    expect(e.estado).toBe("completed");
    expect(e.capital_min_usd).toBe(10000); // el retry no pisÃ³ el capital con otra banda
  });

  test("(Â§9.4b) descartar un lead YA vinculado/archivado â†’ rechaza (no ok fingido)", async () => {
    const s = session(67);
    const mail = email(67);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_10k_25k" }) });
    const leadId = ((await envio(s)).persona_id) as string;

    const correoCliente = mail.replace("quiz-rpc-", "descarto-");
    EMAILS.push(correoCliente);
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente descarto", email: correoCliente, telefono_e164: "+5491100007777", divisa_preferida: "USD" });
    const clienteId = cliente.body[0].id;
    PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);

    await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    const intento = await rpc("descartar_lead", { p_lead_id: leadId });
    expect(intento.status).toBeGreaterThanOrEqual(400);
    expect(intento.body.message).toContain("lead_invalido");
  });

  test("(H-08) RLS: un JWT `authenticated` (anon) NO lee nada del funnel; helper sin EXECUTE", async () => {
    expect(ANON).toBeTruthy();
    const rAnon = await fetch(`${URL_BASE}/rest/v1/diagnostico_envios?select=id,telefono_e164_capturado`, {
      headers: { apikey: ANON },
    });
    expect(rAnon.status).toBe(200);
    expect((await rAnon.json() as { id: string }[]).length).toBe(0); // policies eliminadas: denegado por defecto

    // el helper de validaciÃ³n ya no es ejecutable por anon (antes PUBLIC)
    const rHelper = await fetch(`${URL_BASE}/rest/v1/rpc/validar_respuestas_quiz`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ p_definicion: {}, p_answers: [], p_exigir_todas: false }),
    });
    expect(rHelper.status).toBeGreaterThanOrEqual(400);
  });

  test("(H-04) la definiciÃ³n de una versiÃ³n PUBLICADA es inmutable", async () => {
    const r = await rest("GET", "quiz_versiones", `codigo=eq.${QUIZ}&select=id`);
    const id = r.body[0].id;
    // cambiar la definiciÃ³n de una versiÃ³n publicada â†’ rechazado
    const patch = await rest("PATCH", "quiz_versiones", `id=eq.${id}`, { definicion: { hack: true } });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    // y lo que sÃ­ se permite: transiciones de estado (pausar/reanudar)
    const pausa = await rest("PATCH", "quiz_versiones", `id=eq.${id}`, { estado: "paused" });
    expect(pausa.status).toBeLessThan(300);
    const reactiva = await rest("PATCH", "quiz_versiones", `id=eq.${id}`, { estado: "active" });
    expect(reactiva.status).toBe(200);
  });

  test("(H-05) consentimiento de versiÃ³n distinta de 'contacto-v1' â†’ contacto_incompleto", async () => {
    const s = session(71);
    const p = completedPayload({ sessionId: s, email: email(71), capital: "capital_10k_25k" }) as Record<string, any>;
    p.lead.consent.version = "promocion-2027-fantasma";
    const r = await rpc("registrar_diagnostico", { p_payload: p });
    expect(r.body.message).toContain("contacto_incompleto");
  });

  test("(H-07) rollback ESTRICTO: si un envÃ­o ya no estÃ¡ en el cliente, aborta sin mutar", async () => {
    const s = session(72);
    const mail = email(72);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_10k_25k" }) });
    const leadId = ((await envio(s)).persona_id) as string;

    // telÃ©fonos dinÃ¡micos: personas.telefono_e164 es UNIQUE global y los
    // re-runs no deben chocar con residuos de corridas previas
    const sufijo = String(Date.now()).slice(-6);
    const tel1 = `+54911${sufijo.padStart(8, "0")}`;
    const tel2 = `+54912${sufijo.padStart(8, "0")}`;
    const correoCliente = mail.replace("quiz-rpc-", "estricto-");
    EMAILS.push(correoCliente);
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente estricto", email: correoCliente, telefono_e164: tel1, divisa_preferida: "USD" });
    const clienteId = cliente.body[0].id;
    PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);

    const v = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    expect(v.status).toBe(200);

    // un envÃ­o fue movido POR FUERA del mÃ³dulo a otro cliente (la Ãºnica vÃ­a
    // posible: el CHECK impide NULL en completed; PATCH directo con service_role)
    const correoCliente2 = mail.replace("quiz-rpc-", "estricto2-");
    EMAILS.push(correoCliente2);
    const cliente2 = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente estricto 2", email: correoCliente2, telefono_e164: tel2, divisa_preferida: "USD" });
    const cliente2Id = cliente2.body[0].id;
    PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: cliente2Id, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);
    const movido = await rest("PATCH", "diagnostico_envios", `session_id=eq.${s}`, { persona_id: cliente2Id });
    expect(movido.status).toBeLessThan(300);

    const d = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d.status).toBeGreaterThanOrEqual(400);
    expect(d.body.message).toContain("rollback_incompleto");

    // el estado quedÃ³ INTACTO (no mutÃ³ nada antes de fallar)
    const eTras = await envio(s);
    expect(eTras.persona_id).toBe(cliente2Id);
    const leadTras = await rest("GET", "personas", `id=eq.${leadId}&select=estado`);
    expect(leadTras.body[0].estado).toBe("archivado"); // sin restaurar a ciegas

    // devuelto el envÃ­o a su lugar, el rollback procede completo
    await rest("PATCH", "diagnostico_envios", `session_id=eq.${s}`, { persona_id: clienteId });
    const d2 = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d2.status).toBe(200);
    expect((await envio(s)).persona_id).toBe(leadId);
    const audit = await rest("GET", "auditoria", `accion=eq.desvinculacion&entidad_id=eq.${leadId}&select=datos&order=created_at.desc&limit=1`);
    expect(typeof audit.body[0].datos.vinculacion_audit_id).toBe("string"); // UUID real, no el flag
  });

  test("(M-04) retry histÃ³rico sobre versiÃ³n PAUSADA sigue idempotente", async () => {
    const s = session(73);
    const alta = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(73), capital: "capital_10k_25k" }) });
    expect(alta.status).toBe(200);

    // pausar la versiÃ³n del quiz (la inmutabilidad permite transiciones de estado)
    await rest("PATCH", "quiz_versiones", `codigo=eq.${QUIZ}`, { estado: "paused" });
    try {
      // retry tardÃ­o del completed: el envÃ­o YA existe â†’ no exige versiÃ³n activa
      const retry = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(73), capital: "capital_10k_25k" }) });
      expect(retry.status).toBe(200);
      expect(retry.body.status).toBe("completed");
      // una sesiÃ³n NUEVA mientras estÃ© pausada â†’ rechazada honestamente
      const rNueva = await rpc("registrar_diagnostico", { p_payload: payload({ session_id: session(74), event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) });
      expect(rNueva.body.message ?? rNueva.body.message).toBeTruthy();
      expect(rNueva.body.message).toContain("quiz_version_desconocida");
    } finally {
      // SIEMPRE se reactiva: la versiÃ³n vigente es de todos los demÃ¡s tests
      await rest("PATCH", "quiz_versiones", `codigo=eq.${QUIZ}`, { estado: "active" });
    }
  });

  test("un envÃ­o completed no puede retroceder ni siquiera por escritura directa", async () => {
    const s = session(40);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(40), capital: "capital_10k_25k" }) });
    const r = await rest("PATCH", "diagnostico_envios", `session_id=eq.${s}`, { estado: "in_progress" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const e = await envio(s);
    expect(e.estado).toBe("completed");
  });

  test("I6: dropped sin progress previo guarda el paso exacto del abandono", async () => {
    const s = session(90);
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) });
    const r = await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "dropped", occurred_at: "2026-09-21T09:01:00Z", progress: { step_id: "challenge", step_index: 2 } }) });
    expect(r.status).toBe(200);
    const e = await envio(s);
    expect(e.estado).toBe("dropped");
    expect(e.last_step_id).toBe("challenge");
    expect(e.last_step_index).toBe(2);
  });

  test("I1: consentimiento anterior al inicio del recorrido se rechaza", async () => {
    const s = session(91);
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) });
    const p = completedPayload({ sessionId: s, email: email(91), capital: "capital_10k_25k" }) as Record<string, any>;
    p.lead.consent.accepted_at = "2026-09-20T09:00:00Z"; // un dia antes del inicio
    const r = await rpc("registrar_diagnostico", { p_payload: p });
    expect(r.body.message).toContain("contacto_incompleto");
  });

  test("I1: consentimiento posterior a la finalizacion se rechaza", async () => {
    const s = session(92);
    const p = completedPayload({ sessionId: s, email: email(92), capital: "capital_10k_25k" }) as Record<string, any>;
    p.lead.consent.accepted_at = "2026-09-21T10:20:00Z"; // 12 min despues del occurred_at (10:08)
    const r = await rpc("registrar_diagnostico", { p_payload: p });
    expect(r.body.message).toContain("contacto_incompleto");
  });

  test("I5: la auditoria de desvinculacion guarda revertido_de como UUID", async () => {
    const s = session(93);
    const mail = email(93);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_10k_25k" }) });
    const leadId = ((await envio(s)).persona_id) as string;
    const sufijo = String(Date.now()).slice(-6);
    const tel = `+54913${sufijo.padStart(8, "0")}`;
    const correoCliente = mail.replace("quiz-rpc-", "revd-");
    EMAILS.push(correoCliente);
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente revertido_de", email: correoCliente, telefono_e164: tel, divisa_preferida: "USD" });
    const clienteId = cliente.body[0].id;
    PROGRAMA_IDS.push((await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" })).body[0].id);
    await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    await rpc("desvincular_lead", { p_cliente_id: clienteId });
    const audit = await rest("GET", "auditoria", `accion=eq.desvinculacion&entidad_id=eq.${leadId}&select=datos&order=created_at.desc&limit=1`);
    const datos = audit.body[0].datos;
    expect(typeof datos.revertido_de).toBe("string");
    expect(datos.revertido_de).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("I4a: peticiones concurrentes con el mismo session_id y distinta version → una gana y la otra pierde limpio", async () => {
    const s = session(94);
    const [a, b] = await Promise.all([
      rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) }),
      rpc("registrar_diagnostico", { p_payload: payload({ quiz_version: MC_VERSION, session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) }),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses[0]).toBe(200);       // una creó la sesión
    expect(statuses[1]).toBeGreaterThanOrEqual(400); // la otra perdió limpio
    const e = await envio(s);
    expect(e).not.toBeNull();
    expect(e.quiz_version_id).not.toBeNull();
  });
});

// mapa auxiliar para el test de concurrencia
const sessionIds: Record<number, string> = {};
for (let n = 1; n <= 99; n++) sessionIds[n] = `0000c0de-0000-4000-8000-${String(n).padStart(12, "0")}`;
