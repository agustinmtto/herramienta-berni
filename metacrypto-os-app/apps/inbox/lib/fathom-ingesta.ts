import { rest } from "@/lib/supabase";
import {
  aFila, clasificar, emparejar,
  type MiembroMin, type PersonaMin, type ReunionFathom,
} from "@/lib/fathom";

/**
 * Fathom — la parte que habla con la red y escribe en la base.
 *
 * La lógica de clasificar y emparejar vive en `lib/fathom.ts`, que es pura y
 * está cubierta por tests. Aquí solo está lo que no se puede probar sin red.
 *
 * QUÉ ESCRIBE Y QUÉ NO: escribe en `fathom_llamadas`, nunca en `sesiones`. El
 * porqué está en la cabecera de la migración 0062, y se resume así: `sesiones`
 * mueve el cupo de consultorías y las comisiones, así que un emparejamiento
 * equivocado ahí regala dinero. Esto es una bandeja; convertir es un paso con
 * una persona delante.
 */

const BASE = "https://api.fathom.ai/external/v1";

/** Página de la API. `next_cursor` a null = ya no hay más. */
type PaginaFathom = { items?: ReunionFathom[]; next_cursor?: string | null };

/**
 * Trae las reuniones de Fathom, paginando hasta el final.
 *
 * 🔴 Fíjate en lo que NO lleva la URL: ningún `recorded_by[]`. Ese filtro se
 * ignora en silencio (un correo inventado devuelve las mismas reuniones que
 * uno real), así que pedir "solo las de Manuel" devolvería las de Berni
 * etiquetadas como de Manuel. Se pide TODO y se clasifica fila a fila.
 *
 * `include_summary` sí, `include_transcript` NO: la transcripción de una
 * consultoría de 90 minutos son cientos de kB por llamada y no se enseña en
 * ninguna pantalla. El resumen es lo que Berni quiere leer.
 *
 * `tope` existe para que un fallo de paginación no dé vueltas para siempre: la
 * cuenta tiene 17 reuniones hoy, 60 páginas de 50 son 3.000.
 */
export async function traerReuniones(
  key: string,
  tope = 60,
): Promise<{ ok: true; reuniones: ReunionFathom[] } | { ok: false; error: string }> {
  const reuniones: ReunionFathom[] = [];
  let cursor: string | null = null;

  for (let i = 0; i < tope; i++) {
    const url =
      `${BASE}/meetings?limit=50&include_summary=true&include_action_items=true` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    let r: Response;
    try {
      r = await fetch(url, { headers: { "X-Api-Key": key }, cache: "no-store" });
    } catch {
      return { ok: false, error: "No se pudo conectar con Fathom." };
    }
    if (!r.ok) {
      // El 403 es el caso que importa distinguir: la key es personal y solo ve
      // lo que grabó su dueño más lo COMPARTIDO con su equipo. Si alguien deja
      // de compartir, esto empieza a devolver menos sin ningún error.
      return { ok: false, error: `Fathom respondió ${r.status}. Si es 401/403, la clave ya no sirve o le retiraron el acceso al equipo.` };
    }
    const pag = (await r.json()) as PaginaFathom;
    reuniones.push(...(pag.items ?? []));
    cursor = pag.next_cursor ?? null;
    if (!cursor) return { ok: true, reuniones };
  }
  // Se llegó al tope: se devuelve lo que hay, pero se avisa. Mejor una ingesta
  // incompleta y dicha que una silenciosa.
  console.warn("[fathom] se alcanzó el tope de páginas; puede faltar histórico");
  return { ok: true, reuniones };
}

export type ResultadoIngesta = {
  ok: boolean;
  error?: string;
  vistas: number;
  guardadas: number;
  emparejadas: number;
  porTipo: Record<string, number>;
};

/**
 * Trae todo de Fathom y lo deja en `fathom_llamadas`.
 *
 * IDEMPOTENTE: hace upsert por `recording_id`, así que correrlo diez veces
 * seguidas deja lo mismo que correrlo una.
 *
 * 🔴 NO PISA LO QUE TOCÓ UNA PERSONA. Si alguien emparejó una llamada a mano
 * (`emparejado_por = 'manual'`), o la descartó, o la convirtió en sesión, la
 * ingesta respeta esas tres columnas y solo refresca lo que viene de Fathom
 * (título, resumen, duración…). Sin esto, el primer cron después de una
 * corrección manual la borraría y nadie sabría por qué.
 */
export async function ingerirFathom(): Promise<ResultadoIngesta> {
  const vacio = { vistas: 0, guardadas: 0, emparejadas: 0, porTipo: {} as Record<string, number> };
  const key = (process.env.FATHOM_API_KEY ?? "").trim();
  if (!key) return { ok: false, error: "Falta FATHOM_API_KEY.", ...vacio };

  const res = await traerReuniones(key);
  if (!res.ok) return { ok: false, error: res.error, ...vacio };
  const { reuniones } = res;

  // El equipo y los clientes, una sola vez para todas las llamadas.
  const [rEquipo, rPersonas] = await Promise.all([
    rest<MiembroMin[]>("GET", "team_members?select=email,rol"),
    rest<PersonaMin[]>("GET", "personas?select=id,nombre,email&limit=2000"),
  ]);
  // Sin equipo no se puede clasificar (el tipo sale del rol), y sin clientes no
  // se puede emparejar. Guardar igual dejaría todo como 'interna' y sin dueño,
  // y el siguiente cron NO lo arreglaría porque la fila ya existiría.
  if (rEquipo.status >= 300 || !Array.isArray(rEquipo.json) || rEquipo.json.length === 0) {
    return { ok: false, error: "No se pudo leer el equipo; no se ingiere nada.", ...vacio };
  }
  if (rPersonas.status >= 300 || !Array.isArray(rPersonas.json)) {
    return { ok: false, error: "No se pudo leer la lista de clientes; no se ingiere nada.", ...vacio };
  }
  const equipo = rEquipo.json;
  const personas = rPersonas.json;

  // Lo que ya hay, para no pisar decisiones humanas.
  const rPrevias = await rest<
    { recording_id: number; emparejado_por: string | null; sesion_id: string | null; descartada_at: string | null }[]
  >("GET", "fathom_llamadas?select=recording_id,emparejado_por,sesion_id,descartada_at&limit=5000");
  if (rPrevias.status >= 300 || !Array.isArray(rPrevias.json)) {
    return { ok: false, error: "No se pudo leer lo ya ingerido; no se ingiere nada.", ...vacio };
  }
  const previas = new Map(rPrevias.json.map((p) => [p.recording_id, p]));

  const filas: Record<string, unknown>[] = [];
  const porTipo: Record<string, number> = {};
  let emparejadas = 0;

  for (const m of reuniones) {
    if (!m.recording_id) continue;
    const base = aFila(m);
    const tipo = clasificar(m, equipo);
    porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;

    const prev = previas.get(m.recording_id);
    const fila: Record<string, unknown> = { ...base, actualizado_at: new Date().toISOString() };

    if (prev?.emparejado_por === "manual") {
      // Una persona ya decidió de quién es. No se toca ni el cliente ni el
      // tipo: puede haberlo corregido justo porque la regla se equivocó.
      // El resto (título, resumen, duración) sí se refresca.
    } else {
      const par = emparejar(m, personas);
      fila.tipo = tipo;
      fila.persona_id = par?.personaId ?? null;
      fila.emparejado_por = par?.via ?? null;
      if (par) emparejadas++;
    }
    filas.push(fila);
  }

  if (filas.length === 0) return { ok: true, vistas: 0, guardadas: 0, emparejadas: 0, porTipo };

  // `resolution=merge-duplicates` sobre la clave única `recording_id`: las
  // nuevas se insertan y las conocidas se refrescan, en una sola llamada.
  const ins = await rest(
    "POST",
    "fathom_llamadas?on_conflict=recording_id",
    filas,
    "resolution=merge-duplicates,return=minimal",
  );
  if (ins.status >= 300) {
    return {
      ok: false,
      error: `La base rechazó la ingesta (${ins.status}). Si es 42P01, falta aplicar la migración 0062.`,
      vistas: reuniones.length, guardadas: 0, emparejadas: 0, porTipo,
    };
  }

  return { ok: true, vistas: reuniones.length, guardadas: filas.length, emparejadas, porTipo };
}
