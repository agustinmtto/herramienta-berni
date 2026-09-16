"use client";
import { useState, useTransition } from "react";
import {
  pagarCuota, editarCuota, deshacerPagoCuota, anularCuota, reactivarCuota,
} from "@/app/actions";
import { saldoTrasAbono, money2 } from "@/lib/cuotas";
import { confirmar } from "@/components/Confirmacion";
import Modal from "@/components/Modal";
import { dateEs } from "@/lib/format";
import type { CuotaDetalle, CuotaResult } from "@/lib/types";

const METODOS = ["Stripe", "Transferencia", "Crypto", "Efectivo", "Otro"];

export default function CuotaAcciones({ cuota, hoy }: { cuota: CuotaDetalle; hoy: string }) {
  const [modal, setModal] = useState<null | "pago" | "editar" | "anular">(null);
  const [error, setError] = useState<string | null>(null);
  const [importe, setImporte] = useState(String(cuota.monto));
  const [pending, start] = useTransition();

  const saldo = saldoTrasAbono(cuota.monto, Number(importe) || 0);

  function enviar(accion: (fd: FormData) => Promise<CuotaResult>, fd: FormData) {
    setError(null);
    start(async () => {
      const r = await accion(fd);
      if (!r.ok) setError(r.error);
      else {
        // El servidor redacta el mensaje ("Pago deshecho — la cuota vuelve a
        // estar pendiente.") y hasta ahora se descartaba aquí mismo. Va por
        // el aviso global y no por el estado de esta fila porque las cuatro
        // acciones revalidan /cuotas y mueven la cuota de bloque: la fila se
        // remonta y se llevaría el mensaje por delante.
        confirmar(r.mensaje);
        setModal(null);
      }
    });
  }

  // Cierra/cambia de modal SIEMPRE limpiando el error: sin esto, un error de un
  // modal (p.ej. pago rechazado) sobrevive a Cancelar y reaparece dentro del
  // OTRO modal (p.ej. editar) la próxima vez que se abre.
  function cambiarModal(next: typeof modal) { setError(null); setModal(next); }

  return (
    <>
      <div className="cuota-acciones">
        {cuota.estado === "pendiente" && (
          <>
            <button className="btn primary" onClick={() => { setImporte(String(cuota.monto)); cambiarModal("pago"); }}>
              Pagada
            </button>
            <button className="btn" onClick={() => cambiarModal("editar")}>Editar</button>
            {/* Anular no es borrar: la cuota sale de las cuentas pero queda
                con su motivo en la auditoría, y se puede reactivar. Es el
                caso del cliente al que se da de baja. */}
            <button className="btn" onClick={() => cambiarModal("anular")}>Anular</button>
          </>
        )}
        {cuota.estado === "anulada" && (
          <form action={(fd) => enviar(reactivarCuota, fd)}>
            <input type="hidden" name="cuota_id" value={cuota.id} />
            <button className="btn" disabled={pending}>Reactivar</button>
          </form>
        )}
        {cuota.abonos.map((a) => (
          <form key={a.id} action={(fd) => enviar(deshacerPagoCuota, fd)}>
            <input type="hidden" name="pago_id" value={a.id} />
            <button className="btn" disabled={pending}
                    title={`Deshacer el abono de ${money2(a.monto, cuota.divisa)} del ${a.fecha}`}>
              Deshacer{cuota.abonos.length > 1 ? ` ${money2(a.monto, cuota.divisa)}` : ""}
            </button>
          </form>
        ))}
        {/* El Deshacer vive fuera de los modales (no hay modal que abrir para
            deshacer). Sin este párrafo, un fallo del RPC (p.ej. "El pago no
            existe" si otro operador ya lo deshizo) se guardaba en `error` y
            no tenía dónde pintarse: el usuario no veía nada y creía que la
            app estaba rota o que el click sí había funcionado. */}
        {modal === null && error && <p className="cuota-error">{error}</p>}
      </div>

      {modal === "pago" && (
        <Modal
          titulo="Marcar cuota pagada"
          subtitulo={`${cuota.persona_nombre ?? "—"} · cuota ${cuota.numero_cuota ?? "—"} · vencía ${dateEs(cuota.fecha_vencimiento)}`}
          onCerrar={() => cambiarModal(null)}
        >
            <form action={(fd) => enviar(pagarCuota, fd)}>
              <input type="hidden" name="cuota_id" value={cuota.id} />
              <label>Importe
                <input name="importe" type="number" step="0.01" min="0.01" required
                       value={importe} onChange={(e) => setImporte(e.target.value)} />
              </label>
              <label>Fecha
                <input name="fecha" type="date" required defaultValue={hoy} max={hoy} />
              </label>
              <label>Método de pago
                <select name="metodo_pago" defaultValue="Stripe">
                  {METODOS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              {/* Obligatorio desde el 14-ago: la comisión se calcula sobre
                  el dólar cobrado. Sin el dato, esta cuota llegaría al cierre
                  del mes sin poder pagarle a nadie. */}
              <label>USD recibido
                <input name="usd_recibido" type="number" step="0.01" min="0.01" required
                       placeholder="lo que entró en dólares" />
              </label>
              <label>Comprobante (opcional)
                <input name="comprobante" type="file" accept="image/png,image/jpeg,application/pdf" />
              </label>
              {saldo > 0 && (
                <p className="note">
                  Abono parcial: quedarán <strong>{money2(saldo, cuota.divisa)}</strong> pendientes.
                </p>
              )}
              {error && <p className="cuota-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => cambiarModal(null)}>Cancelar</button>
                <button className="btn primary" disabled={pending}>
                  {pending ? "Guardando…" : "Confirmar pago"}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {modal === "editar" && (
        <Modal titulo="Editar cuota" onCerrar={() => cambiarModal(null)}>
            <form action={(fd) => enviar(editarCuota, fd)}>
              <input type="hidden" name="cuota_id" value={cuota.id} />
              <label>Importe
                <input name="monto" type="number" step="0.01" min="0.01" defaultValue={cuota.monto} />
              </label>
              <label>Vencimiento
                <input name="fecha_vencimiento" type="date" defaultValue={cuota.fecha_vencimiento} />
              </label>
              {error && <p className="cuota-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => cambiarModal(null)}>Cancelar</button>
                <button className="btn primary" disabled={pending}>
                  {pending ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
        </Modal>
      )}
      {modal === "anular" && (
        <Modal
          titulo="Anular cuota"
          subtitulo={`${cuota.persona_nombre ?? "—"} · ${money2(cuota.monto, cuota.divisa)} · vence ${dateEs(cuota.fecha_vencimiento)}`}
          onCerrar={() => cambiarModal(null)}
        >
            <form action={(fd) => enviar(anularCuota, fd)}>
              <input type="hidden" name="cuota_id" value={cuota.id} />
              <label>Motivo
                <input name="motivo" type="text" required maxLength={200}
                       placeholder="p. ej. cliente dado de baja por impago" />
              </label>
              <p className="note">
                La cuota deja de contar en “por cobrar” y en las vencidas, pero
                <strong> no se borra</strong>: queda con este motivo en la auditoría
                y se puede reactivar.
              </p>
              {error && <p className="cuota-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => cambiarModal(null)}>Cancelar</button>
                <button className="btn primary" disabled={pending}>
                  {pending ? "Anulando…" : "Anular cuota"}
                </button>
              </div>
            </form>
        </Modal>
      )}
    </>
  );
}
