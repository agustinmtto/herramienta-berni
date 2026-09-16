import "server-only";
// El pegamento de red del centro de novedades: consultas y marcas. La
// decisión (qué es noticia, quién la ve, cómo se redacta) vive en
// lib/novedades.ts, pura y testeada. Aquí solo hay red — y por eso, como
// push-envio.ts, no hay tests unitarios: se verifica en el flujo real.
import { rest } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import {
  paresVisibles,
  traducirNovedad,
  type EventoAuditoria,
  type Nombres,
  type Novedad,
} from "@/lib/novedades";

export type CursorNovedades = { t: string; id: string } | null;

export type MiembroFeed = {
  id: string;
  nombre: string;
  acceso_total: boolean;
  modulos: string[] | null;
};

const SELECT = "id,entidad,entidad_id,accion,autor_id,datos,created_at";
const NOMBRES_VACIO: Nombres = {
  miembroPorId: new Map(),
  personaPorId: new Map(),
  personaPorCuotaId: new Map(),
};

/**
 * getCurrentUser + comprobación EXPLÍCITA de `activo`. La cookie vive 30 días
 * sin revocación y getCurrentUser no mira `activo`: un dado de baja con la
 * cookie viva NO debe ver el feed. (El agujero general del OS queda fuera de
 * alcance — esta pantalla nueva no lo amplía.)
 */
export async function miembroActivo(): Promise<MiembroFeed | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  const r = await rest<{ id: string }[]>(
    "GET",
    `team_members?id=eq.${u.id}&activo=eq.true&select=id&limit=1`,
  );
  if (!Array.isArray(r.json) || r.json.length === 0) return null;
  return {
    id: u.id,
    nombre: u.nombre,
    acceso_total: u.acceso_total,
    modulos: u.modulos ?? null,
  };
}

// or=(and(entidad.eq.X,accion.eq.Y),…) — PARES completos, no dos `in` sueltos
// que casarían combinaciones no listadas (venta/edicion, cuota/alta…).
function paresInner(pares: { entidad: string; accion: string }[]): string {
  return pares.map((p) => `and(entidad.eq.${p.entidad},accion.eq.${p.accion})`).join(",");
}

/**
 * Los nombres humanos de una página de eventos, en LOTES por id — el `datos`
 * histórico solo trae ids. Jamás se cruzan dos consultas por posición: cada
 * lote vuelve keyed (o con el nombre embebido en la misma fila, caso cuota).
 */
async function lotesDeNombres(eventos: EventoAuditoria[]): Promise<Nombres> {
  const personaIds = new Set<string>();
  const cuotaIds = new Set<string>();
  for (const e of eventos) {
    const d = e.datos && typeof e.datos === "object" ? (e.datos as Record<string, unknown>) : {};
    if (typeof d.persona_id === "string") personaIds.add(d.persona_id);
    const desp = d.despues;
    if (desp && typeof desp === "object" && typeof (desp as Record<string, unknown>).persona_id === "string") {
      personaIds.add((desp as Record<string, unknown>).persona_id as string);
    }
    if (e.entidad === "cuota") cuotaIds.add(e.entidad_id);
  }

  type FilaCuota = { id: string; programa: { persona: { id: string; nombre: string | null } | null } | null };
  const [rEquipo, rPersonas, rCuotas] = await Promise.all([
    rest<{ id: string; nombre: string | null }[]>("GET", "team_members?select=id,nombre"),
    personaIds.size
      ? rest<{ id: string; nombre: string | null }[]>(
          "GET",
          `personas?id=in.(${[...personaIds].join(",")})&select=id,nombre`,
        )
      : Promise.resolve({ status: 200, json: [] as { id: string; nombre: string | null }[] }),
    cuotaIds.size
      ? rest<FilaCuota[]>(
          "GET",
          `cuotas_programadas?id=in.(${[...cuotaIds].join(",")})&select=id,programa:programas(persona:personas(id,nombre))`,
        )
      : Promise.resolve({ status: 200, json: [] as FilaCuota[] }),
  ]);

  // Un no-2xx de PostgREST es un objeto de error, no un array (trampa cazada
  // en el push): un lote caído degrada nombres, nunca tumba el feed.
  const equipo = Array.isArray(rEquipo.json) ? rEquipo.json : [];
  const personas = Array.isArray(rPersonas.json) ? rPersonas.json : [];
  const cuotas = Array.isArray(rCuotas.json) ? rCuotas.json : [];

  return {
    miembroPorId: new Map(equipo.filter((m) => m.nombre).map((m) => [m.id, m.nombre as string])),
    personaPorId: new Map(personas.filter((p) => p.nombre).map((p) => [p.id, p.nombre as string])),
    personaPorCuotaId: new Map(
      cuotas
        .filter((c) => c.programa?.persona?.nombre)
        .map((c) => [c.id, c.programa!.persona!.nombre as string]),
    ),
  };
}

/**
 * Página de novedades traducidas para este miembro. El filtro de módulos va
 * EN la consulta (30 de SQL = 30 visibles; la redacción de dinero recorta la
 * frase, no elimina filas). Cursor compuesto (created_at, id): dos filas con
 * el mismo timestamp no se pierden ni se duplican al paginar.
 */
export async function paginaNovedades(
  miembro: MiembroFeed,
  cursor: CursorNovedades,
): Promise<{ items: Novedad[]; siguiente: CursorNovedades }> {
  const pares = paresVisibles(miembro);
  if (pares.length === 0) return { items: [], siguiente: null };

  // cursor.id también se codifica (defensa en profundidad: el endpoint ya
  // valida que sea uuid, pero este módulo no debe fiarse de sus llamadores).
  const filtro = cursor
    ? `and=(or(${paresInner(pares)}),or(created_at.lt.${encodeURIComponent(cursor.t)},and(created_at.eq.${encodeURIComponent(cursor.t)},id.lt.${encodeURIComponent(cursor.id)})))`
    : `or=(${paresInner(pares)})`;
  const r = await rest<EventoAuditoria[]>(
    "GET",
    `auditoria?select=${SELECT}&${filtro}&order=created_at.desc,id.desc&limit=30`,
  );
  if (!Array.isArray(r.json)) {
    // LANZAR, no devolver vacío: un feed vacío por error se pintaría como
    // "Nada nuevo por aquí todavía" — una afirmación falsa sobre el negocio
    // con la base caída. La página cae en (os)/error.tsx (reintento honesto)
    // y /api/novedades responde 500, que el botón "cargar más" ya trata.
    // La campana es la única que degrada en silencio (decisión declarada).
    console.error("[novedades] no se pudo leer la página", r.status);
    throw new Error(`No se pudo leer la auditoría (${r.status})`);
  }

  const nombres = await lotesDeNombres(r.json);
  const items = r.json
    .map((e) => traducirNovedad(e, miembro, nombres))
    .filter((n): n is Novedad => n !== null);
  const ultima = r.json[r.json.length - 1];
  return {
    items,
    // Página incompleta = no hay más. El cursor apunta a la última fila CRUDA
    // (no a la última traducida): la siguiente consulta sigue desde ahí.
    siguiente: r.json.length === 30 && ultima ? { t: ultima.created_at, id: ultima.id } : null,
  };
}

/**
 * No-vistos (0–10) para la campana. Si el miembro aún no tiene fila de marca
 * (alta posterior al deploy — la 0055 siembra a los existentes), se crea al
 * día y se responde 0: tu primer contacto con la campana te marca al día.
 */
export async function contadorNovedades(miembro: MiembroFeed): Promise<number> {
  const rV = await rest<{ visto_hasta: string }[]>(
    "GET",
    `notificaciones_vistas?team_member_id=eq.${miembro.id}&select=visto_hasta&limit=1`,
  );
  if (!Array.isArray(rV.json)) {
    console.error("[novedades] no se pudo leer la marca de", miembro.id, rV.status);
    return 0;
  }
  if (rV.json.length === 0) {
    const rc = await rest(
      "POST",
      "notificaciones_vistas",
      { team_member_id: miembro.id },
      "resolution=merge-duplicates,return=minimal",
    );
    if (rc.status >= 300) console.error("[novedades] no se pudo crear la marca de", miembro.id, rc.status);
    return 0;
  }

  const pares = paresVisibles(miembro);
  if (pares.length === 0) return 0;
  const r = await rest<EventoAuditoria[]>(
    "GET",
    `auditoria?select=${SELECT}&and=(or(${paresInner(pares)}),created_at.gt.${encodeURIComponent(rV.json[0].visto_hasta)})&order=created_at.desc,id.desc&limit=10`,
  );
  if (!Array.isArray(r.json)) return 0;
  // Sin lotes de nombres a propósito: los nombres no cambian si una fila
  // cuenta o no (traducirNovedad solo devuelve null por lista blanca o
  // permisos). Es la red final por si una fila viniera irreconocible.
  return r.json.filter((e) => traducirNovedad(e, miembro, NOMBRES_VACIO) !== null).length;
}

/** Marca ahora como visto (upsert por PK). Solo lo llama el POST de visto. */
export async function marcarVisto(teamMemberId: string): Promise<void> {
  const r = await rest(
    "POST",
    "notificaciones_vistas",
    { team_member_id: teamMemberId, visto_hasta: new Date().toISOString() },
    "resolution=merge-duplicates,return=minimal",
  );
  if (r.status >= 300) console.error("[novedades] no se pudo marcar visto", teamMemberId, r.status);
}
