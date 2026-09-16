"use client";
import { useEffect, useState } from "react";
import { confirmar } from "@/components/Confirmacion";
import { clasificarDevolucion, deshacerDevolucion } from "@/app/actions";
import type { CobroElegible } from "@/lib/types";
import { money, dateEs } from "@/lib/format";

// Dos acciones en un componente porque son la misma decisión vista desde dos
// lados: "esto qué fue" y "esto no debería estar". Separarlas obligaría a
// duplicar el manejo de estado y de errores.
export default function ClasificarDevolucion({
  devolucionId,
  personaId,
  pendiente,
}: {
  devolucionId: string;
  personaId: string;
  pendiente: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Una parcial tiene que decir qué cobro revierte — sin eso no hay forma de
  // saber qué comisión quitar, y la RPC la rechaza. Los cobros se cargan solo
  // cuando hacen falta: la mayoría de las clasificaciones son «total».
  const [alcance, setAlcance] = useState("");
  const [cobros, setCobros] = useState<CobroElegible[] | null>(null);

  useEffect(() => {
    if (alcance !== "parcial" || cobros) return;
    fetch(`/api/devoluciones/cobros?persona=${personaId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setCobros(d.cobros ?? []))
      .catch(() => setError("No se pudieron cargar los cobros de este cliente."));
  }, [alcance, cobros, personaId]);

  async function clasificar(fd: FormData) {
    setEnviando(true);
    const r = await clasificarDevolucion(fd);
    setEnviando(false);
    if (r.ok) {
      confirmar(r.mensaje);
      setAbierto(false);
      setError(null);
    } else setError(r.error);
  }

  async function deshacer(fd: FormData) {
    // Deshacer revierte cuotas y estado del cliente: merece una confirmación
    // explícita, no un clic suelto en una tabla.
    if (
      !confirm(
        "¿Deshacer esta devolución? Las cuotas anuladas y el estado del cliente vuelven a como estaban.",
      )
    )
      return;
    setEnviando(true);
    const r = await deshacerDevolucion(fd);
    setEnviando(false);
    // "Devolución deshecha — las cuotas y el estado del cliente vuelven a
    // como estaban" lo escribe `deshacerDevolucion` y no se leía en ningún
    // sitio: acababas de revertir cuotas y el cierre de un cliente y la
    // pantalla no te decía nada.
    if (!r.ok) setError(r.error);
    else confirmar(r.mensaje);
  }

  if (!pendiente) {
    return (
      <form action={deshacer} style={{ display: "inline" }}>
        <input type="hidden" name="devolucion_id" value={devolucionId} />
        <button type="submit" className="linkbtn" disabled={enviando}>
          Deshacer
        </button>
        {error && <span className="error">{error}</span>}
      </form>
    );
  }

  if (!abierto) {
    return (
      <button type="button" className="btn" onClick={() => setAbierto(true)}>
        Clasificar
      </button>
    );
  }

  return (
    <form action={clasificar} className="fila-acciones">
      <input type="hidden" name="devolucion_id" value={devolucionId} />
      {/* Sin valor por defecto A PROPÓSITO: clasificar como «total» anula las
          cuotas pendientes y cierra al cliente. Tiene que ser un acto
          deliberado, no lo que pasa si le das a guardar sin mirar. */}
      <select
        name="alcance" required value={alcance}
        onChange={(e) => setAlcance(e.target.value)}
      >
        <option value="">¿Qué fue?</option>
        <option value="total">Devolución del programa entero</option>
        <option value="parcial">Devolución de un cobro suelto</option>
      </select>
      {alcance === "parcial" && (
        <select name="revierte_pago_id" required defaultValue="">
          <option value="">{cobros ? "¿Qué cobro revierte?" : "Cargando cobros…"}</option>
          {(cobros ?? []).map((c) => (
            <option key={c.pago_id} value={c.pago_id}>
              {dateEs(c.fecha)} · {money(c.monto)} ·{" "}
              {c.usd_recibido != null ? money(c.usd_recibido, "USD") : "sin USD"}
            </option>
          ))}
        </select>
      )}
      <input name="motivo" required placeholder="Qué fue exactamente" />
      <button type="submit" className="btn primary" disabled={enviando}>
        {enviando ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" className="btn" onClick={() => setAbierto(false)}>
        Cancelar
      </button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}
