"use client";
// ============================================================
// Corrección de ventas YA atribuidas (diseño § 4.2, no construido en el
// primer build). Sin esto, `atribucion_at is not null` es un candado de un
// solo sentido: nada en el OS vuelve a leerlo, así que una cita equivocada
// o un "no vino de agenda" pulsado por error queda mal PARA SIEMPRE.
//
// Deliberadamente parecido a BandejaAtribucion.tsx pero NO el mismo
// componente: aquí la atribución YA existe, así que cada fila arranca con
// el selector precargado en lo que hay guardado (en vez de vacío) y el
// texto dice "corregir", no "atribuir" — mezclar los dos casos en un mismo
// componente escondería cuál es cuál.
// ============================================================
import { useState, type FormEvent } from "react";
import Link from "next/link";
import SelectorAgenda, { type AtribucionElegida } from "./SelectorAgenda";
import { atribuirVenta } from "@/app/actions";
import type { VentaAtribuida } from "@/lib/data";
import type { TeamMember } from "@/lib/types";
import { money, dateEs } from "@/lib/format";

export default function CorreccionAtribucion({
  ventas,
  team,
}: {
  ventas: VentaAtribuida[];
  team: TeamMember[];
}) {
  const [rows, setRows] = useState<VentaAtribuida[]>(ventas);

  if (rows.length === 0) {
    return <p className="hint">No hay ventas atribuidas en el cierre actual que corregir.</p>;
  }

  return (
    <div className="atribucion-lista">
      {rows.map((v) => (
        <FilaCorreccion
          key={v.id}
          venta={v}
          team={team}
          onGuardada={() =>
            // No se quita de la lista local: sigue atribuida (a lo mejor a
            // otra cosa) y sigue siendo corregible. Solo se limpia el aviso.
            setRows((rs) => rs.map((r) => (r.id === v.id ? { ...r } : r)))
          }
        />
      ))}
    </div>
  );
}

function FilaCorreccion({
  venta,
  team,
  onGuardada,
}: {
  venta: VentaAtribuida;
  team: TeamMember[];
  onGuardada: () => void;
}) {
  // Precargado con lo que YA está guardado — a diferencia de la bandeja de
  // pendientes, que arranca en null. `SelectorAgenda` ya sabe marcar el
  // radio correcto si el `ghlAppointmentId` guardado aparece entre las
  // citas que devuelve GHL (y si no aparece —p.ej. está fuera de la
  // ventana de 365 días—, simplemente no marca ninguna: el operador elige
  // de nuevo, que es razonable para una cita tan vieja).
  const [atribucion, setAtribucion] = useState<AtribucionElegida | null>({
    sourceId: venta.source_id,
    setterId: venta.setter_id,
    closerId: venta.closer_id,
    ghlAppointmentId: venta.ghl_appointment_id,
  });
  const [upsellPor, setUpsellPor] = useState(venta.upsell_por_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [guardadoOk, setGuardadoOk] = useState(false);
  // Misma regla que en BandejaAtribucion: renovación cobra igual que
  // ascensión desde el fix de lib/comisiones.ts.
  const esAscension = venta.motivo === "upsell" || venta.motivo === "renovacion";

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (atribucion === null) return;
    setBusy(true);
    setError("");
    setGuardadoOk(false);
    const fd = new FormData();
    fd.set("programaId", venta.id);
    fd.set("source_id", atribucion.sourceId ?? "");
    fd.set("setter_id", atribucion.setterId ?? "");
    fd.set("closer_id", atribucion.closerId ?? "");
    fd.set("ghl_appointment_id", atribucion.ghlAppointmentId ?? "");
    fd.set("upsell_por_id", upsellPor);
    // Una corrección siempre es una decisión — no tiene sentido "dejar para
    // después" algo que ya estaba decidido.
    fd.set("decidido", "true");
    const r = await atribuirVenta(fd);
    setBusy(false);
    if (r.ok) {
      setGuardadoOk(true);
      onGuardada();
    } else setError(r.error);
  }

  return (
    <form onSubmit={guardar} className="card atribucion-fila gasto-form">
      <div className="af-head">
        {/* Pestaña nueva, igual que en la bandeja: este formulario lleva
            estado sin guardar y navegar encima lo tiraría. */}
        <Link href={`/clientes/${venta.persona_id}`} className="af-nombre"
              target="_blank" rel="noopener">
          <strong>{venta.persona_nombre}</strong>
        </Link>
        <span className="muted">
          {dateEs(venta.fecha_inicio)} · tier {venta.tier} · {money(venta.monto, venta.divisa)}
          {esAscension ? " · ascensión/renovación" : ""}
        </span>
      </div>
      <p className="hint">
        Atribuido actualmente a: {venta.fuente ?? (venta.source_id ? venta.source_id : "sin fuente")}
        {/* Sin cita YA no significa "no vino de agenda": desde el respaldo
            manual puede ser una venta cuyo closer se puso a mano porque su
            llamada no aparecía. Decir lo mismo en los dos casos invitaba a
            "corregir" lo que ya estaba bien. */}
        {venta.ghl_appointment_id
          ? ""
          : venta.closer_id
            ? " (sin cita, puesto a mano)"
            : " (no vino de agenda)"}
      </p>

      <SelectorAgenda
        personaId={venta.persona_id}
        email={venta.persona_email}
        telefono={venta.persona_telefono}
        team={team}
        value={atribucion}
        onChange={setAtribucion}
      />

      {esAscension && (
        <label>
          ¿Quién hizo esta ascensión?
          <select value={upsellPor} onChange={(e) => setUpsellPor(e.target.value)}>
            <option value="">— elegir —</option>
            {team.filter((t) => t.rol !== "setter").map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="aviso">{error}</p>}
      {guardadoOk && !error && <p className="hint">✓ Corrección guardada.</p>}

      <div className="gf-actions">
        <button className="btn" type="submit" disabled={atribucion === null || busy}>
          {busy ? "Guardando…" : "Guardar corrección"}
        </button>
      </div>
    </form>
  );
}
