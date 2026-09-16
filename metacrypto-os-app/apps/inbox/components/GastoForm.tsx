"use client";
import { useRef, useState } from "react";
import { crearGasto } from "@/app/actions";
import { confirmar } from "@/components/Confirmacion";
// La misma fecha local que usa VentaForm: `toISOString()` da UTC y en España
// a las 00:30 devuelve el día anterior, con lo que el gasto se registraría en
// el mes equivocado.
import { hoy } from "@/lib/venta-form";

const CATEGORIAS = [
  "Software",
  "Salario",
  "Herramientas",
  "Gastos LLC",
  "Formación",
  "Otros",
  "Ads",
  "Comisiones",
];
const TIPOS = ["Gasto único", "Gasto recurrente"];
const METODOS = ["Cripto", "Transferencia", "Tarjeta"];

export default function GastoForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function action(fd: FormData) {
    setSaving(true);
    setOk(false);
    setError(null);
    const r = await crearGasto(fd);
    setSaving(false);
    // Antes: `await crearGasto(fd)` sin mirar el resultado, `reset()` y check
    // verde siempre. Si el POST fallaba, el formulario se vaciaba y decía
    // "✓ Gasto registrado" sobre un gasto que no existe. Ahora el formulario
    // solo se vacía cuando de verdad se ha guardado — así lo tecleado sigue
    // ahí para reintentar.
    if (!r.ok) { setError(r.error); return; }
    ref.current?.reset();
    confirmar(r.mensaje);
    setOk(true);
    setTimeout(() => setOk(false), 2500);
  }

  // El gasto se registra casi siempre el día que se paga. Estaba vacío, así
  // que había que abrir el calendario y elegir hoy en cada alta.
  const today = hoy();
  return (
    <form ref={ref} action={action} className="gasto-form">
      <div className="gf-row">
        <label>
          Concepto
          <input name="concepto" required placeholder="Ej: Facebook Ads" />
        </label>
        <label>
          Importe (USD)
          <input name="monto" type="number" step="0.01" min="0" required placeholder="0.00" />
        </label>
      </div>
      <div className="gf-row">
        <label>
          Categoría
          <select name="categoria" defaultValue="Software" required>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha
          <input name="fecha" type="date" required defaultValue={today} />
        </label>
      </div>
      <div className="gf-row">
        <label>
          Tipo
          <select name="tipo_gasto" defaultValue="Gasto recurrente">
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Método
          <select name="metodo_pago" defaultValue="Tarjeta">
            {METODOS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Notas (opcional)
        <input name="notas" placeholder="Detalle…" />
      </label>
      <div className="gf-actions">
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? "Guardando…" : "Registrar gasto"}
        </button>
        {ok && <span className="gf-ok">✓ Gasto registrado</span>}
        {/* El error se pinta junto al botón que lo produjo, no solo en el
            aviso global: aquí es donde está mirando quien acaba de pulsar. */}
        {error && <span className="cuota-error">{error}</span>}
      </div>
    </form>
  );
}
