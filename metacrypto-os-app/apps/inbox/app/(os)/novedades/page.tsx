import { redirect } from "next/navigation";
import { miembroActivo, paginaNovedades } from "@/lib/novedades-datos";
import NovedadesLista from "@/components/NovedadesLista";

export const dynamic = "force-dynamic";

// SIN requireModulo a propósito (spec de novedades): cualquier miembro
// ACTIVO entra y la tabla ya se autofiltra por módulos. Es la pantalla donde
// aterriza un miembro sin módulos (homePath) y donde vive el botón
// "Activar avisos del OS" del menú.
export default async function NovedadesPage() {
  const u = await miembroActivo();
  if (!u) redirect("/login");
  const { items, siguiente } = await paginaNovedades(u, null);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Novedades</h1>
        <p>Lo que ha pasado en el negocio — cada uno ve lo que sus módulos le dejan</p>
      </div>
      <NovedadesLista inicial={items} cursorInicial={siguiente} />
    </div>
  );
}
