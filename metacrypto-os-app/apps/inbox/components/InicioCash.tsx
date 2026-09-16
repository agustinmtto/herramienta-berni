"use client";
import { useState } from "react";
import { money } from "@/lib/format";
import { etiquetaMes, ejeConSuelo, etiquetaEje, etiquetaVisible, type BarraCash } from "@/lib/inicio";
import { usarAncho } from "@/components/usarAncho";

/**
 * Cash collected mes a mes. UNA sola serie: dinero que entró de verdad.
 *
 * No hay capas ni texturas porque no hay nada que proyectar — la pantalla
 * habla de pasado y presente. Con una sola serie tampoco hay leyenda: el
 * título ya la nombra.
 */
export default function InicioCash({ barras }: { barras: BarraCash[] }) {
  const { ref, ancho } = usarAncho<HTMLDivElement>();
  const [verTabla, setVerTabla] = useState(false);
  const [activa, setActiva] = useState<number | null>(null);

  const H = 330;
  const M = { t: 18, r: 14, b: 42, l: 64 };
  const iw = Math.max(ancho - M.l - M.r, 10);
  const ih = H - M.t - M.b;
  // Un mes puede salir NEGATIVO si las devoluciones superan a los cobros. Antes
  // la barra no se pintaba y el mes parecía vacío mientras la tabla sí enseñaba
  // el número; ahora el suelo baja para que se vea, con el paso bien escalado.
  const { top, suelo, paso } = ejeConSuelo(barras.map((b) => b.cob));
  const rango = top - suelo;
  const y = (v: number) => M.t + ih - ((v - suelo) / rango) * ih;
  const paso1 = barras.length ? iw / barras.length : iw;
  const cx = (i: number) => M.l + paso1 * (i + 0.5);
  const bw = Math.min(56, paso1 * 0.66);
  // Salto de etiquetas del eje: por debajo de ~52px por columna se solapan.
  const cada = Math.max(1, Math.ceil(52 / Math.max(paso1, 1)));

  const lineas: number[] = [];
  for (let v = Math.ceil(suelo / paso) * paso; v <= top + 1e-6; v += paso) lineas.push(v);

  const b = activa === null ? null : barras[activa];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Cash collected mes a mes</h2>
          <span className="hint">
            {barras.length === 0
              ? "el rango empieza después de hoy"
              : `${barras.length} ${barras.length === 1 ? "mes" : "meses"} · solo cobrado`}
          </span>
        </div>
        {barras.length > 0 && (
          <button
            type="button"
            className="chip"
            aria-pressed={verTabla}
            onClick={() => setVerTabla((v) => !v)}
          >
            {verTabla ? "Ver gráfico" : "Ver tabla"}
          </button>
        )}
      </div>

      <div className="card-body">
        {barras.length === 0 ? (
          <div className="empty-box">
            El rango empieza después de hoy: todavía no hay nada cobrado que enseñar.
          </div>
        ) : verTabla ? (
          <TablaCash barras={barras} />
        ) : (
          <div className="gr-wrap" ref={ref}>
            {ancho > 0 && (
              <svg width={ancho} height={H} viewBox={`0 0 ${ancho} ${H}`} role="img" aria-label={descripcion(barras)}>
                {lineas.map((v) => (
                  <g key={v}>
                    <line x1={M.l} x2={ancho - M.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
                    <text x={M.l - 10} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-4)">
                      {etiquetaEje(v, paso)}
                    </text>
                  </g>
                ))}
                {barras.map((d, i) => (
                  <g key={d.ym}>
                    {d.cob !== 0 && (
                      <rect
                        x={cx(i) - bw / 2}
                        y={d.cob > 0 ? y(d.cob) : y(0)}
                        width={bw}
                        height={Math.max(Math.abs(y(d.cob) - y(0)), 1)}
                        rx={4}
                        /* Rojo = dinero que SALIÓ, que es lo que significa un mes en negativo. */
                        fill={d.cob > 0 ? "var(--gold)" : "var(--red)"}
                        opacity={activa === null || activa === i ? 1 : 0.55}
                      />
                    )}
                    {/* Etiqueta directa solo en el mes en curso: nunca un número en cada barra. */}
                    {d.enCurso && d.cob !== 0 && (
                      <text x={cx(i)} y={(d.cob > 0 ? y(d.cob) : y(0)) - 8} textAnchor="middle"
                        fontSize={11} fontWeight={600} fill="var(--text-2)">
                        {etiquetaEje(d.cob, paso)}
                      </text>
                    )}
                    {etiquetaVisible(i, barras.length, cada) && (
                      <text
                        /* La ÚLTIMA se ancla por su borde derecho: centrada, el
                           viewBox le cortaba el año y se leía «ago ’2» — y la
                           última columna es siempre el mes en curso. */
                        x={i === barras.length - 1 ? ancho - 2 : cx(i)}
                        y={H - 22}
                        textAnchor={i === barras.length - 1 ? "end" : "middle"}
                        fontSize={11}
                        fill={d.enCurso ? "var(--text-3)" : "var(--text-4)"}
                      >
                        {etiquetaMes(d.ym)}
                      </text>
                    )}
                    {/* El objetivo de puntero es toda la columna, no solo la barra pintada. */}
                    <rect
                      x={cx(i) - paso1 / 2}
                      y={M.t}
                      width={paso1}
                      height={ih}
                      fill="transparent"
                      tabIndex={0}
                      role="img"
                      aria-label={`${etiquetaMes(d.ym, true)}: ${money(d.cob, "USD")}`}
                      onPointerEnter={() => setActiva(i)}
                      onFocus={() => setActiva(i)}
                      onPointerLeave={() => setActiva(null)}
                      onBlur={() => setActiva(null)}
                    />
                  </g>
                ))}
                <line x1={M.l} x2={ancho - M.r} y1={y(0)} y2={y(0)} stroke="var(--border-2)" strokeWidth={1} />
              </svg>
            )}
            {b && (
              <div
                className="tt visible"
                role="status"
                style={{ left: Math.min(Math.max(cx(activa!), 96), ancho - 96), top: Math.min(y(b.cob), y(0)) - 12 }}
              >
                <div className="tt-m">{etiquetaMes(b.ym, true)}{b.enCurso ? " · en curso" : ""}</div>
                <div className="tt-f">
                  <span className="tt-l">Cobrado</span>
                  <span className="tt-v">{money(b.cob, "USD")}</span>
                </div>
                {/* El ritmo por mes: cuánto entra al día contando solo los transcurridos. */}
                <div className="tt-f">
                  <span className="tt-l">Ritmo</span>
                  <span className="tt-v">{money(b.cob / b.dias, "USD")}/día</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Vista de tabla: todo valor del tooltip es alcanzable sin pasar el ratón. */
function TablaCash({ barras }: { barras: BarraCash[] }) {
  return (
    <div className="tabla-scroll">
      <table className="t">
        <thead>
          <tr>
            <th>Mes</th>
            <th className="r">Días</th>
            <th className="r">Ritmo</th>
            <th className="r">Cobrado</th>
          </tr>
        </thead>
        <tbody>
          {barras.map((d) => (
            <tr key={d.ym}>
              <td>{etiquetaMes(d.ym, true)}{d.enCurso ? " · en curso" : ""}</td>
              <td className="r mono muted">{d.dias}</td>
              <td className="r mono">{money(d.cob / d.dias, "USD")}/día</td>
              <td className="r mono">{d.cob ? money(d.cob, "USD") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const descripcion = (barras: BarraCash[]) =>
  barras.map((d) => `${etiquetaMes(d.ym, true)}: ${money(d.cob, "USD")}`).join(". ");
