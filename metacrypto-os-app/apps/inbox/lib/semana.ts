// Lógica pura de la semana del reporte. Sin acceso a datos: las fechas viven
// aquí para poder testearlas con días fijos, igual que lib/timeline.ts.
//
// Todas las fechas se manipulan como medianoche UTC construida a mano desde
// las partes YYYY-MM-DD, y se formatean fijando timeZone: "UTC". Así el
// resultado no depende del TZ del proceso — en Vercel es UTC, en local puede
// ser cualquier cosa. El "hoy" desde el que se arranca sí es de Madrid: lo
// aporta hoyMadrid() de lib/timeline.ts, que es quien decide qué día es hoy
// para el negocio.

export type Semana = { desde: string; hasta: string }; // YYYY-MM-DD, lunes y domingo

function aUTC(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

function aISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sumarDias(dia: string, n: number): string {
  const d = aUTC(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return aISO(d);
}

export function semanaDe(dia: string): Semana {
  const offset = (aUTC(dia).getUTCDay() + 6) % 7; // getUTCDay: domingo=0 → lunes=0
  const desde = sumarDias(dia, -offset);
  return { desde, hasta: sumarDias(desde, 6) };
}

export function semanaAnterior(s: Semana): Semana {
  return semanaDe(sumarDias(s.desde, -7));
}

export function semanaSiguiente(s: Semana): Semana {
  return semanaDe(sumarDias(s.desde, 7));
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

// El query string no es de fiar: cualquier valor que no sea una fecha real
// cae a la semana en curso en vez de propagar basura a las consultas. El
// viaje de ida y vuelta es imprescindible — Date.UTC rueda los valores
// imposibles (mes 13, día 45) en vez de dar NaN.
export function parseSemanaParam(w: string | undefined, hoy: string): Semana {
  if (!w || !RE_DIA.test(w) || aISO(aUTC(w)) !== w) return semanaDe(hoy);
  return semanaDe(w);
}

function fmt(dia: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("es-ES", { ...opts, timeZone: "UTC" }).format(aUTC(dia));
}

export function etiquetaSemana(s: Semana): string {
  const mismoAnio = s.desde.slice(0, 4) === s.hasta.slice(0, 4);
  const mismoMes = mismoAnio && s.desde.slice(5, 7) === s.hasta.slice(5, 7);
  if (mismoMes) {
    return `${fmt(s.desde, { day: "numeric" })} – ` +
      `${fmt(s.hasta, { day: "numeric", month: "short" })} ${fmt(s.hasta, { year: "numeric" })}`;
  }
  if (mismoAnio) {
    return `${fmt(s.desde, { day: "numeric", month: "short" })} – ` +
      `${fmt(s.hasta, { day: "numeric", month: "short" })} ${fmt(s.hasta, { year: "numeric" })}`;
  }
  return `${fmt(s.desde, { day: "numeric", month: "short", year: "numeric" })} – ` +
    `${fmt(s.hasta, { day: "numeric", month: "short", year: "numeric" })}`;
}

/* ---------------- Agregación del reporte ---------------- */

export type PagoSemana = {
  id: string;
  fecha: string;
  tipo: string | null;
  tipo_detalle: string | null;
  monto: number; // EUR firmado
  usd_recibido: number | null; // lo que entró de verdad — el cash de Berni
  persona: { id: string; nombre: string | null } | null;
};

export type VentaSemana = {
  id: string;
  fecha_inicio: string;
  motivo: string;
  tier: string;
  monto: number;
  persona: { id: string; nombre: string | null } | null;
};

export type ResumenSemana = {
  cashCollected: number; // EUR — se conserva para cuadrar contra Airtable
  cashUsd: number; // DÓLARES — el número que Berni quiere ver (14-ago-2026)
  // Pagos de la semana sin `usd_recibido`. Si no es 0, `cashUsd` está
  // INCOMPLETO y la pantalla debe decirlo: un total en dólares más bajo de lo
  // real, presentado como si fuera el bueno, es peor que no enseñarlo.
  nSinUsd: number;
  nPagos: number;
  facturacion: number; // EUR — la venta se firma en euros y ahí se queda
  nVentas: number;
  ticketMedio: number | null; // null si no hubo ventas — no cero, no NaN
  porMotivo: { motivo: string; importe: number; n: number }[];
};

export function resumenSemana(pagos: PagoSemana[], ventas: VentaSemana[]): ResumenSemana {
  const cashCollected = pagos.reduce((s, p) => s + p.monto, 0);
  // Los null se saltan en vez de contar como 0: sumarlos como cero daría el
  // mismo número pero escondería que falta un dato. `nSinUsd` lo saca a la luz.
  const cashUsd = pagos.reduce((s, p) => s + (p.usd_recibido ?? 0), 0);
  const nSinUsd = pagos.filter((p) => p.usd_recibido == null).length;
  const facturacion = ventas.reduce((s, v) => s + v.monto, 0);

  const porMotivo: ResumenSemana["porMotivo"] = [];
  for (const v of ventas) {
    const acc = porMotivo.find((x) => x.motivo === v.motivo);
    if (acc) {
      acc.importe += v.monto;
      acc.n += 1;
    } else {
      porMotivo.push({ motivo: v.motivo, importe: v.monto, n: 1 });
    }
  }
  porMotivo.sort((a, b) => b.importe - a.importe);

  return {
    cashCollected,
    cashUsd,
    nSinUsd,
    nPagos: pagos.length,
    facturacion,
    nVentas: ventas.length,
    ticketMedio: ventas.length === 0 ? null : facturacion / ventas.length,
    porMotivo,
  };
}

// null cuando la semana anterior no tuvo cash: un porcentaje sobre cero no
// significa nada, y la pantalla prefiere no enseñar delta a enseñar "+∞%".
export function deltaPct(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

// Los motivos son el catálogo de `programas.motivo` (migración 0002). Un
// motivo nuevo que no esté aquí se muestra crudo en vez de desaparecer de la
// tabla: mejor un texto feo que una venta invisible.
const ETIQUETA_MOTIVO: Record<string, string> = {
  nueva_venta: "Nueva",
  upsell: "Ascensión",
  renovacion: "Extensión",
  downsell: "Downsell",
  reactivacion: "Reactivación",
  cross_sell: "Cross-sell",
};

export function etiquetaMotivo(m: string): string {
  return ETIQUETA_MOTIVO[m] ?? m;
}
