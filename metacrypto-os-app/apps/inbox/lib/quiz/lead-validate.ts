// Funciones PURAS para que los tests no necesiten Next: la ruta solo hace
// parsing, rate limit, honeypot y esta validación antes del RPC.
//
// El RPC revalida TODO contra la definición publicada; esta capa existe para
// rechazar basura temprano, con códigos HTTP honestos y sin filtrar detalles
// internos al cliente.

import { COUNTRIES } from "./lead-payload";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_ANSWERS = 32;

export type ValidationOk = { ok: true; payload: Record<string, unknown> };
export type ValidationError = { ok: false; reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVENTS = new Set(["started", "progress", "dropped", "completed"]);
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const E164_RE = /^\+[1-9][0-9]{7,14}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;

const optStr = (v: unknown, max: number): boolean =>
  v === null || v === undefined || isStr(v, max);

// Teléfono → E.164. El navegador manda "+<prefijo><número>" compuesto por el
// selector de país; acá se re-normaliza sin confiar en su formato (docs/09).
export function normalizePhoneE164(raw: string): string | null {
  let digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!digits.startsWith("+")) digits = `+${digits}`;
  return E164_RE.test(digits) ? digits : null;
}

function validateSource(source: unknown): string | null {
  if (!isObj(source)) return "bad_source";
  for (const key of Object.keys(source)) {
    if (!["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer"].includes(key)) return "unexpected_source_field";
  }
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    if (!optStr(source[key], 200)) return "bad_source";
  }
  if (!optStr(source.referrer, 500)) return "bad_source";
  return null;
}

function validateProgress(progress: unknown): string | null {
  if (!isObj(progress)) return "bad_progress";
  for (const key of Object.keys(progress)) {
    if (!["step_id", "step_index"].includes(key)) return "unexpected_progress_field";
  }
  if (!isStr(progress.step_id, 64)) return "bad_progress";
  const idx = progress.step_index;
  if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx > 99) return "bad_progress";
  return null;
}

function validateAnswers(answers: unknown): string | null {
  if (!Array.isArray(answers)) return "bad_answers";
  if (answers.length > MAX_ANSWERS) return "too_many_answers";
  for (const a of answers) {
    if (!isObj(a)) return "bad_answer";
    for (const key of Object.keys(a)) {
      if (!["question_id", "type", "question_text", "order", "answer_id", "answer_text", "value", "answered_at"].includes(key)) return "unexpected_answer_field";
    }
    if (!isStr(a.question_id, 64)) return "bad_answer";
    if (!isStr(a.type, 32)) return "bad_answer";
    if (!isStr(a.question_text, 500)) return "bad_answer";
    if (typeof a.order !== "number" || !Number.isInteger(a.order) || a.order < 0) return "bad_answer";
    if (!optStr(a.answer_id, 64)) return "bad_answer";
    if (!optStr(a.answer_text, 1000)) return "bad_answer";
    if (a.answered_at !== null && a.answered_at !== undefined && !(typeof a.answered_at === "string" && ISO_TS_RE.test(a.answered_at))) return "bad_answer";
  }
  return null;
}

function validateLead(lead: unknown): string | null {
  if (!isObj(lead)) return "bad_lead";
  for (const key of Object.keys(lead)) {
    if (!["name", "email", "phone", "country", "consent", "website"].includes(key)) return "unexpected_lead_field";
  }
  if (!isStr(lead.name, 120) || lead.name.trim() === "") return "bad_name";
  if (!isStr(lead.email, 254) || !EMAIL_RE.test(lead.email)) return "bad_email";
  if (!isStr(lead.phone, 20)) return "bad_phone";
  if (lead.country !== null && lead.country !== undefined && !/^[A-Za-z]{2}$/.test(String(lead.country))) return "bad_country";
  // Cross-check país↔prefijo (v3 M-01, barato): el funnel siempre manda ambos;
  // el servidor rechaza combinaciones incoherentes ("AR" con un +34…) aunque
  // la normalización E.164 completa queda para el endpoint + documentación.
  if (typeof lead.country === "string" && typeof lead.phone === "string" && lead.phone.startsWith("+")) {
    const pais = COUNTRIES.find((c) => c.code === String(lead.country).toUpperCase());
    if (pais && !String(lead.phone).startsWith(`+${pais.prefix}`)) return "country_phone_mismatch";
  }
  if (typeof lead.website === "string" && lead.website.trim() !== "") return "honeypot";
  const consent = lead.consent;
  if (!isObj(consent)) return "bad_consent";
  for (const key of Object.keys(consent)) {
    if (!["accepted", "version", "accepted_at"].includes(key)) return "unexpected_consent_field";
  }
  if (consent.accepted !== true) return "bad_consent";
  if (!isStr(consent.version, 64)) return "bad_consent";
  if (typeof consent.accepted_at === "string" && !ISO_TS_RE.test(consent.accepted_at)) return "bad_consent";
  return null;
}

function validateDiagnosis(diagnosis: unknown): string | null {
  if (!isObj(diagnosis)) return "bad_diagnosis";
  for (const key of Object.keys(diagnosis)) {
    if (!["version", "result"].includes(key)) return "unexpected_diagnosis_field";
  }
  if (!isStr(diagnosis.version, 64)) return "bad_diagnosis";
  // Snapshot de presentación: objeto acotado para que nadie persista megas.
  if (!isObj(diagnosis.result)) return "bad_diagnosis";
  if (JSON.stringify(diagnosis.result).length > 16000) return "diagnosis_too_large";
  return null;
}

// Validación cerrada del contrato completo. Devuelve {ok:true, payload} con
// el payload NORMALIZADO (email minúsculas, teléfono E.164) listo para el RPC.
export function validateLeadContract(input: unknown): ValidationOk | ValidationError {
  if (!isObj(input)) return { ok: false, reason: "not_an_object" };
  for (const key of Object.keys(input)) {
    if (!["schema_version", "quiz_version", "session_id", "event", "occurred_at", "source", "progress", "lead", "answers", "diagnosis", "client_context", "website"].includes(key)) return { ok: false, reason: "unexpected_field" };
  }
  if (typeof input.website === "string" && input.website.trim() !== "") return { ok: false, reason: "honeypot" };
  if (input.schema_version !== 1) return { ok: false, reason: "bad_schema_version" };
  if (!isStr(input.quiz_version, 64)) return { ok: false, reason: "bad_quiz_version" };
  if (!isStr(input.session_id, 36) || !UUID_RE.test(input.session_id)) return { ok: false, reason: "bad_session_id" };
  if (!isStr(input.event, 20) || !EVENTS.has(input.event)) return { ok: false, reason: "bad_event" };
  if (input.occurred_at !== undefined && !(typeof input.occurred_at === "string" && ISO_TS_RE.test(input.occurred_at))) return { ok: false, reason: "bad_occurred_at" };

  const event = input.event as string;
  if (input.source !== undefined && input.source !== null) {
    const err = validateSource(input.source);
    if (err) return { ok: false, reason: err };
  }
  const progressErr = validateProgress(input.progress);
  if (progressErr) return { ok: false, reason: progressErr };

  if (input.answers !== undefined && input.answers !== null) {
    const err = validateAnswers(input.answers);
    if (err) return { ok: false, reason: err };
  }

  let lead: Record<string, unknown> | null = null;
  if (event === "completed") {
    const err = validateLead(input.lead);
    if (err) return { ok: false, reason: err };
    lead = input.lead as Record<string, unknown>;
  } else if (input.lead !== null && input.lead !== undefined) {
    return { ok: false, reason: "lead_in_non_completed" };
  }

  if (input.diagnosis !== undefined && input.diagnosis !== null) {
    const err = validateDiagnosis(input.diagnosis);
    if (err) return { ok: false, reason: err };
  }
  if (event === "completed" && input.diagnosis === undefined) {
    // El snapshot es esperable pero no bloqueante: si falta, el envío igual
    // se persiste y el diagnóstico se recalcula para el reporte.
  }

  // Normalización server-side antes del RPC
  const payload: Record<string, unknown> = { ...input };
  delete payload.website;
  if (lead) {
    payload.lead = {
      ...lead,
      name: String(lead.name).trim(),
      email: String(lead.email).trim().toLowerCase(),
      phone: normalizePhoneE164(String(lead.phone)) ?? String(lead.phone),
    };
  }
  if (input.source === undefined) payload.source = null;
  return { ok: true, payload };
}

// Mapea el mensaje del RPC (prefijo quiz_leads/) a código HTTP sin filtrar
// detalles internos. Errores no previstos → 502 genérico (logs de servidor).
export function mapRpcError(message: string | null | undefined): { status: number; code: string } {
  const match = /quiz_leads\/([a-z_]+)/.exec(message ?? "");
  if (!match) return { status: 502, code: "internal_error" };
  const code = match[1];
  const bad422 = new Set([
    "pregunta_ajena", "opcion_ajena", "tipo_incorrecto",
    "allocation_incompleta", "allocation_invalida", "allocation_duplicada",
    "seleccion_vacia", "respuestas_duplicadas",
    "preguntas_requeridas_faltantes",
  ]);
  return { status: bad422.has(code) ? 422 : 400, code };
}
