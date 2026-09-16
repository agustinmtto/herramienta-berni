// ============================================================
// MetaCrypto OS — Route Handler `POST /api/wa-ingest`
// Recibe el webhook de Kapso (whatsapp.message.received/.sent, payload v2)
// y espeja la conversación + mensaje en Supabase, identificando la
// persona, su tier activo y su coach. Idempotente por kapso_message_id.
//
// Auth: HMAC-SHA256(secret, raw_body) hex en header X-Webhook-Signature
// (modelo real de Kapso). El secreto es KAPSO_WEBHOOK_SECRET, que se pasa
// como --secret-key al crear el webhook.
//
// Alojado en Vercel para esquivar el 403 de la Management API de Supabase.
// Kapso → Vercel → Supabase (REST). Puerto de supabase/functions/wa-ingest.
// ============================================================

import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { avisarMensajeEntrante } from "@/lib/push-envio";
import { rest } from "@/lib/supabase";
import { downloadMediaToStorage } from "@/lib/wa-media";
import { soloDigitos, variantesE164 } from "@/lib/telefono";

// Webhook: sin caché, siempre Node.js (service_role + crypto + fetch server-side).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Etapa 0 de WhatsApp Coexistence (spec 2026-09-01), y vale por sí sola.
//
// Esta ruta procesa EN SERIE y cada mensaje cuesta entre 4 y 6 idas a
// PostgREST (buscar conversación, cruzar persona por sus variantes de E.164,
// upsert del mensaje, media, aviso). Sin `maxDuration` declarado se queda con
// el default de la plataforma, y era la única de las cuatro rutas de fondo del
// OS sin declararlo: `sesiones/sync` y `ghl/evento-notas` llevan 60 y
// `sesiones/recurrentes` 300.
//
// Por qué importa AHORA: hoy entran mensajes de uno en uno y no se nota. Pero
// coexistence trae un volcado de historial de hasta 180 días — entre 7.000 y
// 22.000 mensajes contra una tabla que hoy tiene 712 — y ahí los lotes son
// grandes. Si un lote agota el tiempo, Kapso reintenta y REPROCESA EL LOTE
// ENTERO; el upsert es idempotente, así que no duplica, pero la pasada se
// puede volver a agotar y entrar en bucle. Y por esta misma ruta entran los
// mensajes VIVOS de los clientes: una ingesta atascada es el equipo sin ver
// que alguien ha escrito.
//
// 60 y no 300: si una sola tanda necesita más de un minuto, el problema es el
// tamaño del lote, no el tiempo. Que corte y se vea.
export const maxDuration = 60;

const WEBHOOK_SECRET = process.env.KAPSO_WEBHOOK_SECRET ?? "";

// --- Verificación de firma HMAC (bytes crudos, antes de parsear) --------------
function verifySignature(raw: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET) return true; // sin secreto configurado = sin verificación
  if (!signature) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Normalización del payload v2 de Kapso ------------------------------------
// whatsapp.message.received / .sent: { message{ id,timestamp,type,text{body},
//   kapso{direction,status,content} }, conversation{ id,phone_number,... } }
type Norm = {
  from?: string;
  conversation_id?: string;
  message_id?: string;
  direction: "in" | "out";
  body: string;
  tipo: string;
  status: string;
  timestamp: string;
  caption?: string;
  transcript?: string;
  hasMedia: boolean;
  mediaKapsoUrl?: string;
  mediaMime?: string;
  mediaFilename?: string;
  mediaSize?: number;
  reaction?: { messageId: string; emoji: string };
};

function toIso(ts: unknown, fallback?: string): string {
  if (ts == null) return fallback ?? new Date().toISOString();
  const s = String(ts);
  // Kapso manda el timestamp del mensaje como unix en segundos (string).
  if (/^\d+$/.test(s)) return new Date(Number(s) * 1000).toISOString();
  return s; // ya es ISO
}

function normalize(evt: any): Norm {
  const m = evt?.message ?? {};
  const conv = evt?.conversation ?? {};
  const k = m?.kapso ?? {};
  const direction: "in" | "out" = k?.direction === "outbound" ? "out" : "in";
  const md = k?.media_data ?? {};
  const isReaction = (m?.type ?? "text") === "reaction";
  // Defensivo: si Kapso no manda has_media pero sí trae una URL de media,
  // igual la tratamos como media (evitar que quede huérfana en silencio).
  const hasMedia = Boolean(k?.has_media) || Boolean(k?.media_url) || Boolean(md?.url);
  return {
    from: conv?.phone_number,
    conversation_id: conv?.id,
    message_id: m?.id,
    direction,
    // Para media, body = "" (renderizamos el archivo, no el string largo de
    // kapso.content). Para NO-media (interactive/button/unsupported, etc.)
    // caemos a kapso.content, que trae el texto real.
    body: m?.text?.body ?? m?.reaction?.emoji ?? k?.message_type_data?.caption ?? (hasMedia ? "" : k?.content) ?? "",
    tipo: m?.type ?? "text",
    status: k?.status ?? (direction === "in" ? "received" : "sent"),
    timestamp: toIso(m?.timestamp, conv?.last_active_at),
    caption: k?.message_type_data?.caption ?? undefined,
    transcript: k?.transcript?.text ?? undefined,
    hasMedia,
    mediaKapsoUrl: k?.media_url ?? md?.url ?? undefined,
    mediaMime: md?.content_type ?? undefined,
    mediaFilename: md?.filename ?? undefined,
    mediaSize: typeof md?.byte_size === "number" ? md.byte_size : undefined,
    reaction: isReaction && m?.reaction?.message_id
      ? { messageId: m.reaction.message_id, emoji: m.reaction.emoji ?? "" }
      : undefined,
  };
}

async function derivePersona(from: string): Promise<{ id: string; coach_id: string | null; tier: string | null } | null> {
  // Kapso manda el wa_id en dígitos ("56961111666") y `personas` guarda E.164
  // con prefijo ("+56961111666"): buscar por igualdad exacta no encontraba a
  // NADIE (los 92 clientes con teléfono lo tienen con "+"). Probamos ambas.
  const variantes = variantesE164(from);
  if (!variantes.length) return null;
  const filtro = variantes.map((v) => `telefono_e164.eq.${encodeURIComponent(v)}`).join(",");
  const per = await rest("GET", `personas?or=(${filtro})&select=id,coach_id&limit=1`);
  const persona = per.json?.[0] ?? null;
  if (!persona) return null;
  const va = await rest("GET", `v_programa_activo?persona_id=eq.${persona.id}&select=tier`);
  return { id: persona.id, coach_id: persona.coach_id ?? null, tier: va.json?.[0]?.tier ?? null };
}

type IngestResult = {
  ok: boolean;
  convId?: string;
  // Necesario para decidir si toca avisar: solo se notifican los ENTRANTES.
  direction?: "in" | "out";
  error?: string;
  msgId?: string;
  media?: { kapsoMessageId: string; kapsoUrl: string; mime: string; filename: string } | null;
};

async function ingestOne(p: Norm): Promise<IngestResult> {
  if (!p.conversation_id || !p.from) return { ok: false, error: "missing conversation/from" };

  // 1) ¿Existe ya el hilo? Se busca por TELÉFONO, no por el id de sesión de
  //    Kapso: ese id cambia cada vez que expira la ventana de 24 h de Meta, y
  //    usarlo como clave partía el historial en hilos nuevos (ver migración 0020).
  const telefono = soloDigitos(p.from);
  const existing = await rest(
    "GET",
    `wa_conversaciones?telefono_e164=eq.${encodeURIComponent(
      telefono,
    )}&select=id,persona_id,kapso_conversation_id`,
  );
  let convId: string | undefined = existing.json?.[0]?.id;

  if (!convId) {
    // Nueva conversación: deriva persona/coach/tier UNA vez, al crear.
    const persona = await derivePersona(p.from);
    const ins = await rest(
      "POST",
      "wa_conversaciones",
      {
        telefono_e164: telefono,
        kapso_conversation_id: p.conversation_id,
        persona_id: persona?.id ?? null,
        coach_asignado: persona?.coach_id ?? null,
        tier: persona?.tier ?? null,
        ultimo_mensaje_at: p.timestamp,
      },
      "return=representation",
    );
    convId = ins.json?.[0]?.id;
    if (!convId) {
      console.error("[wa-ingest] conv insert failed", ins.status, ins.json);
      return { ok: false, error: "conv insert failed" };
    }
  } else {
    // Existente: SOLO toca ultimo_mensaje_at (preserva coach/tier/estado
    // que el equipo pueda haber editado en el inbox). Re-vincula persona
    // si antes era desconocida y ahora sí matchea un teléfono conocido.
    const patch: Record<string, unknown> = { ultimo_mensaje_at: p.timestamp };
    // La sesión de Kapso en curso es un dato del hilo, no su identidad.
    if (existing.json?.[0]?.kapso_conversation_id !== p.conversation_id) {
      patch.kapso_conversation_id = p.conversation_id;
    }
    if (!existing.json?.[0]?.persona_id) {
      const persona = await derivePersona(p.from);
      if (persona) {
        patch.persona_id = persona.id;
        patch.coach_asignado = persona.coach_id;
        patch.tier = persona.tier;
      }
    }
    await rest(
      "PATCH",
      `wa_conversaciones?id=eq.${convId}`,
      patch,
      "return=minimal",
    );
  }

  // 3.5) Reacción: no crea/actualiza mensaje propio, solo marca el mensaje
  //      objetivo (referenciado por kapso_message_id). Si no existe, el
  //      PATCH no afecta filas y no rompe la ingesta.
  if (p.reaction) {
    const reactionPatch = await rest("PATCH",
      `wa_mensajes?kapso_message_id=eq.${encodeURIComponent(p.reaction.messageId)}`,
      { reaccion_emoji: p.reaction.emoji || null }, "return=minimal");
    // 0 filas afectadas (mensaje objetivo no existe aún) es benigno, no error.
    if (reactionPatch.status >= 300) {
      console.error("[wa-ingest] reaction patch failed", reactionPatch.status, reactionPatch.json);
    }
    return { ok: true, convId };
  }

  // 4) Upsert mensaje (idempotente por kapso_message_id). Sin message_id
  //    (p.ej. evento solo de conversación) espejamos la conversación y salimos.
  if (p.message_id) {
    // Redelivery-safe: si Kapso reentrega un evento cuya media YA está
    // 'stored', no lo pisamos a 'pending' (evita flicker en la UI y
    // re-descargas redundantes).
    const existingMsg = await rest(
      "GET",
      `wa_mensajes?kapso_message_id=eq.${encodeURIComponent(p.message_id)}&select=media_status`,
    );
    const alreadyStored = existingMsg.json?.[0]?.media_status === "stored";

    const msg = await rest(
      "POST",
      "wa_mensajes?on_conflict=kapso_message_id",
      {
        conversacion_id: convId,
        kapso_message_id: p.message_id,
        direction: p.direction,
        body: p.body,
        tipo: p.tipo,
        ...(p.direction === "in" ? { autor: "cliente" } : {}),
        status: p.status,
        sent_at: p.timestamp,
        // Los 7 campos de media SOLO van cuando este evento trae media.
        // Así un evento de texto o un `message.sent` saliente (Kapso no
        // manda media_url/media_data ahí) NO pisa lo que /api/reply ya
        // guardó (media_path, etc.) vía merge-duplicates; y en un INSERT
        // nuevo de texto, media_status usa su default 'none'.
        ...(p.hasMedia
          ? {
              caption: p.caption ?? null,
              transcript: p.transcript ?? null,
              media_kapso_url: p.mediaKapsoUrl ?? null,
              media_mime: p.mediaMime ?? null,
              media_filename: p.mediaFilename ?? null,
              media_size: p.mediaSize ?? null,
              media_status: alreadyStored ? "stored" : "pending",
            }
          : {}),
      },
      "resolution=merge-duplicates,return=representation",
    );
    if (msg.status >= 300) {
      console.error("[wa-ingest] message upsert failed", msg.status, msg.json);
      return { ok: false, convId, error: "message upsert failed" };
    }
    const msgId: string | undefined = msg.json?.[0]?.id;
    if (!msgId) {
      console.error("[wa-ingest] upsert no devolvió id", msg.status);
    }
    if (!alreadyStored && p.hasMedia && p.mediaKapsoUrl && msgId) {
      return {
        ok: true,
        convId,
        msgId,
        media: {
          kapsoMessageId: p.message_id,
          kapsoUrl: p.mediaKapsoUrl,
          mime: p.mediaMime ?? "",
          filename: p.mediaFilename ?? "",
        },
      };
    }
    return { ok: true, convId, msgId, direction: p.direction };
  }

  return { ok: true, convId };
}

export async function POST(request: Request) {
  const raw = await request.text();

  // Auth: firma HMAC del body crudo.
  if (!verifySignature(raw, request.headers.get("x-webhook-signature"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // Kapso puede mandar un lote (X-Webhook-Batch) como array de eventos.
  const events: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.events)
      ? parsed.events
      : [parsed];

  const results: IngestResult[] = [];
  for (const evt of events) {
    try {
      const r = await ingestOne(normalize(evt));
      if (!r.ok) console.error("[wa-ingest] ingest failed", r.error);
      results.push(r);
    } catch (e) {
      // Un evento malo (fetch de red, payload inesperado, etc.) no debe
      // tumbar el resto del lote.
      console.error("[wa-ingest] exception processing event", e);
      results.push({ ok: false, error: "exception" });
    }
  }

  // 200 salvo que TODO falle (evita reintentos infinitos por un solo evento malo).
  const anyOk = results.some((r) => r.ok);
  // La URL de Kapso (campo `media`) es solo para uso interno (encolar la
  // descarga); no aporta al ack del webhook y no debe salir en la respuesta.
  const publicResults = results.map(({ media, ...fields }) => fields);
  const response = Response.json(
    { ok: anyOk, processed: results.length, results: publicResults },
    { status: anyOk ? 200 : 500 },
  );

  // Descarga de media SIEMPRE diferida a after(): nunca bloquea el webhook.
  const mediaJobs = results.filter(
    (r): r is IngestResult & { msgId: string; media: NonNullable<IngestResult["media"]> } =>
      Boolean(r.ok && r.msgId && r.media && r.convId),
  );
  for (const r of mediaJobs) {
    after(() =>
      downloadMediaToStorage(
        r.msgId,
        r.convId!,
        r.media.kapsoMessageId,
        r.media.kapsoUrl,
        r.media.mime,
        r.media.filename,
      ),
    );
  }

  // Aviso push, por el MISMO motivo y con el mismo patrón que la media:
  // diferido a after() para que no bloquee el webhook. `avisarMensajeEntrante`
  // además no lanza nunca — si falla, el mensaje del cliente ya está guardado
  // y lo único que se pierde es la notificación. Al revés sería grave: si esto
  // tumbara el webhook, Kapso dejaría de entregar y se perderían mensajes.
  //
  // Solo ENTRANTES: nadie quiere una notificación cuando contesta un compañero.
  for (const r of results) {
    if (r.ok && r.msgId && r.convId && r.direction === "in") {
      const msgId = r.msgId, convId = r.convId;
      after(() => avisarMensajeEntrante(msgId, convId));
    }
  }

  return response;
}
