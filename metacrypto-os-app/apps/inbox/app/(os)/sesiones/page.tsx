import { requireModulo } from "@/lib/guard";
import {
  historicoSesiones, proximasSesiones, sesionesSinCliente, cupoClientes,
  repartoPorCoach, operacionesDeSesiones, clientesParaSelector, coaches,
  reglasRecurrentes, tamanoAudiencia,
} from "@/lib/sesiones-datos";
import SesionesPanel from "@/components/SesionesPanel";
import SesionesSinCliente from "@/components/SesionesSinCliente";
import RecurrentesPanel from "@/components/RecurrentesPanel";

export const dynamic = "force-dynamic";

export default async function SesionesPage() {
  await requireModulo("sesiones");

  const [historico, proximas, sinCliente, cupo, reparto, listaClientes, listaCoaches, recurrentes, audiencia] =
    await Promise.all([
      historicoSesiones(), proximasSesiones(), sesionesSinCliente(),
      cupoClientes(), repartoPorCoach(), clientesParaSelector(), coaches(),
      reglasRecurrentes(), tamanoAudiencia(),
    ]);

  // Las operaciones se traen de una vez para todas las sesiones, no por sesión
  // al abrir el detalle: son pocas y así el modal no tiene que esperar a una
  // petición para pintar lo que ya podría estar en memoria.
  const operaciones = await operacionesDeSesiones(
    [...historico, ...proximas].map((s) => s.id),
  );

  // Una sola fecha de corte para toda la página, en Madrid y no en UTC: este
  // componente corre en Vercel (UTC) y `toISOString()` a las 00:30 de Madrid
  // devuelve el día anterior — el mismo bug que ya documenta /cuotas. Aquí
  // decidiría mal qué sesión cuenta como "de este mes" en el KPI.
  const hoyMadrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" })
    .format(new Date());
  const mesActual = hoyMadrid.slice(0, 7);

  const realizadas = historico.filter((s) => s.estado_asistencia === "asistio").length;
  const esteMes = historico.filter(
    (s) => s.estado_asistencia === "asistio" && s.dia?.startsWith(mesActual),
  ).length;
  const sinRegistrar = historico.filter((s) => s.estado_asistencia === null).length;

  return (
    <div className="page">
      <div className="page-head sesiones-head">
        <div>
          <h1>Sesiones</h1>
          <p>
            El histórico de consultorías del servicio: qué se hizo, con quién,
            qué se habló y cuántas quedan.
          </p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Sesiones realizadas</div>
          <div className="value">{realizadas}</div>
          <div className="sub">todo el histórico</div>
        </div>
        <div className="kpi">
          <div className="label">Este mes</div>
          <div className="value">{esteMes}</div>
          <div className="sub">{mesLargo(mesActual)}</div>
        </div>
        <div className={`kpi ${sinRegistrar > 0 ? "warn" : ""}`}>
          <div className="label">Sin registrar</div>
          <div className="value">{sinRegistrar}</div>
          <div className="sub">
            {sinRegistrar > 0 ? "ya pasaron y nadie anotó nada" : "todo al día"}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Próximas</div>
          <div className="value">{proximas.length}</div>
          <div className="sub">agendadas en GoHighLevel</div>
        </div>
      </div>

      {/* La bandeja sólo existe cuando hay algo que rescatar: una franja vacía
          permanente enseña a ignorarla. */}
      {sinCliente.length > 0 && (
        <SesionesSinCliente sesiones={sinCliente} clientes={listaClientes} />
      )}

      <SesionesPanel
        historico={historico}
        proximas={proximas}
        cupo={cupo}
        reparto={reparto}
        operaciones={operaciones}
        clientes={listaClientes}
        coaches={listaCoaches}
        hoy={hoyMadrid}
      />

      {/* La configuración del aviso semanal va al final: es algo que se toca
          una vez (hora + link de Zoom + activar), no trabajo del día a día.
          El interruptor global (env) se lee aquí, en el servidor. */}
      <RecurrentesPanel
        reglas={recurrentes}
        coaches={listaCoaches}
        audiencia={audiencia}
        envioGlobal={process.env.RECORDATORIO_GRUPAL_ACTIVO === "1"}
      />
    </div>
  );
}

function mesLargo(mes: string): string {
  const [a, m] = mes.split("-");
  const nombres = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${nombres[Number(m) - 1]} ${a}`;
}
