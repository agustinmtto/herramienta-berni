// GET /api/inbox/conversations?f=pendiente|resuelto — lista (JSON, poll rápido).
import { getConversations } from "@/lib/data";
import type { EstadoAtencion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const f = new URL(request.url).searchParams.get("f");
  const filter = f === "pendiente" || f === "resuelto" ? (f as EstadoAtencion) : undefined;
  const conversations = await getConversations(filter);
  return Response.json({ conversations });
}
