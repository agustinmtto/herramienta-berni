import type { ReactNode } from "react";
import OsNav from "@/components/OsNav";
import Confirmacion from "@/components/Confirmacion";
import AvisoWaCaido from "@/components/AvisoWaCaido";
import { getCounts } from "@/lib/data";
import { getCurrentUser } from "@/lib/auth";

export default async function OsLayout({ children }: { children: ReactNode }) {
  const [counts, user] = await Promise.all([getCounts(), getCurrentUser()]);
  return (
    <div className="os">
      <OsNav
        counts={counts}
        perms={{ acceso_total: user?.acceso_total ?? false, modulos: user?.modulos ?? null }}
        nombre={user?.nombre}
      />
      <main className="os-main">
        <AvisoWaCaido />
        {children}
      </main>
      {/* Fuera de <main> y del árbol de cada página: las acciones revalidan
          la ruta y remontan las filas, así que la confirmación tiene que
          vivir donde no la alcance ese remontaje. */}
      <Confirmacion />
    </div>
  );
}
