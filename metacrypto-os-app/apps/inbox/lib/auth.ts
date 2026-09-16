import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { rest } from "@/lib/supabase";

const SECRET = process.env.AUTH_TOKEN ?? "";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = (stored ?? "").split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hmacHex(msg: string): string {
  return createHmac("sha256", SECRET).update(msg).digest("hex");
}

export function signSession(teamMemberId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const msg = `${teamMemberId}.${exp}`;
  return `${msg}.${hmacHex(msg)}`;
}

export function verifySessionNode(cookie: string | undefined): { id: string; exp: number } | null {
  if (!cookie || !SECRET) return null;
  const i = cookie.lastIndexOf(".");
  if (i < 0) return null;
  const msg = cookie.slice(0, i);
  const sig = cookie.slice(i + 1);
  const expected = hmacHex(msg);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [id, expStr] = msg.split(".");
  const exp = Number(expStr);
  if (!id || !exp || exp < Math.floor(Date.now() / 1000)) return null;
  return { id, exp };
}

export async function getCurrentUser(): Promise<{ id: string; nombre: string; rol: string; acceso_total: boolean; modulos: string[] | null } | null> {
  const store = await cookies();
  const s = verifySessionNode(store.get("mcc_session")?.value);
  if (!s) return null;
  const r = await rest("GET", `team_members?id=eq.${s.id}&select=id,nombre,rol,acceso_total,modulos&limit=1`);
  return r.json?.[0] ?? null;
}
