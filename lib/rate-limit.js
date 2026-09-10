// Best-effort in-memory rate limiter — docs/07 §5 (security hardening).
//
// Single-instance only: on serverless (Netlify/Vercel) each isolate has its
// own counters, so limits are approximate until the final hosting is decided
// (docs/06 pending item). Swap the real limiter (Upstash / WAF) without
// changing the call site once hosting is set.
//
// Sliding window, keyed by request IP, no persistence, no external deps.

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 10;

const hits = new Map();

export function isRateLimited(key, { windowMs = WINDOW_MS, max = MAX_REQUESTS } = {}) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const history = (hits.get(key) || []).filter((t) => t > cutoff);
  history.push(now);

  if (history.length > max) {
    hits.set(key, history);
    return { limited: true, current: history.length, max };
  }

  hits.set(key, history);

  // Opportunistic cleanup to keep memory bounded under attack.
  if (hits.size > 10000) {
    for (const [k, v] of hits) {
      if (v.length && v[v.length - 1] < cutoff) hits.delete(k);
    }
  }

  return { limited: false, current: history.length, max };
}

export function resetRateLimiter() {
  hits.clear();
}

export const RATE_LIMIT_MAX = MAX_REQUESTS;
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
