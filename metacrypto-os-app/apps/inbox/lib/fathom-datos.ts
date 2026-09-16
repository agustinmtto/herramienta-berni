import { rest } from "@/lib/supabase";

/**
 * Lecturas de `fathom_llamadas`.
 *
 * En un fichero propio y no en `lib/data.ts` a propósito: `data.ts` tiene 1.500
 * líneas y lo está editando el equipo del cockpit en paralelo. Un fichero nuevo
 * no genera conflicto de merge con nadie.
 */

export type LlamadaFathom = {
  id: string;
  recording_id: number;
  titulo: string | null;
  url: string | null;
  share_url: string | null;
  grabado_por_nombre: string | null;
  grabado_por_email: string | null;
  inicio: string | null;
  duracion_min: number | null;
  tipo: "venta" | "servicio" | "interna";
  persona_id: string | null;
  emparejado_por: "correo" | "titulo" | "manual" | null;
  invitados_externos: Array<{ nombre: string | null; email: string | null }>;
  resumen_md: string | null;
  acciones: unknown[];
  sesion_id: string | null;
  descartada_at: string | null;
  personas: { nombre: string | null } | null;
};

const CAMPOS =
  "id,recording_id,titulo,url,share_url,grabado_por_nombre,grabado_por_email,inicio," +
  "duracion_min,tipo,persona_id,emparejado_por,invitados_externos,resumen_md,acciones," +
  "sesion_id,descartada_at,personas(nombre)";

/**
 * Las llamadas de la bandeja.
 *
 * Las `interna` NO se traen: son weeklies y debriefs del equipo, no llamadas
 * con un cliente, y llenar la pantalla con ellas convierte la bandeja en ruido.
 * Siguen guardadas — si algún día hace falta verlas, están.
 */
export async function getLlamadas(): Promise<LlamadaFathom[]> {
  const r = await rest<LlamadaFathom[]>(
    "GET",
    // ⚠️ Estas columnas las crea la migración 0062. Sin ella, PostgREST responde
    // 400, `rest()` no lanza y esto devuelve [] — la pantalla diría "no hay
    // ninguna llamada" con llamadas delante. La 0062 va ANTES del deploy.
    `fathom_llamadas?select=${CAMPOS}&tipo=neq.interna&order=inicio.desc&limit=300`,
  );
  return Array.isArray(r.json) ? r.json : [];
}

/** Las llamadas de UN cliente, para el bloque de su ficha. */
export async function getLlamadasDeCliente(personaId: string): Promise<LlamadaFathom[]> {
  const r = await rest<LlamadaFathom[]>(
    "GET",
    `fathom_llamadas?select=${CAMPOS}&persona_id=eq.${personaId}&descartada_at=is.null&order=inicio.desc`,
  );
  return Array.isArray(r.json) ? r.json : [];
}

/**
 * Cuántas llamadas quedan por revisar: con cliente conocido, sin convertir en
 * sesión y sin descartar. Es el número del contador del menú.
 *
 * Las que NO tienen cliente quedan fuera del contador a propósito: no se pueden
 * "resolver" sin decidir de quién son, así que meterlas haría un badge que no
 * baja — el mismo error que el resto del menú evita a propósito.
 */
export async function contarLlamadasPendientes(): Promise<number> {
  const r = await rest<{ id: string }[]>(
    "GET",
    "fathom_llamadas?select=id&tipo=eq.servicio&persona_id=not.is.null&sesion_id=is.null&descartada_at=is.null",
  );
  return Array.isArray(r.json) ? r.json.length : 0;
}
