// Tests de integración del módulo de leads (docs/11 §2–§9) contra el Supabase
// LOCAL por PostgREST, igual que la app (service_role, solo servidor).
//
// Corren cuando la base local está arriba (docs/10) y se saltan solos si no
// lo está — igual que lib/__tests__/numero-emisor.test.ts salta lo que no
// encuentra. Nunca apuntan a producción: la URL sale de apps/inbox/.env.local.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, test } from "vitest";

// ── entorno local ────────────────────────────────────────────────────────────
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
const HDRS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

let reachable = false;
if (URL_BASE && KEY) {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/`, { headers: HDRS });
    reachable = r.status < 500;
  } catch {
    reachable = false;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
const QUIZ = "diagnostico-cripto-v1-a";
// Versión de prueba (solo tests) con una pregunta multiple_choice: los huecos
// de selección vacía/ids duplicados son de la función genérica de validación
// y la versión vigente no declara ese tipo.
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

// Respuestas mínimas que satisfacen las 8 preguntas requeridas de la versión
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
    { question_id: "situation", type: "single_choice", question_text: "situación", order: 1, answer_id: "exposure_full_unclear", answer_text: "100% expuesto", value: null, answered_at: "2026-09-21T10:00:00Z" },
    { question_id: "challenge", type: "single_choice", question_text: "desafío", order: 2, answer_id: "pain_risk", answer_text: "Gestionar el riesgo", value: null, answered_at: "2026-09-21T10:01:00Z" },
    { question_id: "allocation", type: "allocation", question_text: "distribución", order: 3, answer_id: null, answer_text: "BTC: 50-75%", value: [{ asset_id: "btc", level: "high" }, { asset_id: "eth", level: "low" }, { asset_id: "alts", level: "minimal" }, { asset_id: "stables", level: "medium" }], answered_at: "2026-09-21T10:02:00Z" },
    { question_id: "capital", type: "range", question_text: "capital", order: 4, answer_id: capitalAnswerId, answer_text: "rango", value: { currency: "USD", ...capital, min_inclusive: true, max_inclusive: capital.max !== null }, answered_at: "2026-09-21T10:03:00Z" },
    { question_id: "horizon", type: "single_choice", question_text: "horizonte", order: 5, answer_id: "horizon_cycle_3y", answer_text: "ciclo completo", value: null, answered_at: "2026-09-21T10:04:00Z" },
    { question_id: "drawdown", type: "single_choice", question_text: "caída", order: 6, answer_id: "drawdown_hold", answer_text: "mantengo", value: null, answered_at: "2026-09-21T10:05:00Z" },
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
  // la versión de prueba se elimina después de sus envíos (FK de quiz_version_id)
  await rest("DELETE", "quiz_versiones", `codigo=eq.${MC_VERSION}`);
  if (PROGRAMA_IDS.length) {
    await rest("DELETE", "programas", `id=in.(${PROGRAMA_IDS.join(",")})`);
  }
  if (EMAILS.length) {
    await rest("DELETE", "personas", `email=in.(${EMAILS.map((e) => `"${e}"`).join(",")})`);
  }
}

// Clona la definición vigente, le agrega una pregunta multiple_choice y la
// publica como versión de pruebas (estado active, mismo funnel).
async function crearVersionMultiChoice() {
  const src = await rest("GET", "quiz_versiones", `codigo=eq.${QUIZ}&select=funnel,definicion`);
  const def = src.body[0].definicion;
  def.questions.push({
    id: "extras", type: "multiple_choice", required: false,
    text: "¿Qué te interesaría recibir?",
    options: [{ id: "mc_a", text: "Opción A" }, { id: "mc_b", text: "Opción B" }],
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
  if (r.status !== 201) throw new Error(`no se pudo publicar la versión de pruebas: ${r.status} ${JSON.stringify(r.body)}`);
}

// ── suite ────────────────────────────────────────────────────────────────────
const d = reachable ? describe : describe.skip;

d("quiz leads RPC (integración local, docs/11)", () => {
  beforeAll(async () => {
    await limpiar();
    await crearVersionMultiChoice();
  });

  afterAll(async () => {
    await limpiar();
  });

  test("la versión vigente del quiz está publicada y activa", async () => {
    const r = await rest("GET", "quiz_versiones", `codigo=eq.${QUIZ}&select=codigo,estado,version`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].estado).toBe("active");
    expect(r.body[0].version).toBe(1);
  });

  test("completed crea envío + respuestas + persona lead con teléfono NULL y flag caliente", async () => {
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
    expect(persona.body[0].telefono_e164).toBeNull(); // docs/11 §2
    expect(persona.body[0].email).toBe("quiz-rpc-1@test.local");
    expect(persona.body[0].nombre).toBe("Lead de prueba RPC");

    const respuestas = await rest("GET", "diagnostico_respuestas", `envio_id=eq.${e.id}&select=question_id,question_order&order=question_order.asc`);
    expect(respuestas.body).toHaveLength(8);
    expect(respuestas.body[0].question_id).toBe("situation");
    expect(respuestas.body[7].question_id).toBe("rules");
  });

  test("capital bajo el umbral produce flag frío, no NULL ni verdadero", async () => {
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

  test("un beacon tardío no degrada un envío completed", async () => {
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

  test("started → progress → dropped persiste el abandono sin persona", async () => {
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

  test("dropped puede completarse después (y entonces sí crea persona)", async () => {
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

  test("validaciones: versión desconocida, pregunta ajena, contacto incompleto, teléfono inválido", async () => {
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

  test("dos sesiones simultáneas del mismo contacto crean UNA sola persona", async () => {
    const mail = email(20);
    const resultados = await Promise.all([
      rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: session(21), email: mail, capital: "capital_gt_250k" }) }),
      rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: session(22), email: mail, capital: "capital_gt_250k" }) }),
    ]);
    expect(resultados.every((r) => r.status === 200)).toBe(true);
    const personas = await rest("GET", "personas", `email=eq.${mail}&select=id`);
    expect(personas.body).toHaveLength(1);
    // el segundo envío reutiliza el lead del primero
    const e1 = await envio(sessionIds[21]);
    const e2 = await envio(sessionIds[22]);
    expect(e1.persona_id).not.toBeNull();
    expect(e2.persona_id).toBe(e1.persona_id);
  });

  test("vincular: mismo teléfono → ok; distinto → rechaza sin confirmar y ok con confirmar (docs/11 §9.1)", async () => {
    const s = session(30);
    const mail = email(30);
    const alta = await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: mail, capital: "capital_10k_25k" }) });
    expect(alta.status).toBe(200);
    const e = await envio(s);
    const leadId = e.persona_id as string;

    // cliente con teléfono DISTINTO al del quiz (+5493585000001)
    const clienteEmail = mail.replace("quiz-rpc-", "cliente-");
    EMAILS.push(clienteEmail); // para el cleanup (evita 409 por teléfono en re-runs)
    const cliente = await rest("POST", "personas", "select=id", { estado: "cliente", nombre: "Cliente final prueba", email: clienteEmail, telefono_e164: "+5491100009999", divisa_preferida: "USD" });
    expect(cliente.status).toBe(201);
    const clienteId = cliente.body[0].id;
    const programa = await rest("POST", "programas", "select=id", { persona_id: clienteId, tier: "3000", motivo: "nueva_venta", fecha_inicio: "2026-09-01", monto: 3000, divisa: "EUR" });
    expect(programa.status).toBe(201);
    PROGRAMA_IDS.push(programa.body[0].id);

    // sin confirmar → rechazo por teléfonos distintos
    const v0 = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId });
    expect(v0.status).toBeGreaterThanOrEqual(400);
    expect(v0.body.message).toContain("telefono_no_coincide");

    // con confirmar → pasa
    const v1 = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    expect(v1.status).toBe(200);
    expect(v1.body.envios_reasignados).toBeGreaterThanOrEqual(1);

    const eTras = await envio(s);
    expect(eTras.persona_id).toBe(clienteId);
    const leadTras = await rest("GET", "personas", `id=eq.${leadId}&select=estado,telefono_e164`);
    expect(leadTras.body[0].estado).toBe("archivado");
    expect(leadTras.body[0].telefono_e164).toBeNull();

    // auditoría: la vinculación quedó registrada con envio_ids y confirmado
    const audit = await rest("GET", "auditoria", `entidad=eq.persona&accion=eq.vinculacion&entidad_id=eq.${leadId}&select=datos&order=created_at.desc&limit=1`);
    expect(audit.body[0].datos.envios_reasignados).toBeGreaterThanOrEqual(1);
    expect(audit.body[0].datos.confirmado).toBe(true);
    expect(audit.body[0].datos.telefono_lead).toBe("+5493585000001");

    // idempotente: repetir no rompe ni duplica
    const v2 = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteId, p_confirmar: true });
    expect(v2.status).toBe(200);
    expect(v2.body.envios_reasignados).toBe(0);
  });

  test("vincular: MISMO teléfono en quiz y cliente → pasa sin confirmación", async () => {
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
    expect(v.status).toBe(200); // sin p_confirmar: teléfonos iguales no friccionan
    expect(v.body.envios_reasignados).toBeGreaterThanOrEqual(1);
  });

  test("desvincular_lead revierte la vinculación exactamente (docs/11 §9.3)", async () => {
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
    expect(eRestaurado.persona_id).toBe(leadId); // el envío volvió al temporal
    const leadRestaurado = await rest("GET", "personas", `id=eq.${leadId}&select=estado`);
    expect(leadRestaurado.body[0].estado).toBe("lead"); // el temporal volvió a lead

    // segunda desvinculación → nada que revertir
    const d2 = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d2.status).toBeGreaterThanOrEqual(400);
    expect(d2.body.message).toContain("nada_que_desvincular");
  });

  // ═══ bloqueantes corregidos (docs/11 §5–§9) — validación de cada fix ═══

  test("(B1) el capital se sella desde la DEFINICIÓN aunque el cliente mande importes falsos", async () => {
    const s = session(50);
    const p = completedPayload({ sessionId: s, email: email(50), capital: "capital_10k_25k", diagnosis: true }) as Record<string, any>;
    // answer_id VÁLIDO + value falsificado: el hueco que guardaba datos truchos.
    (p.answers as any[])[3].value = { currency: "USD", min: 999999, max: 5 };
    const r = await rpc("registrar_diagnostico", { p_payload: p });
    expect(r.status).toBe(200);

    const e = await envio(s);
    // importes persistidos = los de la opción elejida, no los del cliente
    expect(e.capital_min_usd).toBe(10000);
    expect(e.capital_max_usd).toBe(25000);
    expect(e.es_lead_caliente).toBe(true); // el flag sigue siendo del answer_id validado

    const resp = await rest("GET", "diagnostico_respuestas", `envio_id=eq.${e.id}&question_id=eq.capital&select=answer_text,answer_value`);
    expect(resp.body[0].answer_text).toBe("Entre 10.000 y 25.000 USD"); // texto de la definición
    expect(resp.body[0].answer_value).toMatchObject({ min: 10000, max: 25000 });
  });

  test("(B4) una sesión existente no se revalida contra otra versión del quiz", async () => {
    const s = session(51);
    await rpc("registrar_diagnostico", { p_payload: payload({ session_id: s, event: "started", occurred_at: "2026-09-21T09:00:00Z", progress: { step_id: "start", step_index: 0 } }) });
    const r = await rpc("registrar_diagnostico", {
      p_payload: payload({ quiz_version: MC_VERSION, session_id: s, event: "progress", occurred_at: "2026-09-21T09:01:00Z", progress: { step_id: "situation", step_index: 1 } }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.message).toContain("version_conflictada");
    // el envío sigue en su versión original, sin tocar
    const e = await envio(s);
    expect(e.estado).toBe("started");
    expect(e.quiz_version_id).not.toBeNull();
  });

  test("(B5) completed sin nombre, sin version de consentimiento o con fecha basura → contacto_incompleto", async () => {
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
  });

  test("(B6) allocation con activos duplicados → rechazada", async () => {
    const s = session(56);
    const p = completedPayload({ sessionId: s, email: email(56), capital: "capital_10k_25k" }) as Record<string, any>;
    // btc repetido, stables ausente: el largo "cuadra", la data no
    (p.answers as any[])[2].value = [{ asset_id: "btc", level: "high" }, { asset_id: "btc", level: "zero" }, { asset_id: "eth", level: "low" }, { asset_id: "alts", level: "medium" }];
    const r = await rpc("registrar_diagnostico", { p_payload: p });
    expect(r.body.message).toContain("allocation_duplicada");
  });

  test("(B6) multiple_choice vacía o con ids repetidos → rechazada", async () => {
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

  test("(B6) la misma pregunta repetida en el payload → rechazada", async () => {
    const s = session(59);
    const base = respuestasCompletas("capital_10k_25k");
    base.push({ ...base[0], order: 9 }); // situation dos veces, ambas "válidas"
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

    // el lead ya está archivado con A: pasar B no puede devolver ok
    const vConOtro = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: clienteB, p_confirmar: true });
    expect(vConOtro.status).toBeGreaterThanOrEqual(400);
    expect(vConOtro.body.message).toContain("lead_vinculado_a_otro_cliente");

    // y el eco legítimo del cliente correcto sigue siendo idempotente
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

    // primera desvinculación (la UI manda solo el cliente): revierte la ÚLTIMA no revertida (lead B)
    const d1 = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d1.status).toBe(200);
    expect(d1.body.lead_id).toBe(leadB);

    // si el operador desvincula por lead (botón del detalle del envío), revierte a A y no a B
    const d2 = await rpc("desvincular_lead", { p_cliente_id: clienteId, p_lead_id: leadA });
    expect(d2.status).toBe(200);
    expect(d2.body.lead_id).toBe(leadA);

    // ya no queda ninguna pendiente para este cliente
    const d3 = await rpc("desvincular_lead", { p_cliente_id: clienteId });
    expect(d3.status).toBeGreaterThanOrEqual(400);
    expect(d3.body.message).toContain("nada_que_desvincular");

    // y la auditoría de la vinculación de A quedó marcada como revertida
    const auditA = await rest("GET", "auditoria", `accion=eq.vinculacion&entidad_id=eq.${leadA}&select=datos&order=created_at.desc&limit=1`);
    expect(auditA.body[0].datos.revertido).toBe(true);
  });

  test("(§9.4) descartar_lead pasa el lead a 'descartado', no es vincular-able y audita", async () => {
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

    // fuera del ciclo comercial: no se vincula más
    const intento = await rpc("vincular_lead_convertido", { p_lead_id: leadId, p_cliente_id: session(64) });
    expect(intento.status).toBeGreaterThanOrEqual(400);
    expect(intento.body.message).toContain("lead_invalido");

    const audit = await rest("GET", "auditoria", `accion=eq.descarte&entidad_id=eq.${leadId}&select=datos`);
    expect(audit.body.length).toBeGreaterThanOrEqual(1);
  });

  test("un envío completed no puede retroceder ni siquiera por escritura directa", async () => {
    const s = session(40);
    await rpc("registrar_diagnostico", { p_payload: completedPayload({ sessionId: s, email: email(40), capital: "capital_10k_25k" }) });
    const r = await rest("PATCH", "diagnostico_envios", `session_id=eq.${s}`, { estado: "in_progress" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const e = await envio(s);
    expect(e.estado).toBe("completed");
  });
});

// mapa auxiliar para el test de concurrencia
const sessionIds: Record<number, string> = {};
for (let n = 1; n <= 99; n++) sessionIds[n] = `0000c0de-0000-4000-8000-${String(n).padStart(12, "0")}`;
