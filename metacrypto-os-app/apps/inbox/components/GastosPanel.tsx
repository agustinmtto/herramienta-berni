"use client";
import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import GastoDetalle from "@/components/GastoDetalle";
import GastoForm from "@/components/GastoForm";
import GastosTable from "@/components/GastosTable";
import TraerRecurrentes from "@/components/TraerRecurrentes";
import { money, dateEs } from "@/lib/format";
import {
  mesesDisponibles, delMes, resumen, serieMensual, porCategoria, comparativa,
  recurrentesQueFaltan, etiquetaMes, mesCorto, mesAnterior,
} from "@/lib/gastos";
import type { GastoRow } from "@/lib/types";

/** `null` = "Todo": el histórico completo, que es lo único que había antes. */
type MesElegido = string | null;

const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(0)} %`;

/**
 * La pantalla de Gastos.
 *
 * Antes no tenía ninguna dimensión temporal: un total de los 105 movimientos
 * históricos, las tres categorías mayores y una tabla. No había forma de
 * preguntar "cuánto gasté en agosto", que es la pregunta que se le hace a esta
 * pantalla todos los meses.
 *
 * Filtra en el navegador y no en el servidor, igual que InicioPanel: el
 * servidor manda las filas una vez y a partir de ahí cambiar de mes es
 * instantáneo. Con 105 gastos y un techo de 500, eso son unos pocos KB.
 *
 * Regla que gobierna la pantalla, la misma que Inicio: el mes elegido arriba
 * manda sobre TODO lo de abajo. Si dos bloques de la misma pantalla cuentan
 * cosas distintas, se acabó la confianza en la pantalla.
 */
export default function GastosPanel({
  gastos,
  hoy,
}: {
  gastos: GastoRow[];
  hoy: string;
}) {
  const meses = useMemo(() => mesesDisponibles(gastos, hoy), [gastos, hoy]);
  // Arranca en el mes en curso y no en "Todo": lo que se viene a hacer aquí es
  // cargar y cuadrar el mes que corre, no contemplar el acumulado histórico.
  const [mes, setMes] = useState<MesElegido>(meses[0] ?? null);
  const [detalle, setDetalle] = useState<GastoRow | null>(null);

  const v = useMemo(() => {
    const visibles = mes ? delMes(gastos, mes) : gastos;
    return {
      visibles,
      res: resumen(visibles),
      cats: porCategoria(visibles),
      serie: serieMensual(gastos, hoy),
      comp: mes ? comparativa(gastos, mes) : null,
      faltan: mes ? recurrentesQueFaltan(gastos, mes) : [],
    };
  }, [gastos, mes, hoy]);

  const maxSerie = Math.max(...v.serie.map((s) => s.total), 1);
  const maxCat = v.cats[0]?.total || 1;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Gastos</h1>
        <p>
          {mes ? etiquetaMes(mes) : `los ${gastos.length} movimientos`} · USD
        </p>
      </div>

      {/* Los meses mandan sobre todo lo de abajo. Una sola fila, encima de lo
          que gobierna, igual que los filtros de Inicio. */}
      <div className="filtros" role="group" aria-label="Filtrar por mes">
        <div className="grupo">
          <span className="etq">Mes</span>
          {meses.map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              aria-pressed={mes === m}
              onClick={() => setMes(m)}
            >
              {mesCorto(m)}
              {m.slice(0, 4) !== hoy.slice(0, 4) && ` ${m.slice(2, 4)}`}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-pressed={mes === null}
            onClick={() => setMes(null)}
          >
            Todo
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">{mes ? etiquetaMes(mes) : "Todos los meses"}</div>
          <div className="value gold">{money(v.res.total, "USD")}</div>
          <div className="sub">
            {v.res.n} {v.res.n === 1 ? "movimiento" : "movimientos"}
            {/* La comparación es la mitad de la respuesta: "22.179 USD" no
                dice nada sin "y el mes pasado fueron 31.623". */}
            {v.comp && v.comp.totalAnterior > 0 && (
              <>
                {" · "}
                <span className={v.comp.diff > 0 ? "neg" : "ok"}>
                  {v.comp.pct != null ? pct(v.comp.pct) : "—"}
                </span>
                {" vs "}{etiquetaMes(v.comp.anterior).split(" ")[0]}
              </>
            )}
          </div>
        </div>
        {/* Las categorías dejan de ser adorno: pulsar una filtra la tabla.
            Antes eran tres tarjetas de solo lectura y el reparto completo
            estaba en otro bloque, así que había que mirar en dos sitios. */}
        {v.cats.slice(0, 3).map((c) => (
          <div className="kpi" key={c.categoria}>
            <div className="label">{c.categoria}</div>
            <div className="value">{money(c.total, "USD")}</div>
            <div className="sub">
              {c.n} {c.n === 1 ? "movimiento" : "movimientos"} ·{" "}
              {v.res.total > 0 ? ((c.total / v.res.total) * 100).toFixed(0) : 0} % del mes
            </div>
          </div>
        ))}
      </div>

      {/* El bloque que hace el trabajo. Solo aparece si de verdad falta algo:
          un panel permanente diciendo "0 pendientes" es ruido. */}
      {mes && v.faltan.length > 0 && (
        <TraerRecurrentes
          mes={mes}
          mesOrigen={mesAnterior(mes)}
          candidatos={v.faltan}
        />
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Gasto por mes</h2>
              <span className="hint">pulsa un mes para filtrar</span>
            </div>
          </div>
          <div className="card-body">
            {v.serie.map((s) => (
              <button
                type="button"
                className={`bar-row bar-row-btn ${mes === s.mes ? "on" : ""}`}
                key={s.mes}
                aria-pressed={mes === s.mes}
                onClick={() => setMes(s.mes)}
              >
                <span className="lbl">{etiquetaMes(s.mes).split(" ")[0]}</span>
                <span className="track">
                  <span className="fill" style={{ width: `${(s.total / maxSerie) * 100}%` }} />
                </span>
                <span className="num mono">
                  {s.total > 0 ? money(s.total, "USD") : <span className="muted">sin cargar</span>}
                </span>
                <span className="n2">{s.n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Reparto por categoría</h2>
              <span className="hint">{mes ? etiquetaMes(mes) : "histórico"}</span>
            </div>
            <span className="hint">{money(v.res.total, "USD")}</span>
          </div>
          <div className="card-body">
            {v.cats.length === 0 ? (
              <div className="empty-box">
                No hay gastos cargados en {mes ? etiquetaMes(mes) : "ningún mes"}.
              </div>
            ) : (
              v.cats.map((c) => (
                <div className="bar-row" key={c.categoria}>
                  <span className="lbl">{c.categoria}</span>
                  <span className="track">
                    <span className="fill" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                  </span>
                  <span className="num mono">{money(c.total, "USD")}</span>
                  <span className="n2">{c.n}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card bloque">
        <div className="card-head">
          <div>
            <h2>Movimientos</h2>
            <span className="hint">
              {mes ? etiquetaMes(mes) : "todos"} · pulsa una fila para ver el detalle
            </span>
          </div>
          <span className="hint">{v.res.n}</span>
        </div>
        <div className="card-body">
          <GastosTable gastos={v.visibles} onDetalle={setDetalle} />
        </div>
      </div>

      <div className="card bloque">
        <div className="card-head">
          <div>
            <h2>Registrar gasto</h2>
            <span className="hint">se guarda en dólares</span>
          </div>
        </div>
        <div className="card-body-pad">
          <GastoForm />
        </div>
      </div>

      {detalle && (
        <Modal
          titulo={detalle.concepto}
          subtitulo={`${dateEs(detalle.fecha)} · ${detalle.categoria ?? "sin categoría"}`}
          ancho
          onCerrar={() => setDetalle(null)}
        >
          <GastoDetalle gasto={detalle} todos={gastos} />
        </Modal>
      )}
    </div>
  );
}
