"use client";
import { useMemo, useState } from "react";
import { money } from "@/lib/format";
import {
  etiquetaMes, ejeBonito, etiquetaEje, comparaRitmo, finDeMes, mesDe,
  type PagoInicio,
} from "@/lib/inicio";
import { usarAncho } from "@/components/usarAncho";

/**
 * Ritmo del mes: acumulado día a día de dos meses, uno contra otro.
 *
 * Berni elige los dos meses. Esta tarjeta NO obedece al filtro de fechas de
 * arriba a propósito — es su propia comparación, y lo dice en la acotación.
 *
 * El mes de referencia va en tinta neutra y a trazos porque es una
 * referencia, no una serie rival: con un segundo color de marca competiría
 * con el mes que de verdad se está mirando.
 */
export default function InicioRitmo({
  pagos, meses, hoy,
}: {
  pagos: PagoInicio[];
  /** Meses con datos, del más reciente al más antiguo. */
  meses: string[];
  hoy: string;
}) {
  const { ref, ancho } = usarAncho<HTMLDivElement>();
  const [mesA, setMesA] = useState(meses[0] ?? mesDe(hoy));
  const [mesB, setMesB] = useState(meses[1] ?? meses[0] ?? mesDe(hoy));
  const [dia, setDia] = useState<number | null>(null);

  const r = useMemo(() => comparaRitmo(pagos, mesA, mesB, hoy), [pagos, mesA, mesB, hoy]);

  const H = 260;
  const M = { t: 16, r: 58, b: 34, l: 64 };
  const iw = Math.max(ancho - M.l - M.r, 10);
  const ih = H - M.t - M.b;
  const dias = Math.max(finDeMes(mesA), finDeMes(mesB));
  const { top, paso } = ejeBonito(Math.max(r.totalA, r.totalB, 1));
  const x = (d: number) => M.l + (d / dias) * iw;
  const y = (v: number) => M.t + ih - (v / top) * ih;
  const diaHoy = Number(hoy.slice(8, 10));

  // Si los dos totales caen a menos de 12px, se abren 6px cada uno.
  const juntas = Math.abs(y(r.totalA) - y(r.totalB)) < 12;
  const desvioA = juntas ? (r.totalA >= r.totalB ? -6 : 6) : 0;
  const desvioB = juntas ? (r.totalA >= r.totalB ? 6 : -6) : 0;

  const traza = (serie: number[], hasta: number) =>
    serie.slice(0, hasta + 1).map((v, d) => `${d ? "L" : "M"}${x(d)} ${y(v)}`).join("");

  const lineas: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += paso) lineas.push(v);
  const marcasX: number[] = [];
  for (let d = 5; d <= dias; d += 5) marcasX.push(d);

  const enTooltip = dia !== null;
  const vA = dia !== null && dia <= r.diasA ? r.serieA[dia] : null;
  const vB = dia !== null && dia <= r.diasB ? r.serieB[dia] : null;
  const difDia = dia !== null && vA !== null && vB !== null && vB > 0 ? (vA - vB) / vB : null;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Ritmo del mes</h2>
          <span className="hint">
            {mesA === mesDe(hoy) ? `día ${r.diasA} de ${finDeMes(mesA)}` : `${etiquetaMes(mesA, true)} completo`}
            {r.dif !== null &&
              ` · ${r.dif >= 0 ? "+" : ""}${(r.dif * 100).toFixed(1).replace(".", ",")} % que ${etiquetaMes(mesB, true)} al día ${r.diaComparacion}`}
          </span>
        </div>
        <div className="grupo">
          <label className="etq" htmlFor="ri-a">Mes</label>
          <select className="sel" id="ri-a" value={mesA} onChange={(e) => setMesA(e.target.value)}>
            {meses.map((m) => (
              <option key={m} value={m}>
                {etiquetaMes(m, true)}{m === mesDe(hoy) ? " · en curso" : ""}
              </option>
            ))}
          </select>
          <label className="etq" htmlFor="ri-b" style={{ marginLeft: 6 }}>contra</label>
          <select className="sel" id="ri-b" value={mesB} onChange={(e) => setMesB(e.target.value)}>
            {meses.map((m) => (
              <option key={m} value={m}>
                {etiquetaMes(m, true)}{m === mesDe(hoy) ? " · en curso" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card-body">
        {/* Dos series: la identidad nunca va solo por color — trazo, tinta y nombre. */}
        <div className="leyenda" style={{ marginBottom: 10 }}>
          <span className="it"><span className="linea" />{etiquetaMes(mesA, true)}</span>
          <span className="it"><span className="linea ref" />{etiquetaMes(mesB, true)}</span>
        </div>

        <div className="gr-wrap" ref={ref}>
          {ancho > 0 && (
            <svg
              width={ancho} height={H} viewBox={`0 0 ${ancho} ${H}`} role="img"
              aria-label={`${etiquetaMes(mesA, true)} lleva ${money(r.serieA[r.diaComparacion] ?? 0, "USD")} el día ${r.diaComparacion}; ${etiquetaMes(mesB, true)} llevaba ${money(r.serieB[r.diaComparacion] ?? 0, "USD")} ese mismo día.`}
              onPointerMove={(e) => {
                const caja = e.currentTarget.getBoundingClientRect();
                const px = e.clientX - caja.left;
                setDia(Math.max(1, Math.min(dias, Math.round(((px - M.l) / iw) * dias))));
              }}
              onPointerLeave={() => setDia(null)}
            >
              {lineas.map((v) => (
                <g key={v}>
                  <line x1={M.l} x2={ancho - M.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                  <text x={M.l - 10} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-4)">
                    {etiquetaEje(v, paso)}
                  </text>
                </g>
              ))}
              {marcasX.map((d) => (
                <text key={d} x={x(d)} y={H - 14} textAnchor="middle" fontSize={11} fill="var(--text-4)">{d}</text>
              ))}

              <path d={traza(r.serieB, r.diasB)} fill="none" stroke="var(--text-3)" strokeWidth={2}
                strokeDasharray="5 4" strokeLinecap="round" />
              <path d={traza(r.serieA, r.diasA)} fill="none" stroke="var(--gold)" strokeWidth={2} strokeLinecap="round" />

              {/* La marca de hoy solo si alguno de los dos meses es el actual:
                  entre dos meses cerrados no significaría nada. */}
              {r.tocaMesEnCurso && (
                <line x1={x(diaHoy)} x2={x(diaHoy)} y1={M.t} y2={M.t + ih}
                  stroke="var(--gold-line)" strokeWidth={1} strokeDasharray="3 3" />
              )}
              {/* Las dos etiquetas de total se separan si acaban a la misma altura:
                  con meses parecidos se imprimían una encima de otra e incluso
                  decían las dos lo mismo, y no había forma de saber cuál era cuál. */}
              <text x={ancho - M.r + 6} y={y(r.totalA) + 4 + desvioA} fontSize={11} fontWeight={600} fill="var(--text-2)">
                {etiquetaEje(r.totalA, paso)}
              </text>
              <text x={ancho - M.r + 6} y={y(r.totalB) + 4 + desvioB} fontSize={11} fontWeight={600} fill="var(--text-4)">
                {etiquetaEje(r.totalB, paso)}
              </text>

              {/* Crosshair: el lector apunta a un día, no a una línea de 2px. */}
              {enTooltip && (
                <line x1={x(dia!)} x2={x(dia!)} y1={M.t} y2={M.t + ih} stroke="var(--border-2)" strokeWidth={1} />
              )}
            </svg>
          )}
          {enTooltip && (
            <div
              className="tt visible"
              role="status"
              style={{
                left: Math.min(Math.max(x(dia!), 96), ancho - 96),
                top: y(Math.max(vA ?? 0, vB ?? 0)) - 12,
              }}
            >
              <div className="tt-m">Día {dia}</div>
              <div className="tt-f">
                <span className="tt-k" style={{ background: "var(--gold)" }} />
                <span className="tt-l">{etiquetaMes(mesA)}</span>
                <span className="tt-v">{vA === null ? "aún no" : money(vA, "USD")}</span>
              </div>
              <div className="tt-f">
                <span className="tt-k" style={{ background: "var(--text-3)" }} />
                <span className="tt-l">{etiquetaMes(mesB)}</span>
                <span className="tt-v">{vB === null ? "aún no" : money(vB, "USD")}</span>
              </div>
              {difDia !== null && (
                <div className="tt-f tt-tot">
                  <span className="tt-l">Diferencia</span>
                  <span className={`tt-v ${difDia >= 0 ? "pos" : "neg"}`}>
                    {difDia >= 0 ? "+" : ""}{(difDia * 100).toFixed(1).replace(".", ",")} %
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
