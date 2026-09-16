import "server-only";

// ============================================================
// convertAudioForWhatsApp — WhatsApp (Meta) rechaza audio/webm
// (error 131053) aunque el códec interno sea opus. El navegador
// (Chrome) graba notas de voz como audio/webm;codecs=opus. Como
// WhatsApp SÍ acepta audio/ogg;codecs=opus, remuxeamos el
// contenedor webm -> ogg copiando el stream (sin recodificar) con
// ffmpeg. Si el mime ya es aceptado por WhatsApp, se devuelve tal
// cual.
// ============================================================
import { execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const execFile = promisify(execFileCb);

export interface ConvertedAudio {
  bytes: ArrayBuffer;
  mime: string;
  ext: string;
}

function extForAcceptedMime(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("amr")) return "amr";
  if (mime.includes("mp4") || mime.includes("m4a") || mime === "audio/x-m4a") return "m4a";
  if (mime.includes("aac")) return "aac";
  return "bin";
}

function isAlreadyAccepted(mime: string): boolean {
  return (
    mime.startsWith("audio/ogg") ||
    mime === "audio/mpeg" ||
    mime === "audio/mp3" ||
    mime === "audio/amr" ||
    mime === "audio/mp4" ||
    mime === "audio/aac" ||
    mime === "audio/x-m4a" ||
    mime === "audio/m4a"
  );
}

async function cleanup(paths: string[]): Promise<void> {
  for (const p of paths) {
    await unlink(p).catch(() => {});
  }
}

export async function convertAudioForWhatsApp(
  bytes: ArrayBuffer,
  mime: string,
): Promise<ConvertedAudio> {
  if (isAlreadyAccepted(mime)) {
    return { bytes, mime, ext: extForAcceptedMime(mime) };
  }

  // Cualquier otro audio (típicamente audio/webm;codecs=opus de Chrome):
  // remuxeamos el contenedor a ogg. WhatsApp acepta audio/ogg;codecs=opus.
  if (!ffmpegPath) {
    throw new Error("ffmpeg no disponible para convertir el audio.");
  }

  const id = randomUUID();
  const inPath = join(tmpdir(), `in-${id}.webm`);
  const outPath = join(tmpdir(), `out-${id}.ogg`);

  try {
    await writeFile(inPath, Buffer.from(bytes));

    try {
      // Remux rápido: copia el stream opus a un contenedor ogg, sin recodificar.
      await execFile(ffmpegPath, ["-i", inPath, "-c:a", "copy", "-f", "ogg", "-y", outPath]);
    } catch {
      // Si el remux directo falla (p.ej. el contenedor de origen no trae
      // opus puro), reintenta recodificando a opus dentro de ogg.
      try {
        await execFile(ffmpegPath, ["-i", inPath, "-c:a", "libopus", "-f", "ogg", "-y", outPath]);
      } catch (err) {
        throw new Error(
          `No se pudo convertir el audio a ogg/opus para WhatsApp: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const outBuffer = await readFile(outPath);
    const outBytes = outBuffer.buffer.slice(
      outBuffer.byteOffset,
      outBuffer.byteOffset + outBuffer.byteLength,
    ) as ArrayBuffer;

    return { bytes: outBytes, mime: "audio/ogg", ext: "ogg" };
  } finally {
    await cleanup([inPath, outPath]);
  }
}
