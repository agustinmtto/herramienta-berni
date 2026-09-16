// ============================================================
// Cliente Supabase por PostgREST (service_role, solo servidor).
// Esquiva el deploy bloqueado de Edge Functions: escribimos/leemos
// directo contra la REST API de Supabase por HTTPS.
// NUNCA importar esto en un Client Component — usa service_role.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const REST = `${SUPABASE_URL}/rest/v1`;

const HDR = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

export type RestResult<T = any> = { status: number; json: T | null };

/**
 * Escapa un valor literal para usarlo con los filtros `like`/`ilike` de
 * PostgREST.
 *
 * `ilike` es la única forma de comparar sin distinguir mayúsculas contra una
 * columna que se guarda tal cual la escribió el usuario (un email de
 * GoHighLevel puede venir "Juan@X.com" y estar en el OS como "juan@x.com").
 * Pero `ilike` NO es una comparación: es un patrón, y en LIKE `_` significa
 * "un carácter cualquiera" y `%` "lo que sea". Sin escapar, buscar
 * `juan_perez@x.com` casa también con `juanXperez@x.com` — y los guiones
 * bajos son de lo más corriente en los emails. En una consulta que decide a
 * qué teléfono sale un WhatsApp, eso es mandarle el mensaje a otra persona.
 *
 * `\` va primero para no re-escapar las barras que añaden las otras dos
 * reglas. El carácter de escape por defecto de LIKE en Postgres es la barra
 * invertida, y PostgREST manda el valor como parámetro, así que llega intacto.
 *
 * Ojo — esto NO convierte `ilike` en igualdad: PostgREST además trata `*`
 * como sinónimo de `%` en estos filtros, y aquí no se puede neutralizar (un
 * `\*` acabaría buscando un `%` literal). Con emails es teórico, pero por eso
 * quien cruza por email debe confirmar el resultado comparando en cliente:
 * este escape estrecha la búsqueda, la comprobación posterior es la que
 * garantiza que la fila es la buena.
 */
export function patronLike(valor: string): string {
  return valor.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Llamada genérica a PostgREST.
 * @param method  GET/POST/PATCH/DELETE
 * @param path    ruta + query, p.ej. `personas?telefono_e164=eq.%2B34...`
 * @param body    payload para POST/PATCH
 * @param prefer  header Prefer, p.ej. "resolution=merge-duplicates,return=minimal"
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
