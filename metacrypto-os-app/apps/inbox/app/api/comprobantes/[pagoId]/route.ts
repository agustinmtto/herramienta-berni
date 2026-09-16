import { rest } from "@/lib/supabase";
import { getStorageBytes } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ pagoId: string }> }) {
  // Mismo gate que /api/ventas/contexto: comprobantes = datos financieros del módulo "ventas".
  const u = await getCurrentUser();
  if (!u) return new Response("no auth", { status: 401 });
  if (!(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return new Response("sin permiso", { status: 403 });
  }
  const { pagoId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(pagoId)) return new Response("bad id", { status: 400 });
  const r = await rest("GET", `pagos?id=eq.${pagoId}&select=comprobante_path`);
  const path = r.json?.[0]?.comprobante_path;
  if (!path) return new Response("not found", { status: 404 });
  const file = await getStorageBytes(path, "comprobantes");
  if (!file) return new Response("not found", { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": file.mime,
    "Cache-Control": "private, max-age=86400, immutable",
  };
  // PDF y todo lo no-imagen → descarga (anti-XSS, mismo criterio que /api/inbox/media)
  if (!/^image\//.test(file.mime)) headers["Content-Disposition"] = `attachment; filename="comprobante.pdf"`;
  return new Response(file.bytes, { headers });
}
