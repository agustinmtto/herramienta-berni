// ============================================================
// MetaCrypto OS — Edge Function `wa-ingest`
// Recibe el webhook de Kapso (message.created, in/out) y espeja
// la conversación + mensaje en Supabase, identificando la persona,
// su tier activo y su coach. Idempotente por kapso_message_id.
//
// Despliegue: `supabase functions deploy wa-ingest` (usa Management API).
// Si la Management API está bloqueada (403 en esta org), alternativa:
//   - alojar este receptor en Vercel, o
//   - un nodo `function`/`webhook` en el workflow de Kapso que haga
//     los mismos upserts contra PostgREST.
// Validado en sandbox (2026-07-28) contra la base real.
// ============================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("KAPSO_WEBHOOK_SECRET") ?? "";

const REST = `${SUPABASE_URL}/rest/v1`;
const HDR = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

async function rest(method: string, path: string, body?: unknown, prefer?: string) {
  const res = await fetch(`${REST}/${path}`, {
    method,
    headers: prefer ? { ...HDR, Prefer: prefer } : HDR,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  return { status: res.status, json: txt ? JSON.parse(txt) : null };
}

// --- Normalización del payload de Kapso (AJUSTAR a claves reales) -------------
// El webhook message.created de Kapso trae la conversación y el mensaje. Aquí
// mapeamos a un shape estable; confirmar nombres contra un evento real de Kapso.
function normalize(evt: any) {
  const m = evt?.message ?? evt?.data?.message ?? evt;
  const conv = evt?.conversation ?? evt?.data?.conversation ?? {};
  return {
    from: m?.from ?? m?.phone_number ?? conv?.phone_number,
    conversation_id: conv?.id ?? m?.conversation_id,
    message_id: m?.id ?? m?.wamid,
    direction: (m?.direction ?? "in") === "outbound" ? "out" : (m?.direction ?? "in"),
    body: m?.text ?? m?.body ?? "",
    tipo: m?.type ?? "text",
    status: m?.status ?? "delivered",
    timestamp: m?.timestamp ?? new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  // Verificación de secreto (Kapso firma/manda un header o query secret)
  if (WEBHOOK_SECRET) {
    const got = req.headers.get("x-webhook-secret") ?? new URL(req.url).searchParams.get("secret");
    if (got !== WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
  }

  const evt = await req.json().catch(() => null);
  const p = evt && normalize(evt);
  if (!p?.conversation_id || !p?.message_id || !p?.from) {
    return new Response("Bad payload", { status: 400 });
  }

  // 1) Identificar persona por teléfono
  const per = await rest("GET", `personas?telefono_e164=eq.${encodeURIComponent(p.from)}&select=id,coach_id`);
  const persona = per.json?.[0] ?? null;

  // 2) Tier activo (vista calculada)
  let tier: string | null = null;
  if (persona) {
    const va = await rest("GET", `v_programa_activo?persona_id=eq.${persona.id}&select=tier`);
    tier = va.json?.[0]?.tier ?? null;
  }

  // 3) Upsert conversación (idempotente por kapso_conversation_id)
  await rest("POST", "wa_conversaciones?on_conflict=kapso_conversation_id", {
    telefono_e164: p.from,
    kapso_conversation_id: p.conversation_id,
    persona_id: persona?.id ?? null,
    coach_asignado: persona?.coach_id ?? null,
    tier,
    ultimo_mensaje_at: p.timestamp,
  }, "resolution=merge-duplicates,return=minimal");

  const conv = await rest("GET", `wa_conversaciones?kapso_conversation_id=eq.${encodeURIComponent(p.conversation_id)}&select=id`);
  const convId = conv.json?.[0]?.id;
  if (!convId) return new Response("Conv upsert failed", { status: 500 });

  // 4) Upsert mensaje (idempotente por kapso_message_id)
  await rest("POST", "wa_mensajes?on_conflict=kapso_message_id", {
    conversacion_id: convId,
    kapso_message_id: p.message_id,
    direction: p.direction,
    body: p.body,
    tipo: p.tipo,
    autor: p.direction === "in" ? "cliente" : "equipo",
    status: p.status,
    sent_at: p.timestamp,
  }, "resolution=merge-duplicates,return=minimal");

  return new Response(JSON.stringify({ ok: true, conversation: convId }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
