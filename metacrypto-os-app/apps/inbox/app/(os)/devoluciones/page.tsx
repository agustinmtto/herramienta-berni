import { requireModulo } from "@/lib/guard";
import { getDevoluciones, getCashCobradoAnio, getTeamMembers } from "@/lib/data";
import { money, num } from "@/lib/format";
import DevolucionesTabla from "@/components/DevolucionesTabla";
import DevolucionesMeses from "@/components/DevolucionesMeses";

export const dynamic = "force-dynamic";

function anioValido(a: string | undefined): number {
  const n = Number(a);
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : new Date().getFullYear();
}

export default async function DevolucionesPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string }>;
}) {
  await requireModulo("devoluciones");
  const { anio } = await searchParams;
  const y = anioValido(anio);

  const [filas, cobrado, equipo] = await Promise.all([
    getDevoluciones(y),
    getCashCobradoAnio(y),
    getTeamMembers(),
  ]);

  const devuelto = filas.reduce((s, d) => s + Number(d.usd_recibido ?? 0), 0);
  // La tasa se mide sobre el cash cobrado SIN devoluciones (ver
  // getCashCobradoAnio): restarlas del denominador las contaría dos veces.
  const tasa = cobrado > 0 ? (Math.abs(devuelto) / cobrado) * 100 : null;
  const sinClasificar = filas.filter((d) => d.alcance === "sin_clasificar").length;
  const nombres = Object.fromEntries(equipo.map((t) => [t.id, t.nombre]));

  // Madrid y no UTC: a las 00:30 del 1 de mes, `toISOString()` devuelve el día
  // anterior y la serie cortaría un mes antes de tiempo. Misma trampa que en
  // cuotas y gastos.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

  return (
    <div className="page">
      <div className="page-head">
        <h1>Devoluciones · {y}</h1>
        <span className="hint">
          {num(filas.length)} movimientos en {y}
        </span>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Devuelto en {y}</div>
          <div className="value">{money(devuelto, "USD")}</div>
          <div className="sub">{filas.length} movimientos</div>
        </div>
        <div className="kpi">
          <div className="label">Sobre el cash cobrado</div>
          <div className="value">{tasa === null ? "—" : `${tasa.toFixed(2)} %`}</div>
          <div className="sub">de {money(cobrado, "USD")} cobrados</div>
        </div>
        <div className="kpi">
          <div className="label">Sin clasificar</div>
          <div className="value">{num(sinClasificar)}</div>
          <div className="sub">
            {sinClasificar === 0
              ? "todas resueltas"
              : "esperan que alguien diga qué fueron"}
          </div>
        </div>
      </div>

      <DevolucionesMeses filas={filas} anio={y} hoy={hoy} />

      <DevolucionesTabla filas={filas} nombres={nombres} />
    </div>
  );
}
