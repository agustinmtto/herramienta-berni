// ============================================================
// POST /api/inbox/upload — sube un adjunto del equipo (para enviar por
// WhatsApp) a Storage y devuelve un link firmado que Meta pueda leer.
// Solo tipos permitidos para ENVIAR: png/jpg/pdf + audio (nota de voz).
// ============================================================
import { randomUUID } from "node:crypto";
import { uploadToStorage, signStorageUrl } from "@/lib/storage";
import { convertAudioForWhatsApp } from "@/lib/audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGN_TTL_SECONDS = 600; // ~10 min, suficiente para que Meta descargue el link
const MAX_BYTES = 16 * 1024 * 1024; // 16 MB — holgado para imagen/PDF/nota de voz de WhatsApp

function extForMime(mime: string, filename?: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) {
    if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("wav")) return "wav";
  }
  const fromName = filename?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return fromName || "bin";
}

function isAllowed(mime: string): boolean {
  return mime === "image/png" || mime === "image/jpeg" || mime === "application/pdf" || mime.startsWith("audio/");
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return Response.json({ ok: false, error: "Falta el archivo (campo 'file')." }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  if (!isAllowed(mime)) {
    return Response.json(
      { ok: false, error: `Tipo no permitido: ${mime || "desconocido"}. Solo PNG, JPG, PDF o nota de voz.` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "El archivo supera el límite de 16 MB." }, { status: 400 });
  }

  let bytes = await file.arrayBuffer();
  let finalMime = mime;
  let ext = extForMime(mime, file.name);

  if (mime.startsWith("audio/")) {
    try {
      const conv = await convertAudioForWhatsApp(bytes, mime);
      bytes = conv.bytes;
      finalMime = conv.mime;
      ext = conv.ext;
    } catch (err) {
      console.error("[upload] audio convert failed", err);
      return Response.json(
        { ok: false, error: "No se pudo procesar el audio para WhatsApp." },
        { status: 502 },
      );
    }
  }

  const path = `outbound/${randomUUID()}.${ext}`;

  const ok = await uploadToStorage(path, bytes, finalMime);
  if (!ok) {
    return Response.json({ ok: false, error: "No se pudo subir el archivo a Storage." }, { status: 502 });
  }

  const link = await signStorageUrl(path, SIGN_TTL_SECONDS);
  if (!link) {
    return Response.json({ ok: false, error: "No se pudo firmar el link del archivo." }, { status: 502 });
  }

  return Response.json({ ok: true, link, path, mime: finalMime, filename: file.name || `archivo.${ext}` });
}
