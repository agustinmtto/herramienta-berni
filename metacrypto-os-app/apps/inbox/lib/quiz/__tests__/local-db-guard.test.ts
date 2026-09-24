import { describe, expect, test, vi } from "vitest";
import { guardedLocalFetch, isLocalSupabaseUrl } from "../local-db-guard";

describe("guarda destructiva de Supabase local", () => {
  test("acepta únicamente hosts loopback", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:54321")).toBe(true);
    expect(isLocalSupabaseUrl("https://example.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("http://localhost.evil.test:54321")).toBe(false);
  });

  test("una URL externa produce cero llamadas HTTP incluso en helpers destructivos", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(guardedLocalFetch("https://example.supabase.co", "/rest/v1/personas", { method: "DELETE" }, fetchFn)).rejects.toThrow(/local/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
