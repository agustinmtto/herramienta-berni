// Módulo de leads (docs/11 §10): consultas server-only contra PostgREST.
//
// El listado representa ENVÍOS del quiz (diagnostico_envios), no una tabla
// raíz "leads". El contacto se lee de los SNAPSHOTs del envío, no de personas:
// el lead temporal nace con telefono_e164 NULL a propósito (docs/11 §2).
//
// El armado de la query de listado es una función PURA (buildLeadsQuery) para
// que los tests la cubran sin base; las funciones de abajo solo la ejecutan
// con rest() (service_role, solo servidor).

import { rest, patronLike } from "@/lib/supabase";

// ── tipos ────────────────────────────────────────────────────────────────────
export interface LeadRow {
  id: string;
  session_id: string;
  estado: "started" | "in_progress" | "dropped" | "completed";
  created_at: string;
  finished_at: string | null;
  dropped_at: string | null;
  last_activity_at: string | null;
  quiz_version: { codigo: string; variante: string } | null;
  nombre_capturado: string | null;
  email_capturado: string | null;
  telefono_e164_capturado: string | null;
  pais_capturado: string | null;
  capital_min_usd: number | null;
  capital_max_usd: number | null;
  es_lead_caliente: boolean | null;
  qualification_rule_version: string | null;
  motivo_calificacion: string | null;
  diagnosis_version: string | null;
  last_step_id: string | null;
  last_step_index: number | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  persona_id: string | null;
  persona_estado: string | null;
  persona_nombre: string | null;
}

export interface LeadFilters {
  estado?: string;        // completed | dropped | en_proceso
  calificacion?: string;  // caliente | frio | indeterminado
  version?: string;       // código de quiz_versiones
  desde?: string;         // YYYY-MM-DD
  hasta?: string;         // YYYY-MM-DD
  paso?: string;          // last_step_id (abandono)
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  banda?: string;         // banda EXACTA de capital (BANDAS_CAPITAL)
  q?: string;             // búsqueda: nombre, email o teléfono capturados
  page?: number;          // 1-based
}

// Las seis bandas EXACTAS de la definición publicada (0068, §8). El filtro
// "Capital" del listado filtra por banda exacta — no por umbrales de solape
// que mezclaban bandas (fix auditoría v2 #11 / v3 M-02).
export const BANDAS_CAPITAL: { id: string; label: string; min: number | null; max: number | null }[] = [
  { id: "lt_10k",    label: "Menos de 10.000 USD",      min: 0,      max: 10000 },
  { id: "10k_25k",   label: "Entre 10.000 y 25.000 USD",  min: 10000,  max: 25000 },
  { id: "25k_50k",   label: "Entre 25.000 y 50.000 USD",  min: 25000,  max: 50000 },
  { id: "50k_100k",  label: "Entre 50.000 y 100.000 USD", min: 50000,  max: 100000 },
  { id: "100k_250k", label: "Entre 100.000 y 250.000 USD",min: 100000, max: 250000 },
  { id: "gt_250k",   label: "Más de 250.000 USD",       min: 250000, max: null },
];

export const LEADS_PAGE_SIZE = 50;

// ── builder puro ─────────────────────────────────────────────────────────────
// Devuelve el query string de PostgREST para el listado. Sin filtros, solo
// orden + paginación: exactamente lo que pinta la pantalla sin tocar.
export function buildLeadsQuery(f: LeadFilters): string {
  const parts: string[] = [
    "select=" +
      [
        "id", "session_id", "estado", "created_at", "finished_at", "dropped_at", "last_activity_at",
        "nombre_capturado", "email_capturado", "telefono_e164_capturado", "pais_capturado",
        "capital_min_usd", "capital_max_usd", "es_lead_caliente", "qualification_rule_version",
        "motivo_calificacion", "diagnosis_version", "last_step_id", "last_step_index",
        "utm_source", "utm_medium", "utm_campaign", "utm_content", "persona_id",
        "quiz_version:quiz_version_id(codigo,variante)",
        "persona:persona_id(estado,nombre)",
      ].join(","),
    "order=created_at.desc",
    `limit=${LEADS_PAGE_SIZE + 1}`, // +1 para saber si hay página siguiente
  ];

  if (f.estado === "completed") parts.push("estado=eq.completed");
  if (f.estado === "dropped") parts.push("estado=eq.dropped");
  if (f.estado === "en_proceso") parts.push("estado=in.(started,in_progress)");
  if (f.calificacion === "caliente") parts.push("es_lead_caliente=eq.true");
  if (f.calificacion === "frio") parts.push("es_lead_caliente=eq.false");
  if (f.calificacion === "indeterminado") parts.push("es_lead_caliente=is.null&estado=eq.completed");
  // `version` llega como UUID ya resuelto (getLeads lo busca por código antes):
  // el builder puro no sabe nada de quiz_versiones.
  if (f.version) parts.push(`quiz_version_id=eq.${encodeURIComponent(f.version)}`);
  if (f.desde) parts.push(`created_at=gte.${f.desde}T00:00:00Z`);
  // L-01 (auditoría v3): el hasta con 23:59:59Z se comía el último segundo
  // fraccionario — excluye con < medianoche del día siguiente.
  if (f.hasta) {
    const d = new Date(`${f.hasta}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    parts.push(`created_at=lt.${d.toISOString().slice(0, 10)}T00:00:00Z`);
  }
  if (f.paso) parts.push(`last_step_id=eq.${encodeURIComponent(f.paso)}`);
  if (f.utm_source) parts.push(`utm_source=eq.${encodeURIComponent(f.utm_source)}`);
  if (f.utm_medium) parts.push(`utm_medium=eq.${encodeURIComponent(f.utm_medium)}`);
  if (f.utm_campaign) parts.push(`utm_campaign=eq.${encodeURIComponent(f.utm_campaign)}`);
  if (f.utm_content) parts.push(`utm_content=eq.${encodeURIComponent(f.utm_content)}`);
  if (f.utm_term) parts.push(`utm_term=eq.${encodeURIComponent(f.utm_term)}`);
  // Banda EXACTA de la definición: una banda [min,max] es min=eq.X con
  // max=eq.Y (o is.null para la banda abierta ">$250k").
  if (f.banda) {
    const banda = BANDAS_CAPITAL.find((b) => b.id === f.banda);
    if (banda) {
      if (banda.min != null) parts.push(`capital_min_usd=eq.${banda.min}`);
      parts.push(banda.max != null ? `capital_max_usd=eq.${banda.max}` : "capital_max_usd=is.null");
    }
  }
  if (f.q) {
    const like = encodeURIComponent(`*${patronLike(f.q)}*`);
    parts.push(`or=(nombre_capturado.ilike.${like},email_capturado.ilike.${like},telefono_e164_capturado.ilike.${like})`);
  }

  const offset = Math.max(0, ((f.page ?? 1) - 1) * LEADS_PAGE_SIZE);
  if (offset > 0) parts.push(`offset=${offset}`);

  return parts.join("&");
}

// ── consultas ────────────────────────────────────────────────────────────────
function filaToRow(fila: Record<string, unknown>): LeadRow {
  const persona = fila.persona as { estado: string; nombre: string } | null;
  const quizVersion = fila.quiz_version as { codigo: string; variante: string } | null;
  const { persona: _p, quiz_version: _q, ...resto } = fila;
  return { ...resto, persona_estado: persona?.estado ?? null, persona_nombre: persona?.nombre ?? null, quiz_version: quizVersion } as LeadRow;
}

export async function getLeads(f: LeadFilters): Promise<{ rows: LeadRow[]; hayMas: boolean }> {
  // El filtro por versión se resuelve por subconsulta real de PostgREST:
  // PostgREST soporta `quiz_version_id=eq.(select id from quiz_versiones
  // where codigo=...)` — pero no en un query string escapado limpio, así que
  // resolvemos el id antes y filtramos por UUID.
  let filtros: LeadFilters = f;
  if (f.version) {
    const v = await rest<{ id: string }[]>("GET", `quiz_versiones?codigo=eq.${encodeURIComponent(f.version)}&select=id`);
    const id = v.json?.[0]?.id;
    filtros = { ...f, version: id ?? "no-existe" };
  }

  let query = buildLeadsQuery(filtros);
  if (filtros.version) query += `&quiz_version_id=eq.${encodeURIComponent(filtros.version)}`;

  const r = await rest<Record<string, unknown>[]>("GET", `diagnostico_envios?${query}`);
  const filas = r.json ?? [];
  const hayMas = filas.length > LEADS_PAGE_SIZE;
  return { rows: filas.slice(0, LEADS_PAGE_SIZE).map(filaToRow), hayMas };
}

export interface LeadRespuesta {
  question_id: string;
  question_type: string;
  question_text: string;
  question_order: number;
  answer_id: string | null;
  answer_text: string | null;
  answer_value: unknown;
  answered_at: string | null;
}

export interface LeadDetalle extends LeadRow {
  respuestas: LeadRespuesta[];
  consentimiento_aceptado: boolean | null;
  consentimiento_version: string | null;
  consentimiento_at: string | null;
  started_at: string | null;
  utm_term: string | null;
  referrer: string | null;
  diagnosis_result: unknown;
  diagnosis_result_size: number;
  schema_version: number;
  // El lead temporal que fue vinculado (si este envío ya pasó a un cliente):
  // el rollback exacto (docs/11 §9.3) lo necesita para revertir ESA vinculación.
  leadVinculadoId: string | null;
}

export async function getLeadDetalle(id: string): Promise<LeadDetalle | null> {
  const r = await rest<Record<string, unknown>[]>(
    "GET",
    `diagnostico_envios?id=eq.${encodeURIComponent(id)}&select=` +
      [
        "id", "session_id", "estado", "schema_version", "created_at", "started_at", "finished_at",
        "dropped_at", "last_activity_at", "last_step_id", "last_step_index",
        "nombre_capturado", "email_capturado", "telefono_e164_capturado", "pais_capturado",
        "consentimiento_aceptado", "consentimiento_version", "consentimiento_at",
        "capital_min_usd", "capital_max_usd", "es_lead_caliente", "qualification_rule_version",
        "motivo_calificacion", "diagnosis_version", "diagnosis_result",
        "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer",
        "persona_id",
        "quiz_version:quiz_version_id(codigo,variante)",
        "persona:persona_id(estado,nombre)",
      ].join(","),
  );
  const fila = r.json?.[0];
  if (!fila) return null;

  const respuestas = await rest<LeadRespuesta[]>(
    "GET",
    `diagnostico_respuestas?envio_id=eq.${encodeURIComponent(id)}&select=question_id,question_type,question_text,question_order,answer_id,answer_text,answer_value,answered_at&order=question_order.asc`,
  );

  // Si este envío ya fue vinculado a un cliente, la auditoría guarda QUÉ lead
  // temporal se movió (evita que el rollback mueva la vinculación equivocada).
  const vinculaciones = await rest<{ entidad_id: string }[]>(
    "GET",
    `auditoria?accion=eq.vinculacion${"&"}datos.cs=${encodeURIComponent(`{"envio_ids":["${id}"]}`)}&select=entidad_id&order=created_at.desc&limit=1`,
  );

  const row = filaToRow(fila);
  const diagnosisResult = fila.diagnosis_result;
  return {
    ...row,
    respuestas: respuestas.json ?? [],
    consentimiento_aceptado: fila.consentimiento_aceptado as boolean | null,
    consentimiento_version: fila.consentimiento_version as string | null,
    consentimiento_at: fila.consentimiento_at as string | null,
    started_at: fila.started_at as string | null,
    utm_term: fila.utm_term as string | null,
    referrer: fila.referrer as string | null,
    diagnosis_result: diagnosisResult,
    diagnosis_result_size: diagnosisResult ? JSON.stringify(diagnosisResult).length : 0,
    schema_version: fila.schema_version as number,
    leadVinculadoId: vinculaciones.json?.[0]?.entidad_id ?? null,
  };
}

// Clientes definitivos para el picker de vinculación post-venta (docs/11 §9).
// SOLO clientes con al menos un programa (v3 M-03: la versión anterior
// listaba cualquier `estado=cliente` y el RPC rechazaría a los sin programa).
// Búsqueda por texto opcional (nombre/email/teléfono).
export async function getClientesParaVincular(q?: string): Promise<{ id: string; nombre: string; email: string | null; telefono_e164: string | null }[]> {
  let query =
    "personas?estado=eq.cliente" +
    "&select=id,nombre,email,telefono_e164" +
    "&programas!inner(id)" + // exige al menos un programa: lo que el RPC valida
    "&order=nombre.asc&limit=500";
  if (q && q.trim()) {
    const like = encodeURIComponent(`*${patronLike(q.trim())}*`);
    query += `&or=(nombre.ilike.${like},email.ilike.${like},telefono_e164.ilike.${like})`;
  }
  const r = await rest<{ id: string; nombre: string; email: string | null; telefono_e164: string | null }[]>( "GET", query);
  return r.json ?? [];
}

// Versiones publicadas del quiz (para el filtro del listado)
export async function getVersiones(): Promise<{ codigo: string; variante: string; version: number }[]> {
  const r = await rest<{ codigo: string; variante: string; version: number }[]>(
    "GET",
    "quiz_versiones?order=created_at.desc&limit=50",
  );
  return r.json ?? [];
}
