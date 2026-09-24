"use server";
// ============================================================
// Server actions del módulo de leads (docs/11 §9).
// La vinculación post-venta es la ÚNICA mutación del módulo: el flujo de
// ventas existente crea al cliente, y desde /leads alguien con permiso
// `leads` conecta los diagnósticos del lead temporal con ese cliente.
//
// Validación de teléfono + rollback viven en el RPC (migración 0069,
// docs/11 §9.1–9.3); acá solo se exige sesión con permiso, se pasa el
// flag de confirmación explícita y se revalida.
//
// Firma (formData) y no (prev, formData): mismo criterio que crearVenta.
// useActionState NO existe en React 18 — el formulario la llama directo
// desde un onSubmit (ver components/VincularLead.tsx).
// ============================================================
import { revalidatePath } from "next/cache";
import { rest } from "@/lib/supabase";
import { requireModulo } from "@/lib/guard";
import { getClientesParaVincular, type ClienteParaVincular } from "@/lib/leads";

// Búsqueda server-side del picker de vinculación (I8): el componente cliente
// no puede cargar "todos los clientes" (el cap silencioso de 500 + búsqueda
// local era el problema). Acá se consulta PostgREST con el texto y se devuelve
// el lote acotado.
export async function buscarClientesParaVincular(
  q: string,
  page = 1,
): Promise<{ clientes: ClienteParaVincular[]; hayMas: boolean }> {
  await requireModulo("leads");
  return getClientesParaVincular(typeof q === "string" ? q : "", page);
}

export async function vincularLeadAccion(
  formData: FormData
): Promise<{ ok: boolean; error?: string; mensaje?: string }> {
  const u = await requireModulo("leads");

  const leadPersonaId = String(formData.get("leadPersonaId") ?? "");
  const clienteId = String(formData.get("clienteId") ?? "");
  const envioId = String(formData.get("envioId") ?? "");
  const confirmar = formData.get("confirmar") === "on" || formData.get("confirmar") === "true";
  if (!leadPersonaId || !clienteId) {
    return { ok: false, error: "Falta el cliente definitivo para vincular." };
  }

  const r = await rest<{ ok: boolean; envios_reasignados: number; cliente_id: string }>(
    "POST",
    "rpc/vincular_lead_convertido",
    { p_lead_id: leadPersonaId, p_cliente_id: clienteId, p_confirmar: confirmar, p_autor_id: u.id },
  );

  if (r.status === 200 && r.json?.ok) {
    revalidatePath("/leads");
    if (envioId) revalidatePath(`/leads/${envioId}`);
    const n = r.json.envios_reasignados;
    const sufijo = confirmar ? " (teléfonos distintos — confirmado manualmente)" : "";
    return { ok: true, mensaje: n > 0 ? `Vinculado: ${n} ${n === 1 ? "envío reasignado" : "envíos reasignados"} al cliente.${sufijo}` : "Ya estaba vinculado." };
  }

  const message = (r.json as { message?: string } | null)?.message ?? "";
  if (message.includes("telefono_no_coincide")) return { ok: false, error: "Los teléfonos no coinciden: marcá la confirmación para vincular de todos modos." };
  if (message.includes("lead_vinculado_a_otro_cliente")) return { ok: false, error: "Este lead ya fue vinculado a otro cliente definitivo." };
  if (message.includes("lead_invalido")) return { ok: false, error: "El lead no es una persona temporal de este módulo." };
  if (message.includes("cliente_invalido")) return { ok: false, error: "El cliente no existe, no está en estado 'cliente' o no tiene ningún programa." };
  return { ok: false, error: "No se pudo vincular. Intentá de nuevo." };
}

export async function desvincularLeadAccion(
  formData: FormData
): Promise<{ ok: boolean; error?: string; mensaje?: string }> {
  const u = await requireModulo("leads");

  const clienteId = String(formData.get("clienteId") ?? "");
  const leadPersonaId = String(formData.get("leadPersonaId") ?? "");
  const envioId = String(formData.get("envioId") ?? "");
  if (!clienteId) {
    return { ok: false, error: "Falta el cliente a desvincular." };
  }

  // Con lead explícito revierte ESA vinculación; sin lead, la más reciente
  // sin revertir de ese cliente (docs/11 §9.3).
  const r = await rest<{ ok: boolean; envios_restaurados: number; lead_id: string }>(
    "POST",
    "rpc/desvincular_lead",
    {
      p_cliente_id: clienteId,
      ...(leadPersonaId ? { p_lead_id: leadPersonaId } : {}),
      p_autor_id: u.id,
    },
  );

  if (r.status === 200 && r.json?.ok) {
    revalidatePath("/leads");
    if (envioId) revalidatePath(`/leads/${envioId}`);
    const n = r.json.envios_restaurados;
    return { ok: true, mensaje: n > 0 ? `Desvinculado: ${n} ${n === 1 ? "envío devuelto" : "envíos devueltos"} al lead temporal.` : "No había envíos que devolver." };
  }

  const message = (r.json as { message?: string } | null)?.message ?? "";
  if (message.includes("nada_que_desvincular")) return { ok: false, error: "No hay ninguna vinculación registrada para revertir." };
  return { ok: false, error: "No se pudo desvincular. Intentá de nuevo." };
}

// Camino "no hubo venta" del flujo comercial (docs/11 §9.4): el lead deja el
// ciclo sin borrarse — estado 'descartado', con auditoría.
export async function descartarLeadAccion(
  formData: FormData
): Promise<{ ok: boolean; error?: string; mensaje?: string }> {
  const u = await requireModulo("leads");

  const leadPersonaId = String(formData.get("leadPersonaId") ?? "");
  const envioId = String(formData.get("envioId") ?? "");
  if (!leadPersonaId) {
    return { ok: false, error: "Falta el lead a descartar." };
  }

  const r = await rest<{ ok: boolean; lead_id: string; estado: string }>(
    "POST",
    "rpc/descartar_lead",
    { p_lead_id: leadPersonaId, p_autor_id: u.id },
  );

  if (r.status === 200 && r.json?.ok) {
    revalidatePath("/leads");
    if (envioId) revalidatePath(`/leads/${envioId}`);
    return { ok: true, mensaje: "Lead descartado: queda fuera del ciclo comercial (quedó auditado y visible en /leads)." };
  }

  const message = (r.json as { message?: string } | null)?.message ?? "";
  if (message.includes("lead_invalido")) return { ok: false, error: "El lead no se puede descartar: no es una persona temporal de este módulo." };
  return { ok: false, error: "No se pudo descartar. Intentá de nuevo." };
}
