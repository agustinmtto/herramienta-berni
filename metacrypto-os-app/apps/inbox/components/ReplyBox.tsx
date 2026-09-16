"use client";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import PlantillaPicker from "./PlantillaPicker";
import { msHastaCierre, momentoEnMadrid } from "@/lib/ventana";
import { IconoClip, IconoPortapapeles, IconoMic, IconoStop } from "@/components/Iconos";

type Media = { link: string; path: string; mime: string; filename: string };

const ACCEPT_ADJUNTO = "image/png,image/jpeg,application/pdf";
const REC_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

// El poll del hilo y el de la lista se frenan solos cuando no pasa nada. Si
// acabas de enviar, tu propio saliente podria tardar hasta 8s en aparecer;
// esto les dice que vuelvan al ritmo rapido ahora mismo.
function avisarEnviado() {
  window.dispatchEvent(new Event("inbox:enviado"));
}

export default function ReplyBox({
  to,
  fueraDeVentana,
  ultimoEntranteAt,
  clienteNombre,
  waCaido,
}: {
  to: string;
  fueraDeVentana: boolean;
  ultimoEntranteAt: string | null;
  clienteNombre: string;
  // Motivo de la caída del canal, o "" si WhatsApp está operativo. Lo calcula
  // el servidor en Thread.tsx. Es un string y no un booleano a propósito: el
  // equipo necesita saber POR QUÉ no puede escribir, no solo que no puede.
  waCaido: string;
}) {
  const [texto, setTexto] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [recording, setRecording] = useState(false);
  const [bloqueado, setBloqueado] = useState(false); // 409/131047 devuelto por /api/reply
  const [mostrarPlantillas, setMostrarPlantillas] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // `fueraDeVentana` lo calcula el servidor AL PINTAR la página. Si el chat se
  // queda abierto y la ventana vence mientras tanto, ese valor se queda viejo:
  // el compositor sigue activo y el primer intento se come el error de Meta
  // (pasó el 10-ago-2026). Este temporizador lo cierra en cuanto vence.
  // Solo puede bloquear, nunca desbloquear — reabrir exige un mensaje nuevo
  // del cliente, que llega por el refresco del hilo.
  const [vencioAlEsperar, setVencioAlEsperar] = useState(false);
  useEffect(() => {
    if (fueraDeVentana) return;
    const ms = msHastaCierre(ultimoEntranteAt, new Date());
    if (ms <= 0) {
      setVencioAlEsperar(true);
      return;
    }
    const t = setTimeout(() => setVencioAlEsperar(true), ms + 1000);
    return () => clearTimeout(t);
  }, [fueraDeVentana, ultimoEntranteAt]);

  const puedeGrabar = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";
  const bloqueadoPorVentana = fueraDeVentana || vencioAlEsperar || bloqueado;
  // La caída del canal manda sobre la ventana de 24 h: cuando la WABA está
  // baneada, la salida que ofrece el aviso de ventana —"envía una plantilla"—
  // también está muerta, y ofrecerla manda al equipo a un botón que no puede
  // funcionar. Por eso este aviso sustituye al otro en vez de sumarse.
  const disabledEnvio = sending || subiendo || recording || bloqueadoPorVentana || !!waCaido;
  const cuandoEscribio = momentoEnMadrid(ultimoEntranteAt);

  function marcarBloqueadoSiVentana(status: number, code?: unknown) {
    if (status === 409 && code === 131047) setBloqueado(true);
  }

  async function enviarMedia(media: Media, caption?: string) {
    const res = await fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, media: { ...media, caption: caption || undefined } }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      marcarBloqueadoSiVentana(res.status, data?.code);
      setErr(data?.error ?? "No se pudo enviar el adjunto.");
      return false;
    }
    return true;
  }

  async function subirYEnviar(file: File, caption?: string) {
    setSubiendo(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/inbox/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? "No se pudo subir el archivo.");
        return;
      }
      const ok = await enviarMedia({ link: data.link, path: data.path, mime: data.mime, filename: data.filename }, caption);
      if (ok) {
        setTexto("");
        avisarEnviado();
      }
      // El saliente aparece solo cuando el webhook lo espeja (igual que el texto).
    } catch {
      setErr("Error de red al subir el archivo.");
    } finally {
      setSubiendo(false);
    }
  }

  async function onAdjuntoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-elegir el mismo archivo después
    if (!file || bloqueadoPorVentana) return;
    await subirYEnviar(file, texto.trim());
  }

  async function startRecording() {
    if (bloqueadoPorVentana || !puedeGrabar) return;
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = REC_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m));
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blobType = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const ext = blobType.includes("mp4") ? "m4a" : blobType.includes("ogg") ? "ogg" : "webm";
        const file = new File([blob], `nota-voz.${ext}`, { type: blobType });
        await subirYEnviar(file);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setErr("No se pudo acceder al micrófono.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim() || disabledEnvio) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, texto }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        marcarBloqueadoSiVentana(res.status, data?.code);
        setErr(data?.error ?? "No se pudo enviar.");
        return;
      }
      setTexto("");
      avisarEnviado();
      // El saliente aparece solo: LiveMessages hace poll y lo trae
      // cuando el webhook whatsapp.message.sent lo espeja.
    } catch {
      setErr("Error de red al enviar.");
    } finally {
      setSending(false);
    }
  }

  // En un teclado tactil no hay Shift+Enter comodo: si Enter enviara, cada
  // salto de parrafo saldria como un mensaje suelto al cliente. En movil Enter
  // hace linea nueva y se envia solo con el boton, igual que en WhatsApp.
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    e.preventDefault();
    void send(e as unknown as FormEvent);
  }

  return (
    <div className="reply">
      {waCaido && (
        <div className="aviso-wa-caido" role="status">
          <strong>WhatsApp está caído — no escribas desde aquí.</strong> {waCaido}
        </div>
      )}
      {!waCaido && bloqueadoPorVentana && (
        <div className="banner-ventana">
          <strong>No se puede escribir libremente.</strong> WhatsApp solo lo permite durante 24 h
          desde el último mensaje del cliente
          {cuandoEscribio ? `, y ${clienteNombre} escribió el ${cuandoEscribio}` : ""}. Envía una
          plantilla para reabrir la conversación.{" "}
          <button type="button" className="linkbtn" onClick={() => setMostrarPlantillas(true)}>
            Enviar plantilla
          </button>
        </div>
      )}
      <form onSubmit={send}>
        <button
          type="button"
          className="btn"
          title="Adjuntar imagen o PDF"
          disabled={disabledEnvio}
          onClick={() => fileRef.current?.click()}
        >
          <IconoClip />
        </button>
        <button
          type="button"
          className="btn"
          title={waCaido ? "WhatsApp está caído" : "Enviar una plantilla aprobada"}
          // Único botón del compositor que no miraba `disabledEnvio`: era la
          // salida de la ventana de 24 h y por eso seguía vivo. Con el canal
          // caído las plantillas mueren igual que el texto libre.
          disabled={!!waCaido}
          onClick={() => setMostrarPlantillas(true)}
        >
          <IconoPortapapeles /> Plantilla
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ADJUNTO}
          style={{ display: "none" }}
          onChange={onAdjuntoChange}
          disabled={disabledEnvio}
        />
        {puedeGrabar && (
          <button
            type="button"
            className={`btn ${recording ? "warn" : ""}`}
            title={recording ? "Detener grabación" : "Grabar nota de voz"}
            disabled={bloqueadoPorVentana || subiendo || sending}
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? <IconoStop /> : <IconoMic />}
          </button>
        )}
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={onKey}
          placeholder="Escribe una respuesta…"
          disabled={disabledEnvio}
        />
        <button className="btn primary" type="submit" disabled={disabledEnvio || !texto.trim()}>
          {sending ? "Enviando…" : subiendo ? "Subiendo…" : "Enviar"}
        </button>
      </form>
      {err && <div className="err">{err}</div>}
      <div className="hint">
        <span className="solo-escritorio">Enter envía · Shift+Enter salto de línea. </span>
        El mensaje aparece al confirmarse por el webhook.
      </div>
      {mostrarPlantillas && (
        <PlantillaPicker to={to} clienteNombre={clienteNombre} onClose={() => setMostrarPlantillas(false)} />
      )}
    </div>
  );
}
