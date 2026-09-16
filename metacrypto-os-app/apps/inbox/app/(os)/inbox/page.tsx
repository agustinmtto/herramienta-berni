import Sidebar from "@/components/Sidebar";
import type { EstadoAtencion } from "@/lib/data";
import { requireModulo } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function InboxHome({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  await requireModulo("inbox");
  const { f } = await searchParams;
  const filter = f === "pendiente" || f === "resuelto" ? (f as EstadoAtencion) : undefined;
  return (
    <div className="shell">
      <Sidebar filter={filter} />
      <div className="main">
        <div className="empty">
          {/* Sin emoji: el spec pide formas geométricas monocromas (§8.6), que
              además se dibujan igual en todos los sistemas. Y con una salida:
              un estado vacío que solo describe el vacío deja al usuario sin
              nada que hacer. */}
          <div className="box vacio-inbox">
            <span className="vacio-marca" aria-hidden="true">◧</span>
            <h2>Ninguna conversación abierta</h2>
            <p>Elige una de la izquierda, o busca a alguien para escribirle.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
