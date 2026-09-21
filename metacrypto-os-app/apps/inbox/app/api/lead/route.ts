// POST /api/lead — ingestión del Quiz Funnel (docs/11 Fase B, docs/09).
// Público por diseño (el funnel es una ruta pública del OS, docs/11 D1), pero
// endurecido: rate limit por IP, chequeo same-origin, cap de body, honeypot y
// validación cerrada del contrato antes de llamar al RPC transaccional
// registrar_diagnostico (migración 0068) con service_role SOLO en servidor.
//
// Cero PII en logs de producción: solo marca de sesión, evento y conteos.
// La respuesta nunca expone persona_id (docs/11 §5).

import { NextResponse } from "next/server";
import { rest } from "@/lib/supabase";
import { isRateLimited, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "@/lib/quiz/rate-limit";
import {
  MAX_BODY_BYTES,
  mapRpcError,
  validateLeadContract,
} from "@/lib/quiz/lead-validate";

export const runtime = "nodejs";

const envInt = (name: string, fallback: number): number => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const RATE_LIMIT_MAX_EFF = envInt("LEAD_RATE_LIMIT_MAX", RATE_LIMIT_MAX);
const RATE_LIMIT_WINDOW_MS_EFF = envInt("LEAD_RATE_LIMIT_WINDOW_MS", RATE_LIMIT_WINDOW_MS);

const ip = (request: Request): string =>
  (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
  request.headers.get("x-real-ip") ||
  "desconocida";

// Same-origin cuando el navegador manda Origin (los beacons de sendBeacon lo
// mandan; las herramientas no). Un POST cruzado legítimo no existe: el funnel
// y el endpoint viven en el mismo deploy (docs/11 D1).
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403 });
  }

  const limited = isRateLimited(ip(request), {
    max: RATE_LIMIT_MAX_EFF,
    windowMs: RATE_LIMIT_WINDOW_MS_EFF,
  });
  if (limited.limited) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "body_too_large" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const validation = validateLeadContract(parsed);
  if (!validation.ok) {
    if (validation.reason === "honeypot") {
      // Bot detectado: 200 falso para no confirmarle nada (docs/09).
      return NextResponse.json({ ok: true, session_id: null, submission_id: null, status: "ignored" });
    }
    console.warn(`[lead] rechazado: ${validation.reason} ip=${ip(request)}`);
    return NextResponse.json({ ok: false, error: validation.reason }, { status: 400 });
  }

  const r = await rest<{ ok: boolean; session_id: string; submission_id: string; status: string }>(
    "POST",
    "rpc/registrar_diagnostico",
    { p_payload: validation.payload }
  );

  if (r.status === 200 && r.json?.ok) {
    console.log(`[lead] ${r.json.status} sesion=${String(r.json.session_id).slice(0, 8)}… evento=${String(validation.payload.event)} respuestas=${Array.isArray(validation.payload.answers) ? validation.payload.answers.length : 0}`);
    return NextResponse.json({
      ok: true,
      session_id: r.json.session_id,
      submission_id: r.json.submission_id,
      status: r.json.status,
    });
  }

  const message = (r.json as { message?: string } | null)?.message;
  const mapped = mapRpcError(message);
  if (mapped.code !== "internal_error") {
    console.warn(`[lead] rpc_rechazado: ${mapped.code} ip=${ip(request)}`);
    return NextResponse.json({ ok: false, error: mapped.code }, { status: mapped.status });
  }

  // Error inesperado: registrar en servidor SIN PII (solo el mensaje de la base,
  // que no incluye datos del lead — los raise del RPC llevan IDs, nunca valores).
  console.error(`[lead] error_rpc status=${r.status} msg=${(message ?? "").slice(0, 200)}`);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 502 });
}
