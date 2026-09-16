import Link from "next/link";
import { getClientes } from "@/lib/data";
import { num } from "@/lib/format";
import { requireModulo } from "@/lib/guard";
import { puedeEnviarBienvenida } from "@/lib/bienvenida";
import ClientesTabla from "@/components/ClientesTabla";

export const dynamic = "force-dynamic";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ archivados?: string }>;
}) {
  const user = await requireModulo("clientes");
  const puedeBienvenida = puedeEnviarBienvenida(user);
  const { archivados: verArchivados } = await searchParams;
  const todos = await getClientes();

  // Los archivados (los OG legacy) se esconden por defecto: son 76 de 180 y
  // eran la mitad del ruido de esta pantalla. No se borran ni se excluyen de
  // la consulta — se pueden ver con el enlace, y sus pagos siguen contando en
  // todo lo financiero, que no mira `personas.estado`.
  const nArchivados = todos.filter((c) => c.estado === "archivado").length;
  const nExClientes = todos.filter((c) => c.estado === "ex_cliente").length;
  // Berni, CAMBIOS OS: «enseñemos solo los Clientes». Antes se escondían los
  // archivados pero los ex-clientes seguían mezclados con los vivos, así que la
  // lista principal contestaba mal a "¿a quién estoy sirviendo?".
  // El toggle sigue existiendo y ahora trae a los dos grupos de golpe.
  const clientes = verArchivados ? todos : todos.filter((c) => c.estado === "cliente");

  const activos = clientes.filter((c) => c.estado === "cliente");
  const conPrograma = activos.filter((c) => c.tier).length;
  // Cuántos clientes vivos no se pueden contactar. Es el número que Berni
  // quiere llevar a cero y el motivo de que la ficha sea editable.
  const sinTelefono = activos.filter((c) => !c.telefono_e164).length;

  const porTier = new Map<string, number>();
  for (const c of activos) if (c.tier) porTier.set(c.tier, (porTier.get(c.tier) ?? 0) + 1);
  const tiers = [...porTier.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Clientes</h1>
        <p>{num(activos.length)} clientes activos · ficha, programa activo y consultor</p>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Clientes activos</div>
          <div className="value gold">{num(activos.length)}</div>
          <div className="sub">
            {nExClientes} ex-cliente
            {nArchivados > 0 && ` · ${nArchivados} OG's`}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Con programa activo</div>
          <div className="value">{num(conPrograma)}</div>
          {/* Decía "según v_programa_activo": el nombre de una vista de
              Postgres, en un KPI, delante de tres personas no técnicas. */}
          <div className="sub">con un programa en curso</div>
        </div>
        <div className="kpi">
          <div className="label">Sin teléfono</div>
          <div className={`value ${sinTelefono > 0 ? "neg" : ""}`}>{num(sinTelefono)}</div>
          <div className="sub">no se les puede escribir</div>
        </div>
        {tiers.slice(0, 2).map(([t, n]) => (
          <div className="kpi" key={t}>
            <div className="label">Tier {t}</div>
            <div className="value">{num(n)}</div>
            <div className="sub">clientes activos</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Todos los clientes</h2>
          {nArchivados > 0 || verArchivados ? (
            <Link className="hint gold" href={verArchivados ? "/clientes" : "/clientes?archivados=1"}>
              {/* Berni pidió llamarlos "OG's". El estado de la base sigue
                  siendo `archivado` y el parámetro de la URL también: lo que
                  cambia es lo que lee una persona. */}
              {verArchivados ? "Ver solo clientes" : `Ver ex-clientes y OG's (${nExClientes + nArchivados}) →`}
            </Link>
          ) : (
            <span className="hint">ordenados por alta reciente</span>
          )}
        </div>
        <div className="card-body">
          <ClientesTabla clientes={clientes} puedeBienvenida={puedeBienvenida} />
        </div>
      </div>
    </div>
  );
}
