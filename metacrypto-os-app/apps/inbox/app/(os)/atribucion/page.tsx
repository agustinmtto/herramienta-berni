import Link from "next/link";
import {
  getVentasSinAtribuir, getVentasAtribuidas, getTeamMembers, getFuentesPorConfirmar,
} from "@/lib/data";
import { requireModulo } from "@/lib/guard";
import { money, dateEs } from "@/lib/format";
import { ATRIBUCION_CORTE } from "@/lib/comisiones";
import BandejaAtribucion from "@/components/BandejaAtribucion";
import CorreccionAtribucion from "@/components/CorreccionAtribucion";
import ConfirmarFuentes from "@/components/ConfirmarFuentes";
import { IconoCheck } from "@/components/Iconos";

export const dynamic = "force-dynamic";

export default async function AtribucionPage() {
  // Mismo permiso que /nueva-venta: quien registra ventas es quien las
  // atribuye, y así no hace falta un permiso nuevo que alguien tenga que
  // recordar conceder aparte.
  await requireModulo("ventas");
  const [{ relevantes, historico }, atribuidas, team, fuentesPorConfirmar] = await Promise.all([
    getVentasSinAtribuir(),
    getVentasAtribuidas(),
    getTeamMembers(),
    getFuentesPorConfirmar(),
  ]);
  // El contador y el KPI se alimentan SOLO de `relevantes`: es lo único que
  // responde la pregunta del cierre. El histórico se ve más abajo, pero no
  // cuenta aquí — contarlo haría que la bandeja pareciera imposible de vaciar.
  const total = relevantes.reduce((s, v) => s + v.monto, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ventas sin atribuir</h1>
        <p>
          Su valor no es corregir: es ser la garantía de que el cierre de comisiones desde{" "}
          {dateEs(ATRIBUCION_CORTE)} está completo. Si esta bandeja está vacía, ninguna venta que
          todavía pueda devengar comisión se quedó sin decidir.
        </p>
      </div>

      {/* Fuentes nuevas que /api/ghl/citas insertó sola (Source_ID que GHL
          nunca había visto) y que Berni no ha validado. Visible SIN
          `<details>` a propósito, a diferencia de las dos secciones de abajo:
          esas son para "algo salió mal" (revisión ocasional), esta bloquea
          comisiones activamente y Berni acuña un código nuevo por cada pieza
          de contenido — si se escondiera, nadie la miraría hasta el cierre.
          Solo se pinta si hay algo pendiente: hoy (con las 20 fuentes ya
          confirmadas) esta sección no existe en la página. */}
      {fuentesPorConfirmar.length > 0 && (
        <div className="card bloque-fin">
          <div className="card-head">
            <h2>Fuentes por confirmar ({fuentesPorConfirmar.length})</h2>
            <span className="hint">sin esto, sus ventas no generan comisión</span>
          </div>
          <div className="card-body card-body-pad">
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              Cada Source_ID nuevo que trae GoHighLevel entra sin confirmar — mientras siga así,
              ningún pago que lo use genera comisión (incidencia &quot;fuente sin confirmar&quot;).
            </p>
            <ConfirmarFuentes fuentes={fuentesPorConfirmar} team={team} />
          </div>
        </div>
      )}

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Sin atribuir</div>
          <div className={`value ${relevantes.length === 0 ? "pos" : "gold"}`}>{relevantes.length}</div>
          <div className="sub">{money(total, "EUR")} en ventas todavía sin decisión</div>
        </div>
      </div>

      {relevantes.length === 0 ? (
        <div className="card">
          <div className="empty-box"><IconoCheck /> Todo atribuido. El cierre de comisiones está completo.</div>
        </div>
      ) : (
        <BandejaAtribucion ventas={relevantes} team={team} />
      )}

      {/* Corrección de ya atribuidas (diseño § 4.2): sin esto una cita mal
          elegida queda mal para siempre, porque nada más en el OS relee
          `atribucion_at is not null`. Colapsado por defecto — su público es
          "algo salió mal", no el flujo normal de cada día. */}
      <details className="historico-atribucion">
        <summary>Ya atribuidas del cierre actual · corregir ({atribuidas.length})</summary>
        <p className="hint">
          Para arreglar una cita mal elegida o un "no vino de agenda" que era un error. Cada
          cambio queda en auditoría, porque mueve a quién se le paga.
        </p>
        <CorreccionAtribucion ventas={atribuidas} team={team} />
      </details>

      {historico.length > 0 && (
        <details className="historico-atribucion">
          <summary>
            Histórico sin atribuir · no se recalcula ({historico.length} ·{" "}
            {money(historico.reduce((s, v) => s + v.monto, 0), "EUR")})
          </summary>
          <p className="hint">
            Ventas anteriores a {dateEs(ATRIBUCION_CORTE)} sin cuotas pendientes. Sus comisiones ya
            se pagaron como se pagaron — decisión de Milo (11-ago-2026) de no recalcularlas. Se
            muestran aquí para no esconderlas, no porque haya algo que hacer con ellas.
          </p>
          <div className="tabla-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Tier</th>
                  <th className="r">Importe</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((v) => (
                  <tr key={v.id}>
                    <td className="mono">{dateEs(v.fecha_inicio)}</td>
                    {/* El nombre lleva a su ficha. `persona_id` ya viajaba en
                        la fila y no se usaba: en /ingresos, /semana e Inicio el
                        nombre SÍ es enlace, así que aquí se leía como si esta
                        tabla fuera de otra aplicación. */}
                    <td><Link href={`/clientes/${v.persona_id}`} className="linkbtn">{v.persona_nombre}</Link></td>
                    <td>{v.tier}</td>
                    <td className="r mono">{money(v.monto, v.divisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
