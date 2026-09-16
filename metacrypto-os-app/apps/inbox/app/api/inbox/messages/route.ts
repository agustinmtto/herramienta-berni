// GET /api/inbox/messages?convId=X — hilo de mensajes (JSON, para poll rápido).
// Protegido por el middleware (cookie de sesión). Payload mínimo.
import { getMessages } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const convId = new URL(request.url).searchParams.get("convId");
  if (!convId) return Response.json({ messages: [] });
  const messages = await getMessages(convId);
  return Response.json({ messages });
}
