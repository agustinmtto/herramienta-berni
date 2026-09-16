"use client";
import { useState } from "react";
import { etiquetaMes, ejeBonito, etiquetaVisible, type FilaVentas } from "@/lib/inicio";
import { usarAncho } from "@/components/usarAncho";

/**
 * Ventas por mes, separando nueva venta de upsell.
 *
 * El upsell no lleva un segundo color sino la MISMA tinta tramada: son dos
 * series de la misma cosa (ventas), y a los volúmenes reales — 12 upsells de
 * 200 — un segundo color de marca pesaría mucho más de lo que vale.
 */
export default function InicioVentas({ filas }: { filas: FilaVentas[] }) {
  const { ref, ancho } = usarAncho<HTMLDivElement>();
  const [activa, setActiva] = useState<number | null>(null);

  const H = 218;
  const M = { t: 14, r: 8, b: 34, l: 34 };
  const iw = Math.max(ancho - M.l - M.r, 10);
  const ih = H - M.t - M.b;
  // `true` = eje de recuento: no existen 0,25 ventas.
  const { top, paso } = ejeBonito(Math.max(...filas.map((f) => f.nueva + f.up), 1), true);
  const y = (v: number) => M.t + ih - (v / top) * ih;
  const paso1 = filas.length ? iw / filas.length : iw;
  const cx = (i: number) => M.l + paso1 * (i + 0.5);
  const bw = Math.min(34, paso1 * 0.62);
  const cada = Math.max(1, Math.ceil(38 / Math.max(paso1, 1)));

  const lineas: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += paso) lineas.push(v);

  const total = filas.reduce((s, f) => s + f.nueva + f.up, 0);
  const ups = filas.reduce((s, f) => s + f.up, 0);
  const f = activa === null ? null : filas[activa];

  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Ventas por mes</h2><span className="hint">{total} ventas · {ups} upsell</span></div>
        <div className="leyenda">
          <span className="it"><span className="sw" />Nueva</span>
          <span className="it"><span className="sw tramado" />Upsell</span>
        </div>
      </div>
      <div className="card-body">
        <div className="gr-wrap" ref={ref}>
          {ancho > 0 && (
            <svg width={ancho} height={H} viewBox={`0 0 ${ancho} ${H}`} role="img"
              aria-label={filas.map((x) => `${etiquetaMes(x.ym, true)}: ${x.nueva + x.up}`).join(". ")}>
              <defs>
                <pattern id="tramaUpsell" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={6} height={6} fill="var(--surface-3)" />
                  <rect width={2.6} height={6} fill="var(--gold)" />
                </pattern>
              </defs>
              {lineas.map((v) => (
                <g key={v}>
                  <line x1={M.l} x2={ancho - M.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                  <text x={M.l - 7} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--text-4)">{v}</text>
                </g>
              ))}
              {filas.map((d, i) => {
                const hNueva = (d.nueva / top) * ih;
                const hUp = (d.up / top) * ih;
                return (
                  <g key={d.ym}>
                    {d.nueva > 0 && (
                      <rect x={cx(i) - bw / 2} y={y(d.nueva)} width={bw} height={Math.max(hNueva, 1)}
                        rx={3} fill="var(--gold)" opacity={activa === null || activa === i ? 1 : 0.55} />
                    )}
                    {/* 2px de hueco de superficie entre segmentos apilados. */}
                    {d.up > 0 && (
                      <rect x={cx(i) - bw / 2} y={y(d.nueva + d.up)} width={bw}
                        height={Math.max(hUp - (d.nueva > 0 ? 2 : 0), 1)} rx={3} fill="url(#tramaUpsell)"
                        opacity={activa === null || activa === i ? 1 : 0.55} />
                    )}
                    {/* La última va anclada por su borde derecho: centrada se salía
                        del viewBox y perdía el año. */}
                    {etiquetaVisible(i, filas.length, cada) && (
                      <text x={i === filas.length - 1 ? ancho - 2 : cx(i)} y={H - 18}
                        textAnchor={i === filas.length - 1 ? "end" : "middle"}
                        fontSize={10} fill="var(--text-4)">
                        {etiquetaMes(d.ym)}
                      </text>
                    )}
                    <rect x={cx(i) - paso1 / 2} y={M.t} width={paso1} height={ih} fill="transparent"
                      tabIndex={0} role="img"
                      aria-label={`${etiquetaMes(d.ym, true)}: ${d.nueva} nuevas, ${d.up} upsells`}
                      onPointerEnter={() => setActiva(i)} onFocus={() => setActiva(i)}
                      onPointerLeave={() => setActiva(null)} onBlur={() => setActiva(null)} />
                  </g>
                );
              })}
            </svg>
          )}
          {f && (
            <div className="tt visible" role="status"
              style={{ left: Math.min(Math.max(cx(activa!), 92), ancho - 92), top: y(f.nueva + f.up) - 10 }}>
              <div className="tt-m">{etiquetaMes(f.ym, true)}</div>
              <div className="tt-f">
                <span className="tt-k" style={{ background: "var(--gold)" }} />
                <span className="tt-l">Nueva venta</span><span className="tt-v">{f.nueva}</span>
              </div>
              <div className="tt-f">
                <span className="tt-k" style={{ background: "var(--gold-dim)" }} />
                <span className="tt-l">Upsell</span><span className="tt-v">{f.up}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
