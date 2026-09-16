"use client";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";

/**
 * El modal del OS. Uno solo, para los doce que había copiados a mano.
 *
 * QUÉ ESTABA ROTO
 *
 * Seis de los doce no se cerraban sin ratón: la única salida era hacer clic
 * en el fondo. Tres de esos seis mueven dinero — cobrar una cuota, editarla y
 * anularla. En toda la app había 0 `role="dialog"`, 0 trampas de foco y un
 * solo `aria-label` en 109 botones, así que con el teclado se podía tabular
 * "fuera" del modal y acabar pulsando algo de la página de detrás sin verlo.
 *
 * Nada de esto se inventa aquí: el Escape ya estaba escrito en
 * SesionDetalle.tsx:29-33 y en el cajón de móvil de OsNav.tsx:33-40. Lo que
 * faltaba era propagarlo, y para eso hay que tener un sitio del que
 * propagarlo.
 *
 * QUÉ HACE, ADEMÁS DE LO OBVIO
 *
 * - Devuelve el foco a donde estaba al cerrar. Sin esto, cerrar un modal deja
 *   el foco en el <body> y el siguiente Tab te manda al principio de la
 *   página: en /cuotas eso significa recorrer el menú entero para volver a la
 *   fila que estabas cobrando.
 * - Bloquea el scroll del fondo mientras está abierto. En móvil, sin eso, el
 *   gesto de desplazar dentro del modal arrastra la página de detrás y al
 *   cerrar has perdido el sitio.
 * - El título es el nombre accesible del diálogo (`aria-labelledby`), así que
 *   un lector de pantalla anuncia "Anular cuota, diálogo" en vez de
 *   "diálogo".
 *
 * LO QUE NO CAMBIA: cerrar haciendo clic fuera. Es el comportamiento de hoy
 * en los doce y el equipo ya lo tiene aprendido; quitarlo sería una decisión
 * de producto, no un arreglo. Se puede desactivar con `cerrarAlPulsarFuera`
 * donde perder lo tecleado duela.
 */
export default function Modal({
  titulo,
  subtitulo,
  ancho = false,
  cerrarAlPulsarFuera = true,
  onCerrar,
  children,
}: {
  titulo: string;
  /** Línea bajo el título: cliente, importe, fecha de vencimiento… */
  subtitulo?: ReactNode;
  /** `.modal.ancho` para tabla/dos columnas; `"grande"` (`.modal.grande`)
   *  para un documento que necesita leerse cómodo, casi a pantalla completa. */
  ancho?: boolean | "grande";
  cerrarAlPulsarFuera?: boolean;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  // Quién tenía el foco antes de abrir, para devolvérselo al cerrar.
  const focoPrevio = useRef<HTMLElement | null>(null);

  const selectorFocalizables =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  const focalizables = useCallback((): HTMLElement[] => {
    if (!caja.current) return [];
    return Array.from(caja.current.querySelectorAll<HTMLElement>(selectorFocalizables))
      // `offsetParent === null` descarta lo que está oculto por CSS: un campo
      // dentro de un bloque plegado seguiría saliendo del querySelectorAll y
      // el Tab se pararía en algo que no se ve.
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, [selectorFocalizables]);

  // Foco inicial. Al primer campo si lo hay, y si no a la propia caja: en un
  // modal de solo lectura no hay nada que enfocar y sin esto el foco se queda
  // en el botón que abrió el modal, detrás del overlay.
  useEffect(() => {
    focoPrevio.current = document.activeElement as HTMLElement | null;
    const t = requestAnimationFrame(() => {
      const els = focalizables();
      // Se salta el botón de cerrar: enfocarlo primero invita a cerrar lo que
      // acabas de abrir. El primer sitio útil es el primer campo.
      const primero = els.find((el) => !el.hasAttribute("data-modal-cerrar"));
      (primero ?? caja.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(t);
      // El foco vuelve a donde estaba, si ese elemento sigue en el documento
      // (puede no estarlo: al cobrar una cuota, la fila entera se remonta).
      const prev = focoPrevio.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [focalizables]);

  // Escape para cerrar, Tab que cicla dentro. En captura para ganarle a
  // cualquier manejador de la página de detrás.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCerrar();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focalizables();
      if (els.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = els[0];
      const ultimo = els[els.length - 1];
      const activo = document.activeElement;
      // El ciclo: del último hacia delante vuelve al primero, y del primero
      // hacia atrás va al último. Sin esto el Tab se escapa a la página de
      // detrás, que está tapada por el overlay pero sigue siendo pulsable.
      if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      } else if (e.shiftKey && (activo === primero || activo === caja.current)) {
        e.preventDefault();
        ultimo.focus();
      }
    };
    document.addEventListener("keydown", alPulsar, true);
    return () => document.removeEventListener("keydown", alPulsar, true);
  }, [onCerrar, focalizables]);

  // Congelar el fondo mientras el modal está abierto.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previo; };
  }, []);

  return (
    <div
      className="modal-overlay"
      onClick={cerrarAlPulsarFuera ? onCerrar : undefined}
    >
      <div
        ref={caja}
        className={`modal${ancho === "grande" ? " grande" : ancho ? " ancho" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id={tituloId}>{titulo}</h3>
          {/* Los seis modales sin salida de teclado tampoco tenían botón de
              cierre visible: había que adivinar que se cierran clicando
              fuera. Con `aria-label` porque una ✕ sola no se lee. */}
          <button
            type="button"
            className="modal-cerrar"
            aria-label={`Cerrar ${titulo.toLowerCase()}`}
            data-modal-cerrar=""
            onClick={onCerrar}
          >
            ✕
          </button>
        </div>
        {subtitulo && <p className="modal-sub">{subtitulo}</p>}
        {children}
      </div>
    </div>
  );
}
