"use client";
// Picker de vinculación post-venta (docs/11 §9) + rollback (§9.3) + descarte (§9.4).
//
// ⚠ El OS corre React 18: useActionState NO existe allí (llegó en React 19)
// y un componente que lo use se crashea en la hidratación — el HTML se ve
// bien pero NINGÚN click hace nada. Por eso esto es un onSubmit manual con
// useTransition, que sí existe en 18.

import { useEffect, useState, useTransition } from "react";
import { descartarLeadAccion, desvincularLeadAccion, vincularLeadAccion, buscarClientesParaVincular } from "@/app/leads-actions";
import type { ClienteParaVincular } from "@/lib/leads";

type Resultado = { ok: boolean; error?: string; mensaje?: string };

export default function VincularLead({
  leadPersonaId,
  leadTelefono,
  clientes,
  personaEstado,
  leadVinculadoId = null,
}: {
  leadPersonaId: string;
  leadTelefono: string | null; // teléfono capturado en el quiz (snapshot del envío)
  clientes: ClienteParaVincular[];
  personaEstado: string | null;
  leadVinculadoId?: string | null; // lead temporal que ya fue vinculado (auditoría)
}) {
  if (!leadPersonaId) {
    return <p className="vincular-nota">Este envío no llegó a completarse: no hay lead temporal que vincular.</p>;
  }
  // El RPC revalida TODO; acá solo decidimos QUÉ pantalla mostrar.
  if (personaEstado === "cliente") {
    return <Desvincular clienteId={leadPersonaId} leadPersonaId={leadVinculadoId} />;
  }
  if (personaEstado === "descartado") {
    return <p className="vincular-nota">El lead fue descartado por el triaje (no hubo venta). Queda auditado; la reactivación es manual.</p>;
  }
  if (personaEstado === "archivado") {
    return <p className="vincular-nota">El lead temporal de este envío ya fue vinculado y archivado.</p>;
  }
  // Persona temporal viva: se puede vincular (hubo venta) o descartar (no la hubo).
  return (
    <div className="vincular-form">
      <Picker leadPersonaId={leadPersonaId} leadTelefono={leadTelefono} clientes={clientes} />
      <Descartar leadPersonaId={leadPersonaId} />
    </div>
  );
}

// ── vinculación (docs/11 §9.1): con aviso y confirmación si el teléfono difiere ──
function Picker({
  leadPersonaId,
  leadTelefono,
  clientes,
}: {
  leadPersonaId: string;
  leadTelefono: string | null;
  clientes: ClienteParaVincular[];
}) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();
  const [clienteId, setClienteId] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [lista, setLista] = useState<ClienteParaVincular[]>(clientes);
  const [buscando, setBuscando] = useState(false);

  // Búsqueda SERVER-SIDE con debounce (auditoría v4 I8): antes se filtraba
  // localmente sobre los primeros 500 cargados — clientes fuera de ese lote
  // eran inalcanzables. Ahora cada búsqueda consulta PostgREST.
  useEffect(() => {
    const q = busqueda.trim();
    if (!q) {
      setLista(clientes);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await buscarClientesParaVincular(q);
        setLista(res.clientes);
        setBuscando(false);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, clientes]);

  // La comparación EXACTA la hace el RPC (server); acá es solo para mostrar
  // el aviso y exigir la confirmación visible (docs/11 §9.1).
  const cliente = lista.find((c) => c.id === clienteId) ?? null;
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
      <input
        type="text"
        className="vincular-busqueda"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar cliente por nombre, email o teléfono…"
      />
      <select name="clienteId" value={clienteId} onChange={(e) => { setClienteId(e.target.value); setResultado(null); setConfirmado(false); }} required>
        <option value="" disabled>
          {buscando ? "Buscando…" : "Elegí el cliente definitivo…"}
        </option>
        {lista.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
            {c.programa ? ` · ${c.programa}` : ""}
            {c.telefono_e164 ? ` — ${c.telefono_e164}` : c.email ? ` — ${c.email}` : ""}
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
        Si te equivocás, hay un botón para desvincular y revertir; si no hubo venta, el camino es descartar.
      </small>
    </form>
  );
}

// ── camino sin venta (docs/11 §9.4): el lead sale del ciclo, con auditoría ───
function Descartar({ leadPersonaId }: { leadPersonaId: string }) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  const descartar = () => {
    const formData = new FormData();
    formData.set("leadPersonaId", leadPersonaId);
    startTransition(async () => {
      setResultado(await descartarLeadAccion(formData));
      setConfirmando(false);
    });
  };

  return (
    <div className="vincular-descarte">
      {!confirmando ? (
        <button type="button" className="vincular-rollback" disabled={pending} onClick={() => setConfirmando(true)}>
          Descartar lead (sin venta)
        </button>
      ) : (
        <>
          <span>¿Seguro? Sin venta el lead queda fuera del ciclo comercial (no se borra nada).</span>
          <button type="button" className="vincular-rollback" disabled={pending} onClick={descartar}>
            {pending ? "Descartando…" : "Sí, descartar"}
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

// ── rollback (docs/11 §9.3): visible cuando el envío ya es del cliente ───────
function Desvincular({ clienteId, leadPersonaId = null }: { clienteId: string; leadPersonaId?: string | null }) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);

  const revertir = () => {
    const formData = new FormData();
    formData.set("clienteId", clienteId);
    if (leadPersonaId) formData.set("leadPersonaId", leadPersonaId);
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
      <small className="vincular-nota">
        Revierte exactamente la vinculación de este envío. Si el cliente recibió vinculaciones de varios
        leads, cada una se revierte por separado.
      </small>
    </div>
  );
}
