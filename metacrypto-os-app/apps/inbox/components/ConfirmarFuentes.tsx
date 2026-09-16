"use client";
// ============================================================
// Fuentes de atribución que GHL trajo NUEVAS y que nadie ha confirmado
// (`confirmado=false`, ver app/api/ghl/citas/route.ts). Mientras una fuente
// siga así, `comisionesDePago` (lib/comisiones.ts) la trata como incidencia
// `fuente_sin_confirmar` y ningún pago que la use genera comisión — cada
// pieza de contenido que Berni publica acuña un Source_ID nuevo, así que
// esta lista es la única forma de destrabar esas comisiones sin entrar a
// Supabase a mano.
//
// Parecido a BandejaAtribucion.tsx a propósito (mismo público, mismo
// patrón: cada fila es su propio <form>), pero NO el mismo dato: aquí se
// confirma el CATÁLOGO, no una venta puntual.
// ============================================================
import { useState, type FormEvent } from "react";
import { confirmarFuente } from "@/app/actions";
import { NIVELES_FUENTE } from "@/lib/confirmar-fuente";
import type { FuentePorConfirmar } from "@/lib/data";
import type { TeamMember } from "@/lib/types";
import { money } from "@/lib/format";

const ETIQUETA_NIVEL: Record<string, string> = {
  setter: "Setter",
  canal: "Canal",
  contenido: "Contenido",
  campana: "Campaña",
};

export default function ConfirmarFuentes({
  fuentes,
  team,
}: {
  fuentes: FuentePorConfirmar[];
  // Equipo completo — el desplegable de setter sale de aquí, con "sin
  // setter" como primera opción (AutoSetter, orgánico, piezas de contenido
  // no llevan setter; ver comentario largo en confirmar-fuente.ts sobre por
  // qué el nombre nunca se acepta suelto del formulario).
  team: TeamMember[];
}) {
  const [rows, setRows] = useState<FuentePorConfirmar[]>(fuentes);

  if (rows.length === 0) return null;

  return (
    <div className="atribucion-lista">
      {rows.map((f) => (
        <FilaFuente
          key={f.source_id}
          fuente={f}
          team={team}
          onConfirmada={() => setRows((rs) => rs.filter((r) => r.source_id !== f.source_id))}
        />
      ))}
    </div>
  );
}

function FilaFuente({
  fuente,
  team,
  onConfirmada,
}: {
  fuente: FuentePorConfirmar;
  team: TeamMember[];
  onConfirmada: () => void;
}) {
  // Precargado con lo que la fila ya trae: `fuente` arranca igual al propio
  // `source_id` (así la insertó /api/ghl/citas), `nivel` en "canal" y
  // `setter_id` en null — el operador edita lo que haga falta, no parte de
  // cero.
  const [nombre, setNombre] = useState(fuente.fuente);
  const [nivel, setNivel] = useState(fuente.nivel);
  const [setterId, setSetterId] = useState(fuente.setter_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nombreValido = nombre.trim().length > 0;

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    // Cinturón de seguridad además del `disabled` del botón: la defensa de
    // verdad vive en el servidor (confirmar-fuente.ts), esto solo evita un
    // envío en vano.
    if (!nombreValido) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.set("source_id", fuente.source_id);
    fd.set("fuente", nombre.trim());
    fd.set("nivel", nivel);
    fd.set("setter_id", setterId);
    const r = await confirmarFuente(fd);
    setBusy(false);
    if (r.ok) onConfirmada();
    else setError(r.error);
  }

  const enJuego =
    fuente.ventas_n === 0
      ? "Todavía ninguna venta usa esta fuente."
      : `${fuente.ventas_n} venta${fuente.ventas_n === 1 ? "" : "s"} ya usa` +
        `${fuente.ventas_n === 1 ? "" : "n"} esta fuente` +
        (fuente.ventas_por_divisa.length > 0
          ? ` · ${fuente.ventas_por_divisa.map((v) => money(v.monto, v.divisa)).join(" + ")} en juego`
          : "");

  return (
    <form onSubmit={confirmar} className="card atribucion-fila gasto-form">
      <div className="af-head">
        <strong className="mono">{fuente.source_id}</strong>
        <span className={fuente.ventas_n > 0 ? "gold" : "muted"}>{enJuego}</span>
      </div>

      <div className="gf-row">
        <label>
          Fuente (nombre legible)
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="p. ej. Instagram, AutoSetter…"
          />
        </label>
        <label>
          Nivel
          <select value={nivel} onChange={(e) => setNivel(e.target.value)}>
            {NIVELES_FUENTE.map((n) => (
              <option key={n} value={n}>
                {ETIQUETA_NIVEL[n]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Setter
        <select value={setterId} onChange={(e) => setSetterId(e.target.value)}>
          <option value="">Sin setter (AutoSetter, orgánico, contenido)</option>
          {team.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="aviso">{error}</p>}

      <div className="gf-actions">
        <button className="btn primary" type="submit" disabled={!nombreValido || busy}>
          {busy ? "Confirmando…" : "Confirmar"}
        </button>
      </div>
    </form>
  );
}
