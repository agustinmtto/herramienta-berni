"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ConversationRow, EstadoAtencion } from "@/lib/types";
import { displayName, shortTime } from "@/lib/format";

const POLL_MIN = 2000;
const POLL_MAX = 10000;

// Lo que hace que una fila de la lista se vea distinta. Si nada de esto cambia,
// no hace falta repintar ni seguir preguntando cada 2s.
function firmaDe(convs: ConversationRow[]) {
  return convs
    .map((c) => [c.id, c.ultimo_mensaje_at, c.estado_atencion, c.ultimo_autor].join("~"))
    .join("|");
}

// Lista de conversaciones en vivo: poll de JSON mínimo, con freno progresivo
// cuando no pasa nada (ver LiveMessages para el porqué).
export default function LiveConversations({
  initial,
  activeId,
  filter,
}: {
  initial: ConversationRow[];
  activeId?: string;
  filter?: EstadoAtencion;
}) {
  const [convs, setConvs] = useState<ConversationRow[]>(initial);
  const q = filter ? `?f=${filter}` : "";

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let delay = POLL_MIN;
    let firma = firmaDe(initial);

    async function poll(): Promise<boolean> {
      try {
        const r = await fetch(`/api/inbox/conversations${filter ? `?f=${filter}` : ""}`, {
          cache: "no-store",
        });
        if (!r.ok) return false;
        const d = await r.json();
        if (!alive || !Array.isArray(d.conversations)) return false;
        const nueva = firmaDe(d.conversations);
        if (nueva === firma) return false;
        firma = nueva;
        setConvs(d.conversations);
        return true;
      } catch {
        /* reintenta al siguiente tick */
        return false;
      }
    }

    async function tick() {
      if (document.visibilityState === "visible") {
        const cambio = await poll();
        delay = cambio ? POLL_MIN : Math.min(Math.round(delay * 1.6), POLL_MAX);
      }
      if (alive) timer = setTimeout(tick, delay);
    }
    timer = setTimeout(tick, delay);

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
    // `initial` solo siembra la firma de arranque.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="conv-list">
      {convs.length === 0 && (
        <div className="divider card-body-pad">
          Sin conversaciones.
        </div>
      )}
      {convs.map((c) => (
        <Link
          key={c.id}
          href={`/inbox/c/${c.id}${q}`}
          className={`conv ${c.id === activeId ? "active" : ""}`}
        >
          <div className="conv-top">
            <span className="conv-name">{displayName(c.persona, c.telefono_e164)}</span>
            <span className="conv-time">{shortTime(c.ultimo_mensaje_at)}</span>
          </div>
          <div className="conv-meta">
            {c.estado_atencion === "pendiente" && <span className="badge pend">Pendiente</span>}
            {c.tier && <span className="badge tier">{c.tier}</span>}
            {c.coach && <span className="badge coach">{c.coach.nombre}</span>}
            {c.ultimo_autor && <span className="conv-autor">· {c.ultimo_autor}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
