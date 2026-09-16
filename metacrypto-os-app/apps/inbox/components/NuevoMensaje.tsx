"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import { useRouter } from "next/navigation";
import type { Contacto } from "@/lib/types";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function NuevoMensaje({ contactos }: { contactos: Contacto[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Contacto | null>(null);
  const [texto, setTexto] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const router = useRouter();

  const qd = q.replace(/\D/g, "");
  const filtered = q.trim()
    ? contactos.filter((c) => {
        const byName = norm(c.nombre ?? "").includes(norm(q));
        const byPhone = qd.length >= 3 && c.telefono_e164.replace(/\D/g, "").includes(qd);
        return byName || byPhone;
      })
    : contactos.slice(0, 60);

  function close() {
    setOpen(false);
    setSel(null);
    setTexto("");
    setQ("");
    setErr(null);
  }

  async function send() {
    if (!sel || !texto.trim() || sending) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: sel.telefono_e164, texto }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErr(d?.error ?? "No se pudo enviar.");
        setSending(false);
        return;
      }
      close();
      router.push("/inbox");
      router.refresh();
    } catch {
      setErr("Error de red.");
      setSending(false);
    }
  }

  return (
    <>
      <button className="btn primary newmsg-btn" style={{ width: "100%" }} onClick={() => setOpen(true)}>
        ✎ Nuevo mensaje
      </button>

      {open && (
        <Modal titulo="Nuevo mensaje" onCerrar={close}>

            {!sel ? (
              <>
                <input
                  className="search"
                  autoFocus
                  placeholder="Buscar cliente por nombre o teléfono…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <div className="picker-list">
                  {filtered.length === 0 && (
                    <div className="muted card-body-pad">
                      Sin resultados.
                    </div>
                  )}
                  {filtered.map((c) => (
                    <button key={c.id} className="picker-item" onClick={() => setSel(c)}>
                      <span className="pi-name">{c.nombre || "(sin nombre)"}</span>
                      <span className="pi-phone mono">{c.telefono_e164}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="picker-sel">
                  <div>
                    <div className="pi-name">{sel.nombre || "(sin nombre)"}</div>
                    <div className="pi-phone mono">{sel.telefono_e164}</div>
                  </div>
                  <button className="linkbtn" onClick={() => setSel(null)}>
                    Cambiar
                  </button>
                </div>
                <textarea
                  className="compose"
                  autoFocus
                  placeholder="Escribe el mensaje…"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />
                {err && (
                  <div className="login-err" style={{ textAlign: "left", marginBottom: 8 }}>
                    {err}
                  </div>
                )}
                <div className="modal-actions">
                  <div className="crece" />
                  <button className="btn" onClick={close}>
                    Cancelar
                  </button>
                  <button className="btn primary" disabled={sending} onClick={send}>
                    {sending ? "Enviando…" : "Enviar WhatsApp"}
                  </button>
                </div>
              </>
            )}
        </Modal>
      )}
    </>
  );
}
