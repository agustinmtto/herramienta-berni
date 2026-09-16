// Lógica pura de la pantalla de Inicio. Sin acceso a datos ni imports de
// runtime: todo entra por parámetros y "hoy" es siempre un argumento, igual
// que en lib/semana.ts. Así los meses parciales, los cambios de año y el
// pacing se testean con días fijos en vez de depender del reloj.
//
// Las fechas son cadenas "YYYY-MM-DD" y los meses "YYYY-MM". No se construye
// ni un solo Date para aritmética de calendario: con fechas como texto no hay
// zona horaria que se coma un día.

/* ---------------- Tipos de fila ---------------- */

export type PagoInicio = {
  fecha: string;
  tipo: string | null;
  /** Facturado en euros. */
  eur: number;
  /** Lo que entró de verdad, en dólares. Negativo en una devolución. */
  usd: number;
  nombre: string;
};

export type ProgramaInicio = {
  id: string;
  fecha: string;
  tier: string;
  motivo: string;
  /**
   * Importe en euros, o null si la fila no lo tiene.
   *
   * NO es lo mismo «vale 0» que «no sabemos cuánto». En la base NINGÚN
   * programa tiene monto 0: los 79 sin importe son NULL — 76 del cohorte OG
   * y 3 ventas reales cuyo importe nunca se rellenó. Colapsar null a 0 se
   * comía esas 3 ventas de todos los recuentos.
   */
  eur: number | null;
  meses: number | null;
  nombre: string;
  /** Para enlazar con la ficha del cliente desde «Últimas compras». */
  personaId: string | null;
  /** El programa al que sustituye, si esta venta fue una ascensión. */
  programaPrevioId: string | null;
  /** ¿Tiene `source_id`? El hueco de atribución se cuenta, no se disimula. */
  conFuente: boolean;
  /** De dónde vino, resuelta desde `fuentes_atribucion`. null = no se sabe. */
  fuente: string | null;
  /** Con qué se pagó, tomado del PRIMER pago de esta venta. null = no se sabe. */
  metodoPago: string | null;
};

export type CuotaInicio = { fecha: string; eur: number; estado: string };

export type PersonaInicio = {
  id: string; nombre: string; estado: string; alta: string | null; pais: string;
};

/**
 * El cohorte legacy: 76 filas importadas de Airtable con fecha 2023-01-01 y
 * sin importe. No son ventas y no deben promediarse.
 *
 * El discriminante es el TIER, no el importe: hay 3 ventas de verdad que
 * también llegaron sin monto, y filtrar por dinero se las llevaba por delante.
 */
export const esLegacy = (p: ProgramaInicio): boolean => p.tier === "OG";

export type DatosInicio = {
  pagos: PagoInicio[];
  programas: ProgramaInicio[];
  cuotas: CuotaInicio[];
  personas: PersonaInicio[];
  /** Meses "YYYY-MM" con algún gasto cargado. Solo para declarar el hueco. */
  mesesConGasto: string[];
};

export type Rango = { desde: string; hasta: string };

/* ---------------- Calendario ---------------- */

export const mesDe = (fecha: string): string => fecha.slice(0, 7);

/** Días que tiene un mes. Día 0 del siguiente = último del actual. */
export function finDeMes(ym: string): number {
  const [a, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

export function sumaMeses(ym: string, n: number): string {
  const [a, m] = ym.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Meses del rango, ambos incluidos, en orden ascendente. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let m = mesDe(desde);
  const fin = mesDe(hasta);
  while (m <= fin) {
    out.push(m);
    m = sumaMeses(m, 1);
  }
  return out;
}

export type Preset = "mes" | "3m" | "6m" | "12m" | "anio" | "todo";

export function rangoDePreset(p: Preset, hoy: string, minFecha: string): Rango {
  const mes = mesDe(hoy);
  switch (p) {
    case "mes":  return { desde: `${mes}-01`, hasta: hoy };
    case "3m":   return { desde: `${sumaMeses(mes, -2)}-01`, hasta: hoy };
    case "6m":   return { desde: `${sumaMeses(mes, -5)}-01`, hasta: hoy };
    case "12m":  return { desde: `${sumaMeses(mes, -11)}-01`, hasta: hoy };
    case "anio": return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy };
    default:     return { desde: minFecha, hasta: hoy };
  }
}

const enRango = (f: string, r: Rango) => f >= r.desde && f <= r.hasta;

/**
 * Días TRANSCURRIDOS de un mes. El mes en curso llega hasta hoy; cualquier
 * otro, hasta su último día. Dividir el cobrado de agosto entre 31 estando a
 * día 26 daría un ritmo artificialmente bajo.
 */
export const diasTrazados = (ym: string, hoy: string): number =>
  ym === mesDe(hoy) ? Number(hoy.slice(8, 10)) : finDeMes(ym);

/**
 * Días de un mes que caen DENTRO del rango y ya han transcurrido.
 *
 * El ritmo €/día divide dinero por días, y el dinero ya viene recortado por
 * el filtro: con un rango 15-jul → 10-ago, julio aporta solo 17 días de
 * cobros, no 31. Dividir entre 31 inventaba un ritmo un 45 % más bajo.
 */
export function diasEnRango(ym: string, r: Rango, hoy: string): number {
  const ultimo = diasTrazados(ym, hoy);
  if (ultimo <= 0) return 1;
  const desde = mesDe(r.desde) === ym ? Number(r.desde.slice(8, 10)) : 1;
  const hasta = mesDe(r.hasta) === ym ? Number(r.hasta.slice(8, 10)) : ultimo;
  return Math.max(Math.min(hasta, ultimo) - Math.max(desde, 1) + 1, 1);
}

/* ---------------- Dinero cobrado ---------------- */

/**
 * Cobrado por mes, en dólares. Suma `usd` tal cual, así que las devoluciones
 * (negativas) restan — igual que la vista v_cash_collected del OS.
 */
export function cobradoPorMes(pagos: PagoInicio[], r: Rango): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pagos) {
    if (!enRango(p.fecha, r)) continue;
    const ym = mesDe(p.fecha);
    m.set(ym, (m.get(ym) ?? 0) + p.usd);
  }
  return m;
}

export type BarraCash = { ym: string; cob: number; enCurso: boolean; dias: number };

/**
 * La serie del gráfico principal. NUNCA pasa del mes en curso, aunque el
 * filtro pida más: la pantalla solo habla de pasado y presente.
 */
export function serieCash(pagos: PagoInicio[], r: Rango, hoy: string): BarraCash[] {
  const mesHoy = mesDe(hoy);
  if (mesDe(r.desde) > mesHoy) return [];      // rango enteramente futuro
  const cob = cobradoPorMes(pagos, r);
  const ultimo = mesDe(r.hasta) > mesHoy ? mesHoy : mesDe(r.hasta);
  return mesesEntre(r.desde, `${ultimo}-01`).map((ym) => ({
    ym,
    cob: cob.get(ym) ?? 0,
    enCurso: ym === mesHoy,
    dias: diasEnRango(ym, r, hoy),
  }));
}

/* ---------------- Ritmo ---------------- */

/**
 * Acumulado día a día de un mes. Índice = día (1..n); la posición 0 es 0 para
 * que la curva arranque en el origen.
 */
export function acumuladoDe(pagos: PagoInicio[], ym: string): number[] {
  const dias = finDeMes(ym);
  const out = new Array(dias + 1).fill(0);
  for (const p of pagos) {
    if (mesDe(p.fecha) !== ym) continue;
    out[Number(p.fecha.slice(8, 10))] += p.usd;
  }
  for (let d = 1; d <= dias; d++) out[d] += out[d - 1];
  return out;
}

export type Ritmo = {
  mesA: string; mesB: string;
  serieA: number[]; serieB: number[];
  diasA: number; diasB: number;
  /** Día al que se comparan. Siempre el menor de los dos. */
  diaComparacion: number;
  totalA: number; totalB: number;
  /** Diferencia relativa al día de comparación. null si no hay base. */
  dif: number | null;
  /** ¿Alguno de los dos es el mes en curso? Decide si se pinta la marca de hoy. */
  tocaMesEnCurso: boolean;
};

/**
 * Compara dos meses día a día.
 *
 * La comparación se hace SIEMPRE a igual número de días: enfrentar un mes que
 * lleva 26 contra otro de 31 completos sería una derrota garantizada.
 */
export function comparaRitmo(
  pagos: PagoInicio[], mesA: string, mesB: string, hoy: string,
): Ritmo {
  const serieA = acumuladoDe(pagos, mesA);
  const serieB = acumuladoDe(pagos, mesB);
  const diasA = diasTrazados(mesA, hoy);
  const diasB = diasTrazados(mesB, hoy);
  const diaComparacion = Math.min(diasA, diasB);
  const a = serieA[diaComparacion] ?? 0;
  const b = serieB[diaComparacion] ?? 0;
  return {
    mesA, mesB, serieA, serieB, diasA, diasB, diaComparacion,
    totalA: serieA[diasA] ?? 0,
    totalB: serieB[diasB] ?? 0,
    dif: b > 0 ? (a - b) / b : null,
    tocaMesEnCurso: mesA === mesDe(hoy) || mesB === mesDe(hoy),
  };
}

/** Meses con algún pago, del más reciente al más antiguo. */
export function mesesConDatos(pagos: PagoInicio[]): string[] {
  return [...new Set(pagos.map((p) => mesDe(p.fecha)))].sort().reverse();
}

/* ---------------- Pacing del mes en curso ---------------- */

export type Pacing = {
  delMes: number;
  /** Proyección a cierre por regla de tres sobre los días transcurridos. */
  proyeccion: number;
  ritmoDiario: number;
  dia: number;
  diasMes: number;
  mesPrevio: string;
  prevMismoDia: number;
  dif: number | null;
};

export function pacing(pagos: PagoInicio[], hoy: string): Pacing {
  const mesHoy = mesDe(hoy);
  const dia = Number(hoy.slice(8, 10));
  const diasMes = finDeMes(mesHoy);
  const delMes = pagos
    .filter((p) => mesDe(p.fecha) === mesHoy)
    .reduce((s, p) => s + p.usd, 0);
  const mesPrevio = sumaMeses(mesHoy, -1);
  const prevMismoDia = pagos
    .filter((p) => mesDe(p.fecha) === mesPrevio && Number(p.fecha.slice(8, 10)) <= dia)
    .reduce((s, p) => s + p.usd, 0);
  return {
    delMes,
    proyeccion: dia > 0 ? (delMes / dia) * diasMes : 0,
    ritmoDiario: dia > 0 ? delMes / dia : 0,
    dia, diasMes, mesPrevio, prevMismoDia,
    dif: prevMismoDia > 0 ? (delMes - prevMismoDia) / prevMismoDia : null,
  };
}

/**
 * ¿El rango contiene todo lo transcurrido del mes en curso? Solo entonces el
 * titular puede decir «agosto 2026».
 *
 * Hacen falta las DOS condiciones. Comparando solo el mes del `hasta`, un
 * «hasta» del día 1 al 25 de agosto pasaba el filtro: el titular etiquetaba
 * «agosto 2026» una cifra de unos pocos días mientras el pacing de al lado
 * seguía calculado sobre el mes entero. Las dos mitades de la misma tarjeta
 * miraban universos distintos.
 */
export const cubreMesEntero = (r: Rango, hoy: string): boolean =>
  r.desde <= `${mesDe(hoy)}-01` && r.hasta >= hoy;

/** ¿El rango termina antes del mes en curso? Entonces el pacing no aplica. */
export const rangoCerrado = (r: Rango, hoy: string): boolean => mesDe(r.hasta) < mesDe(hoy);

/* ---------------- Tipo de cambio ---------------- */

/**
 * Tipo de cambio implícito de cada mes, sacado de los pagos reales. Nunca un
 * valor inventado: oscila entre 1,03 y 1,16 según el mes.
 */
export function fxPorMes(pagos: PagoInicio[]): Map<string, number> {
  const acc = new Map<string, number[]>();
  for (const p of pagos) {
    if (p.eur > 0 && p.usd > 0) {
      const ym = mesDe(p.fecha);
      const l = acc.get(ym) ?? [];
      l.push(p.usd / p.eur);
      acc.set(ym, l);
    }
  }
  const out = new Map<string, number>();
  for (const [ym, l] of acc) out.set(ym, l.reduce((s, x) => s + x, 0) / l.length);
  return out;
}

/** El del mes pedido; si ese mes no tiene pagos, la media de los que sí. */
export function fxDe(fx: Map<string, number>, ym: string): number {
  const v = fx.get(ym);
  if (v) return v;
  const todos = [...fx.values()];
  return todos.length ? todos.reduce((s, x) => s + x, 0) / todos.length : 1.1;
}

/* ---------------- Cuotas ---------------- */

export type Cuotas = {
  futuras: { usd: number; n: number };
  /** Pendientes con fecha ya pasada: dinero atascado, no pronóstico. */
  vencidas: { usd: number; n: number; masVieja: string | null };
};

/**
 * Separa las cuotas pendientes en futuras y vencidas.
 *
 * La vista `v_cash_to_be_collected` del OS las mete en el mismo saco: al
 * 26-ago-2026 daba 13.826 € cuando solo 6.272 € tenían vencimiento futuro.
 * Una cuota vencida no se puede colocar en un mes futuro — es dinero que
 * alguien tiene que ir a cobrar hoy.
 */
export function clasificaCuotas(
  cuotas: CuotaInicio[], fx: Map<string, number>, hoy: string,
): Cuotas {
  const pend = cuotas.filter((c) => c.estado === "pendiente");
  const fut = pend.filter((c) => c.fecha > hoy);
  const ven = pend.filter((c) => c.fecha <= hoy);
  const enUsd = (l: CuotaInicio[]) => l.reduce((s, c) => s + c.eur * fxDe(fx, mesDe(c.fecha)), 0);
  return {
    futuras: { usd: enUsd(fut), n: fut.length },
    vencidas: {
      usd: enUsd(ven), n: ven.length,
      masVieja: ven.length ? ven.map((c) => c.fecha).sort()[0] : null,
    },
  };
}

/* ---------------- Inteligencia ---------------- */

export type Concentracion = { pct: number; nPersonas: number; top: { nombre: string; usd: number }[] };

/** Cuánto del cobrado ponen las 5 personas que más pagaron. */
export function concentracion(pagos: PagoInicio[], r: Rango, n = 5): Concentracion {
  const por = new Map<string, number>();
  for (const p of pagos) {
    if (!enRango(p.fecha, r) || p.usd <= 0) continue;
    por.set(p.nombre, (por.get(p.nombre) ?? 0) + p.usd);
  }
  const orden = [...por.entries()].sort((a, b) => b[1] - a[1]);
  const bruto = orden.reduce((s, x) => s + x[1], 0);
  const top = orden.slice(0, n);
  return {
    pct: bruto > 0 ? top.reduce((s, x) => s + x[1], 0) / bruto : 0,
    nPersonas: orden.length,
    top: top.map(([nombre, usd]) => ({ nombre, usd })),
  };
}

export type Devoluciones = { tasa: number; devuelto: number; bruto: number };

/**
 * `bruto` son solo los pagos positivos. El KPI de cash del rango es NETO, así
 * que quien lo enseñe debe decir «bruto» o las dos cifras parecen mentirse.
 */
export function devoluciones(pagos: PagoInicio[], r: Rango): Devoluciones {
  const en = pagos.filter((p) => enRango(p.fecha, r));
  const bruto = en.filter((p) => p.usd > 0).reduce((s, p) => s + p.usd, 0);
  const devuelto = -en.filter((p) => p.usd < 0).reduce((s, p) => s + p.usd, 0);
  return { tasa: bruto > 0 ? devuelto / bruto : 0, devuelto, bruto };
}

/**
 * Programas vendidos en el rango, SIN el cohorte legacy.
 *
 * Los 76 programas con tier `OG` entraron con importe 0 y fecha 2023-01-01:
 * son artefacto de la importación de Airtable, no ventas. Promediarlos hunde
 * el ticket medio y les asigna 76 ventas a enero de 2023.
 */
export const ventasReales = (programas: ProgramaInicio[], r: Rango, hoy: string): ProgramaInicio[] =>
  // `p.fecha <= hoy`: la pantalla solo habla de pasado y presente. Sin esto,
  // un programa fechado en octubre salía en «Últimas compras» y en el ticket
  // medio bajo un pie que promete lo contrario.
  programas.filter((p) => enRango(p.fecha, r) && p.fecha <= hoy && !esLegacy(p));

/**
 * Ticket medio y cuántas ventas no lo pudieron aportar.
 *
 * Una venta sin importe NO vale cero: no entra en el promedio, pero sí se
 * cuenta como venta y se dice cuántas son, para que nadie lea un ticket
 * medio creyendo que están todas dentro.
 */
export function ticketMedio(ventas: ProgramaInicio[]): { media: number | null; sinImporte: number } {
  const con = ventas.filter((p) => p.eur != null) as (ProgramaInicio & { eur: number })[];
  return {
    // `null`, no 0: si ninguna venta del rango tiene importe, la media no
    // existe. Devolver 0 era enseñar «Ticket medio 0 €» a dos centímetros de
    // una barra que dice «sin importe» — la pantalla contradiciéndose sola.
    media: con.length ? con.reduce((s, p) => s + p.eur, 0) / con.length : null,
    sinImporte: ventas.length - con.length,
  };
}

export type FilaTier = { tier: string; eur: number; n: number };

/**
 * Reparto por tier. Lo que no cabe en `max` filas se agrupa en «otros», nunca
 * se recorta en silencio: con un `.slice()` a secas las barras sumaban 119
 * ventas mientras el KPI de al lado decía 120, y dos bloques contiguos de la
 * misma pantalla se contradecían.
 */
export function mixTiers(ventas: ProgramaInicio[], max = 8): FilaTier[] {
  const acc = new Map<string, FilaTier>();
  for (const p of ventas) {
    // Se agrupa por FAMILIA, no por tier suelto: 3000 y 3500 son el mismo
    // programa, y 1000/1500/1800/2000 también. Ver `familiaDeTier`.
    const clave = familiaDeTier(p.tier);
    const f = acc.get(clave) ?? { tier: clave, eur: 0, n: 0 };
    f.eur += p.eur ?? 0; f.n++;
    acc.set(clave, f);
  }
  const filas = [...acc.values()].sort((a, b) => b.eur - a.eur);
  if (filas.length <= max) return filas;
  const resto = filas.slice(max - 1);
  return [
    ...filas.slice(0, max - 1),
    {
      tier: `otros (${resto.length})`,
      eur: resto.reduce((s, f) => s + f.eur, 0),
      n: resto.reduce((s, f) => s + f.n, 0),
    },
  ];
}

export type FilaVentas = { ym: string; nueva: number; up: number };

export function ventasPorMes(ventas: ProgramaInicio[], r: Rango, hoy: string): FilaVentas[] {
  // Mismo corte que serieCash: el eje no se estira hacia meses que aún no han
  // ocurrido solo porque el filtro los pida.
  const tope = mesDe(r.hasta) > mesDe(hoy) ? mesDe(hoy) : mesDe(r.hasta);
  if (mesDe(r.desde) > tope) return [];
  return mesesEntre(r.desde, `${tope}-01`).map((ym) => {
    const del = ventas.filter((p) => mesDe(p.fecha) === ym);
    return {
      ym,
      nueva: del.filter((p) => p.motivo !== "upsell").length,
      up: del.filter((p) => p.motivo === "upsell").length,
    };
  });
}

/**
 * Programas que terminan dentro de los próximos `meses` meses: la cola de
 * renovación, es decir gente a la que MERECE LA PENA llamar.
 *
 * Ventana estricta (`fin > mesActual` deja fuera los que ya terminaron este
 * mes) y dos exclusiones que la fecha sola no ve:
 *  · quien ya ascendió — su programa aparece como `programaPrevioId` de otro,
 *    y contarlo era enseñarlo a la vez como upsell hecho y como cola pendiente;
 *  · quien ya no es cliente — una venta devuelta seguía figurando como
 *    oportunidad de renovación.
 */
export function porVencer(
  programas: ProgramaInicio[], personas: PersonaInicio[], hoy: string, meses = 2,
): number {
  const mes = mesDe(hoy);
  const tope = sumaMeses(mes, meses);
  const superados = new Set(programas.map((p) => p.programaPrevioId).filter(Boolean));
  const activos = new Set(personas.filter((p) => p.estado === "cliente").map((p) => p.id));
  return programas.filter((p) => {
    if (!p.meses || esLegacy(p)) return false;
    if (superados.has(p.id)) return false;
    if (!p.personaId || !activos.has(p.personaId)) return false;
    const fin = sumaMeses(mesDe(p.fecha), p.meses);
    return fin > mes && fin <= tope;
  }).length;
}

/* ---------------- Etiquetas y ejes ---------------- */

const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Etiqueta de un mes "YYYY-MM", sin construir un Date.
 *
 * monthLabel() de lib/format.ts hace `new Date(iso)` y se formatea en la zona
 * del proceso: con TZ negativa "2026-08-01" se enseña como julio. Aquí no hay
 * Date que se coma un día.
 */
export const etiquetaMes = (ym: string, largo = false): string => {
  const [a, m] = ym.split("-").map(Number);
  return largo ? `${MES_LARGO[m - 1]} ${a}` : `${MES_CORTO[m - 1]} ’${String(a).slice(2)}`;
};

/**
 * Tope y paso "redondos" para un eje. Un eje que termina en 63.295 obliga a
 * leer la cifra; uno que termina en 80k se lee de un vistazo.
 */
export function ejeBonito(max: number, entero = false): { top: number; paso: number } {
  if (!(max > 0)) return { top: entero ? 1 : 1, paso: 1 };
  const crudo = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(crudo)));
  let paso = [1, 2, 2.5, 5, 10].map((x) => x * mag).find((x) => x >= crudo) ?? mag * 10;
  // Un gráfico de recuento no puede tener marcas en 0,25: no existen cuartos
  // de venta. Se redondea el paso al entero siguiente.
  if (entero) paso = Math.max(1, Math.ceil(paso));
  return { top: Math.ceil(max / paso) * paso, paso };
}

/**
 * Etiqueta de una marca del eje del dinero. Con pasos por debajo del millar,
 * redondear a «k» producía marcas repetidas (0k, 1k, 1k, 2k) o directamente
 * falsas, así que por debajo de 1.000 se escribe la cifra entera.
 */
export const etiquetaEje = (v: number, paso: number): string => {
  if (v === 0) return "0";
  if (paso >= 1000) {
    // `Number(...)` quita el decimal cuando no aporta: 50,0k se lee peor que 50k.
    const k = Number((v / 1000).toFixed(1));
    return `${String(k).replace(".", ",")}k`;
  }
  // `useGrouping: always` a propósito: el español no separa los números de
  // cuatro cifras, y en una columna de eje "1500" junto a "15.000" descoloca.
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 0, useGrouping: "always",
  }).format(v);
};

/**
 * Fecha corta "01 ago 26" a partir de "YYYY-MM-DD", sin construir un Date.
 *
 * dateEs() de lib/format.ts hace `new Date(dia)` y formatea en la zona del
 * proceso: con TZ negativa "2026-08-01" se enseña como "31 jul". Aquí no hay
 * instante que convertir — solo texto — así que no hay día que perder.
 */
export const fechaCorta = (dia: string | null): string => {
  if (!dia) return "—";
  const [a, m, d] = dia.split("-");
  return `${d} ${MES_CORTO[Number(m) - 1]} ${a.slice(2)}`;
};

/**
 * Eje del dinero que admite valores negativos.
 *
 * Un mes puede quedar en negativo si las devoluciones superan a los cobros
 * (basta filtrar un día que solo tenga una devolución). Calculando el paso
 * solo sobre el máximo, un mes de −42 US$ contra un tope de 1 producía un
 * paso de 1 y CUARENTA Y CUATRO líneas de rejilla. El paso sale de la
 * magnitud mayor en valor absoluto, y el suelo se ajusta a ese paso.
 */
export function ejeConSuelo(valores: number[]): { top: number; suelo: number; paso: number } {
  const max = Math.max(0, ...valores);
  const min = Math.min(0, ...valores);
  // Serie entera a cero: `ejeBonito(1)` daba un paso de 0,25 y la rejilla salía
  // con dos marcas que, redondeadas a entero, se rotulaban las dos «0».
  if (max === 0 && min === 0) return { top: 1, suelo: 0, paso: 1 };
  const { paso } = ejeBonito(Math.max(max, -min, 1));
  const top = Math.ceil(max / paso) * paso;
  const suelo = -Math.ceil(-min / paso) * paso;
  // Todo a cero: se deja un escalón para que el eje no tenga altura nula.
  return top === suelo ? { top: paso, suelo: 0, paso } : { top, suelo, paso };
}

/**
 * ¿Se dibuja la etiqueta del eje X en la posición `i`?
 *
 * La regla tiene una prioridad clara: **el último mes SIEMPRE se nombra**, porque
 * es el mes en curso y es el que la pantalla existe para enseñar. Las marcas
 * regulares se saltan si chocarían con él.
 *
 * Un intento anterior condicionaba también la última y, con restos intermedios,
 * dejaba mudas las últimas columnas —incluido el mes en curso— habiendo hueco
 * de sobra. Vive aquí, y no en el componente, para poder barrer todos los casos.
 */
export const etiquetaVisible = (i: number, total: number, cada: number): boolean => {
  const ultima = total - 1;
  if (i === ultima) return true;
  if (cada <= 1) return true;
  return i % cada === 0 && ultima - i >= cada;
};

/* ---------------- Familias de programa ---------------- */

/**
 * Berni, en CAMBIOS OS (6-sep): «agrupemos 3000 y 3500 (son el mismo programa)
 * y agrupemos 2000, 1500, 1800 y 1000 (son el "mismo programa")».
 *
 * Son precios distintos del MISMO producto a lo largo del tiempo —subidas de
 * precio, promos, el tier 1800 que salió de un error del catálogo—. Contarlos
 * como cinco programas distintos parte el gráfico en barras que no significan
 * nada: lo que Berni quiere saber es qué producto vende, no a qué precio lo
 * vendió aquel mes.
 *
 * Se agrupa SOLO al pintar. En la base cada venta conserva su tier de verdad,
 * que es lo que cobra el cliente y lo que calcula la comisión.
 */
const FAMILIAS: Record<string, string> = {
  "3000": "3500",
  "1500": "2000",
  "1800": "2000",
  "1000": "2000",
};

/** El tier con el que se agrupa. Cualquiera que no esté en la tabla es él mismo. */
export function familiaDeTier(tier: string | null | undefined): string {
  const t = (tier ?? "").trim();
  if (!t) return "sin tier";
  return FAMILIAS[t] ?? t;
}

/* ---------------- Repartos: por fuente y por método de pago ---------------- */

export type FilaReparto = { clave: string; eur: number; n: number; sinDato: boolean };

/**
 * Agrupa ventas por una etiqueta y deja lo que NO tiene dato en una fila
 * aparte, SIEMPRE la última.
 *
 * Berni pidió dos veces en CAMBIOS OS los datos de "ventas por fuente" y
 * "ventas por método de pago". Al construirlo salió lo que de verdad importa:
 * medido el 11-sep, solo el **44 %** de las ventas desde agosto tiene fuente
 * atribuida (un 10 % en todo el histórico), mientras que el método de pago está
 * al **98 %**.
 *
 * Por eso el hueco se pinta y no se esconde. Un gráfico que solo enseñe las
 * atribuidas diría "Instagram es tu canal" cuando lo que los datos soportan es
 * "de la mitad de tus ventas no sabemos de dónde vienen" — que además es
 * accionable, y esconderlo convertiría la pantalla en una respuesta con más
 * confianza de la que merece.
 */
export function reparto<T>(
  items: readonly T[],
  etiquetaDe: (x: T) => string | null | undefined,
  eurDe: (x: T) => number | null | undefined,
  etiquetaSinDato = "sin atribuir",
): FilaReparto[] {
  const acc = new Map<string, FilaReparto>();
  for (const it of items) {
    const bruta = (etiquetaDe(it) ?? "").trim();
    const clave = bruta || etiquetaSinDato;
    const f = acc.get(clave) ?? { clave, eur: 0, n: 0, sinDato: !bruta };
    f.eur += eurDe(it) ?? 0;
    f.n++;
    acc.set(clave, f);
  }
  // Las conocidas por dinero; la de "sin dato" siempre al final, por mucho que
  // sea la más grande — es el hueco, no un canal más con el que comparar.
  const filas = [...acc.values()];
  const sin = filas.filter((f) => f.sinDato);
  const con = filas.filter((f) => !f.sinDato).sort((a, b) => b.eur - a.eur || b.n - a.n);
  return [...con, ...sin];
}

/** Qué parte del total NO tiene el dato. Es el número que hay que decir en voz alta. */
export function cobertura(filas: readonly FilaReparto[]): { con: number; sin: number; pct: number } {
  const sin = filas.filter((f) => f.sinDato).reduce((s, f) => s + f.n, 0);
  const total = filas.reduce((s, f) => s + f.n, 0);
  return { con: total - sin, sin, pct: total === 0 ? 0 : Math.round(((total - sin) / total) * 100) };
}
