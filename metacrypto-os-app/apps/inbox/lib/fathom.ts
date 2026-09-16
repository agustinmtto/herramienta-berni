/**
 * Fathom — la parte PURA: clasificar una llamada y emparejarla con un cliente.
 *
 * Aquí no hay red ni base de datos a propósito: todo lo de este fichero se
 * puede probar con un objeto en la mano, y de hecho se prueba
 * (lib/__tests__/fathom.test.ts). La parte que habla con la API y escribe en
 * la base vive en `fathom-ingesta.ts`.
 *
 * 🔴 LA TRAMPA DE LA API, y es la razón de que este fichero exista:
 * `GET /meetings?recorded_by[]=quien@sea` **se ignora en silencio**. Medido el
 * 2-sep y confirmado el 10-sep: un correo inventado devuelve exactamente las
 * mismas reuniones que uno real, con 200 y sin aviso
 * (outputs/fathom-alcance-real.md).
 *
 * Consecuencia: el dueño y el tipo de cada llamada se derivan del campo
 * `recorded_by` DE LA FILA, nunca de un filtro en la petición. Si alguien
 * "optimiza" la ingesta pidiéndole a Fathom solo las de un consultor, se
 * guardarán las de otro con su nombre y nada fallará.
 */

/** Lo que devuelve `GET /meetings`, con solo los campos que usamos. */
export type ReunionFathom = {
  recording_id?: number;
  title?: string | null;
  meeting_title?: string | null;
  url?: string | null;
  share_url?: string | null;
  scheduled_start_time?: string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  transcript_language?: string | null;
  recorded_by?: { name?: string | null; email?: string | null; team?: string | null } | null;
  calendar_invitees?: Array<{
    name?: string | null;
    email?: string | null;
    is_external?: boolean | null;
  }> | null;
  default_summary?: { markdown_formatted?: string | null } | null;
  action_items?: unknown[] | null;
};

export type TipoLlamada = "venta" | "servicio" | "interna";
export type EmparejadoPor = "correo" | "titulo" | "manual";

export type PersonaMin = { id: string; nombre: string | null; email: string | null };
export type MiembroMin = { email: string | null; rol: string | null };

/**
 * Normaliza para comparar nombres: sin tildes, sin signos, en minúsculas.
 * Hace falta porque el título lo escribe una persona a mano en el calendario
 * y llega de todo — "Adrián Moreno Fonts" contra "Adrian Moreno Fonts",
 * "Claudio Mendonca" contra "Claudio mendonca".
 */
export function normalizar(s: string | null | undefined): string[] {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Los invitados de fuera del dominio. Se usa `is_external`, que lo dice Fathom. */
export function invitadosExternos(m: ReunionFathom): Array<{ nombre: string | null; email: string | null }> {
  return (m.calendar_invitees ?? [])
    .filter((i) => i?.is_external === true)
    .map((i) => ({ nombre: i.name ?? null, email: (i.email ?? "").trim() || null }));
}

/**
 * Qué clase de llamada es.
 *
 * `interna` GANA sobre todo lo demás cuando no hubo ningún invitado externo:
 * una llamada sin nadie de fuera no puede ser con un cliente, por mucho que el
 * título lleve su nombre. Y pasa de verdad — hay debriefs internos titulados
 * con el nombre del cliente del que se está hablando ("FERNANDO REUSCH IVANNA",
 * grabada por el closer, once minutos, sin ningún externo).
 *
 * El resto sale del ROL de quien grabó, leído de `team_members`, no de una
 * lista de correos escrita aquí: el día que entre otro closer, funciona solo.
 * Quien no esté en el equipo cuenta como `interna` — no sabemos qué es, y
 * meterla en la bandeja de sesiones sería adivinar.
 */
export function clasificar(m: ReunionFathom, equipo: MiembroMin[]): TipoLlamada {
  if (invitadosExternos(m).length === 0) return "interna";
  const correo = (m.recorded_by?.email ?? "").trim().toLowerCase();
  const rol = equipo.find((x) => (x.email ?? "").trim().toLowerCase() === correo)?.rol ?? null;
  if (rol === "closer" || rol === "setter") return "venta";
  if (rol === "coach") return "servicio";
  return "interna";
}

/**
 * Con qué cliente es esta llamada.
 *
 * Dos vías, y NO valen lo mismo:
 *
 *   correo → un invitado externo coincide con `personas.email`. Es una
 *            igualdad exacta sobre un dato que nadie escribió a ojo, así que
 *            se puede usar tal cual. Medido sobre las 16 llamadas reales del
 *            10-sep: 9 emparejadas, 0 falsos positivos.
 *
 *   titulo → el título contiene nombre Y apellido de un cliente. Es una
 *            SUGERENCIA: el título lo escribe quien crea el evento y hay
 *            "Juan - Berni" o "Sesion BR - Nico y Berni". Se exige nombre y
 *            apellido justamente para que un "Juan" suelto no se lleve al
 *            primer Juan de la base, que serían 200 clientes jugando a la
 *            lotería.
 *
 * Quien llama decide qué hacer con cada una: el correo se aplica solo, el
 * título se le enseña a una persona para que confirme.
 */
export function emparejar(
  m: ReunionFathom,
  personas: PersonaMin[],
): { personaId: string; via: EmparejadoPor } | null {
  const externos = invitadosExternos(m);
  for (const e of externos) {
    const mail = (e.email ?? "").toLowerCase();
    if (!mail) continue;
    const p = personas.find((x) => (x.email ?? "").trim().toLowerCase() === mail);
    if (p) return { personaId: p.id, via: "correo" };
  }

  const enTitulo = normalizar(m.title ?? m.meeting_title);
  if (enTitulo.length) {
    for (const p of personas) {
      const partes = normalizar(p.nombre);
      if (partes.length < 2) continue;
      if (partes.slice(0, 2).every((w) => enTitulo.includes(w))) {
        return { personaId: p.id, via: "titulo" };
      }
    }
  }
  return null;
}

/** Duración en minutos de la GRABACIÓN, que es lo que duró de verdad. */
export function duracionMin(m: ReunionFathom): number | null {
  const a = m.recording_start_time;
  const b = m.recording_end_time;
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const min = Math.round(ms / 60000);
  // La cuenta de Fathom trae una "Fathom Demo" sembrada al crearla, con casi
  // dos meses de duración. Cualquier cosa por encima de un día no es una
  // llamada: se guarda sin duración antes que con un número absurdo.
  return min > 1440 ? null : min;
}

/**
 * De la respuesta de la API a la fila que se guarda. Sin `persona_id` ni
 * `tipo`: esos los decide quien llama, que es el único que tiene delante el
 * equipo y la lista de clientes.
 */
export function aFila(m: ReunionFathom) {
  return {
    recording_id: m.recording_id ?? null,
    titulo: (m.title ?? m.meeting_title ?? "").trim() || null,
    url: m.url ?? null,
    share_url: m.share_url ?? null,
    grabado_por_email: (m.recorded_by?.email ?? "").trim().toLowerCase() || null,
    grabado_por_nombre: m.recorded_by?.name ?? null,
    grabado_por_equipo: m.recorded_by?.team ?? null,
    inicio: m.recording_start_time ?? m.scheduled_start_time ?? null,
    fin: m.recording_end_time ?? null,
    duracion_min: duracionMin(m),
    invitados_externos: invitadosExternos(m),
    resumen_md: m.default_summary?.markdown_formatted ?? null,
    acciones: Array.isArray(m.action_items) ? m.action_items : [],
    idioma: m.transcript_language ?? null,
  };
}

/**
 * El resumen de Fathom viene con TODAS las frases envueltas en un enlace con
 * marca de tiempo — `[texto](https://fathom.video/share/...?timestamp=254.0)`.
 * Dentro de Fathom eso es útil; pegado en las notas de una sesión es ilegible.
 *
 * Esto deja el texto y tira los enlaces. Se conserva el markdown de
 * encabezados y viñetas, que es lo que da la estructura.
 */
export function resumenEnTexto(md: string | null | undefined): string {
  if (!md) return "";
  return md
    .replace(/\[([^\]]*)\]\((?:https?:)?[^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------------- El resumen, para pintarlo ---------------- */

export type BloqueResumen =
  | { tipo: "titulo"; texto: TrozoResumen[] }
  | { tipo: "vineta"; texto: TrozoResumen[] }
  | { tipo: "parrafo"; texto: TrozoResumen[] };

export type TrozoResumen = { texto: string; negrita: boolean; enlace: string | null };

/**
 * Parte el resumen de Fathom en bloques y trozos para pintarlo con React.
 *
 * 🔴 Devuelve DATOS, no HTML, y es a propósito: el resumen lo escribe la IA de
 * Fathom sobre lo que dijo un cliente en una llamada. Es texto de fuera, y
 * pasarlo por `dangerouslySetInnerHTML` sería confiar en que ni Fathom ni nadie
 * en esa llamada mete una etiqueta. Pintando elementos, React escapa solo y el
 * problema no existe.
 *
 * Cubre justo lo que Fathom usa: `## título`, `- viñeta`, `**negrita**` y
 * `[texto](url)`. Lo demás se queda como texto plano, que es un fallo bonito:
 * se lee igual, solo sin formato.
 *
 * Los enlaces se CONSERVAN aquí (a diferencia de `resumenEnTexto`, que los
 * quita para las notas): llevan a la marca de tiempo exacta de la grabación, y
 * es lo que hace que el resumen sirva para saltar al minuto que interesa.
 */
export function parsearResumen(md: string | null | undefined): BloqueResumen[] {
  if (!md) return [];
  const bloques: BloqueResumen[] = [];
  for (const linea of md.split("\n")) {
    const l = linea.trim();
    if (!l) continue;
    if (l.startsWith("#")) {
      bloques.push({ tipo: "titulo", texto: trozos(l.replace(/^#+\s*/, "")) });
    } else if (/^[-*]\s+/.test(l)) {
      bloques.push({ tipo: "vineta", texto: trozos(l.replace(/^[-*]\s+/, "")) });
    } else {
      bloques.push({ tipo: "parrafo", texto: trozos(l) });
    }
  }
  return bloques;
}

function trozos(s: string): TrozoResumen[] {
  const out: TrozoResumen[] = [];
  // Un solo recorrido que reconoce enlace o negrita, lo que aparezca antes.
  const re = /\[([^\]]*)\]\(([^)]*)\)|\*\*([^*]+)\*\*/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > ultimo) empujar(out, s.slice(ultimo, m.index), false, null);
    if (m[1] !== undefined) {
      // El texto de un enlace puede traer negritas dentro — pasa en cada
      // viñeta de Fathom: `[**Iker se une** para…](url)`.
      const href = /^https?:\/\//i.test(m[2]) ? m[2] : null;
      for (const t of trozos(m[1])) out.push({ ...t, enlace: t.enlace ?? href });
    } else {
      empujar(out, m[3], true, null);
    }
    ultimo = m.index + m[0].length;
  }
  if (ultimo < s.length) empujar(out, s.slice(ultimo), false, null);
  return out;
}

function empujar(out: TrozoResumen[], texto: string, negrita: boolean, enlace: string | null) {
  if (texto) out.push({ texto, negrita, enlace });
}
