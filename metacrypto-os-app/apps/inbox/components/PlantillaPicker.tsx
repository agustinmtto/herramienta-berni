"use client";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { previsualizar, faltanVariables, resumenUnaLinea } from "@/lib/plantilla-preview";

type Template = { name: string; language: string; body: string; variables: string[] };

export default function PlantillaPicker({
  to,
  clienteNombre,
  onClose,
}: {
  to: string;
  clienteNombre: string;
  onClose: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [errCarga, setErrCarga] = useState<string | null>(null);
  const [sel, setSel] = useState<Template | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/inbox/templates");
        const data = await res.json().catch(() => null);
        if (cancelado) return;
        if (!res.ok || !data?.ok) {
          setErrCarga(data?.error ?? "No se pudieron cargar las plantillas.");
        } else {
          setTemplates(data.templates ?? []);
        }
      } catch {
        if (!cancelado) setErrCarga("Error de red al cargar plantillas.");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  function elegir(t: Template) {
    setSel(t);
    setErr(null);
    const iniciales: Record<string, string> = {};
    for (const v of t.variables) {
      iniciales[v] = v.toLowerCase() === "nombre" ? clienteNombre : "";
    }
    setValores(iniciales);
  }

  function bodyResuelto(t: Template) {
    return previsualizar(t.body, valores);
  }

  // Lo que se ve en la LISTA, antes de elegir: el único valor que se conoce
  // ahí es el nombre del cliente. El resto sale como [variable] — ver el
  // porqué en lib/plantilla-preview.ts.
  function previoLista(t: Template) {
    return resumenUnaLinea(previsualizar(t.body, { nombre: clienteNombre }));
  }

  const pendientes = sel ? faltanVariables(sel.variables, valores) : [];

  async function enviar() {
    if (!sel || enviando) return;
    setEnviando(true);
    setErr(null);
    try {
      const res = await fetch("/api/inbox/send-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          name: sel.name,
          language: sel.language,
          variables: valores,
          bodyResuelto: bodyResuelto(sel),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? "No se pudo enviar la plantilla.");
        return;
      }
      onClose();
    } catch {
      setErr("Error de red al enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo="Enviar plantilla" onCerrar={onClose}>

        {cargando && (
          <div className="muted" style={{ padding: 12 }}>
            Cargando plantillas…
          </div>
        )}

        {!cargando && errCarga && (
          <>
            <div className="tpl-err">{errCarga}</div>
            <div className="modal-actions">
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        )}

        {!cargando && !errCarga && templates.length === 0 && (
          <>
            <div className="muted" style={{ padding: 12 }}>
              No hay plantillas aprobadas todavía.
            </div>
            <div className="modal-actions">
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        )}

        {!cargando && !errCarga && templates.length > 0 && !sel && (
          <div className="picker-list">
            {templates.map((t) => (
              <button key={`${t.name}:${t.language}`} className="picker-item tpl" onClick={() => elegir(t)}>
                {/* El texto del mensaje va PRIMERO y el nombre técnico debajo:
                    "recordatorio_1h_es" no dice qué se le va a mandar al
                    cliente, y elegir a ciegas era el problema a resolver. */}
                <span className="tpl-preview">{previoLista(t)}</span>
                <span className="tpl-meta">
                  <span className="mono">{t.name}</span>
                  <span>·</span>
                  <span className="mono">{t.language}</span>
                  {t.variables.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{t.variables.length} variable{t.variables.length === 1 ? "" : "s"}</span>
                    </>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {!cargando && sel && (
          <>
            <div className="picker-sel tpl-sel">
              <div className="pi-name">{sel.name}</div>
              <button className="linkbtn" onClick={() => setSel(null)}>
                Elegir otra
              </button>
            </div>
            <div className="tpl-body">{bodyResuelto(sel)}</div>
            {sel.variables.length > 0 && (
              <div className="tpl-vars">
                {sel.variables.map((v) => (
                  <label key={v} className="tpl-var">
                    <span>{v}</span>
                    <input
                      value={valores[v] ?? ""}
                      onChange={(e) => setValores((prev) => ({ ...prev, [v]: e.target.value }))}
                      placeholder={`Valor para {{${v}}}`}
                    />
                  </label>
                ))}
              </div>
            )}
            {err && <div className="tpl-err">{err}</div>}
            <div className="modal-actions">
              {/* Meta rechaza una plantilla con un parámetro vacío, con un
                  error que no dice cuál falta. Ahora que el hueco se ve en la
                  previsualización, se bloquea antes de gastar la llamada. */}
              {pendientes.length > 0 && (
                <span className="pi-phone">Falta rellenar: {pendientes.join(", ")}</span>
              )}
              <div style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button
                className="btn primary"
                disabled={enviando || pendientes.length > 0}
                onClick={enviar}
              >
                {enviando ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </>
        )}
    </Modal>
  );
}
