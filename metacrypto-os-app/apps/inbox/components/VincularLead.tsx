"use client";
// Picker de vinculación post-venta (docs/11 §9): elegir el cliente definitivo
// (creado por el flujo de ventas existente) y conectar los diagnósticos del
// lead temporal. Usa useActionState para el resultado de la server action.

import { useActionState } from "react";
import { vincularLeadAccion } from "@/app/leads-actions";

export default function VincularLead({
  leadPersonaId,
  clientes,
  personaEstado,
}: {
  leadPersonaId: string;
  clientes: { id: string; nombre: string; email: string | null }[];
  personaEstado: string | null;
}) {
  const [state, formAction, pending] = useActionState(vincularLeadAccion, { ok: false });

  // Solo un lead TEMPORAL (estado 'lead') se puede vincular. Si el envío ya
  // apunta al cliente definitivo, no hay nada que hacer — y ofrecerlo sería
  // invitar a un error que el RPC rechazaría (cliente con teléfono ≠ lead).
  if (!leadPersonaId) {
    return <p className="vincular-nota">Este envío no llegó a completarse: no hay lead temporal que vincular.</p>;
  }
  if (personaEstado === "cliente") {
    return <p className="vincular-nota">Los diagnósticos de este envío ya pertenecen al cliente definitivo.</p>;
  }
  if (personaEstado === "archivado") {
    return <p className="vincular-nota">El lead temporal de este envío ya fue vinculado y archivado.</p>;
  }

  return (
    <form action={formAction} className="vincular-form">
      <input type="hidden" name="leadPersonaId" value={leadPersonaId} />
      <select name="clienteId" defaultValue="" required>
        <option value="" disabled>
          Elegí el cliente definitivo…
        </option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}{c.email ? ` — ${c.email}` : ""}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending}>
        {pending ? "Vinculando…" : "Vincular con cliente"}
      </button>
      {state.ok && state.mensaje && <span className="vincular-ok">{state.mensaje}</span>}
      {!state.ok && state.error && <span className="vincular-error">{state.error}</span>}
      <small className="vincular-nota">
        Los diagnósticos pasan al cliente elegido y el lead temporal se archiva. No modifica ningún dato del cliente.
      </small>
    </form>
  );
}
