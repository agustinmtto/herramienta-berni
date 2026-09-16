import "server-only";

import { rest } from "@/lib/supabase";
import { uploadToStorage, storagePathFor } from "@/lib/storage";

// --- Descarga diferida de media a Supabase Storage ----------------------------
// Se dispara vía after() tras responder el webhook: nunca bloquea la ingesta.
// También la reutiliza el recolector de media pendiente (media-backfill).
export async function downloadMediaToStorage(
  msgId: string, convId: string, kapsoMessageId: string,
  kapsoUrl: string, mime: string, filename: string,
): Promise<void> {
  try {
    const res = await fetch(kapsoUrl, { headers: { "X-API-Key": process.env.KAPSO_API_KEY ?? "" } });
    if (!res.ok) throw new Error(`kapso media ${res.status}`);
    const bytes = await res.arrayBuffer();
    const path = storagePathFor(convId, kapsoMessageId, filename || "file.bin");
    const ok = await uploadToStorage(path, bytes, mime || res.headers.get("content-type") || "application/octet-stream");
    await rest("PATCH", `wa_mensajes?id=eq.${msgId}`,
      ok ? { media_path: path, media_status: "stored" } : { media_status: "failed" }, "return=minimal");
  } catch (e) {
    console.error("[wa-media] media download failed", e);
    await rest("PATCH", `wa_mensajes?id=eq.${msgId}`, { media_status: "failed" }, "return=minimal");
  }
}
