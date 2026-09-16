"use client";
import { useEffect, useState } from "react";
import type { EfectoDevolucion } from "@/lib/types";
import { money, dateEs } from "@/lib/format";

// Cada acción se traduce a una frase que se lee sin saber cómo está hecho el
// sistema. Un `estado_persona` crudo no le dice nada a Berni.
const TITULO: Record<string, string> = {
  devolucion_registrada: "Devolución registrada",
  devolucion_clasificada: "Clasificada",
  cash_afectado: "Cash afectado",
  cuota_anulada: "Cuota anulada",
  estado_persona: "Estado del cliente",
  comision_revertida: "Comisión revertida",
  devolucion_deshecha: "Devolución deshecha",
};

function describe(e: EfectoDevolucion, nombres: Record<string, string>): string {
  const d = e.datos as Record<string, unknown>;
  const n = (k: string) => Number(d[k] ?? 0);
  const s = (k: string) => String(d[k] ?? "");
  switch (e.accion) {
    case "devolucion_registrada":
      return `${s("alcance")} · ${money(n("eur"))} · ${money(n("usd"), "USD")} — «${s("motivo")}»`;
    case "devolucion_clasificada":
      return `${s("antes")} → ${s("despues")} — «${s("motivo")}»`;
    case "cash_afectado":
      return `mes ${s("mes")} · ${money(n("eur"))} / ${money(n("usd"), "USD")}`;
    case "cuota_anulada":
      return `cuota ${s("numero_cuota")} · ${money(n("monto"))} · vencía ${dateEs(s("fecha_vencimiento"))}`;
    case "estado_persona":
      return `${s("antes")} → ${s("despues")}`;
    case "comision_revertida": {
      const quien = s("nombre") || nombres[s("team_member_id")] || s("team_member_id");
      return `${quien} · ${s("rol")} · ${money(n("importe"), "USD")}`;
    }
    case "devolucion_deshecha":
      return `${s("cuotas_reactivadas")} cuotas reactivadas · estado repuesto: ${s("estado_repuesto") || "sin cambio"}`;
    default:
      return JSON.stringify(d);
  }
}

export default function DevolucionRecibo({
  id,
  nombres,
}: {
  id: string;
  nombres: Record<string, string>;
}) {
  const [efectos, setEfectos] = useState<EfectoDevolucion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/devoluciones/${id}/recibo`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => vivo && setEfectos(d))
      .catch(() => vivo && setError("No se pudo cargar el recibo. Recarga la página."));
    return () => {
      vivo = false;
    };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!efectos) return <p className="muted">Cargando el recibo…</p>;
  if (efectos.length === 0)
    return <p className="muted">Sin efectos registrados (devolución heredada de Airtable).</p>;

  return (
    <div className="empty-box izq">
      <div className="hint" style={{ marginBottom: 8 }}>
        Qué pasó, cuándo, y dónde pegó
      </div>
      <ol style={{ margin: 0, paddingLeft: "1.2em", display: "grid", gap: 6 }}>
        {efectos.map((e, i) => (
          <li key={i}>
            <strong>{TITULO[e.accion] ?? e.accion}</strong>{" "}
            <span className="mono muted">{describe(e, nombres)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
