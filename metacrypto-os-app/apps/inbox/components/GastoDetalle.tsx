"use client";
import { money, dateEs } from "@/lib/format";
import { historialDe, variacionPrecio, etiquetaMes, mesDe } from "@/lib/gastos";
import type { GastoRow } from "@/lib/types";

const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)} %`;

/**
 * Qué es este gasto y qué se ha pagado antes por lo mismo.
 *
 * La tabla de movimientos enseñaba siete columnas y ninguna respondía la
 * pregunta que se hace al mirar una línea: "¿esto siempre ha costado esto?".
 * Con 105 filas repartidas en cuatro meses, una suscripción que sube de 20 a
 * 32 USD no la ve nadie.
 *
 * El histórico se cruza por concepto normalizado, no por id, porque cada mes
 * es una fila nueva tecleada a mano — ver `normalizaConcepto` en lib/gastos.ts.
 */
export default function GastoDetalle({
  gasto,
  todos,
}: {
  gasto: GastoRow;
  todos: GastoRow[];
}) {
  const historial = historialDe(todos, gasto.concepto);
  const variacion = variacionPrecio(historial);
  const total = historial.reduce((s, h) => s + Number(h.monto || 0), 0);

  return (
    <>
      <div className="gd-cifras">
        <div className="d-item">
          <div className="d-label">Importe</div>
          <div className="d-value gold mono">{money(gasto.monto, "USD")}</div>
        </div>
        <div className="d-item">
          <div className="d-label">Veces pagado</div>
          <div className="d-value mono">{historial.length}</div>
        </div>
        <div className="d-item">
          <div className="d-label">Total acumulado</div>
          <div className="d-value mono">{money(total, "USD")}</div>
        </div>
      </div>

      {/* La alarma. Solo se pinta si de verdad cambió de precio: un "0 %"
          permanente enseña al ojo a saltarse el bloque. */}
      {variacion && variacion.diff !== 0 && (
        <p className={`note ${variacion.diff > 0 ? "note-sube" : ""}`}>
          {variacion.diff > 0 ? "Ha subido" : "Ha bajado"} de{" "}
          <strong>{money(variacion.anterior, "USD")}</strong> a{" "}
          <strong>{money(variacion.actual, "USD")}</strong>
          {variacion.pct != null && <> ({pct(variacion.pct)})</>} desde el cobro anterior.
        </p>
      )}

      <dl className="gd-ficha">
        <div>
          <dt>Categoría</dt>
          <dd>{gasto.categoria ?? <span className="muted">sin categoría</span>}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{gasto.tipo_gasto?.replace("Gasto ", "") ?? <span className="muted">—</span>}</dd>
        </div>
        <div>
          <dt>Método de pago</dt>
          <dd>{gasto.metodo_pago ?? <span className="muted">—</span>}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd className="mono">{dateEs(gasto.fecha)}</dd>
        </div>
      </dl>

      {gasto.notas && (
        <div className="gd-notas">
          <div className="d-label">Notas</div>
          <p>{gasto.notas}</p>
        </div>
      )}

      <div className="gd-hist">
        <div className="d-label">
          {historial.length > 1
            ? `Se ha pagado ${historial.length} veces`
            : "Primera vez que se paga esto"}
        </div>
        {historial.length <= 1 ? (
          <p className="hint">
            No hay cobros anteriores de «{gasto.concepto}» con los que comparar.
          </p>
        ) : (
          <div className="tabla-scroll">
            <table className="t">
              <thead>
                <tr><th>Mes</th><th>Fecha</th><th className="r">Importe</th><th className="r">Cambio</th></tr>
              </thead>
              <tbody>
                {historial.map((h, i) => {
                  const prev = historial[i + 1];
                  const d = prev ? Number(h.monto) - Number(prev.monto) : null;
                  return (
                    <tr key={h.id} className={h.id === gasto.id ? "fila-actual" : undefined}>
                      <td>{etiquetaMes(mesDe(h.fecha))}</td>
                      <td className="mono">{dateEs(h.fecha)}</td>
                      <td className="r mono">{money(h.monto, "USD")}</td>
                      <td className="r mono">
                        {d == null ? (
                          <span className="muted">—</span>
                        ) : d === 0 ? (
                          <span className="muted">igual</span>
                        ) : (
                          <span className={d > 0 ? "neg" : "ok"}>
                            {d > 0 ? "+" : ""}{money(d, "USD")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
