// Lógica pura de las sesiones grupales recurrentes (miércoles con Manuel,
// domingo con Berni). Sin red ni base, igual que lib/sesiones.ts: aquí vive
// todo lo que decide CUÁNDO cae la próxima sesión y si una regla está en
// condiciones de programar avisos. Imports relativos a propósito: vitest no
// resuelve el alias `@/` en runtime.
import { zonaValida, nombreDeCoach, horaEnZona } from "./sesiones";

export type ReglaRecurrente = {
  id: string;
  dia_semana: number; // 0=domingo … 6=sábado (convención getUTCDay de JS)
  hora: string | null; // "19:00" o "19:00:00" (time de Postgres); null = sin confirmar
  zona: string;
  coach_id: string | null;
  enlace: string | null;
  plantilla_nombre: string;
  audiencia: string;
  activa: boolean;
  duracion_min: number;
};

const DIA_MS = 24 * 3600 * 1000;

// Cuánto va adelantado el reloj de pared de `zona` respecto a UTC en ese
// instante. Se saca de Intl: se formatea el instante en la zona y se relee
// como si fuera UTC — la diferencia es el offset, DST incluido.
function offsetMs(zona: string, instante: number): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instante));
  const p: Record<string, string> = {};
  for (const { type, value } of partes) p[type] = value;
  // Algunos motores dan "24" para medianoche con hour12:false.
  const hora = p.hour === "24" ? 0 : Number(p.hour);
  const comoUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    hora, Number(p.minute), Number(p.second),
  );
  return comoUtc - instante;
}

/**
 * El instante (ISO UTC) de la primera ocurrencia de `dia_semana` a las `hora`
 * de `zona` que aún no ha pasado. La hora es "de pared": 19:00 de Madrid son
 * 17:00Z en verano y 18:00Z en invierno, y el offset se calcula para el día
 * de la sesión, no para hoy — la semana del cambio de hora es justo donde un
 * cron en UTC se equivocaría de hora media España.
 */
export function proximaOcurrencia(
  dia_semana: number,
  hora: string | null,
  zona: string,
  ahora: Date,
): string | null {
  if (!Number.isInteger(dia_semana) || dia_semana < 0 || dia_semana > 6) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((hora ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  if (!zonaValida(zona)) return null;

  // La fecha de HOY en la zona, no en UTC: a las 00:30 de Madrid, UTC todavía
  // va por ayer — el mismo bug que ya documentan /cuotas y /sesiones.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(ahora);
  const [y, mo, d] = hoy.split("-").map(Number);
  const base = Date.UTC(y, mo - 1, d);

  // 0..7: si hoy es el día pedido pero la hora ya pasó, el candidato bueno es
  // el mismo día de la semana que viene (i = 7).
  for (let i = 0; i <= 7; i++) {
    const fecha = new Date(base + i * DIA_MS);
    if (fecha.getUTCDay() !== dia_semana) continue;
    const guess = Date.UTC(
      fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), hh, mm,
    );
    // Dos pasadas: la primera estima el offset con el instante equivocado por
    // como mucho el salto del DST; la segunda lo corrige.
    let instante = guess - offsetMs(zona, guess);
    instante = guess - offsetMs(zona, instante);
    if (instante >= ahora.getTime()) return new Date(instante).toISOString();
  }
  return null;
}

// Lista BLANCA de audiencias, mismo criterio que los estados de cita: un valor
// nuevo no envía nada hasta que alguien lo implemente aquí y en el cron. Hoy
// solo existe "todos" = clientes activos (estado 'cliente') con teléfono.
export function esAudienciaConocida(audiencia: string): boolean {
  return audiencia === "todos";
}

/**
 * Por qué una regla NO puede programar avisos, o null si está completa.
 * El orden importa poco; que el motivo sea legible en el OS, mucho — es lo
 * que le dice a Milo qué falta por rellenar antes de encenderla.
 */
export function motivoNoProgramable(regla: ReglaRecurrente): string | null {
  if (!zonaValida(regla.zona)) return "zona horaria inválida";
  if (!/^(\d{1,2}):(\d{2})(?::\d{2})?$/.test((regla.hora ?? "").trim())) return "sin hora";
  if (!(regla.enlace ?? "").trim().startsWith("http")) return "sin enlace de Zoom";
  if (!esAudienciaConocida(regla.audiencia)) return "audiencia desconocida";
  if (!nombreDeCoach(regla.coach_id)) return "coach sin nombre";
  return null;
}

/**
 * El valor de `{{hora}}` en la plantilla. La sesión es grupal y los clientes
 * están repartidos entre España y América: "19:00" a secas le dice a un
 * cliente de México una hora que no es la suya. La coletilla lo desambigua —
 * el cuerpo aprobado dice "Te esperamos a las {{hora}} con {{coach}}" y admite
 * texto libre en la variable.
 */
export function horaParaPlantilla(fechaIso: string, zona: string): string {
  const etiqueta = zona === "Europe/Madrid" ? "hora de España" : zona;
  return `${horaEnZona(fechaIso, zona)} (${etiqueta})`;
}

// ============================================================
// Quién queda FUERA de los avisos recurrentes.
//
// Decisión de Milo, 3-sep-2026: el cohorte OG no recibe estos avisos. Son los
// vitalicios de 2023 — sin upsells, sin mentoría y sin datos —, y las sesiones
// grupales no forman parte de lo que compraron.
//
// Hoy ya no les llega nada, pero por accidente: los 76 están `archivado` y
// ninguno tiene teléfono ni email, así que el filtro `estado=eq.cliente` de
// `audienciaTodos` los deja fuera sin que nadie lo decidiera. Basta reactivar
// a uno —o ampliar un backfill de emails como el del 3-sep— para que entren
// solos y en silencio. Esto convierte esa casualidad en una regla legible.
//
// Es lista NEGRA y no blanca a propósito, al revés que `esAudienciaConocida`:
// ahí el riesgo es enviar de más y callar es seguro; aquí el riesgo es callar
// de más. Un tier nuevo debe recibir sus avisos sin que nadie lo dé de alta.
const TIERS_SIN_AVISOS = new Set(["og"]);

export function excluidoDeAvisos(tier: string | null | undefined): boolean {
  const t = (tier ?? "").trim().toLowerCase();
  // Sin tier NO se excluye: los dos errores no cuestan lo mismo. Un OG de más
  // molesta; un cliente de pago de menos es un fallo de servicio, y además
  // silencioso. Ante la duda, se envía.
  if (!t) return false;
  return TIERS_SIN_AVISOS.has(t);
}

/**
 * Parte una audiencia en la que recibe y la que no.
 *
 * Devuelve las DOS listas a propósito. Si solo devolviera la buena, la
 * exclusión sería otro silencio más — y el cron tiene que poder decir
 * "3 OG omitidos" en sus contadores, igual que dice los saltados.
 */
export function filtrarAudiencia<T extends { id: string }>(
  audiencia: T[],
  tierPorPersona: Map<string, string>,
): { enviar: T[]; excluidos: T[] } {
  const enviar: T[] = [];
  const excluidos: T[] = [];
  for (const p of audiencia) {
    if (excluidoDeAvisos(tierPorPersona.get(p.id))) excluidos.push(p);
    else enviar.push(p);
  }
  return { enviar, excluidos };
}
