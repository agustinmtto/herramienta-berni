"use server";
// ============================================================
// Server actions del módulo de leads (docs/11 §9).
// La vinculación post-venta es la ÚNICA mutación del módulo: el flujo de
// ventas existente crea al cliente, y desde /leads alguien con permiso
// `leads` conecta los diagnósticos del lead temporal con ese cliente.
// El RPC revalida todo (lead temporal propio, cliente con programa,
// idempotencia) — acá solo se exige sesión con permiso y se revalida.
// ============================================================
import { revalidatePath } from "next/cache";
import { rest } from "@/lib/supabase";
import { requireModulo } from "@/lib/guard";

export async function vincularLeadAccion(
  _prev: { ok: boolean; error?: string; mensaje?: string },
  formData: FormData
): Promise<{ ok: boolean; error?: string; mensaje?: string }> {
  await requireModulo("leads");

  const leadPersonaId = String(formData.get("leadPersonaId") ?? "");
  const clienteId = String(formData.get("clienteId") ?? "");
  if (!leadPersonaId || !clienteId) {
    return { ok: false, error: "Falta el cliente definitivo para vincular." };
  }

  const r = await rest<{ ok: boolean; envios_reasignados: number; cliente_id: string }>(
    "POST",
    "rpc/vincular_lead_convertido",
    { p_lead_id: leadPersonaId, p_cliente_id: clienteId },
  );

  if (r.status === 200 && r.json?.ok) {
    revalidatePath("/leads");
    revalidatePath(`/leads`);
    const n = r.json.envios_reasignados;
    return { ok: true, mensaje: n > 0 ? `Vinculado: ${n} ${n === 1 ? "envío reasignado" : "envíos reasignados"} al cliente.` : "Ya estaba vinculado." };
  }

  const message = (r.json as { message?: string } | null)?.message ?? "";
  if (message.includes("lead_invalido")) return { ok: false, error: "El lead no es una persona temporal de este módulo." };
  if (message.includes("cliente_invalido")) return { ok: false, error: "El cliente no existe, no está en estado 'cliente' o no tiene ningún programa." };
  return { ok: false, error: "No se pudo vincular. Intentá de nuevo." };
}
