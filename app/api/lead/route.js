import { NextResponse } from "next/server";

// Stub endpoint — docs/03 §2 (agnostic JSON). Logs to console for now;
// Supabase integration lands when the business repo is ready (roadmap Fase 1).
//
// Security hardening (docs/07 §5):
// - Body size cap to avoid oversized payloads (DoS / log flooding).
// - Strict JSON parse + shape validation: reject malformed input early.
// - No secrets handled or echoed back.
//
// Every accept/reject is terminal-logged with reason (traceability, docs/03 §6).

const MAX_BODY_BYTES = 64 * 1024;

const ts = () => new Date().toISOString().slice(11, 19);
const c = { dim: "\x1b[2m", gold: "\x1b[33m", green: "\x1b[32m", red: "\x1b[31m", reset: "\x1b[0m" };

function isValidLead(payload) {
  if (!payload || typeof payload !== "object") return "not_an_object";
  if (typeof payload.session_id !== "string" || payload.session_id.length > 100) return "bad_session_id";
  if (payload.signals && typeof payload.signals !== "object") return "bad_signals";
  if (payload.lead !== null && payload.lead !== undefined && typeof payload.lead !== "object") return "bad_lead";
  if (!Array.isArray(payload.answers)) return "bad_answers";
  if (payload.answers.length > 64) return "too_many_answers";
  for (const a of payload.answers) {
    if (!a || typeof a !== "object") return "bad_answer_item";
    if (typeof a.pregunta !== "string" || a.pregunta.length > 500) return "bad_pregunta";
    if (a.respuesta !== null && a.respuesta !== undefined && typeof a.respuesta !== "string") return "bad_respuesta";
  }
  return null;
}

export async function POST(request) {
  const start = Date.now();
  try {
    const length = Number(request.headers.get("content-length") || 0);
    const raw = await request.text();
    if (length > MAX_BODY_BYTES || raw.length > MAX_BODY_BYTES) {
      console.warn(`${c.red}[${ts()}] ✗ REJECTED lead: payload_too_large (${raw.length}b) from ${ip(request)}${c.reset}`);
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.warn(`${c.red}[${ts()}] ✗ REJECTED lead: invalid_json${c.reset}`);
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const reason = isValidLead(payload);
    if (reason) {
      console.warn(`${c.red}[${ts()}] ✗ REJECTED lead: invalid_payload (${reason})${c.reset}`);
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 422 });
    }

    const answers = payload.answers;
    const dropped = payload.signals && payload.signals.dropoff_question;
    const kind = payload.lead ? "COMPLETE" : "DROPOUT";
    const kindTag = payload.lead ? `${c.green}✓ ${kind}${c.reset}` : `${c.gold}⚠ ${kind}${c.reset}`;

    console.log(`${c.dim}[${ts()}]${c.reset} ${kindTag} lead ${c.gold}${payload.session_id.slice(0, 8)}…${c.reset} · ${answers.length} answers${dropped ? ` · dropped at: "${dropped}"` : ""}${payload.lead ? ` · ${payload.lead.email || "no email"}` : ""} · ${Date.now() - start}ms`);
    console.debug(`${c.dim}[${ts()}] [lead-payload]${c.reset}`, JSON.stringify(payload, null, 2));

    return NextResponse.json({ ok: true, session_id: payload.session_id });
  } catch (err) {
    console.error(`${c.red}[${ts()}] ✗ lead endpoint crashed: ${err.message}${c.reset}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export function GET() {
  // Intentionally closed: the endpoint only accepts POSTs from the wizard.
  console.warn(`${c.red}[${ts()}] ✗ REJECTED lead: wrong method GET${c.reset}`);
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}

function ip(request) {
  return request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "local";
}
