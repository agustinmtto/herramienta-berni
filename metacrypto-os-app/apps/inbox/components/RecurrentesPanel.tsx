"use client";
import { useState, useTransition } from "react";
import { editarRecurrente } from "@/app/actions";
import type { ReglaRecurrente } from "@/lib/recurrentes";

// Configuración de las sesiones grupales fijas (miércoles con Manuel, domingo
// con Berni) y su aviso de WhatsApp 1 h antes. La edición es deliberadamente
// pequeña: hora, enlace de Zoom y el interruptor. La audiencia se muestra pero
// no se edita — hoy solo existe "todos" (lista blanca en lib/recurrentes.ts).
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export default function RecurrentesPanel({
  reglas, coaches, audiencia, envioGlobal,
}: {
  reglas: ReglaRecurrente[];
  coaches: { id: string; nombre: string }[];
  audiencia: number;
  envioGlobal: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nombreCoach = (id: string | null) =>
    coaches.find((c) => c.id === id)?.nombre ?? "sin consultor";

  if (reglas.length === 0) return null;

  return (
    <div className="recurrentes">
      <div className="rc-head">
        <strong>Avisos de las sesiones semanales</strong>
        <span className="hint">
          Recordatorio de WhatsApp 1 h antes ({`plantilla recordatorio_1h_es`}) a todos
          los clientes activos con teléfono — hoy, {audiencia}.{" "}
          {envioGlobal
            ? "El envío global está ENCENDIDO."
            : "El envío global está APAGADO (se enciende con RECORDATORIO_GRUPAL_ACTIVO en Vercel)."}
        </span>
      </div>

      {reglas.map((r) => {
        const falta = !r.hora || !r.enlace;
        return (
          <form
            className="rc-fila"
            key={r.id}
            action={(fd) => {
              setError(null);
              setMensaje(null);
              start(async () => {
                const res = await editarRecurrente(fd);
                if (!res.ok) setError(res.error);
                else setMensaje(res.mensaje ?? "Guardado.");
              });
            }}
          >
            <input type="hidden" name="recurrente_id" value={r.id} />
            <div className="rc-datos">
              <span className="rc-dia">
                {DIAS[r.dia_semana] ?? `día ${r.dia_semana}`} con {nombreCoach(r.coach_id)}
              </span>
              {r.activa ? (
                <span className="pill green">aviso activo</span>
              ) : falta ? (
                <span className="pill orange">falta {!r.hora ? "hora" : "el link de Zoom"}</span>
              ) : (
                <span className="pill gris">apagado</span>
              )}
            </div>
            <div className="rc-form">
              <input
                className="sel rc-hora"
                type="time"
                name="hora"
                defaultValue={(r.hora ?? "").slice(0, 5)}
                aria-label="Hora (de España)"
              />
              <input
                className="sel rc-enlace"
                type="url"
                name="enlace"
                placeholder="Enlace de Zoom"
                defaultValue={r.enlace ?? ""}
              />
              <label className="rc-activa">
                <input type="checkbox" name="activa" value="1" defaultChecked={r.activa} />
                activo
              </label>
              <button className="btn primary" disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        );
      })}

      {error && <p className="cuota-error">{error}</p>}
      {mensaje && <p className="rc-ok">{mensaje}</p>}
    </div>
  );
}
