// ============================================================
// GET /api/ventas/contexto?personaId=<uuid>
// Contexto para ascensión/extensión: programas del cliente,
// total pagado (a nivel cliente: los pagos no se ligan a programa)
// y cuotas pendientes. Solo módulo "ventas".
// ============================================================
import { rest } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return Response.json({ error: "no auth" }, { status: 401 });
  if (!(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return Response.json({ error: "sin permiso" }, { status: 403 });
  }
  const personaId = new URL(req.url).searchParams.get("personaId") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(personaId)) {
    return Response.json({ error: "personaId inválido" }, { status: 400 });
  }
  const [progs, pagos, cuotas] = await Promise.all([
    rest("GET", `programas?persona_id=eq.${personaId}&select=id,tier,motivo,fecha_inicio,monto&order=fecha_inicio.desc`),
    rest("GET", `pagos?persona_id=eq.${personaId}&select=monto`),
    rest(
      "GET",
      `cuotas_programadas?estado=eq.pendiente&select=monto,fecha_vencimiento,programa:programas!inner(persona_id)&programa.persona_id=eq.${personaId}`,
    ),
  ]);
  const total_pagado = (pagos.json ?? []).reduce((s: number, p: any) => s + Number(p.monto || 0), 0);
  const cuotas_pendientes = (cuotas.json ?? []).map((c: any) => ({
    monto: Number(c.monto),
    fecha_vencimiento: c.fecha_vencimiento,
  }));
  return Response.json({ programas: progs.json ?? [], total_pagado, cuotas_pendientes });
}
