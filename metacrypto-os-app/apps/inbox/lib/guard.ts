import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puedeVer, homePath, type ModuloKey } from "@/lib/modulos";

export async function requireModulo(k: ModuloKey) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (!puedeVer(u, k)) redirect(homePath(u));
  return u;
}
