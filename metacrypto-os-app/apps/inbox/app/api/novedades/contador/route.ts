import { miembroActivo, contadorNovedades } from "@/lib/novedades-datos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// El número de la campana (0–10; la UI pinta "9+" desde 10). La campana
// hace poll perezoso de esto cada 60 s.
export async function GET() {
  const u = await miembroActivo();
  if (!u) return Response.json({ ok: false, error: "Sin sesión." }, { status: 401 });
  return Response.json({ ok: true, n: await contadorNovedades(u) });
}
