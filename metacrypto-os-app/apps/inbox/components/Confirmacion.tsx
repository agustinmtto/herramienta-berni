"use client";
import { useEffect, useState } from "react";

/**
 * La línea de confirmación del OS. Una sola, montada en el layout.
 *
 * POR QUÉ NO VA EN EL COMPONENTE QUE HACE LA ACCIÓN
 *
 * El servidor redacta seis confirmaciones —"Cuota registrada.", "Pago
 * deshecho — la cuota vuelve a estar pendiente.", "Cuota anulada — sale de
 * las cuentas, pero queda registrada."— y el cliente las tiraba: `CuotaAcciones`
 * hacía `if (!r.ok) setError(r.error); else setModal(null)` y nunca leía
 * `r.mensaje`. El caso peor era "Deshacer": no hay modal que cerrar, así que
 * al pulsar no ocurría absolutamente nada visible.
 *
 * Lo obvio sería guardar el mensaje en el estado de esa fila. No funciona, y
 * es la razón de que esto exista: `pagarCuota` hace `revalidatePath("/cuotas")`
 * y la cuota pasa de "Vencidas" a "Cobradas recientemente". El componente se
 * desmonta de un bloque y se monta en otro, así que su estado —y el mensaje
 * con él— se pierde antes de que a nadie le dé tiempo a leerlo. Lo mismo al
 * deshacer, al anular y al reactivar: las cuatro acciones mueven la fila.
 *
 * Por eso el mensaje se emite como un evento del navegador y lo recoge este
 * componente, que vive en el layout y no se remonta cuando la página
 * revalida.
 *
 * No lleva ninguna dependencia: un `CustomEvent` es exactamente lo que hace
 * falta y ya está en la plataforma.
 */

const EVENTO = "mcc:confirmacion";

/**
 * Anuncia que una acción salió bien. El texto lo escribe el servidor y está
 * en castellano llano — se pasa tal cual, sin reescribirlo aquí.
 *
 * Se puede llamar desde cualquier componente cliente, incluso desde uno que
 * esté a punto de desaparecer: el evento ya ha salido cuando eso ocurre.
 */
export function confirmar(mensaje: string) {
  if (typeof window === "undefined" || !mensaje) return;
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: mensaje }));
}

// Lo que tarda en irse solo. Ocho segundos y no tres: estos mensajes se leen
// después de una acción que mueve dinero, a veces desde el móvil y con el
// pulgar todavía encima de la pantalla. Y no desaparece nunca sin que se
// pueda cerrar a mano.
const DURACION_MS = 8000;

export default function Confirmacion() {
  const [mensaje, setMensaje] = useState<string | null>(null);
  // Cambia con cada aviso. Sirve de `key` para que dos confirmaciones
  // seguidas reinicien la animación en vez de dejar la segunda quieta,
  // heredando el final de la primera.
  const [n, setN] = useState(0);

  useEffect(() => {
    const alRecibir = (e: Event) => {
      setMensaje(String((e as CustomEvent).detail ?? ""));
      setN((v) => v + 1);
    };
    window.addEventListener(EVENTO, alRecibir);
    return () => window.removeEventListener(EVENTO, alRecibir);
  }, []);

  useEffect(() => {
    if (!mensaje) return;
    const t = setTimeout(() => setMensaje(null), DURACION_MS);
    // Se limpia con cada mensaje nuevo: sin esto, el temporizador del primero
    // cerraría el segundo antes de tiempo.
    return () => clearTimeout(t);
  }, [mensaje, n]);

  if (!mensaje) return null;

  return (
    // `role="status"` con `aria-live="polite"`: se anuncia al terminar lo que
    // el lector de pantalla esté diciendo, sin interrumpir. Un cobro no es una
    // alerta.
    <div className="confirmacion" role="status" aria-live="polite" key={n}>
      <span className="confirmacion-marca" aria-hidden="true">✓</span>
      <span className="confirmacion-texto">{mensaje}</span>
      <button
        type="button"
        className="confirmacion-cerrar"
        aria-label="Cerrar el aviso"
        onClick={() => setMensaje(null)}
      >
        ✕
      </button>
    </div>
  );
}
