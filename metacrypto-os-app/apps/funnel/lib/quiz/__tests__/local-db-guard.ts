export function isLocalSupabaseUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export async function guardedLocalFetch(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (!isLocalSupabaseUrl(baseUrl)) {
    throw new Error(`Supabase URL must be local: ${baseUrl || "(empty)"}`);
  }
  return fetchFn(`${baseUrl.replace(/\/$/, "")}${path}`, init);
}
