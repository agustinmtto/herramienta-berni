// ============================================================
// POST /api/reply — envía un WhatsApp (texto o media) vía Kapso (Meta proxy).
// El mensaje saliente NO se inserta aquí: el webhook whatsapp.message.sent
// lo espeja en wa_mensajes (idempotente). Aquí solo disparamos el envío.
// ============================================================
import { rest } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { interpretarErrorEnvio } from "@/lib/envio-error";
import { estadoWa } from "@/lib/wa-estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY = process.env.KAPSO_API_KEY ?? "";
// Sin valor por defecto A PROPÓSITO. Hasta el 2-sep-2026 esto caía a
// "597907523413541", que es el SANDBOX DE KAPSO — y ese sandbox es el mismo en
// el proyecto de otro cliente distinto. Si la env var faltaba, los WhatsApp de
// MetaCrypto salían por un número compartido con otra empresa, sin error, sin
// aviso y sin que nadie lo notara. No era higiene: era una fuga.
// Ahora falta el número = no se envía nada y se dice por qué.
const PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID ?? "";
const VERSION = process.env.META_GRAPH_VERSION ?? "v24.0";
const META_BASE = process.env.KAPSO_META_BASE ?? "https://api.kapso.ai/meta/whatsapp";

type MediaInput = { link: string; path?: string; mime: string; filename?: string; caption?: string };

export async function POST(request: Request) {
  if (!API_KEY) {
    return Response.json(
      { ok: false, error: "Falta KAPSO_API_KEY en las env vars de Vercel." },
      { status: 501 },
    );
  }

  // Mismo trato que la API key: sin número emisor no se envía. Antes se caía a
  // un sandbox compartido con otro cliente (ver el comentario de arriba).
  if (!PHONE_NUMBER_ID) {
    return Response.json(
      { ok: false, error: "Falta KAPSO_PHONE_NUMBER_ID en las env vars de Vercel." },
      { status: 501 },
    );
  }

  // Canal caído (WABA baneada, incidente del 2-sep-2026). Mismo trato que los
  // dos guards de arriba: sin llamada a Kapso, así que con certeza no sale
  // nada. Hasta este arreglo, Kapso devolvía 200 y el mensaje se veía enviado
  // en el inbox aunque Meta lo tirase después con 131031.
  const wa = estadoWa();
  if (wa.bloqueado) {
    return Response.json({ ok: false, error: wa.motivo, waCaido: true }, { status: 503 });
  }

  const { to, texto, media } = (await request.json().catch(() => ({}) as any)) as {
    to?: string;
    texto?: string;
    media?: MediaInput;
  };
  if (!to || (!texto?.trim() && !media)) {
    return Response.json({ ok: false, error: "Faltan destinatario y texto o adjunto." }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  if (media) {
    if (media.mime.startsWith("image/")) {
      payload = { type: "image", image: { link: media.link, caption: media.caption || undefined } };
    } else if (media.mime === "application/pdf") {
      payload = {
        type: "document",
        document: { link: media.link, filename: media.filename, caption: media.caption || undefined },
      };
    } else if (media.mime.startsWith("audio/")) {
      payload = { type: "audio", audio: { link: media.link } };
    } else {
      return Response.json({ ok: false, error: "Tipo no permitido para envío." }, { status: 400 });
    }
  } else {
    payload = { type: "text", text: { body: String(texto) } };
  }

  const waId = String(to).replace(/[^\d]/g, ""); // wa_id = solo dígitos
  const url = `${META_BASE}/${VERSION}/${PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: waId,
      ...payload,
    }),
  });
  // Como texto, no como JSON: cuando Kapso se cae devuelve HTML y con
  // res.json() ese detalle se perdía. Ver lib/envio-error.ts.
  const bruto = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = bruto ? JSON.parse(bruto) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const { mensaje, crudo, fueraDeVentana } = interpretarErrorEnvio(res.status, bruto);
    console.error("[reply] kapso send failed", res.status, crudo);
    // La ventana de 24 h tiene su propia salida: 409 + 131047 es lo que hace
    // que ReplyBox bloquee el compositor y ofrezca el selector de plantillas.
    // Se sigue mandando ese código aunque Kapso corte con un 422 sin código.
    if (fueraDeVentana) {
      return Response.json({ ok: false, error: mensaje, code: 131047 }, { status: 409 });
    }
    return Response.json({ ok: false, error: mensaje }, { status: 502 });
  }
  try {
    const user = await getCurrentUser();
    const autor = user?.id ?? "equipo";
    const wamid = data?.messages?.[0]?.id;
    // Por dígitos: es la clave canónica del hilo (migración 0020).
    const conv = await rest(
      "GET",
      `wa_conversaciones?telefono_e164=eq.${encodeURIComponent(waId)}&select=id&limit=1`,
    );
    const convId = conv.json?.[0]?.id;
    if (wamid && convId) {
      const base: Record<string, unknown> = {
        conversacion_id: convId,
        kapso_message_id: wamid,
        direction: "out",
        autor,
        status: "sent",
        sent_at: new Date().toISOString(),
      };
      const payload = media && media.path
        ? (() => {
            const tipo = media.mime.startsWith("image/")
              ? "image"
              : media.mime === "application/pdf"
                ? "document"
                : media.mime.startsWith("audio/")
                  ? "audio"
                  : "document";
            return {
              ...base,
              tipo,
              media_path: media.path,
              media_mime: media.mime,
              media_filename: media.filename ?? null,
              media_status: "stored",
              caption: media.caption ?? null,
            };
          })()
        : { ...base, tipo: "text", body: String(texto ?? "") };
      await rest(
        "POST",
        "wa_mensajes?on_conflict=kapso_message_id",
        payload,
        "resolution=merge-duplicates,return=minimal",
      );
    }
  } catch (e) {
    console.error("[reply] no se pudo registrar saliente", e);
  }
  return Response.json({ ok: true, data });
}
