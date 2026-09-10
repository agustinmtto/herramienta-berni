import { NextResponse } from "next/server";
import { isRateLimited, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "../../../lib/rate-limit";

// Stub endpoint — docs/03 §2 (agnostic JSON). Logs to console for now;
// Supabase integration lands when the business repo is ready (roadmap Fase 1).
//
// Security hardening (docs/07 §5 + docs/09-security, pre-production checklist):
// - Body size cap, strict JSON parse, strict shape validation (allow-list).
// - Honeypot: bots tripped by the hidden `website` field get a fake 200.
// - Rate limiting per IP (best-effort in-memory; see lib/rate-limit.js).
// - Same-origin check on Host vs Origin when the browser sends one.
// - PII (name/email/phone/answers) is logged in development only.
//
// Every accept/reject is terminal-logged with reason (traceability, docs/03 §6).

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ANSWER_TEXT = 1000;

const envInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const RATE_LIMIT_MAX_EFF = envInt("LEAD_RATE_LIMIT_MAX", RATE_LIMIT_MAX);
const RATE_LIMIT_WINDOW_MS_EFF = envInt("LEAD_RATE_LIMIT_WINDOW_MS", RATE_LIMIT_WINDOW_MS);

const ts = () => new Date().toISOString().slice(11, 19);
const c = { dim: "\x1b[2m", gold: "\x1b[33m", green: "\x1b[32m", red: "\x1b[31m", reset: "\x1b[0m" };
const isDev = process.env.NODE_ENV === "development";

function reject(request, status, reason, detail) {
  console.warn(`${c.red}[${ts()}] ✗ REJECTED lead: ${reason}${detail ? ` (${detail})` : ""} from ${ip(request)}${c.reset}`);
  return NextResponse.json({ ok: false, error: reason }, { status });
}

function isValidLead(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "not_an_object";
  if (typeof payload.session_id !== "string" || !/^[0-9a-zA-Z-]{8,64}$/.test(payload.session_id)) return "bad_session_id";
  for (const key of Object.keys(payload)) {
    if (!["session_id", "lead", "signals", "answers", "website"].includes(key)) return "unexpected_field";
  }
  if (typeof payload.website === "string" && payload.website.trim() !== "") return "honeypot";
  if (payload.signals !== undefined && (payload.signals === null || typeof payload.signals !== "object" || Array.isArray(payload.signals))) return "bad_signals";
  if (payload.lead !== null && payload.lead !== undefined && typeof payload.lead !== "object") return "bad_lead";
  if (payload.lead) {
    for (const key of Object.keys(payload.lead)) {
      if (!["name", "email", "phone", "consent", "website"].includes(key)) return "unexpected_field";
    }
    if (typeof payload.lead.website === "string" && payload.lead.website.trim() !== "") return "honeypot";
    if (typeof payload.lead.name !== "string" || !payload.lead.name.trim() || payload.lead.name.length > 120) return "bad_name";
    if (typeof payload.lead.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.lead.email) || payload.lead.email.length > 254) return "bad_email";
    if (typeof payload.lead.phone !== "string" || payload.lead.phone.length > 40) return "bad_phone";
    const phoneDigits = payload.lead.phone.replace(/\D/g, "");
    if (phoneDigits.length < 8 || phoneDigits.length > 15) return "bad_phone";
    if (payload.lead.consent !== true) return "bad_consent";
  }
  if (!Array.isArray(payload.answers)) return "bad_answers";
  if (payload.answers.length > 64) return "too_many_answers";
  for (const a of payload.answers) {
    if (!a || typeof a !== "object" || Array.isArray(a)) return "bad_answer_item";
    for (const key of Object.keys(a)) {
      if (!["pregunta", "respuesta"].includes(key)) return "unexpected_field";
    }
    if (typeof a.pregunta !== "string" || !a.pregunta.trim() || a.pregunta.length > 500) return "bad_pregunta";
    if (a.respuesta !== null && a.respuesta !== undefined) {
      if (typeof a.respuesta !== "string") return "bad_respuesta";
      if (a.respuesta.length > MAX_ANSWER_TEXT) return "bad_respuesta";
    }
  }
  return null;
}

export async function POST(request) {
  const start = Date.now();
  try {
    const limit = isRateLimited(ip(request), { max: RATE_LIMIT_MAX_EFF, windowMs: RATE_LIMIT_WINDOW_MS_EFF });
    if (limit.limited) {
      return reject(request, 429, "rate_limited", `> ${RATE_LIMIT_MAX_EFF}/min`);
    }

    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return reject(request, 415, "unsupported_media_type", contentType || "missing");
    }

    let origin = request.headers.get("origin");
    if (origin) {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        return reject(request, 403, "bad_origin", origin.slice(0, 25));
      }
      if (originHost !== request.headers.get("host")) {
        return reject(request, 403, "bad_origin", originHost);
      }
    }

    const length = Number(request.headers.get("content-length") || 0);
    const raw = await request.text();
    if (length > MAX_BODY_BYTES || raw.length > MAX_BODY_BYTES) {
      return reject(request, 413, "payload_too_large", `${raw.length}b`);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return reject(request, 400, "invalid_json");
    }

    const reason = isValidLead(payload);
    if (reason) {
      const status = reason === "honeypot" ? 200 : 422;
      if (reason === "honeypot") {
        // Real code 200, generic body: the bot learns nothing. Nothing is stored.
        console.warn(`${c.gold}[${ts()}] ⚠ HONEYPOT lead from ${ip(request)} — discarded${c.reset}`);
        return NextResponse.json({ ok: true });
      }
      return reject(request, status, "invalid_payload", reason);
    }

    const answers = payload.answers;
    const dropped = payload.signals && payload.signals.dropoff_question;
    const kind = payload.lead ? "COMPLETE" : "DROPOUT";
    const kindTag = payload.lead ? `${c.green}✓ ${kind}${c.reset}` : `${c.gold}⚠ ${kind}${c.reset}`;

    // Production log: session marker + counts only. PII stays out (docs/09).
    console.log(`${c.dim}[${ts()}]${c.reset} ${kindTag} lead ${c.gold}${payload.session_id.slice(0, 8)}…${c.reset} · ${answers.length} answers${dropped ? " · dropoff (title omitted)" : ""} · ${Date.now() - start}ms`);
    if (isDev) {
      console.debug(`${c.dim}[${ts()}] [lead-payload]${c.reset}`, JSON.stringify(payload, null, 2));
    }

    return NextResponse.json({ ok: true, session_id: payload.session_id });
  } catch (err) {
    if (isDev) console.error(`${c.red}[${ts()}] ✗ lead endpoint crashed: ${err.message}${c.reset}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export function GET() {
  // Intentionally closed: the endpoint only accepts POSTs from the wizard.
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}

function ip(request) {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}
