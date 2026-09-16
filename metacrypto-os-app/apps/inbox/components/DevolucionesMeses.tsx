"use client";
import { money } from "@/lib/format";
import { serieDelAnio, type DevolucionBase } from "@/lib/devoluciones-vista";
import { nombreMes } from "@/lib/meses";

/**
 * Cuándo hubo devoluciones, mes a mes.
 *
 * La pantalla solo tenía un total del año y una tabla ordenada por fecha: para
 * responder "¿en qué meses nos han devuelto?" había que leer las siete filas y
 * agrupar de cabeza. Con más años cargados eso deja de ser posible.
 *
 * Los meses a cero SE PINTAN. Julio no tuvo ninguna devolución, y una serie
 * que salte de junio a agosto miente sobre la forma del año: un mes limpio es
 * un hecho que se quiere ver, no un dato que falta.
 */
export default function DevolucionesMeses({
  filas,
  anio,
  hoy,
}: {
  filas: DevolucionBase[];
  anio: number;
  hoy: string;
}) {
  const serie = serieDelAnio(filas, anio, hoy);
  const max = Math.max(...serie.map((s) => s.total), 1);
  const conAlguna = serie.filter((s) => s.n > 0).length;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Cuándo se devolvió</h2>
          <span className="hint">
            {conAlguna === 0
              ? `ningún mes de ${anio} con devoluciones`
              : `${conAlguna} ${conAlguna === 1 ? "mes" : "meses"} de ${serie.length} con devoluciones`}
          </span>
        </div>
      </div>
      <div className="card-body">
        <div className="dev-meses">
          {serie.map((s) => (
            <div className={`dev-mes ${s.n === 0 ? "vacio" : ""}`} key={s.mes}>
              <div className="dev-mes-barra">
                {/* La barra crece desde abajo. Un mes sin devoluciones deja el
                    hueco vacío en vez de una barra de altura cero, que se lee
                    como un fallo de render. */}
                <span
                  className="dev-mes-fill"
                  style={{ height: s.total > 0 ? `${Math.max((s.total / max) * 100, 4)}%` : "0%" }}
                />
              </div>
              <div className="dev-mes-nombre">{nombreMes(s.mes).slice(0, 3)}</div>
              <div className="dev-mes-cifra">
                {s.n === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <>
                    <span className="mono">{money(s.total, "USD")}</span>
                    <span className="dev-mes-n">
                      {s.n} {s.n === 1 ? "devolución" : "devoluciones"}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
