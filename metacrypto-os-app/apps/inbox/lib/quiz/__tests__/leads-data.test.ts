import { beforeEach, describe, expect, test, vi } from "vitest";

const rest = vi.fn();
vi.mock("@/lib/supabase", () => ({
  patronLike: (value: string) => value,
  rest,
}));

const { esConsentimientoLegacySinRegistro, getClientesParaVincular, getLeads } = await import("../../leads");
const { createLatestRequestSequence } = await import("../../latest-request");

describe("datos server-side de /leads", () => {
  beforeEach(() => rest.mockReset());

  test("propaga errores PostgREST en vez de devolver una lista vacía", async () => {
    rest.mockResolvedValue({ status: 500, json: { message: "db down" } });
    await expect(getLeads({})).rejects.toThrow("diagnostico_envios_http_500");
  });

  test("pagina más de 50 clientes sin perder resultados", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `cliente-${index}`,
      nombre: `Cliente ${index}`,
      email: null,
      telefono_e164: null,
      programas: [{ tier: "tier", tiers: { nombre: "Programa" } }],
    }));
    rest.mockResolvedValue({ status: 200, json: rows });
    const result = await getClientesParaVincular("cliente", 1);
    expect(result.clientes).toHaveLength(50);
    expect(result.hayMas).toBe(true);
    expect(rest).toHaveBeenCalledWith("GET", expect.stringContaining("programas!inner"));
  });

  test("la UI distingue legado sin evidencia de consentimiento", () => {
    expect(esConsentimientoLegacySinRegistro("legacy-sin-registro")).toBe(true);
    expect(esConsentimientoLegacySinRegistro("contacto-v1")).toBe(false);
  });

  test("una búsqueda nueva invalida respuestas anteriores antes de iniciar otro efecto", () => {
    const sequence = createLatestRequestSequence();
    const first = sequence.next();
    sequence.invalidate();
    expect(sequence.isCurrent(first)).toBe(false);
    const second = sequence.next();
    expect(sequence.isCurrent(second)).toBe(true);
  });
});
