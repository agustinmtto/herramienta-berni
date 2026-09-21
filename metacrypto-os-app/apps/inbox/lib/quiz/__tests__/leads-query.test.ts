// Tests del builder de query del listado de leads (docs/11 §10). Función
// PURA: sin base, sin servidor. La cobertura apunta a que cada filtro del
// listado genere exactamente el filtro de PostgREST esperado.

import { describe, expect, test } from "vitest";
import { buildLeadsQuery, LEADS_PAGE_SIZE, type LeadFilters } from "../../leads";
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

  test("banda de capital: min acota por capital_max y viceversa", () => {
    expect(con({ capitalMin: "10000" })).toContain("capital_max_usd=gte.10000");
    expect(con({ capitalMax: "50000" })).toContain("capital_min_usd=lte.50000");
  });

  test("fechas, paso de abandono, versión y UTMs se escapan", () => {
    expect(con({ desde: "2026-09-01" })).toContain("created_at=gte.2026-09-01T00:00:00Z");
    expect(con({ hasta: "2026-09-30" })).toContain("created_at=lte.2026-09-30T23:59:59Z");
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
});
