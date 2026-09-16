import { miembroActivo, marcarVisto } from "@/lib/novedades-datos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marca "visto hasta ahora" del miembro de la SESIÓN (sin body: nadie marca
// a otro). Lo dispara un client component al montar /novedades — nunca el
// render del server component: un GET no muta, y un prefetch no debe poner
// tu contador a cero.
export async function POST() {
  const u = await miembroActivo();
  if (!u) return Response.json({ ok: false, error: "Sin sesión." }, { status: 401 });
  await marcarVisto(u.id);
  return Response.json({ ok: true });
}
