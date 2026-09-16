import { miembroActivo, paginaNovedades } from "@/lib/novedades-datos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Página del feed para "cargar más". El cursor viaja en ?t=&id= (ambos o
// ninguno). Sin miembro ACTIVO no hay feed: 401.
export async function GET(request: Request) {
  const u = await miembroActivo();
  if (!u) return Response.json({ ok: false, error: "Sin sesión." }, { status: 401 });

  const url = new URL(request.url);
  const t = url.searchParams.get("t");
  const id = url.searchParams.get("id");
  // El id del cursor acaba dentro de un filtro de PostgREST: solo un uuid
  // tiene permitido viajar hasta ahí. Cualquier otra cosa es una petición
  // malformada, no "sin cursor" — responderla como primera página serviría
  // filas duplicadas a un cliente con un bug.
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ ok: false, error: "Cursor inválido." }, { status: 400 });
  }
  const cursor = t && id ? { t, id } : null;

  const { items, siguiente } = await paginaNovedades(u, cursor);
  return Response.json({ ok: true, items, siguiente });
}
