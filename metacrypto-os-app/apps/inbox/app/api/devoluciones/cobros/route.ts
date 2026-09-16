import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCobrosDeCliente, getProgramasDeCliente } from "@/lib/data";

export const dynamic = "force-dynamic";

// Devuelve lo que el formulario necesita para NO pedirle nada a mano al
// operador: los programas del cliente y sus cobros reales con el USD ya
// grabado, que es la base sobre la que se revierte la comisión.
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("devoluciones"))) {
    return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
  }
  const persona = new URL(req.url).searchParams.get("persona") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(persona)) {
    return NextResponse.json({ error: "Cliente no válido." }, { status: 400 });
  }
  const [cobros, programas] = await Promise.all([
    getCobrosDeCliente(persona),
    getProgramasDeCliente(persona),
  ]);
  return NextResponse.json({ cobros, programas });
}
