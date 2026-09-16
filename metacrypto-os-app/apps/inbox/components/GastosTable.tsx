"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import type { GastoRow } from "@/lib/types";
import { money, dateEs } from "@/lib/format";
import { editarGasto, eliminarGasto } from "@/app/actions";

const CATEGORIAS = ["Software", "Salario", "Herramientas", "Gastos LLC", "Formación", "Otros", "Ads", "Comisiones"];
const TIPOS = ["Gasto único", "Gasto recurrente"];
const METODOS = ["Cripto", "Transferencia", "Tarjeta"];

export default function GastosTable({
  gastos,
  onDetalle,
}: {
  gastos: GastoRow[];
  /** Abrir la ficha del gasto. Sin esta prop, la fila no es pulsable. */
  onDetalle?: (g: GastoRow) => void;
}) {
  // `gastos` es la fuente, no una semilla. Antes esto era
  // `useState<GastoRow[]>(gastos)` y NUNCA se resincronizaba: al registrar un
  // gasto nuevo, los KPIs del servidor subían y la tabla se quedaba igual, así
  // que la pantalla se contradecía sola y el gasto se registraba dos veces.
  // Ahora el estado local solo guarda lo que esta tabla ha cambiado por su
  // cuenta (una edición o un borrado) mientras llega la revalidación.
  const [parche, setParche] = useState<{
    editados: Record<string, GastoRow>;
    borrados: Set<string>;
  }>({ editados: {}, borrados: new Set() });

  const rows = gastos
    .filter((g) => !parche.borrados.has(g.id))
    .map((g) => parche.editados[g.id] ?? g);

  const [editing, setEditing] = useState<GastoRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(fd: FormData) {
    if (!editing) return;
    setBusy(true);
    fd.set("id", editing.id);
    await editarGasto(fd);
    const updated: GastoRow = {
      ...editing,
      concepto: String(fd.get("concepto") ?? ""),
      categoria: String(fd.get("categoria") ?? "") || null,
      monto: Number(fd.get("monto")),
      fecha: String(fd.get("fecha") ?? ""),
      tipo_gasto: String(fd.get("tipo_gasto") ?? "") || null,
      metodo_pago: String(fd.get("metodo_pago") ?? "") || null,
      notas: String(fd.get("notas") ?? "") || null,
    };
    setParche((p) => ({ ...p, editados: { ...p.editados, [editing.id]: updated } }));
    setBusy(false);
    setEditing(null);
  }

  async function remove(g: GastoRow) {
    if (!confirm(`¿Eliminar el gasto "${g.concepto}" (${money(g.monto, "USD")})?`)) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("id", g.id);
    await eliminarGasto(fd);
    setParche((p) => {
      const borrados = new Set(p.borrados);
      borrados.add(g.id);
      return { ...p, borrados };
    });
    setBusy(false);
    setEditing(null);
  }

  return (
    <>
      <div className="tabla-scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th>Categoría</th>
              <th>Tipo</th>
              <th>Método</th>
              <th className="r">Importe</th>
              <th className="r"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Sin gastos cargados en este mes.
                </td>
              </tr>
            )}
            {rows.map((g) => (
              <tr key={g.id}>
                <td className="mono">{dateEs(g.fecha)}</td>
                <td className="nom">
                  {/* Un <button>, no un onClick sobre el <tr>: la fila entera
                      clicable es inalcanzable por teclado, que es el defecto
                      que tiene hoy la tabla de sesiones. */}
                  {onDetalle
                    ? <button type="button" className="linkbtn gasto-concepto"
                              onClick={() => onDetalle(g)}>{g.concepto}</button>
                    : g.concepto}
                </td>
                <td>{g.categoria ? <span className="pill">{g.categoria}</span> : "—"}</td>
                <td className="muted">{g.tipo_gasto?.replace("Gasto ", "") ?? "—"}</td>
                <td className="muted">{g.metodo_pago ?? "—"}</td>
                <td className="r mono">{money(g.monto, "USD")}</td>
                <td className="r">
                  <button className="linkbtn" onClick={() => setEditing(g)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        // `onCerrar` respeta `busy` igual que lo hacía el clic en el fondo:
        // ahora Escape y la ✕ tampoco cierran a mitad de un guardado.
        <Modal titulo="Editar gasto" onCerrar={() => { if (!busy) setEditing(null); }}>
            <form action={save} className="gasto-form">
              <div className="gf-row">
                <label>
                  Concepto
                  <input name="concepto" required defaultValue={editing.concepto} />
                </label>
                <label>
                  Importe (USD)
                  <input name="monto" type="number" step="0.01" min="0" required defaultValue={editing.monto} />
                </label>
              </div>
              <div className="gf-row">
                <label>
                  Categoría
                  <select name="categoria" defaultValue={editing.categoria ?? "Otros"}>
                    {CATEGORIAS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Fecha
                  <input name="fecha" type="date" required defaultValue={editing.fecha} />
                </label>
              </div>
              <div className="gf-row">
                <label>
                  Tipo
                  <select name="tipo_gasto" defaultValue={editing.tipo_gasto ?? "Gasto recurrente"}>
                    {TIPOS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Método
                  <select name="metodo_pago" defaultValue={editing.metodo_pago ?? "Tarjeta"}>
                    {METODOS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Notas
                <input name="notas" defaultValue={editing.notas ?? ""} />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn warn" disabled={busy} onClick={() => remove(editing)}>
                  Eliminar
                </button>
                <div className="crece" />
                <button type="button" className="btn" disabled={busy} onClick={() => setEditing(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
        </Modal>
      )}
    </>
  );
}
