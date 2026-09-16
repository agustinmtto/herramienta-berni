import { rest } from "@/lib/supabase";
import { getStorageBytes } from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await rest("GET", `wa_mensajes?id=eq.${id}&select=media_path,media_mime,media_filename,tipo`);
  const row = r.json?.[0];
  if (!row?.media_path) return new Response("not found", { status: 404 });
  const file = await getStorageBytes(row.media_path);
  if (!file) return new Response("not found", { status: 404 });
  const mime = row.media_mime || file.mime;
  // Documentos y cualquier cosa no imagen/audio/video → descarga (anti-XSS).
  const inlineOk = /^(image|audio|video)\//.test(mime);
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Cache-Control": "private, max-age=86400, immutable",
  };
  if (!inlineOk) headers["Content-Disposition"] = `attachment; filename="${(row.media_filename || "archivo").replace(/"/g, "")}"`;
  return new Response(file.bytes, { headers });
}
