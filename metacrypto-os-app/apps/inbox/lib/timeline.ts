// Lógica pura de la línea temporal del cliente. Sin acceso a datos: todo lo
// que decide qué se ve y en qué orden vive aquí para poder testearlo.
import type { UserPerms } from "@/lib/modulos";

export type TipoEvento = "programa" | "pago" | "cuota" | "sesion" | "freeze" | "mensaje";

export type EventoTimeline = {
  persona_id: string;
  fecha: string | null;   // timestamptz ISO — para ordenar
  dia: string | null;     // YYYY-MM-DD ya en Madrid — para agrupar y mostrar
  tipo: TipoEvento;
  titulo: string;
  detalle: string | null;
  importe: number | null;
  ref_id: string;
};

// El día de hoy en Madrid. en-CA da directamente YYYY-MM-DD, que es el mismo
// formato que devuelve Postgres para un `date` — así se comparan como cadenas.
// Mismo truco que /cuotas; no usar la parte de fecha de un ISO en UTC.
export function hoyMadrid(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(ahora);
}

// dateEs()/monthLabel() de lib/format.ts NO fijan zona horaria: usan la del
// proceso donde corre Node. Hoy en Vercel eso es UTC y Madrid siempre va por
// delante, así que no se nota — pero con TZ negativa (p.ej. América) un
// `dia` como "2026-08-01" se puede mostrar como "31 jul". Estas dos son las
// mismas, pero clavadas a Europe/Madrid (mismo truco que hoyMadrid, arriba),
// para las fechas de esta página. Deliberadamente NO se toca lib/format.ts:
// dateEs/monthLabel los usan otras seis pantallas (/, /cuotas, /ingresos,
// /pnl, /clientes, GastosTable) que no ha revisado esta tarea.
export function dateEsMadrid(dia: string | null): string {
  if (!dia) return "—";
  return new Date(dia).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "2-digit", timeZone: "Europe/Madrid",
  });
}

export function monthLabelMadrid(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    month: "short", year: "numeric", timeZone: "Europe/Madrid",
  });
}

// Los importes son finanzas: solo los ve quien tiene acceso total o el módulo
// `ingresos`. Manuel (clientes + inbox) ve los eventos pero no las cifras.
// Acepta el objeto que devuelve getCurrentUser() tal cual: trae acceso_total
// y modulos, que es todo lo que UserPerms exige.
export function puedeVerImportes(u: UserPerms): boolean {
  return u.acceso_total || (u.modulos ?? []).includes("ingresos");
}

export function partirTimeline(
  eventos: EventoTimeline[],
  hoy: string,
): { proximo: EventoTimeline[]; historia: EventoTimeline[]; sinFecha: EventoTimeline[] } {
  const proximo: EventoTimeline[] = [];
  const historia: EventoTimeline[] = [];
  const sinFecha: EventoTimeline[] = [];
  for (const e of eventos) {
    if (!e.dia) sinFecha.push(e);
    else if (e.dia > hoy) proximo.push(e);
    else historia.push(e);
  }
  // Historia: más reciente a más antigua. Desempata por fecha (más reciente primero).
  // Si fecha es nula, se trata como más antigua.
  historia.sort((a, b) => {
    if (b.dia! > a.dia!) return 1;
    if (b.dia! < a.dia!) return -1;
    // Mismo día: desempata por fecha (descendente)
    const fechaA = a.fecha ?? "";
    const fechaB = b.fecha ?? "";
    return fechaB.localeCompare(fechaA);
  });
  // Próximo: más cercano a más lejano. Desempata por fecha (más cercano primero).
  // Si fecha es nula, se trata como menos próxima (va después).
  proximo.sort((a, b) => {
    if (a.dia! > b.dia!) return 1;
    if (a.dia! < b.dia!) return -1;
    // Mismo día: desempata por fecha (ascendente). Fecha nula va después.
    if (!a.fecha && b.fecha) return 1;   // a sin fecha va después
    if (a.fecha && !b.fecha) return -1;  // b sin fecha va después
    return (a.fecha ?? "").localeCompare(b.fecha ?? "");
  });
  return { proximo, historia, sinFecha };
}

export function agruparPorMes(
  eventos: EventoTimeline[],
): { mes: string; eventos: EventoTimeline[] }[] {
  // Usa un Map para garantizar que un mismo mes nunca se fragmente, sea cual sea
  // el orden de entrada. El orden de los grupos resultantes se determina por la
  // primera aparición de cada mes en la entrada.
  const meses = new Map<string, EventoTimeline[]>();
  const orden: string[] = [];
  for (const e of eventos) {
    if (!e.dia) continue;
    const mes = e.dia.slice(0, 7);
    if (!meses.has(mes)) {
      meses.set(mes, []);
      orden.push(mes);
    }
    meses.get(mes)!.push(e);
  }
  return orden.map((mes) => ({ mes, eventos: meses.get(mes)! }));
}
