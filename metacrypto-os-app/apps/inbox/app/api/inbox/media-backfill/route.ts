// ============================================================
// GET /api/inbox/media-backfill — Recolector de media pendiente/fallida.
// Reprocesa mensajes entrantes cuya descarga a Storage quedó en
// media_status 'pending' o 'failed' (webhook reentregado sin after(),
// fetch a Kapso caído, etc.). Invocado por Vercel Cron cada 10 min.
//
// Auth: Vercel Cron añade automáticamente `Authorization: Bearer <CRON_SECRET>`
// cuando la env var CRON_SECRET está definida. Solo aceptamos ese header.
// ============================================================

import { rest } from "@/lib/supabase";
import { downloadMediaToStorage } from "@/lib/wa-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("no", { status: 401 });
  }

  const pend = await rest(
    "GET",
    "wa_mensajes?media_status=in.(pending,failed)&media_kapso_url=not.is.null&select=id,conversacion_id,kapso_message_id,media_kapso_url,media_mime,media_filename&limit=50",
  );
  const rows: Array<{
    id: string;
    conversacion_id: string;
    kapso_message_id: string;
    media_kapso_url: string;
    media_mime: string | null;
    media_filename: string | null;
  }> = pend.json ?? [];

  for (const m of rows) {
    await downloadMediaToStorage(
      m.id,
      m.conversacion_id,
      m.kapso_message_id,
      m.media_kapso_url,
      m.media_mime ?? "",
      m.media_filename ?? "",
    );
  }

  return Response.json({ ok: true, reprocessed: rows.length });
}
