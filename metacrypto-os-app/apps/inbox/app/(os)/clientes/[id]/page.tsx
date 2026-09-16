import { notFound } from "next/navigation";
import { getFichaCliente, getTeamMembers } from "@/lib/data";
import { obtenerDatosFichaPanel } from "@/lib/ficha-panel-datos";
import { requireModulo } from "@/lib/guard";
import { puedeVer } from "@/lib/modulos";
import FichaPanel from "@/components/FichaPanel";
import EditarCliente from "@/components/EditarCliente";
import BonosCliente from "@/components/BonosCliente";
import DevolucionForm from "@/components/DevolucionForm";

export const dynamic = "force-dynamic";

export default async function FichaClientePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireModulo("clientes");
  const { id } = await params;

  const [ficha, coaches, panel] = await Promise.all([
    getFichaCliente(id),
    getTeamMembers(),
    obtenerDatosFichaPanel(id, user),
  ]);
  if (!ficha || !panel) notFound();

  return (
    <>
      <FichaPanel
        ficha={panel.ficha}
        datos={panel.datos}
        conversacionId={panel.conversacionId}
        actividad={panel.actividad}
        cupo={panel.cupo}
        hoy={panel.hoy}
        puede={panel.puede}
        contratos={panel.contratos}
        llamadas={panel.llamadas}
      />

      {/* Los tres formularios que ya existían. Van al pie y no en la barra de
          acciones porque son de mantenimiento —corregir la ficha, ajustar los
          bonos de una venta, registrar una devolución— y no del día a día.
          Cada uno trae su propio botón y su propio modal. */}
      <div className="page ficha-mantenimiento">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Corregir esta ficha</h2>
              <span className="hint">datos del cliente, bonos y devoluciones</span>
            </div>
          </div>
          <div className="card-body-pad ficha-mantenimiento-acciones">
            <EditarCliente
              ficha={{
                id: ficha.id, nombre: ficha.nombre, telefono_e164: ficha.telefono_e164,
                email: ficha.email, pais: ficha.pais, coach_id: ficha.coach_id,
                estado: ficha.estado,
              }}
              coaches={coaches.map((c) => ({ id: c.id, nombre: c.nombre }))}
              puedeCambiarEstado={user.acceso_total}
            />
            {puedeVer(user, "ventas") && (
              <BonosCliente
                personaId={ficha.id}
                programaId={ficha.programa_id}
                mesesTier={ficha.meses_tier}
                bonos={ficha.bonos}
              />
            )}
            {puedeVer(user, "devoluciones") && (
              <DevolucionForm personaId={ficha.id} personaNombre={ficha.nombre ?? "este cliente"} />
            )}
          </div>
        </div>

        {panel.truncado && (
          <p className="hint">
            Este cliente tiene más de 500 eventos y la actividad se muestra recortada.
          </p>
        )}
      </div>
    </>
  );
}
