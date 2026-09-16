"use client";
import { useState, useTransition } from "react";
import { traerRecurrentes } from "@/app/actions";
import { confirmar } from "@/components/Confirmacion";
import { money } from "@/lib/format";
import { etiquetaMes, fechaEnMes } from "@/lib/gastos";
import { dateEs } from "@/lib/format";
import type { GastoRow } from "@/lib/types";

/**
 * "Este mes le faltan los recurrentes del anterior: ¿los traigo?"
 *
 * Es la pieza que convierte la pantalla de un informe en una herramienta. 81
 * de los 105 gastos son recurrentes y 18 conceptos se repiten cada mes; a mano
 * son ~19 altas de siete campos. Hoy es 2 de septiembre y septiembre está a
 * cero — no porque a nadie le importe, sino porque cuesta media hora.
 *
 * Human-in-the-loop, como todo lo que toca dinero (PRODUCT.md §4): la lista se
 * ve entera antes, se puede desmarcar uno a uno, y el importe total va DENTRO
 * del botón. Nada se copia a ciegas.
 */
export default function TraerRecurrentes({
  mes,
  mesOrigen,
  candidatos,
}: {
  mes: string;
  mesOrigen: string;
  candidatos: GastoRow[];
}) {
  // Todos marcados de entrada: el caso normal es "sí, los de siempre". Quien
  // quiera afinar desmarca, que es menos trabajo que marcar diecinueve.
  const [fuera, setFuera] = useState<Set<string>>(new Set());
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const elegidos = candidatos.filter((g) => !fuera.has(g.id));
  const total = elegidos.reduce((s, g) => s + Number(g.monto || 0), 0);

  function alternar(id: string) {
    setFuera((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function enviar() {
    if (elegidos.length === 0) return;
    setError(null);
    const fd = new FormData();
    fd.set("mes", mes);
    fd.set("ids", elegidos.map((g) => g.id).join(","));
    start(async () => {
      const r = await traerRecurrentes(fd);
      if (!r.ok) setError(r.error);
      else {
        confirmar(r.mensaje);
        setAbierto(false);
      }
    });
  }

  return (
    <div className="card recurrentes-pendientes">
      <div className="card-head">
        <div>
          <h2>
            A {etiquetaMes(mes).split(" ")[0]} le faltan {candidatos.length}{" "}
            {candidatos.length === 1 ? "gasto recurrente" : "gastos recurrentes"}
          </h2>
          <span className="hint">
            estaban en {etiquetaMes(mesOrigen)} y todavía no en este mes
          </span>
        </div>
        <button
          type="button"
          className="btn"
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
        >
          {abierto ? "Ocultar" : "Revisar y traer"}
        </button>
      </div>

      {abierto && (
        <div className="card-body">
          <p className="note">
            Se copian con su categoría, método e importe de {etiquetaMes(mesOrigen)}, y con el
            mismo día del mes. <strong>Revisa los importes</strong>: si alguna suscripción ha
            subido, corrígela después desde su fila. Los que ya estén cargados se saltan solos.
          </p>

          <div className="tabla-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Traer</th>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th>Fecha que tendrá</th>
                  <th className="r">Importe</th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((g) => {
                  const dentro = !fuera.has(g.id);
                  return (
                    <tr key={g.id} className={dentro ? undefined : "fila-fuera"}>
                      <td>
                        <label className="rc-check">
                          <input
                            type="checkbox"
                            checked={dentro}
                            onChange={() => alternar(g.id)}
                          />
                          <span className="sr">Traer «{g.concepto}»</span>
                        </label>
                      </td>
                      <td className="nom">{g.concepto}</td>
                      <td>
                        {g.categoria
                          ? <span className="pill">{g.categoria}</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td className="mono">{dateEs(fechaEnMes(g.fecha, mes))}</td>
                      <td className="r mono">{money(g.monto, "USD")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error && <p className="cuota-error">{error}</p>}

          <div className="modal-actions">
            {/* El importe va dentro del botón: es lo que se va a registrar
                como gasto del mes y tiene que leerse antes de pulsar, no
                después en un resumen. */}
            <button
              type="button"
              className="btn primary"
              disabled={pending || elegidos.length === 0}
              onClick={enviar}
            >
              {pending
                ? "Copiando…"
                : elegidos.length === 0
                  ? "No has dejado ninguno marcado"
                  : `Traer ${elegidos.length} a ${etiquetaMes(mes).split(" ")[0]} · ${money(total, "USD")}`}
            </button>
            {fuera.size > 0 && (
              <span className="hint">{fuera.size} sin marcar, no se copian</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
