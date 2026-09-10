import { NextResponse } from "next/server";

// Stub endpoint — docs/03 §2 (agnostic JSON). Logs to console for now;
// Supabase integration lands when the business repo is ready (roadmap Fase 1).
//
// Security hardening (docs/07 §5):
// - Body size cap to avoid oversized payloads (DoS / log flooding).
// - Strict JSON parse + shape validation: reject malformed input early.
// - No secrets handled or echoed back.

const MAX_BODY_BYTES = 64 * 1024;

function isValidLead(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (typeof payload.session_id !== "string" || payload.session_id.length > 100) return false;
  if (payload.signals && typeof payload.signals !== "object") return false;
  if (payload.lead !== null && payload.lead !== undefined && typeof payload.lead !== "object") return false;
  if (!Array.isArray(payload.answers)) return false;
  if (payload.answers.length > 64) return false;
  return payload.answers.every(
    (a) =>
      a &&
      typeof a === "object" &&
      typeof a.pregunta === "string" &&
      a.pregunta.length <= 500 &&
      (a.respuesta === null || a.respuesta === undefined || typeof a.respuesta === "string")
  );
}

export async function POST(request) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    if (!isValidLead(payload)) {
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 422 });
    }

    console.info(
      "[lead-payload]",
      JSON.stringify({ session_id: payload.session_id, answers: payload.answers.length, hot: payload.signals?.dropoff_question === null && !!payload.lead }, null, 2)
    );

    return NextResponse.json({ ok: true, session_id: payload.session_id });
  } catch {
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export function GET() {
  // Intentionally closed: the endpoint only accepts POSTs from the wizard.
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
