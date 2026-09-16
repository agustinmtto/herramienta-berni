"use server";
// Carga la ficha de un cliente para mostrarla en el panel lateral que se abre
// al clickear un pago (Semana, Ingresos) — sin navegar a /clientes/[id].
// Mismos datos que esa página, por lib/ficha-panel-datos.ts.
import { requireModulo } from "@/lib/guard";
import { obtenerDatosFichaPanel } from "@/lib/ficha-panel-datos";

export async function cargarFichaPanel(personaId: string) {
  const user = await requireModulo("clientes");
  return obtenerDatosFichaPanel(personaId, user);
}
