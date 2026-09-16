// Reglas de comisión de MetaCrypto Club. Lógica pura: sin red ni base, para
// poder probarla. Las reglas las confirmó Berni el 11-ago-2026 y están
// explicadas en docs/comisiones.md.
//
// BASE ÚNICA: el cash cobrado EN DÓLARES. Los tres porcentajes se aplican
// sobre el PAGO, nunca sobre el valor de la venta — "tanto primer pago como
// segundas cuotas". Una venta a tres cuotas genera comisión tres veces.
//
// DÓLARES Y NO EUROS (Berni, 14-ago-2026): "en comisiones, se calculan
// siempre sobre el cash collected en $, nunca sobre el numero redondo de
// facturación en euros". La base es `usd_recibido` — lo que de verdad entró
// en la cuenta — y no una conversión del importe firmado en euros. La
// diferencia entre ambos ronda el 7 %, que sobre las comisiones de un mes es
// dinero real. Ver docs/comisiones.md y la migración 0040.
//
// QUIÉN COBRA depende del motivo del programa, y son dos repartos distintos:
//   compra nueva → closer 10% + setter 5%
//   ascensión / renovación → SOLO coach 10%
// Lo que aquí NO se calcula: el 18% de equity de Alex sobre el net profit
// del mes (es P&L, no comisión por pago) y su desdoble de setting, que
// Berni lleva fuera del sistema. Ver docs/comisiones.md.

export const TASA_SETTER = 0.05;
export const TASA_CLOSER = 0.1;
export const TASA_COACH = 0.1;

export type RolComision = "setter" | "closer" | "coach";

// Color y etiqueta por rol para el desglose de comisiones (Berni, CO-2). El
// valor "coach" sigue siendo el de la base — acá solo se traduce cómo se ve.
const ETIQUETA_ROL: Record<RolComision, string> = {
  setter: "Setter", closer: "Closer", coach: "Consultor",
};
const COLOR_ROL: Record<RolComision, string> = {
  setter: "blue", closer: "gold", coach: "purple",
};
export const etiquetaRol = (rol: RolComision): string => ETIQUETA_ROL[rol] ?? rol;
export const colorRol = (rol: RolComision): string => COLOR_ROL[rol] ?? "";

export type MotivoIncidencia =
  | "sin_programa"
  | "sin_usd"
  | "sin_atribuir"
  | "fuente_sin_confirmar"
  | "ascension_sin_autor"
  | "sin_closer"
  | "motivo_no_reconocido";

// Unión literal, no `string`. El caso que motivó esto: `tipo_venta='extension'`
// genera `motivo='renovacion'`, y con `motivo: string` el compilador no vio
// nada raro en que esa rama cayera en la de "compra nueva" (setter 5% +
// closer 10%) cuando debía tratarse como ascensión. Con la unión, el
// `switch` de abajo es exhaustivo: un motivo nuevo que alguien añada al
// esquema sin enseñarle aquí su regla de comisión deja de compilar, no paga
// mal en silencio.
export type MotivoPago = "nueva_venta" | "upsell" | "renovacion";

export type PagoAtribuido = {
  pago_id: string;
  monto: number; // EUR firmado — contexto, NO la base de la comisión
  // La base real. `null` = el pago se registró sin el dato; no se comisiona
  // (incidencia `sin_usd`) en vez de caer a los euros, que pagaría un importe
  // silenciosamente equivocado. Ver el guard en comisionesDePago.
  usd_recibido: number | null;
  motivo: MotivoPago | null;
  programa_id: string | null;
  setter_id: string | null;
  closer_id: string | null;
  upsell_por_id: string | null;
  atribuido: boolean;
  fuente_confirmada: boolean;
};

export type LineaComision = {
  pago_id: string;
  rol: RolComision;
  team_member_id: string;
  base: number;
  tasa: number;
  importe: number;
};

export type Incidencia = { pago_id: string; motivo: MotivoIncidencia };

// Quién NO devenga comisión, por persona. Sale de `team_members.cobra_comision`
// (migración 0038).
//
// No se deduce del rol y no se puede: Berni y Manuel son los dos `coach` y solo
// Manuel cobra. Berni es el dueño; Milo no interviene; Paula cobra un fijo
// mensual, no un 5 %.
//
// El argumento es OBLIGATORIO a propósito — sin valor por defecto. Un
// `noCobran` opcional que por defecto sea el conjunto vacío significa que
// cualquier llamada que se olvide de pasarlo le paga a Berni en silencio, que
// es exactamente el error que esto viene a arreglar. Así el compilador obliga
// a cada sitio a decir explícitamente quién no cobra.
export type QuienCobra = { noCobran: ReadonlySet<string> };

// Céntimos, no flotantes: 0.1 * 0.05 en coma flotante da 0.005000000000000001.
function importe(base: number, tasa: number): number {
  return Math.round(base * tasa * 100) / 100;
}

export function comisionesDePago(
  p: PagoAtribuido,
  quienCobra: QuienCobra,
): {
  lineas: LineaComision[];
  incidencias: Incidencia[];
} {
  // Se marca UN solo motivo, el más de fondo. Encadenarlos convertiría el
  // informe en una lista de síntomas del mismo problema.
  if (!p.programa_id) return { lineas: [], incidencias: [{ pago_id: p.pago_id, motivo: "sin_programa" }] };

  // Sin base no hay comisión para NADIE, así que va por delante de las
  // preguntas de "a quién": saber a quién pagarle no sirve de nada si no se
  // sabe cuánto. Y por delante también de la atribución porque se arregla en
  // otro sitio (el registro del pago, no la bandeja).
  //
  // El `< 0` no es defensivo de más: la vista `v_pagos_atribuidos` filtra los
  // reembolsos (0034) justo porque un importe negativo genera una comisión
  // negativa que resta del informe sin avisar. Si alguno se colara por otra
  // vía, aquí se marca en vez de restar.
  if (p.usd_recibido == null || p.usd_recibido < 0) {
    return { lineas: [], incidencias: [{ pago_id: p.pago_id, motivo: "sin_usd" }] };
  }
  const base = p.usd_recibido;

  if (!p.atribuido) return { lineas: [], incidencias: [{ pago_id: p.pago_id, motivo: "sin_atribuir" }] };
  if (!p.fuente_confirmada)
    return { lineas: [], incidencias: [{ pago_id: p.pago_id, motivo: "fuente_sin_confirmar" }] };

  const lineas: LineaComision[] = [];
  const incidencias: Incidencia[] = [];

  // Quien no cobra comisión genera línea igual, con tasa 0 e importe 0, en vez
  // de no generar nada.
  //
  // Decisión de Milo, 12-ago-2026. El total a pagar sale igual de las dos
  // formas, pero la línea ausente pierde información: `actividadPorRol` se
  // construye desde las líneas, así que borrarla borraría también que Berni
  // cerró esa venta — y la actividad comercial sí interesa. Un cero visible se
  // lee como una decisión; una línea que falta no se distingue de un fallo.
  const linea = (
    rol: RolComision,
    team_member_id: string,
    tasaDelRol: number,
  ): LineaComision => {
    const tasa = quienCobra.noCobran.has(team_member_id) ? 0 : tasaDelRol;
    // `base` es el USD cobrado, no `p.monto` (que son los euros firmados).
    return {
      pago_id: p.pago_id, rol, team_member_id,
      base, tasa, importe: importe(base, tasa),
    };
  };

  // `switch` exhaustivo en vez de `esAscension = p.motivo === "upsell"`: esa
  // forma dejaba "renovacion" caer por defecto en la rama de compra nueva
  // (setter 5% + closer 10%) — la misma situación económica que una
  // ascensión (cliente existente, lo genera el servicio) pagando distinto
  // solo porque nadie la nombró en el `if`.
  //
  // El motivo decide TODO el reparto, incluido si el closer cobra. Hasta el
  // 12-ago el closer cobraba su 10% en cualquier pago, fuera del `switch`;
  // el audio de Berni de ese día lo desmintió (ver el comentario de la rama
  // de ascensión). Cada rama arma ahora su reparto completo.
  switch (p.motivo) {
    case "upsell":
    case "renovacion":
      // La ascensión la cobra el coach y NADIE MÁS. Berni, 12-ago-2026:
      // "el que se beneficie del upsell sería 10% de comisión de upsell
      // para él [Manuel] (...) Alex no se lleva un 10% del upsell por esa
      // venta, pero sí que se llevaría el 18% al final del mes".
      //
      // Ni setter ni closer, y por eso tampoco se marca `sin_closer`: en una
      // ascensión da igual quién cerró, no cobra. Sigue valiendo aunque Alex
      // entre en la llamada a ayudar — el responsable es el coach.
      //
      // El setter tampoco: cobró cuando trajo al cliente; esto lo genera el
      // servicio. Confirmado por Milo el 12-ago para la renovación, que paga
      // exactamente igual que la ascensión.
      if (p.upsell_por_id) {
        lineas.push(linea("coach", p.upsell_por_id, TASA_COACH));
      } else {
        // Es un caso real, no solo un dato incompleto: "en el pasado hemos
        // hecho las extensiones nosotros sin contar con Manuel y no se las
        // hemos dado porque él no ha intervenido". Sin autor no se paga a
        // nadie — pero se marca, para que sea una decisión y no un olvido.
        incidencias.push({ pago_id: p.pago_id, motivo: "ascension_sin_autor" });
      }
      break;
    case "nueva_venta":
      // El closer cobra siempre que se sepa quién es. Una fuente sin setter
      // (AutoSetter, orgánico) es legítima y no impide pagarle al closer.
      if (p.closer_id) {
        lineas.push(linea("closer", p.closer_id, TASA_CLOSER));
      } else {
        // Incidencia acumulativa: se marca pero el cálculo continúa, para
        // que el setter siga cobrando su parte.
        incidencias.push({ pago_id: p.pago_id, motivo: "sin_closer" });
      }
      if (p.setter_id) {
        lineas.push(linea("setter", p.setter_id, TASA_SETTER));
      }
      break;
    case null:
      // No debería pasar: si `programa_id` existe (ya se comprobó arriba),
      // `programas.motivo` es NOT NULL en el esquema. Si aun así llega null
      // (dato roto), no se paga nada: sin motivo no se sabe si el closer
      // cobra o no, así que inventar una línea sería peor que no pagar.
      incidencias.push({ pago_id: p.pago_id, motivo: "motivo_no_reconocido" });
      break;
    default: {
      // Exhaustividad real: si `MotivoPago` gana un valor nuevo (p.ej. la
      // base ya admite 'downsell'/'reactivacion'/'cross_sell') y nadie le
      // enseña su regla aquí, esto deja de compilar en vez de colarlo por
      // la rama equivocada — que es exactamente como se coló "renovacion".
      const _exhaustivo: never = p.motivo;
      throw new Error(`comisionesDePago: motivo sin regla de comisión: ${_exhaustivo}`);
    }
  }

  return { lineas, incidencias };
}

/* ---------------- Corte temporal de la bandeja de atribución ---------------- */
// Decisión de Milo, 11-ago-2026 (ver "Corte temporal" en
// docs/superpowers/specs/2026-08-11-comisiones-atribucion-design.md): las
// comisiones de antes de agosto ya se pagaron como se pagaron y NO se
// recalculan. Esto NO es una fecha técnica ni un límite de rendimiento — es
// una decisión del dueño del negocio sobre qué parte del histórico se
// vuelve a mirar.
export const ATRIBUCION_CORTE = "2026-08-01";

// ¿Esta venta entra en el cierre de comisiones (la bandeja de /atribucion)?
// Lógica pura: sin este corte, la bandeja jamás se vaciaría — quedaría
// enterrada bajo el backlog histórico ya liquidado que nadie va a (ni debe)
// tocar, y la promesa de la pantalla ("vacía = informe completo") sería
// mentira desde el primer día.
//
// Una venta anterior al corte SÍ entra si todavía tiene una cuota pendiente:
// la comisión se devenga por pago, no por venta (ver comisionesDePago más
// arriba), así que ese cobro futuro sí necesita saber a quién atribuirse
// aunque la venta en sí sea de antes de agosto.
export function entraEnCierre(v: { fecha_inicio: string; tieneCuotaPendiente: boolean }): boolean {
  return v.fecha_inicio >= ATRIBUCION_CORTE || v.tieneCuotaPendiente;
}

export function agruparPorPersona(
  lineas: LineaComision[],
): { team_member_id: string; total: number; n: number }[] {
  const m = new Map<string, { total: number; n: number }>();
  for (const l of lineas) {
    const a = m.get(l.team_member_id) ?? { total: 0, n: 0 };
    // Se suma en céntimos y se divide al final: sumar euros con decimales
    // arrastra el error de coma flotante hasta el total que se paga.
    a.total = Math.round(a.total * 100 + l.importe * 100) / 100;
    a.n += 1;
    m.set(l.team_member_id, a);
  }
  return [...m.entries()].map(([team_member_id, v]) => ({ team_member_id, ...v }));
}

export type ActividadRol = {
  team_member_id: string;
  rol: RolComision;
  ventas: number; // pagos distintos en los que participó
  cash: number; // base total sobre la que cobró
  ticket: number; // cash / ventas
};

// La otra cara del informe: qué hizo cada uno, no solo cuánto cobra. Sale de
// las mismas líneas — el `cash` de un rol es la suma de las bases sobre las
// que cobró, que es exactamente el cash que ese rol movió.
export function actividadPorRol(lineas: LineaComision[]): ActividadRol[] {
  const m = new Map<string, ActividadRol>();
  for (const l of lineas) {
    const k = `${l.team_member_id}|${l.rol}`;
    const a = m.get(k) ?? {
      team_member_id: l.team_member_id, rol: l.rol, ventas: 0, cash: 0, ticket: 0,
    };
    a.ventas += 1;
    a.cash = Math.round(a.cash * 100 + l.base * 100) / 100;
    m.set(k, a);
  }
  for (const a of m.values()) {
    a.ticket = a.ventas ? Math.round((a.cash / a.ventas) * 100) / 100 : 0;
  }
  return [...m.values()];
}

// ---- Reversión de comisión por devolución (spec 2026-08-21) ----
//
// Berni, 21-ago-2026: "Las comisiones simplemente desaparecen" y, sobre una
// venta comisionada en julio que se devuelve hoy, "se resta en este". Criterio
// de CAJA: la reversión pertenece al mes en que salió el dinero, no al mes en
// que entró. Un mes cerrado no se reescribe nunca.
//
// NO recalcula el reparto: llama a `comisionesDePago` sobre el pago ORIGINAL y
// le da la vuelta al signo. Así lo que se quita es por construcción lo que se
// dio — si mañana cambia una tasa, la reversión cambia con ella. Un cálculo
// paralelo se desincronizaría en silencio y el fallo aparecería meses después
// en la nómina de alguien.
export type MotivoSinAjuste =
  | "venta_anterior_al_corte"
  | "sin_atribuir"
  | "fuente_sin_confirmar"
  | "sin_usd"
  | "sin_programa"
  | "sin_autor";

function sinAjusteDesde(
  motivo: MotivoIncidencia | undefined,
  ventaFechaInicio: string | undefined,
): MotivoSinAjuste {
  // Una venta anterior al corte no está "sin atribuir": su comisión se liquidó
  // fuera del OS (ver ATRIBUCION_CORTE). Mandar a alguien a atribuirla sería
  // mandarlo a arreglar algo que no está roto — por eso tiene motivo propio, y
  // por eso la pantalla lo enseña como un cero explicado y no como incidencia.
  if (motivo === "sin_atribuir" && ventaFechaInicio && ventaFechaInicio < ATRIBUCION_CORTE) {
    return "venta_anterior_al_corte";
  }
  switch (motivo) {
    case "sin_programa": return "sin_programa";
    case "sin_usd": return "sin_usd";
    case "fuente_sin_confirmar": return "fuente_sin_confirmar";
    case "ascension_sin_autor":
    case "sin_closer": return "sin_autor";
    default: return "sin_atribuir";
  }
}

export function ajusteDeDevolucion(
  pagoOriginal: PagoAtribuido,
  usdDevuelto: number,
  quienCobra: QuienCobra,
  ventaFechaInicio?: string,
): { lineas: LineaComision[]; sinAjuste?: MotivoSinAjuste } {
  const base = pagoOriginal.usd_recibido;
  if (base == null || base <= 0) return { lineas: [], sinAjuste: "sin_usd" };

  // El importe llega negativo desde la base y positivo desde un formulario. Se
  // normaliza aquí en vez de exigir un signo: dos convenciones que se
  // encuentran en el mismo argumento son un error esperando a pasar.
  const devuelto = Math.abs(usdDevuelto);
  if (devuelto === 0) return { lineas: [] };

  // Tope al 100 %: la RPC ya impide devolver de más, pero si alguna vez se
  // colara, revertir el 500 % de una comisión es peor que revertirla entera.
  const factor = Math.min(devuelto / base, 1);

  const { lineas, incidencias } = comisionesDePago(pagoOriginal, quienCobra);
  if (lineas.length === 0) {
    return { lineas: [], sinAjuste: sinAjusteDesde(incidencias[0]?.motivo, ventaFechaInicio) };
  }

  return {
    lineas: lineas.map((l) => {
      const imp = Math.round(l.importe * factor * 100) / 100;
      return {
        ...l,
        base: Math.round(l.base * factor * 100) / 100,
        // `-0` se compara igual que `0` pero se imprime "-0" en pantalla, que
        // en un informe de nóminas parece un error. Se normaliza.
        importe: imp === 0 ? 0 : -imp,
      };
    }),
  };
}
