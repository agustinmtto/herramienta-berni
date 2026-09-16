// Lógica pura de la ficha del cliente: agrupar las compras por programa,
// hacer la aritmética del dinero y decidir qué hay que hacer hoy.
//
// Sin acceso a datos ni imports "@/" — vitest no resuelve el alias. "Hoy" es
// siempre un argumento, nunca `new Date()`: así los avisos que dependen de
// días se prueban con fechas fijas.

/* ---------------- Filas de entrada ---------------- */

export type ProgramaFicha = {
  id: string;
  tier: string;
  motivo: string | null;
  fecha_inicio: string;
  meses_duracion: number | null;
  monto: number | null;
  divisa: string | null;
  programa_previo_id: string | null;
};

export type PagoFicha = {
  id: string;
  programa_id: string | null;
  cuota_id: string | null;
  tipo: string | null;
  tipo_detalle: string | null;
  monto: number;
  divisa: string | null;
  usd_recibido: number | null;
  fecha: string;
  metodo_pago: string | null;
  comprobante_path: string | null;
  devolucion_motivo: string | null;
};

export type CuotaFicha = {
  id: string;
  programa_id: string;
  numero_cuota: number | null;
  fecha_vencimiento: string;
  monto: number;
  divisa: string | null;
  estado: string;
};

export type SesionFicha = {
  id: string;
  fecha: string | null;
  coach: string | null;
  duracion_min: number | null;
  estado_asistencia: string | null;
  notas: string | null;
  numero: number | null;
};

/** Un pago es una devolución cuando su tipo lo dice. El monto viene negativo. */
export const esDevolucion = (p: PagoFicha): boolean => p.tipo === "refund";

/* ---------------- El dinero ---------------- */

export type ResumenDinero = {
  cobradoBruto: number;
  devuelto: number;
  neto: number;
  pendiente: number;
  nCobros: number;
  nDevoluciones: number;
  nCuotasPendientes: number;
};

/**
 * Las cuatro cifras de la cabecera.
 *
 * Sustituyen al trío Cobrado / Pendiente / **Total** que hay hoy, donde ese
 * "Total" es cobrado + pendiente y se lee como el valor del contrato — que no
 * lo es. La aritmética que se cuadra contra Stripe es
 * bruto → devuelto → neto, y el pendiente va aparte porque todavía no ha
 * ocurrido.
 *
 * `devuelto` sale en positivo aunque en la base sea negativo: la pantalla ya
 * dice "Devuelto" y pinta un menos delante, así que devolverlo negativo haría
 * que se restara dos veces al componerlo.
 */
export function resumenDinero(
  pagos: PagoFicha[],
  cuotas: CuotaFicha[],
): ResumenDinero {
  let cobradoBruto = 0;
  let devuelto = 0;
  let nCobros = 0;
  let nDevoluciones = 0;

  for (const p of pagos) {
    const v = Number(p.monto || 0);
    if (esDevolucion(p)) {
      devuelto += Math.abs(v);
      nDevoluciones++;
    } else {
      cobradoBruto += v;
      nCobros++;
    }
  }

  const vivas = cuotas.filter((c) => c.estado === "pendiente");
  return {
    cobradoBruto,
    devuelto,
    neto: cobradoBruto - devuelto,
    pendiente: vivas.reduce((s, c) => s + Number(c.monto || 0), 0),
    nCobros,
    nDevoluciones,
    nCuotasPendientes: vivas.length,
  };
}

/* ---------------- Las compras, agrupadas por programa ---------------- */

/** Una línea de la tabla de un programa: un cobro o una cuota que falta. */
export type LineaPrograma = {
  clave: string;
  concepto: string;
  fecha: string;
  eur: number;
  usd: number | null;
  estado: "cobrado" | "cobrada" | "pendiente" | "anulada" | "devuelto";
  comprobante: string | null;
  motivo: string | null;
  /** Días de retraso si está vencida; 0 o negativo si aún no vence. */
  retraso: number | null;
};

export type BloquePrograma = {
  programa: ProgramaFicha;
  vigente: boolean;
  /** El tier del programa del que ascendió, si vino de otro. */
  ascendioDe: string | null;
  lineas: LineaPrograma[];
  total: number;
};

const diasEntre = (a: string, b: string): number =>
  Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) -
    Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000);

/**
 * Las compras del cliente, una tarjeta por programa, el más reciente primero.
 *
 * Cada línea es un hecho con su fecha real: un cobro va con el día en que
 * entró el dinero, y una cuota solo aparece como línea propia si TODAVÍA no se
 * ha cobrado. Cuando se cobra, la línea que se ve es su pago.
 *
 * Eso arregla un defecto real de la ficha de hoy: anuncia como "próximo" un
 * cobro que ya está en la cuenta, porque la vista usa `fecha_vencimiento`
 * como día del evento aunque la cuota esté pagada.
 */
export function agruparCompras(
  programas: ProgramaFicha[],
  pagos: PagoFicha[],
  cuotas: CuotaFicha[],
  hoy: string,
): BloquePrograma[] {
  const porTier = new Map(programas.map((p) => [p.id, p.tier]));
  // El vigente es el de fecha de inicio más reciente que ya ha empezado.
  const ordenados = [...programas].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio));
  const vigenteId = ordenados.find((p) => p.fecha_inicio <= hoy)?.id ?? ordenados[0]?.id ?? null;

  // Las cuotas que ya tienen un pago no vuelven a salir como línea aparte.
  const cuotasCobradas = new Set(
    pagos.filter((p) => p.cuota_id && !esDevolucion(p)).map((p) => p.cuota_id as string),
  );
  const numeroDeCuota = new Map(cuotas.map((c) => [c.id, c.numero_cuota]));

  return ordenados.map((prog) => {
    const lineas: LineaPrograma[] = [];

    for (const p of pagos.filter((x) => x.programa_id === prog.id)) {
      const dev = esDevolucion(p);
      lineas.push({
        clave: `pago-${p.id}`,
        concepto: dev
          ? "Reembolso"
          : p.cuota_id
            ? (numeroDeCuota.get(p.cuota_id) ? `Cuota ${numeroDeCuota.get(p.cuota_id)}` : "Cuota")
            : (p.tipo_detalle || "Cobro"),
        fecha: p.fecha,
        eur: Number(p.monto || 0),
        usd: p.usd_recibido == null ? null : Number(p.usd_recibido),
        estado: dev ? "devuelto" : p.cuota_id ? "cobrada" : "cobrado",
        comprobante: p.comprobante_path,
        motivo: p.devolucion_motivo,
        retraso: null,
      });
    }

    for (const c of cuotas.filter((x) => x.programa_id === prog.id)) {
      if (cuotasCobradas.has(c.id)) continue;
      if (c.estado === "pagada") continue;
      lineas.push({
        clave: `cuota-${c.id}`,
        concepto: c.numero_cuota ? `Cuota ${c.numero_cuota}` : "Cuota",
        fecha: c.fecha_vencimiento,
        eur: Number(c.monto || 0),
        usd: null,
        estado: c.estado === "anulada" ? "anulada" : "pendiente",
        comprobante: null,
        motivo: null,
        retraso: c.estado === "pendiente" ? diasEntre(hoy, c.fecha_vencimiento) : null,
      });
    }

    lineas.sort((a, b) => a.fecha.localeCompare(b.fecha));

    return {
      programa: prog,
      vigente: prog.id === vigenteId,
      ascendioDe: prog.programa_previo_id ? (porTier.get(prog.programa_previo_id) ?? null) : null,
      lineas,
      // Solo lo que de verdad entró: las cuotas por cobrar no son dinero
      // cobrado y un total que las incluyera repetiría el error de "Total".
      total: lineas
        .filter((l) => l.estado === "cobrado" || l.estado === "cobrada" || l.estado === "devuelto")
        .reduce((s, l) => s + l.eur, 0),
    };
  });
}

/* ---------------- El cupo de sesiones ---------------- */

export type Cupo = { incluidas: number | null; hechas: number; pendientes: number | null };

/**
 * Cuántas consultorías se han usado. `incluidas` puede ser null —hay tiers sin
 * cupo definido— y entonces la pantalla enseña las hechas sin inventar un
 * denominador.
 */
export function cupoDe(sesiones: SesionFicha[], incluidas: number | null): Cupo {
  const hechas = sesiones.filter((s) => s.estado_asistencia === "asistio").length;
  return {
    incluidas,
    hechas,
    pendientes: incluidas == null ? null : Math.max(incluidas - hechas, 0),
  };
}

/* ---------------- Lo que hay que hacer hoy ---------------- */

export type Aviso = {
  clave: string;
  tono: "atencion" | "dato";
  texto: string;
  accion: string;
  href?: string;
};

/**
 * Como mucho tres avisos, y solo los que son ciertos.
 *
 * Tres y no todos los posibles: una lista larga de avisos deja de leerse. Se
 * ordenan por lo que cuesta dinero antes que por lo que falta de rellenar, y
 * quien llama NO pinta el bloque si esto vuelve vacío — un "nada pendiente"
 * en gris enseña al ojo a saltarse la zona donde luego aparecerá algo urgente.
 */
export function avisosDe(
  {
    cuotas, sesiones, cupo, programa, estrategias, telefono,
  }: {
    cuotas: CuotaFicha[];
    sesiones: SesionFicha[];
    cupo: Cupo;
    programa: ProgramaFicha | null;
    estrategias: number;
    telefono: string | null;
  },
  hoy: string,
): Aviso[] {
  const out: Aviso[] = [];

  // 1. Dinero vencido o a punto de vencer. Lo primero siempre.
  const vivas = cuotas
    .filter((c) => c.estado === "pendiente")
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
  const proxima = vivas[0];
  if (proxima) {
    const dias = diasEntre(hoy, proxima.fecha_vencimiento);
    if (dias > 0) {
      out.push({
        clave: "cuota-vencida",
        tono: "atencion",
        texto: `La cuota ${proxima.numero_cuota ?? ""} lleva ${dias} ${dias === 1 ? "día" : "días"} vencida.`.replace("  ", " "),
        accion: "Cobrar",
        href: "/cuotas",
      });
    } else if (dias >= -14) {
      const faltan = Math.abs(dias);
      out.push({
        clave: "cuota-proxima",
        tono: "atencion",
        texto: faltan === 0
          ? `La cuota ${proxima.numero_cuota ?? ""} vence hoy.`.replace("  ", " ")
          : `La cuota ${proxima.numero_cuota ?? ""} vence en ${faltan} ${faltan === 1 ? "día" : "días"}.`.replace("  ", " "),
        accion: "Cobrar",
        href: "/cuotas",
      });
    }
  }

  // 2. Sesiones sin registrar: son las que mantienen encendido el contador
  //    del menú y las que hacen que el cupo mienta.
  const sinRegistrar = sesiones.filter(
    (s) => s.fecha && s.fecha <= hoy && !s.estado_asistencia,
  ).length;
  if (sinRegistrar > 0) {
    out.push({
      clave: "sesiones-sin-registrar",
      tono: "atencion",
      texto: `${sinRegistrar} ${sinRegistrar === 1 ? "sesión ya pasada sin registrar" : "sesiones ya pasadas sin registrar"}.`,
      accion: "Registrar",
    });
  }

  // 3. Cupo por consumir con el programa terminándose: es la conversación de
  //    renovación, y llega tarde si se ve el último mes.
  if (programa?.meses_duracion && cupo.pendientes != null && cupo.pendientes > 0) {
    const fin = sumaMeses(programa.fecha_inicio, programa.meses_duracion);
    const diasRestantes = -diasEntre(hoy, fin);
    if (diasRestantes > 0 && diasRestantes <= 60) {
      const sem = Math.max(Math.round(diasRestantes / 7), 1);
      out.push({
        clave: "cupo-sin-usar",
        tono: "atencion",
        texto: `Le ${cupo.pendientes === 1 ? "queda 1 consultoría" : `quedan ${cupo.pendientes} consultorías`} y el programa termina en ${sem} ${sem === 1 ? "semana" : "semanas"}.`,
        accion: "Agendar",
      });
    }
  }

  // 4. Faltan datos. Detrás de lo que cuesta dinero.
  if (!telefono) {
    out.push({
      clave: "sin-telefono",
      tono: "dato",
      texto: "No tiene teléfono: no se le puede escribir por WhatsApp.",
      accion: "Añadir",
    });
  }
  if (estrategias === 0) {
    out.push({
      clave: "sin-estrategia",
      tono: "dato",
      texto: "No tiene ninguna estrategia publicada.",
      accion: "Publicar",
      href: "/estrategias",
    });
  }

  return out.slice(0, 3);
}

/** Suma meses a una fecha sin Date: el día se conserva y cae al último si no existe. */
export function sumaMeses(fecha: string, meses: number): string {
  const a = Number(fecha.slice(0, 4));
  const m = Number(fecha.slice(5, 7));
  const d = Number(fecha.slice(8, 10));
  const total = (a * 12 + (m - 1)) + meses;
  const na = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(na, nm, 0)).getUTCDate();
  return `${na}-${String(nm).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}
