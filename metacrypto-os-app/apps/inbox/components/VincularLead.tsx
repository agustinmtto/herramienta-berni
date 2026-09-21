"use client";
// Picker de vinculación post-venta (docs/11 §9): elegir el cliente definitivo
// (creado por el flujo de ventas existente) y conectar los diagnósticos del
// lead temporal.
//
// ⚠ El OS corre React 18: useActionState NO existe allí (llegó en React 19)
// y un componente que lo use se crashea en la hidratación — el HTML se ve
// bien pero NINGÚN click hace nada. Por eso esto es un onSubmit manual con
// useTransition, que sí existe en 18.

import { useState, useTransition } from "react";
import { vincularLeadAccion } from "@/app/leads-actions";

type Resultado = { ok: boolean; error?: string; mensaje?: string };

export default function VincularLead({
  leadPersonaId,
  clientes,
  personaEstado,
}: {
  leadPersonaId: string;
  clientes: { id: string; nombre: string; email: string | null }[];
  personaEstado: string | null;
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();

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

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setResultado(await vincularLeadAccion(formData));
    });
  };

  return (
    <form onSubmit={onSubmit} className="vincular-form">
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
      {resultado?.ok && resultado.mensaje && <span className="vincular-ok">{resultado.mensaje}</span>}
      {resultado && !resultado.ok && resultado.error && <span className="vincular-error">{resultado.error}</span>}
      <small className="vincular-nota">
        Los diagnósticos pasan al cliente elegido y el lead temporal se archiva. No modifica ningún dato del cliente.
      </small>
    </form>
  );
}
