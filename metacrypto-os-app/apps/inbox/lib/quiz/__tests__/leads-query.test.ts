// Tests del builder de query del listado de leads (docs/11 §10). Función
// PURA: sin base, sin servidor. La cobertura apunta a que cada filtro del
// listado genere exactamente el filtro de PostgREST esperado.

import { describe, expect, test } from "vitest";
import { buildLeadsQuery, buildClientesQuery, LEADS_PAGE_SIZE, parseLeadPage, type LeadFilters } from "../../leads";
import { patronLike } from "../../supabase";

const base: LeadFilters = {};
const con = (f: LeadFilters): string => buildLeadsQuery(f);

function parte(query: string, prefix: string): string | undefined {
  return query.split("&").find((p) => p.startsWith(prefix));
}

describe("buildLeadsQuery", () => {
  test("sin filtros: select con snapshots, orden y límite de página", () => {
    const q = con(base);
    expect(q).toContain("select=");
    expect(q).toContain("order=created_at.desc");
    expect(parte(q, "limit=")).toBe(`limit=${LEADS_PAGE_SIZE + 1}`);
    expect(q).toContain("quiz_version:quiz_version_id(codigo,variante)");
    expect(q).toContain("persona:persona_id(estado,nombre)");
    expect(q).not.toContain("estado=eq");
  });

  test("filtros de estado y calificación", () => {
    expect(con({ estado: "completed" })).toContain("estado=eq.completed");
    expect(con({ estado: "dropped" })).toContain("estado=eq.dropped");
    expect(con({ estado: "en_proceso" })).toContain("estado=in.(started,in_progress)");
    expect(con({ calificacion: "caliente" })).toContain("es_lead_caliente=eq.true");
    expect(con({ calificacion: "frio" })).toContain("es_lead_caliente=eq.false");
    expect(con({ calificacion: "indeterminado" })).toContain("es_lead_caliente=is.null");
    expect(con({ calificacion: "indeterminado" })).toContain("estado=eq.completed");
  });

  // Semántica por ETIQUETA (fix auditoría v2 #11): los selects del filtro se
  // llaman "Capital mínimo: ≥ X" y "Capital máximo: ≤ X", así que el mínimo
  // acota por el MÍNIMO de la banda y el máximo por el TOPE. La semántica de
  // solape anterior hacía que un lead "<10k" entrara en el filtro "≥ 10k" y
  // que la banda abierta ">$250k" (capital_max NULL) desapareciera del suyo.
  // Semántica por banda EXACTA (v3 M-02): el filtro de capital ya no usa
  // umbrales de solape — filtra la banda exacta de la definición, incluyendo
  // la banda abierta ">$250k" (capital_min definido, capital_max NULL).
  test("banda de capital: filtra min y max de la banda elegida", () => {
    expect(con({ banda: "10k_25k" })).toContain("capital_min_usd=eq.10000");
    expect(con({ banda: "10k_25k" })).toContain("capital_max_usd=eq.25000");
    expect(con({ banda: "gt_250k" })).toContain("capital_min_usd=eq.250000");
    expect(con({ banda: "gt_250k" })).toContain("capital_max_usd=is.null");
    expect(con({ banda: "no-existe" })).not.toContain("capital_min_usd=eq");
  });

  test("UTM medium/content/term se filtran igual que source/campaign", () => {
    expect(con({ utm_medium: "organic" })).toContain("utm_medium=eq.organic");
    expect(con({ utm_content: "reel-1" })).toContain("utm_content=eq.reel-1");
    expect(con({ utm_term: "cripto" })).toContain("utm_term=eq.cripto");
  });

  test("filtro de fecha incluye el último segundo del día (L-01: lt medianoche siguiente)", () => {
    expect(con({ hasta: "2026-09-30" })).toContain("created_at=lt.2026-10-01T00:00:00Z");
    expect(con({ hasta: "2026-09-30" })).not.toContain("23:59:59");
  });

  test("fechas, paso de abandono, versión y UTMs se escapan", () => {
    expect(con({ desde: "2026-09-01" })).toContain("created_at=gte.2026-09-01T00:00:00Z");
    expect(con({ hasta: "2026-09-30" })).toContain("created_at=lt.2026-10-01T00:00:00Z");
    expect(con({ paso: "capital" })).toContain("last_step_id=eq.capital");
    expect(con({ version: "a-b-c" })).toContain("quiz_version_id=eq.a-b-c");
    expect(con({ utm_source: "instagram" })).toContain("utm_source=eq.instagram");
    expect(con({ utm_campaign: "diag 2026" })).toContain("utm_campaign=eq.diag%202026");
  });

  test("búsqueda por nombre/email/teléfono con LIKE escapado", () => {
    const q = con({ q: "agus@gmail.com" });
    const or = parte(q, "or=");
    expect(or).toBeDefined();
    expect(or!).toContain("nombre_capturado.ilike");
    expect(or!).toContain("email_capturado.ilike");
    expect(or!).toContain("telefono_e164_capturado.ilike");
  });

  test("el LIKE escapa _ y % del input (patronLike) — un guión bajo no es comodín", () => {
    const q = con({ q: "agus_gmail%com" });
    // exactamente el like escapado por patronLike, envuelto en * y codificado
    expect(q).toContain(encodeURIComponent(`*${patronLike("agus_gmail%com")}*`));
  });

  test("paginación: offset por página", () => {
    expect(con({ page: 1 })).not.toContain("offset=");
    expect(con({ page: 2 })).toContain(`offset=${LEADS_PAGE_SIZE}`);
    expect(con({ page: 3 })).toContain(`offset=${LEADS_PAGE_SIZE * 2}`);
  });

  test("page solo acepta enteros finitos positivos y acotados", () => {
    expect(parseLeadPage("2")).toBe(2);
    for (const value of ["1.5", "Infinity", "0", "-4", "1000000000", "abc", ""]) {
      expect(parseLeadPage(value)).toBe(1);
    }
    expect(con({ page: Number.POSITIVE_INFINITY })).not.toContain("offset=");
    expect(con({ page: 2.5 })).not.toContain("offset=");
  });

  test("fechas inválidas se descartan, no producen filtro roto (I9)", () => {
    expect(con({ desde: "abc" })).not.toContain("created_at=gte");
    expect(con({ hasta: "99-99-9999" })).not.toContain("created_at=lt");
    expect(con({ hasta: "2026-02-31" })).not.toContain("created_at=lt"); // fecha imposible
    expect(con({ desde: "2026-09-01" })).toContain("created_at=gte.2026-09-01T00:00:00Z");
  });
});

describe("buildClientesQuery (v4 I7/I8)", () => {
  test("el inner join de programas va DENTRO del select (exige programa)", () => {
    const q = buildClientesQuery();
    expect(q).toContain("personas?estado=eq.cliente");
    expect(q).toContain("select=id,nombre,email,telefono_e164,programas!inner(tier,tiers(nombre))");
    expect(q).toContain("limit=51");
  });

  test("búsqueda por texto filtra server-side (nombre/email/teléfono)", () => {
    const q = buildClientesQuery("juan perez");
    expect(q).toContain("or=(nombre.ilike.");
    expect(q).toContain("email.ilike.");
    expect(q).toContain("telefono_e164.ilike.");
  });

  test("pagina resultados sin límite silencioso y conserva orden estable", () => {
    const first = buildClientesQuery("juan", 1);
    const second = buildClientesQuery("juan", 2);
    expect(first).toContain("limit=51");
    expect(first).not.toContain("offset=");
    expect(second).toContain("offset=50");
    expect(second).toContain("order=nombre.asc,id.asc");
  });
});
