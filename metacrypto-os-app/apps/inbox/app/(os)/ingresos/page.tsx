import { getPagos, getCashCollected } from "@/lib/data";
import { money, num, monthLabel, dateEs, displayName } from "@/lib/format";
import { requireModulo } from "@/lib/guard";
import FichaEnPanel from "@/components/FichaEnPanel";
import { IconoAlerta, IconoClip } from "@/components/Iconos";

export const dynamic = "force-dynamic";

export default async function IngresosPage() {
  await requireModulo("ingresos");
  const [pagos, cash] = await Promise.all([getPagos(120), getCashCollected()]);
  const cur = cash[0];
  const totalPagos = pagos.length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ingresos / Pagos</h1>
        <p>Movimientos reales importados y reconciliados vs Airtable</p>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Cash collected · {cur ? monthLabel(cur.mes) : "—"}</div>
          <div className="value gold">{money(cur?.cash_usd, "USD")}</div>
          <div className="sub">
            {cur?.n_pagos ?? 0} pagos · {money(cur?.cash_collected)} facturado
            {cur && cur.n_sin_usd > 0 && (
              <span className="neg"> · <IconoAlerta /> {cur.n_sin_usd} sin USD</span>
            )}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Pagos mostrados</div>
          <div className="value">{num(totalPagos)}</div>
          <div className="sub">últimos movimientos</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>Cash collected por mes</h2>
            <span className="hint">cash $ · facturado €</span>
          </div>
          <div className="card-body">
            <div className="tabla-scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="r">Pagos</th>
                    <th className="r">Cash ($)</th>
                    <th className="r">Facturado (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {cash.map((c) => (
                    <tr key={c.mes}>
                      <td>{monthLabel(c.mes)}</td>
                      <td className="r">
                        {c.n_pagos}
                        {c.n_sin_usd > 0 && (
                          <span className="neg" title={`${c.n_sin_usd} sin USD`}> <IconoAlerta /></span>
                        )}
                      </td>
                      <td className="r mono gold">{money(c.cash_usd, "USD")}</td>
                      <td className="r mono muted">{money(c.cash_collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Últimos pagos</h2>
          </div>
          <div className="card-body lista-alta">
            <div className="tabla-scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th className="r">EUR</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.slice(0, 40).map((p) => (
                    <FichaEnPanel key={p.id} personaId={p.persona?.id ?? null} pagoId={p.id}>
                      <td className="mono">{dateEs(p.fecha)}</td>
                      <td>{displayName(p.persona, "—")}</td>
                      <td className={`r mono ${Number(p.monto) < 0 ? "neg" : ""}`}>{money(p.monto)}</td>
                      <td>{p.comprobante_path ? <a href={`/api/comprobantes/${p.id}`} target="_blank" title="Ver comprobante"><IconoClip /></a> : null}</td>
                    </FichaEnPanel>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
