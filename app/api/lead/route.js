import { NextResponse } from "next/server";
import { isRateLimited, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "../../../lib/rate-limit";

// Endpoint único de captación (stub) — docs/03 §2 (JSON agnóstico).
// Por ahora loguea a consola; la integración con Supabase entra cuando el
// repo del negocio esté listo (roadmap Fase 1).
//
// Endurecimiento de seguridad (docs/07 §5 + docs/09-security, checklist pre-producción):
// - Límite de tamaño de body + parseo JSON estricto + validación con allow-list de campos.
// - Honeypot: los bots que triggerean el campo oculto `website` reciben un 200 falso.
// - Rate limiting por IP (best-effort en memoria; ver lib/rate-limit.js).
// - Chequeo same-origin de `Origin` vs `Host` cuando el navegador lo manda.
// - Logs con PII (nombre/email/teléfono/respuestas) solo en desarrollo.
//
// Cada accept/reject queda logueado en terminal con su reason (trazabilidad, docs/03 §6).

const MAX_BODY_BYTES = 64 * 1024;    // cap de tamaño del body (anti DoS / flooding de logs)
const MAX_ANSWER_TEXT = 1000;        // cap de longitud de cada respuesta ("respuesta")

// Lee un int de env con fallback (para tunear el rate limit sin tocar código).
const envInt = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const RATE_LIMIT_MAX_EFF = envInt("LEAD_RATE_LIMIT_MAX", RATE_LIMIT_MAX);
const RATE_LIMIT_WINDOW_MS_EFF = envInt("LEAD_RATE_LIMIT_WINDOW_MS", RATE_LIMIT_WINDOW_MS);

const ts = () => new Date().toISOString().slice(11, 19); // hora corta para logs
const c = { dim: "\x1b[2m", gold: "\x1b[33m", green: "\x1b[32m", red: "\x1b[31m", reset: "\x1b[0m" }; // colores de terminal
const isDev = process.env.NODE_ENV === "development"; // en prod NO logueamos PII (docs/09)

// Loguea y devuelve una respuesta de rechazo con status + reason. No expone detalles internos.
function reject(request, status, reason, detail) {
  console.warn(`${c.red}[${ts()}] ✗ REJECTED lead: ${reason}${detail ? ` (${detail})` : ""} from ${ip(request)}${c.reset}`);
  return NextResponse.json({ ok: false, error: reason }, { status });
}

// Valida forma + tipos + límites + allow-list del payload. Devuelve null si está OK,
// o una string con el motivo del rechazo (se loguea para trazabilidad, nunca se devuelve al cliente).
function isValidLead(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "not_an_object";
  if (typeof payload.session_id !== "string" || !/^[0-9a-zA-Z-]{8,64}$/.test(payload.session_id)) return "bad_session_id";

  // Allow-list estricta: cualquier clave inesperada en top-level se rechaza.
  for (const key of Object.keys(payload)) {
    if (!["session_id", "lead", "signals", "answers", "website"].includes(key)) return "unexpected_field";
  }

  // Honeypot (top-level): si el bot rellenó el campo, se triggerea acá o en lead.website.
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
    if (payload.lead.consent !== true) return "bad_consent"; // consentimiento explícito obligatorio
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

// POST /api/lead — captura el lead: completado (con datos de contacto) o droppoff (parcial, vía sendBeacon).
export async function POST(request) {
  const start = Date.now();
  try {
    // 1) Rate limit por IP; si excede, 429 y fuera.
    const limit = isRateLimited(ip(request), { max: RATE_LIMIT_MAX_EFF, windowMs: RATE_LIMIT_WINDOW_MS_EFF });
    if (limit.limited) {
      return reject(request, 429, "rate_limited", `> ${RATE_LIMIT_MAX_EFF}/min`);
    }

    // 2) Solo JSON — el beacon manda Blob con este Content-Type (components/flow.jsx).
    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return reject(request, 415, "unsupported_media_type", contentType || "missing");
    }

    // 3) Same-origin: si el navegador manda Origin, debe coincidir con Host (mitiga CSRF/CORS).
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

    // 4) Tamaño: valida el header y el string ya leído (por si el header falta o miente).
    const length = Number(request.headers.get("content-length") || 0);
    const raw = await request.text();
    if (length > MAX_BODY_BYTES || raw.length > MAX_BODY_BYTES) {
      return reject(request, 413, "payload_too_large", `${raw.length}b`);
    }

    // 5) Parseo JSON estricto: si explota, 400 sin detalle.
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return reject(request, 400, "invalid_json");
    }

    // 6) Validación de forma/tipos/límites.
    const reason = isValidLead(payload);
    if (reason) {
      const status = reason === "honeypot" ? 200 : 422;
      if (reason === "honeypot") {
        // 200 real con body genérico: el bot no aprende nada. No se persiste nada.
        console.warn(`${c.gold}[${ts()}] ⚠ HONEYPOT lead from ${ip(request)} — discarded${c.reset}`);
        return NextResponse.json({ ok: true });
      }
      return reject(request, status, "invalid_payload", reason);
    }

    const answers = payload.answers;
    const dropped = payload.signals && payload.signals.dropoff_question;
    const kind = payload.lead ? "COMPLETE" : "DROPOUT";
    const kindTag = payload.lead ? `${c.green}✓ ${kind}${c.reset}` : `${c.gold}⚠ ${kind}${c.reset}`;

    // Log de producción: solo indicadores (marca de sesión + conteo). Sin PII (docs/09).
    console.log(`${c.dim}[${ts()}]${c.reset} ${kindTag} lead ${c.gold}${payload.session_id.slice(0, 8)}…${c.reset} · ${answers.length} answers${dropped ? " · dropoff (title omitted)" : ""} · ${Date.now() - start}ms`);
    if (isDev) {
      // Volcado completo del payload SOLO en desarrollo.
      console.debug(`${c.dim}[${ts()}] [lead-payload]${c.reset}`, JSON.stringify(payload, null, 2));
    }

    return NextResponse.json({ ok: true, session_id: payload.session_id });
  } catch (err) {
    // 500 genérico sin stack ni detalle interno (info sensible solo en consola dev).
    if (isDev) console.error(`${c.red}[${ts()}] ✗ lead endpoint crashed: ${err.message}${c.reset}`);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

// GET cerrado a propósito: el endpoint solo acepta POST del wizard.
export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}

// Extrae la IP del cliente: primer IP de x-forwarded-for (proxy estándar),
// fallback a x-real-ip, y "local" si no hay ninguna (dev en localhost).
function ip(request) {
  return (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}
