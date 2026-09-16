import Link from "next/link";
import { getConversations, getContactables, type EstadoAtencion } from "@/lib/data";
import LiveConversations from "@/components/LiveConversations";
import NuevoMensaje from "@/components/NuevoMensaje";

export default async function Sidebar({
  activeId,
  filter,
}: {
  activeId?: string;
  filter?: EstadoAtencion;
}) {
  const [convs, contactos] = await Promise.all([getConversations(filter), getContactables()]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h1>
          MetaCrypto Inbox <span className="live">● en vivo</span>
        </h1>
        <div className="tabs">
          <Link className={`tab ${!filter ? "active" : ""}`} href="/inbox">
            Todas
          </Link>
          <Link
            className={`tab ${filter === "pendiente" ? "active" : ""}`}
            href="/inbox?f=pendiente"
          >
            Pendientes
          </Link>
          <Link
            className={`tab ${filter === "resuelto" ? "active" : ""}`}
            href="/inbox?f=resuelto"
          >
            Resueltas
          </Link>
        </div>
        <NuevoMensaje contactos={contactos} />
        {/* AvisosPush se fue al pie del menú lateral (OsNav): encima de la
            lista de WhatsApp no lo encontraba nadie que no viviera en el
            inbox, y es un ajuste de toda la app, no de esta pantalla. */}
      </div>
      <LiveConversations initial={convs} activeId={activeId} filter={filter} />
    </aside>
  );
}
