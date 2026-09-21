// Rate limiter en memoria "best-effort" para /api/lead (docs/11 §11).
// Port del lib/rate-limit.js del prototipo. Solo sirve para una sola
// instancia: en serverless cada isolate tiene sus propios contadores, así que
// el límite es aproximado hasta el rate limiting final del hosting (docs/12
// Fase D). El call site no cambia cuando se reemplace por Upstash/WAF.

const WINDOW_MS = 60 * 1000; // ventana de la mayoría: 1 minuto
const MAX_REQUESTS = 10;     // máximo de requests por IP dentro de la ventana

const hits = new Map<string, number[]>();

export function isRateLimited(
  key: string,
  { windowMs = WINDOW_MS, max = MAX_REQUESTS }: { windowMs?: number; max?: number } = {}
): { limited: boolean; current: number; max: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  const history = (hits.get(key) || []).filter((t) => t > cutoff);
  history.push(now);

  if (history.length > max) {
    hits.set(key, history);
    return { limited: true, current: history.length, max };
  }

  hits.set(key, history);

  // Limpieza oportunista para que la memoria no crezca bajo un ataque.
  if (hits.size > 10000) {
    for (const [k, v] of hits) {
      if (v.length && v[v.length - 1] < cutoff) hits.delete(k);
    }
  }

  return { limited: false, current: history.length, max };
}

export function resetRateLimiter(): void {
  hits.clear();
}

export const RATE_LIMIT_MAX = MAX_REQUESTS;
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
