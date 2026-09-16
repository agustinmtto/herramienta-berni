"use client";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Un panel que entra por el lado derecho.
 *
 * Hermano de components/Modal.tsx y con el mismo contrato de teclado —Escape,
 * trampa de foco, foco devuelto al cerrar, scroll del fondo congelado—, pero
 * distinto sitio y distinto propósito: un modal interrumpe para pedir una
 * decisión, un panel acompaña mientras sigues viendo la pantalla de detrás.
 *
 * Por eso el WhatsApp de la ficha vive aquí y no en un modal: leer lo que te
 * ha escrito el cliente no interrumpe el trabajo, es parte de él.
 *
 * En móvil ocupa el ancho entero, porque 400px sobre 390 no deja nada del
 * fondo visible y entonces un panel a medias es peor que una pantalla.
 */
export default function PanelLateral({
  titulo,
  subtitulo,
  onCerrar,
  children,
  pie,
  expandirHref,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  onCerrar: () => void;
  children: ReactNode;
  /** Compositor, avisos: lo que se queda pegado abajo sin hacer scroll. */
  pie?: ReactNode;
  /** Si se pasa, agrega un botón arriba a la izquierda que lleva a la vista
      de página completa de lo mismo que muestra el panel. */
  expandirHref?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const focoPrevio = useRef<HTMLElement | null>(null);

  const focalizables = useCallback((): HTMLElement[] => {
    if (!caja.current) return [];
    return Array.from(
      caja.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, []);

  useEffect(() => {
    focoPrevio.current = document.activeElement as HTMLElement | null;
    const t = requestAnimationFrame(() => {
      const els = focalizables();
      // Se salta el botón de cerrar por lo mismo que el modal: enfocar la
      // salida invita a usarla.
      (els.find((el) => !el.hasAttribute("data-panel-cerrar")) ?? caja.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(t);
      const prev = focoPrevio.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [focalizables]);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onCerrar(); return; }
      if (e.key !== "Tab") return;
      const els = focalizables();
      if (els.length === 0) { e.preventDefault(); return; }
      const primero = els[0];
      const ultimo = els[els.length - 1];
      const activo = document.activeElement;
      if (!e.shiftKey && activo === ultimo) { e.preventDefault(); primero.focus(); }
      else if (e.shiftKey && (activo === primero || activo === caja.current)) {
        e.preventDefault(); ultimo.focus();
      }
    };
    document.addEventListener("keydown", alPulsar, true);
    return () => document.removeEventListener("keydown", alPulsar, true);
  }, [onCerrar, focalizables]);

  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previo; };
  }, []);

  // Portal a document.body: FichaEnPanel lo abre desde dentro de un <tr>, y
  // un <div>/<aside> como hijo de <tbody> es HTML inválido (rompe la
  // hidratación de React). El panel es un overlay de página completa — no
  // pertenece al árbol de la fila que lo abrió.
  return createPortal(
    <>
      <div className="panel-velo" onClick={onCerrar} aria-hidden="true" />
      <aside
        ref={caja}
        className="panel-lateral"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <div className="panel-head">
          {expandirHref && (
            <a
              href={expandirHref}
              className="modal-cerrar"
              title="Ver ficha completa"
              aria-label="Expandir a la ficha completa"
            >
              ⤢
            </a>
          )}
          <div className="panel-titulos">
            <h2 id={tituloId}>{titulo}</h2>
            {subtitulo && <span className="panel-sub">{subtitulo}</span>}
          </div>
          <button
            type="button"
            className="modal-cerrar"
            aria-label={`Cerrar ${titulo.toLowerCase()}`}
            data-panel-cerrar=""
            onClick={onCerrar}
          >
            ✕
          </button>
        </div>
        <div className="panel-cuerpo">{children}</div>
        {pie && <div className="panel-pie">{pie}</div>}
      </aside>
    </>,
    document.body,
  );
}
