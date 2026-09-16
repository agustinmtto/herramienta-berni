import { getPnlUsd } from "@/lib/data";
import { money, monthLabel } from "@/lib/format";
import { requireModulo } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function PnlPage() {
  await requireModulo("pnl");
  const pnl = await getPnlUsd();
  const ytd = pnl.filter((p) => p.mes >= "2026-01-01");
  const ing = ytd.reduce((s, p) => s + p.ingresos, 0);
  const gas = ytd.reduce((s, p) => s + p.gastos, 0);
  const profit = ing - gas;
  const margen = ing > 0 ? (profit / ing) * 100 : 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>P&L · Resumen mensual</h1>
        <p>Ingresos y gastos reales · en USD (moneda de los gastos)</p>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Ingresos YTD 2026</div>
          <div className="value gold">{money(ing, "USD")}</div>
          <div className="sub">cash collected (USD recibido)</div>
        </div>
        <div className="kpi">
          <div className="label">Gastos YTD 2026</div>
          <div className="value">{money(gas, "USD")}</div>
          <div className="sub">{gas > 0 ? "registrados" : "sin cargar aún"}</div>
        </div>
        <div className="kpi">
          <div className="label">Beneficio neto YTD</div>
          <div className={`value ${profit >= 0 ? "pos" : "neg"}`}>{money(profit, "USD")}</div>
          <div className="sub">margen {margen.toFixed(0)}%</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Detalle mensual</h2>
          <span className="hint">USD</span>
        </div>
        <div className="card-body">
          <div className="tabla-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="r">Ingresos</th>
                  <th className="r">Gastos</th>
                  <th className="r">Beneficio</th>
                  <th className="r">Margen</th>
                </tr>
              </thead>
              <tbody>
                {pnl.map((p) => {
                  const m = p.ingresos > 0 ? (p.profit / p.ingresos) * 100 : 0;
                  return (
                    <tr key={p.mes}>
                      <td>{monthLabel(p.mes)}</td>
                      <td className="r mono gold">{money(p.ingresos, "USD")}</td>
                      <td className="r mono muted">{money(p.gastos, "USD")}</td>
                      <td className={`r mono ${p.profit >= 0 ? "pos" : "neg"}`}>
                        {money(p.profit, "USD")}
                      </td>
                      <td className="r mono muted">{p.ingresos > 0 ? `${m.toFixed(0)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
