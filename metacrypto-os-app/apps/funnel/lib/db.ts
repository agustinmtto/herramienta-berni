// ============================================================
// Cliente Supabase por PostgREST para la app pública del funnel.
// Usa la clave del ROL `funnel` (privilegio mínimo: solo puede ejecutar
// registrar_diagnostico, migración 0069) — NUNCA la service_role del OS.
// NUNCA importar esto en un Client Component.
// ============================================================

import "server-only";

const FUNNEL_DB_URL = process.env.FUNNEL_DB_URL!;
const FUNNEL_DB_KEY = process.env.FUNNEL_DB_KEY!;

const REST = `${FUNNEL_DB_URL}/rest/v1`;

const HDR = {
  apikey: FUNNEL_DB_KEY,
  Authorization: `Bearer ${FUNNEL_DB_KEY}`,
  "Content-Type": "application/json",
};

export type RestResult<T = any> = { status: number; json: T | null };

/**
 * Llamada genérica a PostgREST.
 * @param method  GET/POST/PATCH/DELETE
 * @param path    ruta + query
 * @param body    payload para POST/PATCH
 * @param prefer  header Prefer, p.ej. "return=representation"
 */
export async function rest<T = any>(
  method: string,
  path: string,
  body?: unknown,
  prefer?: string,
): Promise<RestResult<T>> {
  const res = await fetch(`${REST}/${path}`, {
    method,
    headers: prefer ? { ...HDR, Prefer: prefer } : HDR,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const txt = await res.text();
  return { status: res.status, json: txt ? (JSON.parse(txt) as T) : null };
}
