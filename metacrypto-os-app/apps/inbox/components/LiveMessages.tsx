"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageRow, TeamMember } from "@/lib/types";
import { fullTime, resolveAutorNombre } from "@/lib/format";
import MessageMedia from "./MessageMedia";

const MEDIA_TIPOS = ["image", "video", "audio", "document", "sticker", "location", "contacts"];
function esMedia(m: MessageRow) {
  return Boolean(m.media_path) || Boolean(m.tipo && MEDIA_TIPOS.includes(m.tipo));
}

const POLL_MIN = 1500;
const POLL_MAX = 8000;
// Margen por debajo del cual seguimos considerando que estás "abajo del todo".
// Si el chip de nuevos mensajes sale cuando no debería, sube este número.
const PEGADO_PX = 80;

// Lo que de verdad cambia de un mensaje entre dos polls. Comparar la firma en
// vez del array entero deja el cálculo fuera del updater de React (que en dev
// se ejecuta dos veces) y nos dice si hay que acelerar o frenar el poll.
function firmaDe(msgs: MessageRow[]) {
  return msgs
    .map((m) =>
      [m.id, m.status, m.media_path, m.reaccion_emoji, m.transcript, m.body, m.caption].join("~"),
    )
    .join("|");
}

// Hilo en vivo: parte del render inicial (SSR) y luego hace poll de un JSON
// mínimo, reemplazando la lista. Sin re-render del servidor.
export default function LiveMessages({
  convId,
  initial,
  team,
}: {
  convId: string;
  initial: MessageRow[];
  team: TeamMember[];
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initial);
  const [hayNuevos, setHayNuevos] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const pegadoRef = useRef(true);
  const primeraVezRef = useRef(true);

  const bajar = useCallback((suave: boolean) => {
    endRef.current?.scrollIntoView({ behavior: suave ? "smooth" : "auto" });
    pegadoRef.current = true;
    setHayNuevos(false);
  }, []);

  function onScroll() {
    const el = listaRef.current;
    if (!el) return;
    const pegado = el.scrollHeight - el.scrollTop - el.clientHeight < PEGADO_PX;
    pegadoRef.current = pegado;
    if (pegado) setHayNuevos(false);
  }

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let delay = POLL_MIN;
    let firma = firmaDe(initial);

    async function poll(): Promise<boolean> {
      try {
        const r = await fetch(`/api/inbox/messages?convId=${convId}`, { cache: "no-store" });
        if (!r.ok) return false;
        const d = await r.json();
        if (!alive || !Array.isArray(d.messages)) return false;
        const nueva = firmaDe(d.messages);
        if (nueva === firma) return false;
        firma = nueva;
        setMessages((prev) => {
          const byId = new Map(prev.map((x) => [x.id, x]));
          return d.messages.map((n: MessageRow) => {
            const old = byId.get(n.id);
            // conservar la referencia previa si nada relevante cambió (evita remount del media)
            return old &&
              old.status === n.status &&
              old.media_path === n.media_path &&
              old.reaccion_emoji === n.reaccion_emoji &&
              old.transcript === n.transcript &&
              old.body === n.body &&
              old.caption === n.caption
              ? old
              : n;
          });
        });
        return true;
      } catch {
        /* red intermitente: reintenta al siguiente tick */
        return false;
      }
    }

    // Con la conversación parada el intervalo se va espaciando hasta POLL_MAX,
    // y vuelve a POLL_MIN en cuanto llega algo. Con la app abierta en 4G esto
    // baja de ~2.400 peticiones/hora a unas pocas decenas cuando no pasa nada.
    async function tick() {
      if (document.visibilityState === "visible") {
        const cambio = await poll();
        delay = cambio ? POLL_MIN : Math.min(Math.round(delay * 1.6), POLL_MAX);
      }
      if (alive) timer = setTimeout(tick, delay);
    }
    timer = setTimeout(tick, delay);

    // Volver a la pestaña —o mandar tú un mensaje— recupera el ritmo rápido.
    // Sin esto, tu propio saliente podría tardar hasta 8s en aparecer, que es
    // exactamente el momento en que estás mirando la pantalla.
    function despertar() {
      if (!alive) return;
      delay = POLL_MIN;
      clearTimeout(timer);
      timer = setTimeout(tick, 0);
    }
    function onVis() {
      if (document.visibilityState === "visible") despertar();
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("inbox:enviado", despertar);

    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("inbox:enviado", despertar);
    };
    // `initial` solo se usa para la firma de arranque; cambia junto con convId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId]);

  // Cambiar de conversación es empezar de cero: abajo del todo y sin chip.
  useEffect(() => {
    primeraVezRef.current = true;
    pegadoRef.current = true;
    setHayNuevos(false);
  }, [convId]);

  useEffect(() => {
    if (primeraVezRef.current) {
      primeraVezRef.current = false;
      bajar(false); // al abrir, abajo y sin animación
      return;
    }
    // Si subiste a leer, no te arrastramos: avisamos y tú decides.
    if (pegadoRef.current) bajar(true);
    else setHayNuevos(true);
  }, [convId, messages.length, bajar]);

  return (
    <div className="messages" ref={listaRef} onScroll={onScroll}>
      {messages.length === 0 && <div className="divider">Sin mensajes todavía.</div>}
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.direction}`}>
          {m.reaccion_emoji && <span className="reaccion">{m.reaccion_emoji}</span>}
          {esMedia(m) ? (
            <>
              <MessageMedia m={m} />
              {m.caption && <div>{m.caption}</div>}
            </>
          ) : (
            <div>{m.body || <em className="divider">[{m.tipo ?? "mensaje"}]</em>}</div>
          )}
          <div className="meta">
            {fullTime(m.sent_at)}
            {m.direction === "out" && m.status ? ` · ${m.status}` : ""}
            {m.direction === "out" && (
              <span className="autor"> · {resolveAutorNombre(m.autor, team)}</span>
            )}
          </div>
        </div>
      ))}
      {hayNuevos && (
        <button type="button" className="nuevos-chip" onClick={() => bajar(true)}>
          Nuevos mensajes
        </button>
      )}
      <div ref={endRef} />
    </div>
  );
}
