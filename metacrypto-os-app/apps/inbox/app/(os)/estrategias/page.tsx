import { requireModulo } from "@/lib/guard";
import { estrategiasTodas, clientesParaSelector, kpis } from "@/lib/estrategias-datos";
import EstrategiasPanel from "@/components/EstrategiasPanel";

export const dynamic = "force-dynamic";

export default async function EstrategiasPage() {
  // Protege el RENDER. Las mutaciones se protegen aparte, dentro de cada server
  // action (`guardEstrategias`): un action es un POST a esta misma ruta y el
  // middleware lo deja pasar con sólo tener cookie de equipo válida.
  await requireModulo("estrategias");

  // Una sola fecha de corte para toda la página, en Madrid y no en UTC: esto
  // corre en Vercel (UTC) y `toISOString()` a las 00:30 de Madrid devuelve el
  // día anterior. Mismo motivo que en /sesiones y /cuotas.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

  const [lista, clientes, k] = await Promise.all([
    estrategiasTodas(),
    clientesParaSelector(),
    kpis(hoy.slice(0, 7)),
  ]);

  return (
    <div>
      <div className="page-head">
        <h1>Estrategias</h1>
        <p>Lo que cada cliente tiene publicado y puede consultar</p>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Publicadas</div>
          <div className="value">{k.publicadas}</div>
          <div className="sub">visibles para el cliente</div>
        </div>
        <div className="kpi">
          <div className="label">Lanzadas este mes</div>
          <div className="value">{k.esteMes}</div>
          <div className="sub">{hoy.slice(0, 7)}</div>
        </div>
        <div className={`kpi ${k.sinEstrategia > 0 ? "warn" : ""}`}>
          <div className="label">Activos sin estrategia</div>
          <div className="value">{k.sinEstrategia}</div>
          <div className="sub">de {k.conPrograma} con programa vigente</div>
        </div>
      </div>

      <EstrategiasPanel lista={lista} clientes={clientes} hoy={hoy} />
    </div>
  );
}
