import Link from "next/link";
import { requireModulo } from "@/lib/guard";
import { getLeads, getVersiones, BANDAS_CAPITAL, LEADS_PAGE_SIZE, parseLeadPage, type LeadFilters } from "@/lib/leads";
import { dateEs } from "@/lib/format";

export const dynamic = "force-dynamic";

// ── helpers de UI ────────────────────────────────────────────────────────────
function pillCalificacion(caliente: boolean | null): { texto: string; clase: string } {
  if (caliente === true) return { texto: "Caliente", clase: "pill gold" };
  if (caliente === false) return { texto: "Frío", clase: "pill" };
  return { texto: "Indeterminado", clase: "pill yellow" };
}

function pillEstado(estado: string): { texto: string; clase: string } {
  switch (estado) {
    case "completed": return { texto: "Completo", clase: "pill green" };
    case "dropped": return { texto: "Abandono", clase: "pill red" };
    case "in_progress": return { texto: "En progreso", clase: "pill blue" };
    default: return { texto: "Iniciado", clase: "pill" };
  }
}

function capitalTexto(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  const fmt = (n: number) => n.toLocaleString("es-AR");
  if (min != null && max == null) return `≥ ${fmt(min)} USD`;
  if (min == null && max != null) return `≤ ${fmt(max)} USD`;
  return `${fmt(min!)}–${fmt(max!)} USD`;
}

// El label de un paso: mapea los IDs estables a texto corto. Si mañana hay
// una pregunta nueva, el fallback muestra el ID crudo — nunca vacío.
function pasoTexto(paso: string | null): string {
  if (!paso) return "—";
  const mapa: Record<string, string> = {
    start: "Inicio", situation: "Situación", challenge: "Desafío", allocation: "Portfolio",
    capital: "Capital", horizon: "Horizonte", drawdown: "Caída", influence: "Influencia",
    rules: "Reglas", contact: "Contacto", analysis: "Análisis", result: "Resultado",
  };
  return mapa[paso] ?? paso;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const u = await requireModulo("leads");
  const sp = await searchParams;
  const val = (k: string): string => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtros: LeadFilters = {
    estado: val("estado") || undefined,
    calificacion: val("calificacion") || undefined,
    version: val("version") || undefined,
    desde: val("desde") || undefined,
    hasta: val("hasta") || undefined,
    paso: val("paso") || undefined,
    utm_source: val("utm_source") || undefined,
    utm_medium: val("utm_medium") || undefined,
    utm_campaign: val("utm_campaign") || undefined,
    utm_content: val("utm_content") || undefined,
    utm_term: val("utm_term") || undefined,
    banda: val("banda") || undefined,
    q: val("q") || undefined,
    page: parseLeadPage(val("page")),
  };

  const [{ rows, hayMas }, versiones] = await Promise.all([getLeads(filtros), getVersiones()]);

  const paginacion = { ...sp } as Record<string, string>;
  const linkPagina = (delta: number): string => {
    const next = { ...paginacion, page: String(Math.max(1, (filtros.page ?? 1) + delta)) };
    return `/leads?${new URLSearchParams(next).toString()}`;
  };

  const calientes = rows.filter((r) => r.es_lead_caliente === true && r.estado === "completed").length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Leads del diagnóstico</h1>
        <p>
          Cada fila es un recorrido del quiz — no una persona. {calientes > 0 ? (
            <>En esta página hay <strong>{calientes}</strong> {calientes === 1 ? "lead caliente" : "leads calientes"} (capital ≥ 10.000 USD) para triaje.</>
          ) : "Los calientes (capital ≥ 10.000 USD) son el triaje comercial."} El contacto es el que dejó el lead, tal cual se capturó.
        </p>
      </div>

      {/* Filtros como GET puro: sin JS de cliente, el servidor re-renderiza.
          Cualquier acción en el formulario mantiene la página y los filtros. */}
      <form method="get" action="/leads" className="filtros-leads">
        <input type="text" name="q" defaultValue={filtros.q} placeholder="Nombre, email o teléfono" />
        <select name="estado" defaultValue={filtros.estado ?? ""}>
          <option value="">Estado: todos</option>
          <option value="completed">Completo</option>
          <option value="dropped">Abandono</option>
          <option value="en_proceso">En proceso</option>
        </select>
        <select name="calificacion" defaultValue={filtros.calificacion ?? ""}>
          <option value="">Calificación: todas</option>
          <option value="caliente">Caliente</option>
          <option value="frio">Frío</option>
          <option value="indeterminado">Indeterminado</option>
        </select>
        <select name="banda" defaultValue={filtros.banda ?? ""}>
          <option value="">Capital: todas las bandas</option>
          {BANDAS_CAPITAL.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
        <input type="date" name="desde" defaultValue={filtros.desde} />
        <input type="date" name="hasta" defaultValue={filtros.hasta} />
        <input type="text" name="utm_source" defaultValue={filtros.utm_source} placeholder="UTM source" />
        <input type="text" name="utm_medium" defaultValue={filtros.utm_medium} placeholder="UTM medium" />
        <input type="text" name="utm_campaign" defaultValue={filtros.utm_campaign} placeholder="UTM campaign" />
        <input type="text" name="utm_content" defaultValue={filtros.utm_content} placeholder="UTM content" />
        <input type="text" name="utm_term" defaultValue={filtros.utm_term} placeholder="UTM term" />
        <select name="version" defaultValue={filtros.version ?? ""}>
          <option value="">Versión del quiz: todas</option>
          {versiones.map((v) => (
            <option key={v.codigo} value={v.codigo}>{v.codigo} (v{v.version}, {v.variante})</option>
          ))}
        </select>
        <select name="paso" defaultValue={filtros.paso ?? ""}>
          <option value="">Abandono en: cualquier paso</option>
          {["start", "situation", "challenge", "allocation", "capital", "horizon", "drawdown", "influence", "rules", "contact"].map((p) => (
            <option key={p} value={p}>{pasoTexto(p)}</option>
          ))}
        </select>
        <button type="submit">Filtrar</button>
        <Link href="/leads" className="link-limpio">Limpiar</Link>
      </form>

      <div className="tabla-scroll">
        <table className="t">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Contacto</th>
              <th>Capital</th>
              <th>Calificación</th>
              <th>Estado</th>
              <th>Último paso</th>
              <th>Campaña</th>
              <th>Variante</th>
              <th>Persona</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cal = pillCalificacion(r.es_lead_caliente);
              const est = pillEstado(r.estado);
              return (
                <tr key={r.id}>
                  <td>{dateEs(r.created_at)}</td>
                  <td>
                    <Link href={`/leads/${r.id}`} className="lead-link">
                      {r.nombre_capturado || <em>Sin contacto</em>}
                    </Link>
                    <br />
                    <small>{r.email_capturado || "—"}{r.telefono_e164_capturado ? ` · ${r.telefono_e164_capturado}` : ""}</small>
                  </td>
                  <td>{capitalTexto(r.capital_min_usd, r.capital_max_usd)}</td>
                  <td><span className={cal.clase}>{cal.texto}</span></td>
                  <td><span className={est.clase}>{est.texto}</span></td>
                  <td>{pasoTexto(r.last_step_id)}</td>
                  <td>{r.utm_campaign || r.utm_source || "—"}</td>
                  <td><small>{r.quiz_version?.variante ?? "—"}</small></td>
                  <td>
                    {r.persona_estado ? (
                      <span className="pill">{r.persona_estado === "lead" ? "Lead temporal" : r.persona_estado}</span>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9}>Sin leads para estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="paginacion-leads">
        <span>
          {(filtros.page ?? 1) > 1 && <Link href={linkPagina(-1)}>← Anterior</Link>}
          {" "}
          {hayMas && <Link href={linkPagina(1)}>Siguiente →</Link>}
        </span>
        <small>Máximo {LEADS_PAGE_SIZE} por página · ordenado por fecha de creación</small>
      </div>

      <small className="leads-nota">
        El permiso de este módulo es `leads` y lo tiene {u.nombre} por acceso total o asignación. A quién se le concede es decisión del negocio
        (docs/11 D13). Los diagnósticos persisten tal como los vio el lead; el teléfono del lead temporal no se escribe en `personas` a propósito
        — vive en el snapshot del envío.
      </small>
    </div>
  );
}
