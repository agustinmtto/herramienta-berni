"use client";
// Picker de vinculación post-venta (docs/11 §9) + rollback (§9.3).
//
// ⚠ El OS corre React 18: useActionState NO existe allí (llegó en React 19)
// y un componente que lo use se crashea en la hidratación — el HTML se ve
// bien pero NINGÚN click hace nada. Por eso esto es un onSubmit manual con
// useTransition, que sí existe en 18.

import { useState, useTransition } from "react";
import { desvincularLeadAccion, vincularLeadAccion } from "@/app/leads-actions";

type Resultado = { ok: boolean; error?: string; mensaje?: string };

export default function VincularLead({
  leadPersonaId,
  leadTelefono,
  clientes,
  personaEstado,
}: {
  leadPersonaId: string;
  leadTelefono: string | null; // teléfono capturado en el quiz (snapshot del envío)
  clientes: { id: string; nombre: string; email: string | null; telefono_e164: string | null }[];
  personaEstado: string | null;
}) {
  if (!leadPersonaId) {
    return <p className="vincular-nota">Este envío no llegó a completarse: no hay lead temporal que vincular.</p>;
  }
  // El RPC revalida TODO; acá solo decidimos QUÉ pantalla mostrar.
  if (personaEstado === "cliente") {
    return <Desvincular clienteId={leadPersonaId} />;
  }
  if (personaEstado === "archivado") {
    return <p className="vincular-nota">El lead temporal de este envío ya fue vinculado y archivado.</p>;
  }
  return <Picker leadPersonaId={leadPersonaId} leadTelefono={leadTelefono} clientes={clientes} />;
}

// ── vinculación (docs/11 §9.1): con aviso y confirmación si el teléfono difiere ──
function Picker({
  leadPersonaId,
  leadTelefono,
  clientes,
}: {
  leadPersonaId: string;
  leadTelefono: string | null;
  clientes: { id: string; nombre: string; email: string | null; telefono_e164: string | null }[];
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();
  const [clienteId, setClienteId] = useState("");
  const [confirmado, setConfirmado] = useState(false);

  // La comparación EXACTA la hace el RPC (server); acá es solo para mostrar
  // el aviso y exigir la confirmación visible (docs/11 §9.1).
  const cliente = clientes.find((c) => c.id === clienteId) ?? null;
  const telefonosDifieren = Boolean(
    cliente && (cliente.telefono_e164 ?? "") !== (leadTelefono ?? "")
  );

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (telefonosDifieren && !confirmado) {
      setResultado({ ok: false, error: "Los teléfonos no coinciden: marcá la confirmación para vincular de todos modos." });
      return;
    }
    startTransition(async () => {
      setResultado(await vincularLeadAccion(formData));
    });
  };

  return (
    <form onSubmit={onSubmit} className="vincular-form">
      <input type="hidden" name="leadPersonaId" value={leadPersonaId} />
      <select name="clienteId" value={clienteId} onChange={(e) => { setClienteId(e.target.value); setResultado(null); setConfirmado(false); }} required>
        <option value="" disabled>
          Elegí el cliente definitivo…
        </option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}{c.telefono_e164 ? ` — ${c.telefono_e164}` : c.email ? ` — ${c.email}` : ""}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending || !clienteId}>
        {pending ? "Vinculando…" : "Vincular con cliente"}
      </button>

      {telefonosDifieren && (
        <div className="vincular-warning">
          <strong>Teléfonos distintos.</strong> Quiz: <code>{leadTelefono || "sin teléfono"}</code> · Cliente:{" "}
          <code>{cliente!.telefono_e164 || "sin teléfono"}</code>
          <label>
            {/* name="confirmar" es OBLIGATORIO: sin name el dato nunca llega
                en el FormData y el RPC rechaza aunque el usuario lo marque. */}
            <input type="checkbox" name="confirmar" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
            Confirmo que es la misma persona y quiero vincular de todos modos
          </label>
        </div>
      )}

      {resultado?.ok && resultado.mensaje && <span className="vincular-ok">{resultado.mensaje}</span>}
      {resultado && !resultado.ok && resultado.error && <span className="vincular-error">{resultado.error}</span>}
      <small className="vincular-nota">
        Los diagnósticos pasan al cliente elegido y el lead temporal se archiva. No modifica ningún dato del cliente.
        Si te equivocás, hay un botón para desvincular y revertir.
      </small>
    </form>
  );
}

// ── rollback (docs/11 §9.3): visible cuando el envío ya es del cliente ───────
function Desvincular({ clienteId }: { clienteId: string }) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  const revertir = () => {
    const formData = new FormData();
    formData.set("clienteId", clienteId);
    startTransition(async () => {
      setResultado(await desvincularLeadAccion(formData));
      setConfirmando(false);
    });
  };

  return (
    <div className="vincular-form">
      <p className="vincular-nota">Los diagnósticos de este envío ya pertenecen al cliente definitivo.</p>
      {!confirmando ? (
        <button type="button" className="vincular-rollback" disabled={pending} onClick={() => setConfirmando(true)}>
          Desvincular (revertir)
        </button>
      ) : (
        <>
          <span>¿Seguro? Los envíos volverán al lead temporal.</span>
          <button type="button" className="vincular-rollback" disabled={pending} onClick={revertir}>
            {pending ? "Revirtiendo…" : "Sí, desvincular"}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </>
      )}
      {resultado?.ok && resultado.mensaje && <span className="vincular-ok">{resultado.mensaje}</span>}
      {resultado && !resultado.ok && resultado.error && <span className="vincular-error">{resultado.error}</span>}
    </div>
  );
}
