import { cookies } from "next/headers";
import { rest } from "@/lib/supabase";
import { verifyPassword, signSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hash dummy (de un password aleatorio) — se usa solo para igualar el tiempo
// de respuesta cuando el usuario no existe (anti-enumeración por timing).
const DUMMY_HASH =
  "scrypt$fccd706f6db2743a527f46ee420683df$3511f9d2d85a8dd66cf4ff39b7ef9f01ff8935230fa71cc7620819dadd3dc58f7f68a9c4c9b2ba5525560c18bfdc7e5c8bdf0d3e884cde68d692eb3b20c7b33c";

export async function POST(request: Request) {
  const { username, password } = await request.json().catch(() => ({}) as any);
  const u = String(username ?? "").trim().toLowerCase();
  const fail = () => Response.json({ ok: false, error: "Usuario o contraseña incorrectos." }, { status: 401 });
  if (!u || !password) return fail();

  const r = await rest("GET",
    `team_members?username=eq.${encodeURIComponent(u)}&activo=eq.true&select=id,password_hash&limit=1`);
  const row = r.json?.[0];
  const hash = row?.password_hash ?? DUMMY_HASH;
  const ok = verifyPassword(String(password), hash);
  if (!row || !row.password_hash || !ok) return fail();

  const store = await cookies();
  store.set("mcc_session", signSession(row.id), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ ok: true });
}
