"use client";
import { useState, useTransition } from "react";
import { crearCuota } from "@/app/actions";
import Modal from "@/components/Modal";
import { confirmar } from "@/components/Confirmacion";

export default function NuevaCuota({ programas }: { programas: { id: string; etiqueta: string }[] }) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <>
      <button className="btn" onClick={() => setAbierto(true)}>+ Añadir cuota</button>
      {abierto && (
        <Modal titulo="Añadir cuota" onCerrar={() => setAbierto(false)}>
            <form action={(fd) => {
              setError(null);
              start(async () => {
                const r = await crearCuota(fd);
                if (!r.ok) setError(r.error);
                else { confirmar(r.mensaje); setAbierto(false); }
              });
            }}>
              <label>Cliente / programa
                <select name="programa_id" required defaultValue="">
                  <option value="" disabled>Elige…</option>
                  {programas.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
                </select>
              </label>
              <label>Importe
                <input name="monto" type="number" step="0.01" min="0.01" required />
              </label>
              <label>Vencimiento
                <input name="fecha_vencimiento" type="date" required />
              </label>
              {error && <p className="cuota-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setAbierto(false)}>Cancelar</button>
                <button className="btn primary" disabled={pending}>{pending ? "Guardando…" : "Añadir"}</button>
              </div>
            </form>
        </Modal>
      )}
    </>
  );
}
