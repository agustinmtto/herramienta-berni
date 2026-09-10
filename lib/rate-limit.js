// Rate limiter en memoria "best-effort" — docs/07 §5 (endurecimiento).
//
// Solo sirve para una sola instancia: en serverless (Netlify/Vercel) cada
// isolate tiene sus propios contadores, así que el límite es aproximado hasta
// decidir el hosting final (pendiente en docs/06). Cuando haya hosting real,
// se reemplaza por un limiter verdadero (Upstash / WAF) sin cambiar el call site.
//
// Ventana deslizante, agrupado por IP del request, sin persistencia ni dependencias.

const WINDOW_MS = 60 * 1000; // ventana de la mayoría: 1 minuto
const MAX_REQUESTS = 10;     // máximo de requests por IP dentro de la ventana

// Mapa en memoria: clave = identificador del cliente (IP), valor = timestamps de sus requests.
const hits = new Map();

// Decide si un request debe ser limitado (true) o permitirse (false).
// key: identificador del cliente (IP). opts: máximo y ventana configurables.
export function isRateLimited(key, { windowMs = WINDOW_MS, max = MAX_REQUESTS } = {}) {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Conserva solo los timestamps que siguen dentro de la ventana actual.
  const history = (hits.get(key) || []).filter((t) => t > cutoff);
  history.push(now); // registra el request actual

  // Si ya pasó el máximo permitido, el request queda limitado.
  if (history.length > max) {
    hits.set(key, history);
    return { limited: true, current: history.length, max };
  }

  hits.set(key, history);

  // Limpieza opportunista para que la memoria no crezca bajo un ataque.
  if (hits.size > 10000) {
    for (const [k, v] of hits) {
      if (v.length && v[v.length - 1] < cutoff) hits.delete(k);
    }
  }

  return { limited: false, current: history.length, max };
}

// Vacía los contadores (lo usan los tests para empezar con estado limpio).
export function resetRateLimiter() {
  hits.clear();
}

// Valores por defecto exportados para que el endpoint y los tests los reutilicen.
export const RATE_LIMIT_MAX = MAX_REQUESTS;
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
