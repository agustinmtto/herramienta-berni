"use client";
// ============================================================
// Bandeja de ventas sin atribuir (/atribucion). Cada fila es su propio
// formulario: elegir agenda (SelectorAgenda) y, si es una ascensión, quién
// la hizo. Al guardar con éxito, la fila desaparece de la lista local — el
// contador de la página vuelve a ser exacto en la siguiente carga (revalida
// /atribucion en el servidor).
// ============================================================
import { useState, type FormEvent } from "react";
import Link from "next/link";
import SelectorAgenda, { type AtribucionElegida } from "./SelectorAgenda";
import { atribuirVenta } from "@/app/actions";
import type { VentaSinAtribuir } from "@/lib/data";
import type { TeamMember } from "@/lib/types";
import { money, dateEs } from "@/lib/format";
import { ATRIBUCION_CORTE } from "@/lib/comisiones";

export default function BandejaAtribucion({
  ventas,
  team,
}: {
  ventas: VentaSinAtribuir[];
  // Equipo completo — el desplegable de ascensión filtra los setters aquí
  // mismo, igual que en VentaForm.tsx (un setter no hace ascensiones).
  team: TeamMember[];
}) {
  const [rows, setRows] = useState<VentaSinAtribuir[]>(ventas);

  return (
    <div className="atribucion-lista">
      {rows.map((v) => (
        <Fila
          key={v.id}
          venta={v}
          team={team}
          onGuardada={() => setRows((rs) => rs.filter((r) => r.id !== v.id))}
        />
      ))}
    </div>
  );
}

function Fila({
  venta,
  team,
  onGuardada,
}: {
  venta: VentaSinAtribuir;
  team: TeamMember[];
  onGuardada: () => void;
}) {
  const [atribucion, setAtribucion] = useState<AtribucionElegida | null>(null);
  const [upsellPor, setUpsellPor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // `renovacion` cobra igual que `upsell` desde el fix de lib/comisiones.ts
  // (cliente existente, sin setter, closer + quien la hizo): la pregunta
  // tiene que aparecer también aquí, o una renovación que caiga en la
  // bandeja nunca podría rellenar `upsell_por_id` y quedaría marcada
  // "ascension_sin_autor" para siempre.
  const esAscension = venta.motivo === "upsell" || venta.motivo === "renovacion";
  // Explica el caso raro: una venta de antes del corte que igual aparece
  // aquí porque todavía tiene un cobro pendiente que sí devenga comisión.
  // Sin esto, vería una venta "vieja" en la bandeja y no sabría por qué no
  // está en el histórico de abajo.
  const esHistoricoConCuota = venta.fecha_inicio < ATRIBUCION_CORTE && venta.tiene_cuota_pendiente;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    // Cinturón de seguridad además del `disabled` del botón: sin decisión
    // ("lo dejo para después") no hay nada que enviar.
    if (atribucion === null) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.set("programaId", venta.id);
    fd.set("source_id", atribucion.sourceId ?? "");
    fd.set("setter_id", atribucion.setterId ?? "");
    fd.set("closer_id", atribucion.closerId ?? "");
    fd.set("ghl_appointment_id", atribucion.ghlAppointmentId ?? "");
    fd.set("upsell_por_id", upsellPor);
    fd.set("decidido", "true");
    const r = await atribuirVenta(fd);
    setBusy(false);
    if (r.ok) onGuardada();
    else setError(r.error);
  }

  return (
    <form onSubmit={guardar} className="card atribucion-fila gasto-form">
      <div className="af-head">
        {/* El nombre lleva a su ficha: al atribuir una venta hay que poder
            comprobar de quién se está hablando sin perder lo tecleado. Se
            abre en pestaña nueva por eso mismo — este formulario tiene estado
            sin guardar y navegar encima lo tiraría. */}
        <Link href={`/clientes/${venta.persona_id}`} className="af-nombre"
              target="_blank" rel="noopener">
          <strong>{venta.persona_nombre}</strong>
        </Link>
        <span className="muted">
          {dateEs(venta.fecha_inicio)} · tier {venta.tier} · {money(venta.monto, venta.divisa)}
          {esAscension ? " · ascensión" : ""}
          {esHistoricoConCuota ? " · anterior al corte, con cuota pendiente" : ""}
        </span>
      </div>

      {/* Aquí siempre hay persona_id real (la venta ya está registrada), pero
          eso NO basta: solo 5 de 179 personas tienen `ghl_contact_id`. Se
          pasan también email/teléfono para que `/api/ghl/citas` pueda
          encadenar al fallback de búsqueda en GHL cuando `personaId` no
          resuelve contacto — igual que ya hace VentaForm para una compra
          nueva. Sin esto, la ruta devuelve `{citas: []}` para 16 de las 21
          ventas del cierre y la única opción visible es "no vino de
          agenda", que sella la atribución de forma irreversible. */}
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

      <div className="gf-actions">
        <button className="btn primary" type="submit" disabled={atribucion === null || busy}>
          {busy ? "Guardando…" : "Guardar atribución"}
        </button>
      </div>
    </form>
  );
}
