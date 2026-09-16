import type { MessageRow } from "@/lib/types";
import { IconoPin, IconoPersona, IconoArchivo } from "@/components/Iconos";

const MEDIA_TIPOS = ["image", "video", "audio", "document", "sticker"];

export default function MessageMedia({ m }: { m: MessageRow }) {
  const src = `/api/inbox/media/${m.id}`;
  const mime = m.media_mime ?? "";
  // Ubicación/contactos: no hay archivo, mostrar texto legible.
  if (m.tipo === "location") return <div className="media-loc"><IconoPin /> {m.body || "Ubicación compartida"}</div>;
  if (m.tipo === "contacts") return <div className="media-loc"><IconoPersona /> {m.body || "Contacto compartido"}</div>;
  // Media aún no descargado a Storage: placeholder hasta el siguiente poll.
  if ((m.tipo && MEDIA_TIPOS.includes(m.tipo)) && !m.media_path)
    return <div className="divider">cargando adjunto…</div>;
  if (m.tipo === "sticker" || mime.startsWith("image/"))
    return <img className="media-img" src={src} alt={m.caption ?? "imagen"} loading="lazy" />;
  if (mime.startsWith("video/")) return <video className="media-video" src={src} controls preload="metadata" />;
  if (mime.startsWith("audio/") || m.tipo === "audio")
    return <div><audio className="media-audio" src={src} controls preload="none" />
      {m.transcript ? <div className="transcript">{m.transcript}</div> : null}</div>;
  // documento u otros
  return <a className="media-doc" href={src}><IconoArchivo /> {m.media_filename ?? "documento"}</a>;
}
