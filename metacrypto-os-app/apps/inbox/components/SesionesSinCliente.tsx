"use client";
import { useState, useTransition } from "react";
import { asignarClienteSesion } from "@/app/actions";
import type { SesionRow } from "@/lib/sesiones-datos";

// La bandeja de sesiones huérfanas. `sesiones.persona_id` es opcional desde la
// 0025 para que una cita de GoHighLevel cuyo contacto no cruza con `personas`
// se guarde igual en vez de perderse — pero sin esta franja no aparecen en
// ninguna pantalla, no cuentan en ningún cupo, y se acumulan invisibles.
// Mismo papel que la bandeja de ventas sin atribuir.
export default function SesionesSinCliente({
  sesiones, clientes,
}: {
  sesiones: SesionRow[];
  clientes: { id: string; nombre: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [asignando, setAsignando] = useState<string | null>(null);

  return (
    <div className="bandeja-sesiones">
      <div className="bs-head">
        <strong>
          {sesiones.length === 1
            ? "1 sesión sin cliente asignado"
            : `${sesiones.length} sesiones sin cliente asignado`}
        </strong>
        <span className="hint">
          Vinieron de GoHighLevel y su contacto no cruzó con ningún cliente del OS.
          Hasta que se asignen no cuentan en el cupo de nadie.
        </span>
      </div>

      {sesiones.map((s) => (
        <div className="bs-fila" key={s.id}>
          <div className="bs-datos">
            <span className="mono bs-fecha">{fechaHora(s.fecha)}</span>
            <span className="pill purple">{s.coach ?? "sin consultor"}</span>
            {s.enlace && (
              <a className="linkbtn" href={s.enlace} target="_blank" rel="noreferrer">
                sala
              </a>
            )}
          </div>
          {asignando === s.id ? (
            <form
              className="bs-form"
              action={(fd) => {
                setError(null);
                start(async () => {
                  const r = await asignarClienteSesion(fd);
                  if (!r.ok) setError(r.error);
                  else setAsignando(null);
                });
              }}
            >
              <input type="hidden" name="sesion_id" value={s.id} />
              <select name="persona_id" required defaultValue="" className="sel">
                <option value="" disabled>Elige cliente…</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
              <button className="btn primary" disabled={pending}>
                {pending ? "Asignando…" : "Asignar"}
              </button>
              <button type="button" className="btn" onClick={() => setAsignando(null)}>
                Cancelar
              </button>
            </form>
          ) : (
            <button className="btn" onClick={() => { setError(null); setAsignando(s.id); }}>
              Asignar cliente
            </button>
          )}
        </div>
      ))}

      {error && <p className="cuota-error">{error}</p>}
    </div>
  );
}

// Estas sesiones SÍ llevan hora real: vienen de GoHighLevel, no del backfill de
// Airtable que puso 12:00 a todo. Por eso aquí se muestra y en el histórico no.
function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}
