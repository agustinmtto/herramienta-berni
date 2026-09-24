import Link from "next/link";
import { notFound } from "next/navigation";
import { requireModulo } from "@/lib/guard";
import { puedeVer } from "@/lib/modulos";
import { esConsentimientoLegacySinRegistro, getLeadDetalle, getClientesParaVincular } from "@/lib/leads";
import { dateEs, fullTime } from "@/lib/format";
import VincularLead from "@/components/VincularLead";

export const dynamic = "force-dynamic";

// El label de un paso: mismo mapa que el listado. Si mañana hay una pregunta
// nueva sin entrada en el mapa, se muestra el ID crudo — nunca vacío.
const PASOS: Record<string, string> = {
  start: "Inicio", situation: "Situación", challenge: "Desafío", allocation: "Portfolio",
  capital: "Capital", horizon: "Horizonte", drawdown: "Caída", influence: "Influencia",
  rules: "Reglas", contact: "Contacto", analysis: "Análisis", result: "Resultado",
};
const pasoTexto = (paso: string | null): string => (paso ? (PASOS[paso] ?? paso) : "—");

// El value estructurado de una respuesta, legible. Los rangos muestran la
// banda en USD; la allocation, el bloque por activo; el resto, el JSON crudo
// truncado — nunca un [object Object].
function valorLegible(type: string, value: unknown): string | null {
  if (value == null) return null;
  if (type === "range" && typeof value === "object" && "min" in (value as object)) {
    const v = value as { currency?: string; min: number | null; max: number | null };
    const fmt = (n: number | null) => (n == null ? "∞" : n.toLocaleString("es-AR"));
    return `${v.currency ?? "USD"} ${fmt(v.min)}–${fmt(v.max)}`;
  }
  if (type === "allocation" && Array.isArray(value)) {
    return value
      .map((a: { asset_id: string; level: string }) => `${a.asset_id}: ${a.level}`)
      .join(" · ");
  }
  const s = JSON.stringify(value);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

export default async function LeadDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireModulo("leads");
  // I10: el enlace a /clientes solo se muestra si el usuario tiene el módulo
  // `clientes` — un usuario con solo `leads` no debe recibir un enlace roto
  // (que además lo lleva a una ficha que no le corresponde ver).
  const puedeVerClientes = puedeVer(u, "clientes");
  const { id } = await params;
  const lead = await getLeadDetalle(id);
  if (!lead) notFound();

  const { clientes, hayMas: hayMasClientes } = await getClientesParaVincular();
  const diagJson = lead.diagnosis_result ? JSON.stringify(lead.diagnosis_result, null, 2) : null;

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/leads">← Leads</Link>
      </p>

      <div className="page-head">
        <h1>{lead.nombre_capturado || "Lead sin contacto"}</h1>
        <p>
          Envío <code>{lead.session_id}</code> · versión{" "}
          <strong>{lead.quiz_version?.codigo ?? "—"}</strong> (variante {lead.quiz_version?.variante ?? "—"}) ·{" "}
          creado {dateEs(lead.created_at)}
        </p>
      </div>

      {/* Los calientes son el triaje: su bloque va primero y sin <details>. */}
      {lead.estado === "completed" && (
        <div className="card lead-calificacion">
          <h3>Calificación comercial</h3>
          {lead.es_lead_caliente === true && <span className="pill gold">Caliente</span>}
          {lead.es_lead_caliente === false && <span className="pill">Frío</span>}
          {lead.es_lead_caliente === null && <span className="pill yellow">Indeterminado</span>}
          <p>
            <code>{lead.qualification_rule_version ?? "—"}</code> — {lead.motivo_calificacion ?? "sin motivo"}
            {lead.capital_min_usd != null && (
              <> · capital declarado {Number(lead.capital_min_usd).toLocaleString("es-AR")}
              {lead.capital_max_usd != null ? `–${Number(lead.capital_max_usd).toLocaleString("es-AR")}` : "+"} USD</>
            )}
          </p>
        </div>
      )}

      <div className="lead-grid">
        <div className="card">
          <h3>Contacto capturado</h3>
          <dl className="lead-datos">
            <dt>Nombre</dt><dd>{lead.nombre_capturado || "—"}</dd>
            <dt>Email</dt><dd>{lead.email_capturado || "—"}</dd>
            <dt>Teléfono</dt><dd>{lead.telefono_e164_capturado || "—"}</dd>
            <dt>País</dt><dd>{lead.pais_capturado || "—"}</dd>
            <dt>Consentimiento</dt>
            <dd>
              {esConsentimientoLegacySinRegistro(lead.consentimiento_version) ? (
                <>Sin registro verificable · revisar</>
              ) : lead.consentimiento_aceptado === true ? (
                <>Sí · <code>{lead.consentimiento_version}</code> · {lead.consentimiento_at ? dateEs(lead.consentimiento_at) : "—"}</>
              ) : lead.estado === "completed" ? "FALTA (envío completado sin consentimiento)" : "No llegó (sin completar)"}
            </dd>
          </dl>
        </div>

        <div className="card">
          <h3>Origen</h3>
          <dl className="lead-datos">
            <dt>UTM source</dt><dd>{lead.utm_source || "—"}</dd>
            <dt>UTM medium</dt><dd>{lead.utm_medium || "—"}</dd>
            <dt>UTM campaign</dt><dd>{lead.utm_campaign || "—"}</dd>
            <dt>UTM content</dt><dd>{lead.utm_content || "—"}</dd>
            <dt>UTM term</dt><dd>{lead.utm_term || "—"}</dd>
            <dt>Referrer</dt><dd>{lead.referrer || "—"}</dd>
          </dl>
        </div>

        <div className="card">
          <h3>Recorrido</h3>
          <dl className="lead-datos">
            <dt>Estado</dt><dd>{lead.estado}</dd>
            <dt>Inicio</dt><dd>{lead.started_at ? fullTime(lead.started_at) : "—"}</dd>
            <dt>Última actividad</dt><dd>{lead.last_activity_at ? fullTime(lead.last_activity_at) : "—"}</dd>
            <dt>Finalizó</dt><dd>{lead.finished_at ? fullTime(lead.finished_at) : "—"}</dd>
            <dt>Abandonó</dt><dd>{lead.dropped_at ? `${fullTime(lead.dropped_at)} en «${pasoTexto(lead.last_step_id)}»` : "—"}</dd>
            <dt>Último paso</dt><dd>{pasoTexto(lead.last_step_id)}{lead.last_step_index != null ? ` (paso ${lead.last_step_index})` : ""}</dd>
          </dl>
        </div>

        <div className="card">
          <h3>Persona</h3>
          {lead.persona_id ? (
            <>
              <p>
                {puedeVerClientes ? (
                  <Link href={`/clientes/${lead.persona_id}`} className="lead-link">
                    {lead.persona_nombre || "Ver persona"}
                  </Link>
                ) : (
                  <span>{lead.persona_nombre || "Persona"}</span>
                )}
              </p>
              <p>
                <small>Estado: <span className="pill">{lead.persona_estado === "lead" ? "Lead temporal" : lead.persona_estado}</span></small>
              </p>
              <h4>Vinculación post-venta</h4>
              <VincularLead
                leadPersonaId={lead.persona_id}
                leadTelefono={lead.telefono_e164_capturado}
                clientes={clientes}
                hayMasClientes={hayMasClientes}
                envioId={lead.id}
                personaEstado={lead.persona_estado}
                leadVinculadoId={lead.leadVinculadoId}
              />
            </>
          ) : (
            <p>Sin persona: el envío no llegó a completarse (los leads temporales se crean solo al completar).</p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Respuestas ({lead.respuestas.length})</h3>
        {/* Renderizadas desde los SNAPSHOTS: si mañana cambia el quiz, estos
            envíos viejos se siguen mostrando igual (docs/11 §10). */}
        <div className="tabla-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>#</th><th>Pregunta</th><th>Respuesta</th><th>Valor</th><th>Respondida</th>
              </tr>
            </thead>
            <tbody>
              {lead.respuestas.map((r) => {
                const valor = valorLegible(r.question_type, r.answer_value);
                return (
                  <tr key={r.question_id}>
                    <td>{r.question_order}</td>
                    <td>{r.question_text}<br /><small><code>{r.question_id}</code></small></td>
                    <td>
                      {r.answer_text || "—"}
                      {r.answer_id && <><br /><small><code>{r.answer_id}</code></small></>}
                    </td>
                    <td>{valor ? <code>{valor}</code> : "—"}</td>
                    <td>{r.answered_at ? fullTime(r.answered_at) : "—"}</td>
                  </tr>
                );
              })}
              {lead.respuestas.length === 0 && (
                <tr><td colSpan={5}>Sin respuestas: el envío no registró ninguna pregunta.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {lead.estado === "completed" && (
        <div className="card">
          <h3>Diagnóstico mostrado</h3>
          <p>
            <small>
              Persistido tal como lo vio el lead (motor <code>{lead.diagnosis_version ?? "—"}</code>, {lead.diagnosis_result_size} bytes).
              La pantalla del funnel lo reconstruye desde este snapshot si el motor cambia.
            </small>
          </p>
          {diagJson ? <pre className="lead-diag-json">{diagJson}</pre> : <p>Sin snapshot: el envío se completó sin diagnóstico (versión antigua del funnel).</p>}
        </div>
      )}
    </div>
  );
}
