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
export const MAX_LEADS_PAGE = 10000;

export function parseLeadPage(value: string | number | undefined): number {
  const page = typeof value === "number" ? value : Number(value);
  return Number.isInteger(page) && page >= 1 && page <= MAX_LEADS_PAGE ? page : 1;
}

// Fecha de filtro válida (YYYY-MM-DD) o null: los inputs de /leads llegan por
// URL y un valor inválido ("abc", "99-99-9999") rompería el `new Date(...)`
// con un 500. Acá se descarta el filtro inválido en vez de romper (I9).
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function fechaValida(s: string | undefined): string | null {
  if (!s || !FECHA_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Fecha rodada: `new Date("2026-02-31")` no lanza, RODA a 03-03. El round-trip
  // detecta ese desborde para no filtrar por una fecha distinta a la pedida.
  if (d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

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
  const desde = fechaValida(f.desde);
  const hasta = fechaValida(f.hasta);
  if (desde) parts.push(`created_at=gte.${desde}T00:00:00Z`);
  // L-01 (auditoría v3): el hasta con 23:59:59Z se comía el último segundo
  // fraccionario — excluye con < medianoche del día siguiente.
  if (hasta) {
    const d = new Date(`${hasta}T00:00:00Z`);
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

  const offset = (parseLeadPage(f.page) - 1) * LEADS_PAGE_SIZE;
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
  // resolvemos el id antes y filtramos por UUID. Un código inexistente da
  // lista vacía, no un filtro de UUID inválido que rompa PostgREST (I9).
  let filtros: LeadFilters = f;
  if (f.version) {
    const v = await rest<{ id: string }[]>("GET", `quiz_versiones?codigo=eq.${encodeURIComponent(f.version)}&select=id`);
    if (v.status >= 400) throw new Error(`quiz_versiones_http_${v.status}`);
    const id = v.json?.[0]?.id;
    if (!id) return { rows: [], hayMas: false };
    filtros = { ...f, version: id };
  }

  const query = buildLeadsQuery(filtros);

  const r = await rest<Record<string, unknown>[]>("GET", `diagnostico_envios?${query}`);
  if (r.status >= 400) throw new Error(`diagnostico_envios_http_${r.status}`);
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
  if (r.status >= 400) throw new Error(`diagnostico_envio_detalle_http_${r.status}`);
  const fila = r.json?.[0];
  if (!fila) return null;

  const respuestas = await rest<LeadRespuesta[]>(
    "GET",
    `diagnostico_respuestas?envio_id=eq.${encodeURIComponent(id)}&select=question_id,question_type,question_text,question_order,answer_id,answer_text,answer_value,answered_at&order=question_order.asc`,
  );
  if (respuestas.status >= 400) throw new Error(`diagnostico_respuestas_http_${respuestas.status}`);

  // Si este envío ya fue vinculado a un cliente, la auditoría guarda QUÉ lead
  // temporal se movió (evita que el rollback mueva la vinculación equivocada).
  const vinculaciones = await rest<{ entidad_id: string }[]>(
    "GET",
    `auditoria?accion=eq.vinculacion${"&"}datos.cs=${encodeURIComponent(`{"envio_ids":["${id}"]}`)}&select=entidad_id&order=created_at.desc&limit=1`,
  );
  if (vinculaciones.status >= 400) throw new Error(`auditoria_vinculacion_http_${vinculaciones.status}`);

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
export interface ClienteParaVincular {
  id: string;
  nombre: string;
  email: string | null;
  telefono_e164: string | null;
  /** Nombre del tier del programa (ej. "€3.000 / 8 meses"), para mostrarlo en el picker (I8). */
  programa: string | null;
}

export const CLIENTES_PAGE_SIZE = 50;

// Query PURA del picker (testeable sin base): inner join con programas y
// búsqueda server-side por nombre/email/teléfono.
//
// I7: el `!inner` va DENTRO del `select`, no como parámetro suelto — como
// parámetro suelto PostgREST lo ignoraba y listaba clientes sin programa
// (HTTP 200, error silencioso). Dentro del select exige al menos un programa.
// I8: búsqueda server-side (no local sobre los primeros 500) y sin cap duro.
export function buildClientesQuery(q?: string, page = 1): string {
  const safePage = parseLeadPage(page);
  const parts = [
    "personas?estado=eq.cliente",
    "select=id,nombre,email,telefono_e164,programas!inner(tier,tiers(nombre))",
    "order=nombre.asc,id.asc",
    `limit=${CLIENTES_PAGE_SIZE + 1}`,
  ];
  if (q && q.trim()) {
    const like = encodeURIComponent(`*${patronLike(q.trim())}*`);
    parts.push(`or=(nombre.ilike.${like},email.ilike.${like},telefono_e164.ilike.${like})`);
  }
  if (safePage > 1) parts.push(`offset=${(safePage - 1) * CLIENTES_PAGE_SIZE}`);
  return parts.join("&");
}

export function esConsentimientoLegacySinRegistro(version: string | null): boolean {
  return version === "legacy-sin-registro";
}

export async function getClientesParaVincular(q?: string, page = 1): Promise<{ clientes: ClienteParaVincular[]; hayMas: boolean }> {
  const r = await rest<
    {
      id: string;
      nombre: string;
      email: string | null;
      telefono_e164: string | null;
      programas: { tier: string; tiers: { nombre: string } | null }[];
    }[]
  >("GET", buildClientesQuery(q, page));
  if (r.status >= 400) throw new Error(`clientes_para_vincular_http_${r.status}`);
  const rows = r.json ?? [];
  return { clientes: rows.slice(0, CLIENTES_PAGE_SIZE).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    email: c.email,
    telefono_e164: c.telefono_e164,
    programa: c.programas?.[0]?.tiers?.nombre ?? c.programas?.[0]?.tier ?? null,
  })), hayMas: rows.length > CLIENTES_PAGE_SIZE };
}

// Versiones publicadas del quiz (para el filtro del listado)
export async function getVersiones(): Promise<{ codigo: string; variante: string; version: number }[]> {
  const r = await rest<{ codigo: string; variante: string; version: number }[]>(
    "GET",
    "quiz_versiones?order=created_at.desc&limit=50",
  );
  if (r.status >= 400) throw new Error(`quiz_versiones_http_${r.status}`);
  return r.json ?? [];
}
