import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getReciboDevolucion } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // El gate se repite server-side: el nav que oculta la pestaña no protege una
  // ruta que se puede pedir a mano.
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("devoluciones"))) {
    return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Identificador no válido." }, { status: 400 });
  }
  return NextResponse.json(await getReciboDevolucion(id));
}
