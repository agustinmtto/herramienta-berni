"use client";
// Envuelve una fila (p. ej. un pago) para que al clickearla se abra la ficha
// del cliente en un panel lateral — la misma <FichaPanel> que /clientes/[id],
// no una vista aparte. El botón "expandir" del panel manda a esa página
// completa si hace falta editar algo.
import { useState, useTransition, type ReactNode } from "react";
import { cargarFichaPanel } from "@/app/ficha-panel-actions";
import PanelLateral from "@/components/PanelLateral";
import FichaPanel from "@/components/FichaPanel";
import type { DatosFichaPanel } from "@/lib/ficha-panel-datos";

export default function FichaEnPanel({
  personaId,
  pagoId,
  as: Tag = "tr",
  children,
}: {
  personaId: string | null;
  /** Si la fila es la de un pago concreto, la ficha abre directo en Compras
      con esa línea resaltada — el mismo mecanismo, sea cual sea la pantalla
      desde la que se abrió. */
  pagoId?: string;
  /** Elemento que envuelve — "tr" para una fila de tabla. */
  as?: "tr" | "div";
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<DatosFichaPanel | null>(null);
  const [saltarA, setSaltarA] = useState<string | undefined>(undefined);
  const [pending, start] = useTransition();

  function abrir(e: React.MouseEvent) {
    if (!personaId) return;
    const target = e.target as HTMLElement;
    // Un control con data-abrir-panel (p.ej. "Sesiones hechas") SÍ abre el
    // panel, y de paso dice a qué sección saltar. Cualquier otro link o botón
    // propio de la fila (enviar bienvenida, clasificar una devolución...)
    // hace lo suyo y el panel no se mete en el medio.
    const disparador = target.closest<HTMLElement>("[data-abrir-panel]");
    if (!disparador && target.closest("a, button, input, select, textarea")) return;
    setAbierto(true);
    setDatos(null);
    setSaltarA(disparador?.dataset.seccion);
    start(async () => {
      setDatos(await cargarFichaPanel(personaId));
    });
  }

  function cerrar() {
    setAbierto(false);
    setDatos(null);
  }

  return (
    <>
      <Tag className={personaId ? "fila-clic" : undefined} onClick={personaId ? abrir : undefined}>
        {children}
      </Tag>
      {abierto && (
        <PanelLateral
          titulo="Cliente"
          onCerrar={cerrar}
          expandirHref={personaId ? `/clientes/${personaId}` : undefined}
        >
          {pending || !datos ? (
            <div className="empty-box">Cargando…</div>
          ) : (
            <FichaPanel
              ficha={datos.ficha}
              datos={datos.datos}
              conversacionId={datos.conversacionId}
              actividad={datos.actividad}
              cupo={datos.cupo}
              hoy={datos.hoy}
              puede={datos.puede}
              contratos={datos.contratos}
              llamadas={datos.llamadas}
              resaltarPago={pagoId}
              saltarA={saltarA}
            />
          )}
        </PanelLateral>
      )}
    </>
  );
}
