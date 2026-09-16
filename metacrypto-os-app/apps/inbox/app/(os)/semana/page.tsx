import Link from "next/link";
import { getSemana } from "@/lib/data";
import FichaEnPanel from "@/components/FichaEnPanel";
import { money, num } from "@/lib/format";
import { requireModulo } from "@/lib/guard";
import { hoyMadrid, dateEsMadrid } from "@/lib/timeline";
import {
  parseSemanaParam, semanaAnterior, semanaSiguiente, etiquetaSemana,
  resumenSemana, deltaPct, etiquetaMotivo,
} from "@/lib/semana";
import { IconoAlerta } from "@/components/Iconos";

export const dynamic = "force-dynamic";

function NombreCliente({ persona }: { persona: { id: string; nombre: string | null } | null }) {
  const nombre = persona?.nombre?.trim() || "—";
  if (!persona?.id) return <>{nombre}</>;
  return <Link href={`/clientes/${persona.id}`}>{nombre}</Link>;
}

export default async function SemanaPage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>;
}) {
  await requireModulo("ingresos");
  const { w } = await searchParams;

  const semana = parseSemanaParam(w, hoyMadrid());
  const previa = semanaAnterior(semana);
  const proxima = semanaSiguiente(semana);

  const [actual, anterior] = await Promise.all([getSemana(semana), getSemana(previa)]);
  const r = resumenSemana(actual.pagos, actual.ventas);
  // El delta compara DÓLARES contra dólares. Mezclarlo con el euro daría un
  // porcentaje que no significa nada.
  const delta = deltaPct(r.cashUsd, resumenSemana(anterior.pagos, anterior.ventas).cashUsd);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reporte semanal</h1>
        <div className="semana-nav">
          <Link className="btn" href={`/semana?w=${previa.desde}`} aria-label="Semana anterior">‹</Link>
          <strong>{etiquetaSemana(semana)}</strong>
          <Link className="btn" href={`/semana?w=${proxima.desde}`} aria-label="Semana siguiente">›</Link>
        </div>
      </div>

      <div className="kpis">
        <a className="kpi accent kpi-link" href="#cash-collected-detalle">
          <div className="label">Cash collected</div>
          <div className="value gold">{money(r.cashUsd, "USD")}</div>
          <div className="sub">
            {num(r.nPagos)} pago{r.nPagos === 1 ? "" : "s"} · {money(r.cashCollected)} facturado
            {delta !== null && (
              <span className={delta >= 0 ? "pos" : "neg"}>
                {" · "}
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}% vs semana anterior
              </span>
            )}
            {r.nSinUsd > 0 && (
              <span className="neg"> · <IconoAlerta /> {r.nSinUsd} sin USD</span>
            )}
          </div>
        </a>
        <div className="kpi">
          <div className="label">Facturación</div>
          <div className="value">{money(r.facturacion)}</div>
          <div className="sub">
            {r.porMotivo.length === 0
              ? "sin ventas firmadas"
              : r.porMotivo.map((m) => `${etiquetaMotivo(m.motivo)} ${money(m.importe)}`).join(" · ")}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Ticket medio</div>
          <div className="value">{r.ticketMedio === null ? "—" : money(r.ticketMedio)}</div>
          <div className="sub">
            {num(r.nVentas)} venta{r.nVentas === 1 ? "" : "s"} firmada{r.nVentas === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="grid-1">
        <div className="card">
          <div className="card-head">
            <h2>Ventas firmadas</h2>
            <span className="hint gold">{money(r.facturacion)}</span>
          </div>
          <div className="card-body">
            {actual.ventas.length === 0 ? (
              <div className="empty-box">Sin ventas firmadas esta semana.</div>
            ) : (
              <div className="tabla-scroll">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Motivo</th>
                      <th>Tier</th>
                      <th className="r">Acordado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actual.ventas.map((v) => (
                      <tr key={v.id}>
                        <td className="mono">{dateEsMadrid(v.fecha_inicio)}</td>
                        <td><NombreCliente persona={v.persona} /></td>
                        <td><span className="pill">{etiquetaMotivo(v.motivo)}</span></td>
                        <td className="muted">{v.tier}</td>
                        <td className="r mono">{money(v.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card" id="cash-collected-detalle">
          <div className="card-head">
            <h2>Cash collected</h2>
            <span className="hint gold">{money(r.cashCollected)}</span>
          </div>
          <div className="card-body">
            {actual.pagos.length === 0 ? (
              <div className="empty-box">Sin cobros esta semana.</div>
            ) : (
              <div className="tabla-scroll">
                <table className="t">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Concepto</th>
                      <th className="r">EUR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actual.pagos.map((p) => (
                      <FichaEnPanel key={p.id} personaId={p.persona?.id ?? null} pagoId={p.id}>
                        <td className="mono">{dateEsMadrid(p.fecha)}</td>
                        <td>{p.persona?.nombre?.trim() || "—"}</td>
                        <td className="muted">{p.tipo_detalle || p.tipo || "pago"}</td>
                        <td className={`r mono ${p.monto < 0 ? "neg" : ""}`}>{money(p.monto)}</td>
                      </FichaEnPanel>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
