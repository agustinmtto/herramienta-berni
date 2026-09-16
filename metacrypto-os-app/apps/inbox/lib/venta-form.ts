// ============================================================
// Máquina de estado del formulario "Nueva venta" (VentaForm.tsx).
//
// Vive aquí, fuera del componente y sin una sola dependencia de React,
// por un motivo muy concreto: por ese formulario entran TODAS las ventas
// del negocio, y de lo que sale de él salen las comisiones. El repo no
// tiene jsdom ni @testing-library, así que un componente no se puede
// testear; una función pura sí. Todo lo que decide QUÉ se guarda está en
// este fichero para que la suite normal (`npx vitest run`) lo cubra.
//
// Regla de este módulo: NADA de imports "@/" en runtime (vitest no
// resuelve el alias). Solo relativos, y `import type` para los tipos.
// ============================================================
import { generarCuotas, telefonoE164, type CuotaDraft } from "./venta";
import { paisPorIso } from "./paises";
import {
  bonoLibreDe,
  bonosAplicables,
  mesesConBono,
  podarBonos,
  MAX_BONO_LIBRE,
  PREFIJO_BONO_LIBRE,
  type ClaveBono,
} from "./bonos";

export type Tipo = "nueva" | "ascension" | "extension";

/** Lo que /api/ventas/contexto devuelve del cliente ya existente. */
export type Contexto = {
  programas: { id: string; tier: string; motivo: string; fecha_inicio: string; monto: number | null }[];
  total_pagado: number;
  cuotas_pendientes: { monto: number; fecha_vencimiento: string }[];
};

// Misma forma que `AtribucionElegida` de components/SelectorAgenda.tsx. Se
// redeclara aquí (en vez de importarla) para que este módulo no dependa de
// nada que vitest no pueda resolver; TypeScript las casa estructuralmente.
export type Atribucion = {
  sourceId: string | null;
  setterId: string | null;
  closerId: string | null;
  ghlAppointmentId: string | null;
};

/** Lo mínimo que este módulo necesita de un tier (ver TierOption en lib/data.ts). */
export type TierMin = { id: string; meses_default: number | null };

/**
 * El desplegable de tiers, ordenado POR PRECIO y no por el texto del id.
 *
 * `tiers.id` es `text`, y ordenar texto pone el 10.000 € justo detrás del
 * 1.000 €: "1.000 · 10.000 · 1.500 · 2.000 · 2.500 · 3.500 · 5.000". En una
 * lista donde todo lo demás va de menos a más, el producto más caro del
 * catálogo pegado al más barato es un clic equivocado esperando a pasar — y
 * el formulario donde pasa es por el que entran TODAS las ventas.
 *
 * Se ordena aquí y no en el `order=` de PostgREST porque ese parámetro solo
 * admite nombres de columna: no hay forma de escribir `id::int` en él. Con
 * siete filas, ordenar en memoria no tiene coste medible.
 *
 * `OG` (el único id no numérico) ya viene excluido por `id=neq.OG` en
 * `getTiersVendibles`, pero el orden no se apoya en eso: cualquier id que no
 * sea un número se va al final, alfabético entre ellos, en vez de convertirse
 * en un `NaN` que deja el `sort` en manos del motor.
 */
export function ordenarTiersPorPrecio<T extends { id: string }>(tiers: T[]): T[] {
  return [...tiers].sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    const aEsNumero = Number.isFinite(na);
    const bEsNumero = Number.isFinite(nb);
    if (aEsNumero && bEsNumero) return na - nb;
    if (aEsNumero) return -1;
    if (bEsNumero) return 1;
    return a.id.localeCompare(b.id);
  });
}

/** Lo mínimo que necesita de un cliente (ver ClienteOption en lib/data.ts). */
export type ClienteMin = {
  nombre: string | null;
  email: string | null;
  telefono_e164: string | null;
};

// `tipo` no es un campo del formulario: es un discriminante. Quien compra
// tiene dos formas MUTUAMENTE EXCLUYENTES y `tipo` decide cuál viaja al
// servidor. Tenerlas en dos grupos separados es lo que hace imposible que
// los datos de un cliente nuevo se cuelen en una ascensión y al revés.
export type CompradorNuevo = { nombre: string; email: string; iso: string; telefono: string };
export type CompradorExistente = {
  personaId: string;
  busqueda: string;
  ctx: Contexto | null;
  programaPrevio: string;
};

export type EstadoVenta = {
  tipo: Tipo;
  nueva: CompradorNuevo;
  existente: CompradorExistente;
  programa: { tier: string; valorTotal: number; meses: number; fechaInicio: string };
  cobro: {
    pagoMonto: number;
    pagoFecha: string;
    metodo: string;
    // STRING, nunca number: "" significa «no aplica» y el servidor lo
    // distingue de "0". Con estado numérico, Number("") === 0 convertiría
    // «sin dato» en un 0 real, y "10.50" en "10.5". Ver camposDeVenta.
    usdRecibido: string;
    nCuotas: number;
    cuotas: CuotaDraft[];
  };
  comision: { atribucion: Atribucion | null; upsellPor: string };
  // Bonos del evento 26/08. Viven en la raíz y no dentro de `programa` porque
  // se guardan en la venta pero su efecto se reparte: la duración toca
  // `programa.meses`, el cupo de consultorías lo calcula la base.
  bonos: ClaveBono[];
  // Un bono que no está en el catálogo, tecleado por el closer. Solo se
  // imprime en el contrato: no mueve duración ni cupo, por eso es un string
  // suelto y no una clave más de `bonos`.
  bonoLibre: string;
};

export const NUEVO_VACIO: CompradorNuevo = { nombre: "", email: "", iso: "ES", telefono: "" };
export const EXISTENTE_VACIO: CompradorExistente = {
  personaId: "", busqueda: "", ctx: null, programaPrevio: "",
};
// `null` en `atribucion` = "sin decidir todavía". No bloquea el envío nunca.
export const COMISION_VACIA: EstadoVenta["comision"] = { atribucion: null, upsellPor: "" };

/** Los cuatro métodos de pago del <select>. El primero es el valor por defecto. */
export const METODOS = ["Stripe", "Crypto", "Transferencia", "Whop"];

// Fecha LOCAL en ISO. `toISOString()` da UTC: en España (UTC+2) a las 00:30
// devolvía el día anterior y la venta se registraba con fecha equivocada.
// `hoyDe` existe aparte de `hoy` solo para poder probar eso sin tocar la TZ
// del runner de tests.
export function hoyDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const hoy = () => hoyDe(new Date());

/**
 * Estado de arranque. Los defaults son contrato, no gusto: `iso:"ES"`,
 * el tier es el primero de la lista y su id ES el precio en euros, y
 * ambas fechas nacen en la fecha local de HOY, congeladas en el montaje
 * (no se re-sincronizan ni a medianoche — igual que antes del refactor,
 * cuando eran `defaultValue={hoy()}` y `useState(hoy())`).
 */
export function estadoInicial(tiers: TierMin[], fecha: string = hoy()): EstadoVenta {
  const t0 = tiers[0];
  return {
    tipo: "nueva",
    nueva: { ...NUEVO_VACIO },
    existente: { ...EXISTENTE_VACIO },
    programa: {
      tier: t0?.id ?? "",
      valorTotal: Number(t0?.id) || 0,
      meses: t0?.meses_default ?? 6,
      fechaInicio: fecha,
    },
    cobro: {
      pagoMonto: 0,
      pagoFecha: fecha,
      metodo: METODOS[0],
      usdRecibido: "",
      nCuotas: 0,
      cuotas: [],
    },
    comision: { ...COMISION_VACIA },
    bonos: [],
    bonoLibre: "",
  };
}

/* ---------------- Valores derivados ---------------- */

/** Candidatos del buscador: mínimo 2 caracteres, solo por nombre, top 8. */
export function candidatosDe<T extends { nombre: string | null }>(clientes: T[], busqueda: string): T[] {
  const q = busqueda.trim().toLowerCase();
  if (q.length < 2) return [];
  return clientes.filter((c) => (c.nombre ?? "").toLowerCase().includes(q)).slice(0, 8);
}

/**
 * Aviso NO bloqueante: el cliente ya podría existir (por nombre, email o
 * teléfono). El teléfono es la señal fuerte y va PRIMERO — es UNIQUE en la
 * base y el RPC reutiliza esa persona en vez de crear una nueva.
 */
export function duplicadoDe<T extends ClienteMin>(
  clientes: T[],
  c: CompradorNuevo,
): { cliente: T; porTelefono: boolean } | null {
  const n = c.nombre.trim().toLowerCase();
  const e = c.email.trim().toLowerCase();
  const tel = telefonoE164(paisPorIso(c.iso)?.prefijo ?? "", c.telefono);
  const porTel = tel ? clientes.find((x) => x.telefono_e164 === tel) : undefined;
  if (porTel) return { cliente: porTel, porTelefono: true };
  const otro = clientes.find(
    (x) => (n && (x.nombre ?? "").toLowerCase() === n) || (e && (x.email ?? "").toLowerCase() === e),
  );
  return otro ? { cliente: otro, porTelefono: false } : null;
}

/**
 * Las tres llaves con las que SelectorAgenda busca las citas en GHL.
 *
 * La normalización a `null` es load-bearing: el selector elige llave con
 * `||`, no con `??`, pero aun así una `personaId=""` que llegara como ""
 * (y no null) ya ocultó el selector una vez. Se normaliza aquí, en un solo
 * sitio, en vez de a mano en el JSX.
 */
export function llaveSelector(e: EstadoVenta): {
  personaId: string | null; email: string | null; telefono: string | null;
} {
  if (e.tipo !== "nueva") {
    return { personaId: e.existente.personaId || null, email: null, telefono: null };
  }
  // En compra nueva el cliente todavía no existe en `personas`: se busca su
  // contacto de GHL por el email/teléfono que se están tecleando.
  return {
    personaId: null,
    email: e.nueva.email.trim() || null,
    telefono: telefonoE164(paisPorIso(e.nueva.iso)?.prefijo ?? "", e.nueva.telefono),
  };
}

/**
 * El plan de cobro: hoy + cuotas vs. el valor total del programa.
 * El epsilon de 0.01 es deliberado: `generarCuotas` redondea a céntimos en
 * la última cuota, así que una diferencia de un céntimo NO es un descuadre.
 * Descuadrar avisa pero NO bloquea: hay tratos raros que hay que poder guardar.
 */
export function planDeCobro(e: EstadoVenta): {
  sumaCuotas: number; totalPlan: number; descuadre: boolean;
} {
  const sumaCuotas = e.cobro.cuotas.reduce((s, c) => s + (Number(c.monto) || 0), 0);
  const totalPlan = e.cobro.pagoMonto + sumaCuotas;
  return { sumaCuotas, totalPlan, descuadre: Math.abs(totalPlan - e.programa.valorTotal) > 0.01 };
}

/**
 * Por qué todavía no se puede guardar. Es a la vez el mensaje y el gate
 * (`disabled={saving || motivoBloqueo !== null}`): extraído a una sola
 * función ya no se pueden separar y volver a divergir. Antes, en una
 * ascensión sin cliente elegido, el botón estaba muerto y no aparecía
 * ningún mensaje: no hay forma de distinguir eso de un formulario roto.
 */
export function motivoBloqueo(e: EstadoVenta): string | null {
  if (e.tipo === "nueva") return null;
  if (!e.existente.personaId) return "Elige el cliente en la lista de sugerencias";
  if (!e.existente.ctx) return "Cargando los programas de ese cliente…";
  if (!e.existente.programaPrevio) {
    return e.tipo === "ascension" ? "Elige desde qué programa asciende" : "Elige qué programa se extiende";
  }
  return null;
}

/* ---------------- El cable ---------------- */

// Cómo serializa un <input type="number"> con `value={x || ""}`: si el
// número es 0 (o NaN) el input se pinta VACÍO y viaja "". Replicarlo aquí
// al carácter es lo único que garantiza que el servidor reciba lo mismo
// que recibía cuando el valor lo ponía el DOM.
const num = (n: number): string => (Number.isFinite(n) && n !== 0 ? String(n) : "");

/**
 * Los campos que VentaForm mete en el FormData de `crearVenta`.
 *
 * ESTE ES EL CONTRATO. El servidor (`app/actions.ts` → crearVenta) lee cada
 * clave con `String(formData.get(k) ?? "").trim()`, así que aquí todo son
 * STRINGS — incluido `atribuido`, que es "true"/"false" literales: un
 * booleano real haría que `s("atribuido") === "true"` fuese siempre falso y
 * TODAS las ventas volverían a la bandeja de /atribucion.
 *
 * El orden de las claves también se respeta: las que ya existen en el DOM
 * van primero (fd.set las sobreescribe en su sitio) y las que solo existían
 * como fd.set van después, en el mismo orden en que se ponían antes.
 *
 * `email`, `pais_iso` y `telefono` se OMITEN en ascensión/extensión: sus
 * inputs no se renderizan, así que hoy no están en el FormData. Mandarlos
 * vacíos daría el mismo payload pero cambiaría el cable, y el cable es
 * justo lo que no puede cambiar.
 *
 * `comprobante` (File) y `agenda` ("on", ruido inerte que nadie lee) NO
 * salen de aquí: siguen viniendo del DOM tal cual.
 */
export function camposDeVenta(e: EstadoVenta): Record<string, string> {
  const esNueva = e.tipo === "nueva";
  const campos: Record<string, string> = {};

  // --- claves que ya vienen del DOM por su atributo name= ---
  if (esNueva) {
    campos.email = e.nueva.email;
    // Solo viaja el ISO: crearVenta deriva de ahí el nombre del país y el
    // prefijo, así que no hay dos campos que puedan discrepar.
    campos.pais_iso = e.nueva.iso;
    // Crudo, sin normalizar: la conversión a E.164 ocurre SOLO en el servidor.
    campos.telefono = e.nueva.telefono;
  }
  campos.tier = e.programa.tier;
  campos.valor_total = num(e.programa.valorTotal);
  campos.fecha_inicio = e.programa.fechaInicio;
  // Si se borra el input, Number("") === 0 y hoy se envía "0" (no ""), lo
  // que hace que el servidor rechace por «entero 1..24». Se replica igual:
  // arreglarlo no es parte de este trabajo.
  campos.meses_duracion = Number.isFinite(e.programa.meses) ? String(e.programa.meses) : "";
  campos.pago_monto = num(e.cobro.pagoMonto);
  campos.metodo_pago = e.cobro.metodo;
  campos.usd_recibido = e.cobro.usdRecibido;
  campos.pago_fecha = e.cobro.pagoFecha;

  // --- claves que antes solo existían como fd.set, en su orden original ---
  campos.tipo_venta = e.tipo;
  campos.persona_id = esNueva ? "" : e.existente.personaId;
  campos.programa_previo_id = esNueva ? "" : e.existente.programaPrevio;
  // En ascensión/extensión el nombre es el TEXTO TECLEADO en el buscador, no
  // el nombre canónico del cliente. Va después de programa_previo_id porque
  // ahí es donde lo ponía el `fd.set("nombre", busqueda)` de antes.
  campos.nombre = esNueva ? e.nueva.nombre : e.existente.busqueda;
  // Re-mapeo explícito a propósito: SOLO monto y fecha, en ese orden, y el
  // monto por Number. Mandar las filas tal cual rompe la validación por fila
  // del servidor.
  campos.cuotas = JSON.stringify(e.cobro.cuotas.map((c) => ({ monto: Number(c.monto), fecha: c.fecha })));
  // La atribución viaja siempre, aunque nadie haya tocado el selector — en
  // ese caso `atribucion` sigue en null y `atribuido` se manda "false".
  // Nunca impide guardar la venta (en crearVenta es un segundo paso).
  const a = e.comision.atribucion;
  campos.source_id = a?.sourceId ?? "";
  campos.setter_id = a?.setterId ?? "";
  campos.closer_id = a?.closerId ?? "";
  campos.ghl_appointment_id = a?.ghlAppointmentId ?? "";
  campos.upsell_por_id = esNueva ? "" : e.comision.upsellPor;
  campos.atribuido = a !== null ? "true" : "false";
  // Viaja como JSON, igual que `cuotas`: FormData solo transporta strings.
  // El servidor vuelve a podar contra el catálogo — esto no es la defensa.
  // El bono escrito a mano viaja en el mismo array, con prefijo: la columna de
  // la base es una sola y así no hace falta un campo nuevo en ningún sitio.
  const libre = bonoLibreDe(e.bonoLibre);
  campos.bonos = JSON.stringify(libre ? [...e.bonos, PREFIJO_BONO_LIBRE + libre] : e.bonos);

  return campos;
}

/* ---------------- El reducer ---------------- */

export type Accion =
  | { t: "cambiarTipo"; tipo: Tipo }
  | { t: "editarNueva"; campo: keyof CompradorNuevo; valor: string }
  | { t: "teclearBusqueda"; valor: string }
  | { t: "elegirCliente"; personaId: string; nombre: string }
  | { t: "contextoCargado"; personaId: string; ctx: Contexto }
  | { t: "elegirProgramaPrevio"; id: string }
  | { t: "elegirTier"; id: string }
  | { t: "editarValorTotal"; valor: number }
  | { t: "editarMeses"; valor: number }
  | { t: "editarFechaInicio"; valor: string }
  | { t: "editarPagoMonto"; valor: number }
  | { t: "editarPagoFecha"; valor: string }
  | { t: "editarMetodo"; valor: string }
  | { t: "editarUsdRecibido"; valor: string }
  | { t: "fijarNCuotas"; n: number }
  | { t: "editarCuotaMonto"; i: number; valor: number }
  | { t: "editarCuotaFecha"; i: number; valor: string }
  | { t: "quitarCuota"; i: number }
  | { t: "elegirAtribucion"; atribucion: Atribucion | null }
  | { t: "elegirUpsellPor"; id: string }
  | { t: "alternarBono"; clave: ClaveBono }
  | { t: "marcarBonosEvento"; puesto: boolean }
  | { t: "bonoLibre"; texto: string };

/**
 * Recalcula el plan de cuotas. Recibe el total POR PARÁMETRO y no lo saca de
 * `programa` porque el input de "Valor total" a propósito NO regenera el
 * plan: escribir un total a mano deja el plan viejo y hace saltar el aviso
 * de descuadre. Solo `elegirTier` recalcula.
 *
 * Sustituye al viejo `regenerarCuotas(n, total, hoyMonto, fecha)`: cuatro
 * argumentos posicionales del mismo tipo, tres con default del closure y
 * ningún llamador que los pasara. Un error de orden ahí producía importes
 * de cuota equivocados sin fallar en ningún sitio.
 */
function conCuotas(cobro: EstadoVenta["cobro"], total: number): EstadoVenta["cobro"] {
  return { ...cobro, cuotas: generarCuotas(total, cobro.pagoMonto, cobro.nCuotas, cobro.pagoFecha) };
}

// Solo precarga el tier del nuevo programa a partir del programa de origen si
// ese tier está entre los tiers vendibles (p.ej. "OG" es vitalicio y no
// vendible: se excluye de getTiersVendibles, así que el select se dejaría
// desincronizado si intentáramos setearlo).
function precargarTier(e: EstadoVenta, p: Contexto["programas"][number] | undefined, tiers: TierMin[]): EstadoVenta {
  if (!p || !tiers.some((t) => t.id === p.tier)) return e;
  return reducer(e, { t: "elegirTier", id: p.tier }, tiers);
}

/**
 * La duración de referencia del tier: la que trae el catálogo, SIN bonos.
 * Es la base sobre la que se calcula el +50 %, así que si `tiers.meses_default`
 * miente, el bono miente con ella — que es exactamente lo que pasó con el 2000
 * (decía 4 meses cuando se vende a 6). Por eso la migración 0051 la corrige.
 */
export function mesesBaseDeTier(tier: string, tiers: TierMin[]): number {
  return tiers.find((t) => t.id === tier)?.meses_default ?? 6;
}

/**
 * La duración que corresponde tras cambiar los bonos: la del tier más un 50 %
 * si el bono de duración está puesto (6 → 9, 12 → 18); si no, la del tier a
 * secas. Vuelve al default (y no a lo que hubiera escrito el operador) porque
 * desmarcar el bono significa "esta venta no lo lleva", y dejar los 9 sería
 * exactamente el error que el bono quería evitar.
 */
function mesesTrasBonos(e: EstadoVenta, bonos: ClaveBono[], tiers: TierMin[]): number {
  const mesesTier = mesesBaseDeTier(e.programa.tier, tiers);
  return mesesConBono(mesesTier, bonos) ?? mesesTier;
}

export function reducer(e: EstadoVenta, a: Accion, tiers: TierMin[]): EstadoVenta {
  switch (a.t) {
    case "cambiarTipo":
      // Cambiar de tipo cambia de cliente (o lo vacía). Se limpia el
      // comprador existente ENTERO y la comisión: una atribución que quedó
      // puesta para el cliente/tipo anterior no puede colarse en la venta
      // nueva (ver "elegirCliente" — mismo motivo, mismas consecuencias).
      return { ...e, tipo: a.tipo, existente: { ...EXISTENTE_VACIO }, comision: { ...COMISION_VACIA } };

    case "editarNueva": {
      const nueva = { ...e.nueva, [a.campo]: a.valor };
      // Cambiar el email, el país o el teléfono CAMBIA DE CONTACTO en GHL:
      // son la llave con la que `llaveSelector` busca las citas. Si la
      // atribución no se limpiara, pasaría esto —el mismo bug que ya nos
      // mordió en ascensión, pero aquí sin red:
      //
      //   1. Se teclea el email de A, se elige una de sus citas.
      //   2. Alguien se da cuenta de que era otra persona y corrige el email.
      //   3. El selector pinta las citas de B y NINGÚN radio queda marcado
      //      (el appointmentId guardado no está en la lista nueva). En
      //      pantalla parece "sin decidir".
      //   4. Al guardar viajan el source_id, el setter y el closer de A con
      //      `atribuido=true`, y `guardarAtribucion` sella `atribucion_at`.
      //   5. /atribucion filtra por `atribucion_at is null`: la venta NO
      //      vuelve a aparecer nunca. Comisión pagada a quien no cerró, sin
      //      un solo rastro visible.
      //
      // En ascensión y extensión `motivoBloqueo` frena mientras no haya
      // cliente elegido; en compra nueva devuelve `null` SIEMPRE, así que
      // esta línea es la única defensa que existe.
      //
      // `nombre` NO limpia: no forma parte de la llave del selector, y
      // borrar la atribución al corregir una tilde sería castigar un typo.
      const cambiaDeContacto = a.campo === "email" || a.campo === "iso" || a.campo === "telefono";
      return cambiaDeContacto
        ? { ...e, nueva, comision: { ...COMISION_VACIA } }
        : { ...e, nueva };
    }

    case "teclearBusqueda":
      // Limpia SOLO personaId, igual que antes. No se amplía a propósito:
      // `motivoBloqueo` es lo que impide guardar sin cliente elegido, y esa
      // red depende de que aquí no se toque nada más.
      return { ...e, existente: { ...e.existente, busqueda: a.valor, personaId: "" } };

    case "elegirCliente":
      // Si Alex ya había elegido una cita con el cliente anterior y corrige
      // la búsqueda (p.ej. confundió a dos "Juan"), esa atribución NO puede
      // seguir colgada: viajaría con la venta del cliente nuevo y, al
      // guardarse, sella `atribucion_at` — la bandeja de pendientes filtra
      // por eso, así que el error dejaría de ser visible para siempre.
      return {
        ...e,
        existente: { personaId: a.personaId, busqueda: a.nombre, ctx: null, programaPrevio: "" },
        comision: { ...COMISION_VACIA },
      };

    case "contextoCargado": {
      // Guardia contra la condición de carrera: si se elige un candidato, se
      // vuelve a teclear y se elige otro, hay dos fetch en vuelo. Sin esto,
      // el que resuelva más tarde deja el `ctx` y el programa del cliente A
      // pegados al `personaId` del B — y en extensión precarga además el
      // tier equivocado. Es la misma clase de bug que SelectorAgenda ya
      // neutraliza con su bandera `vigente`, y aquí decide quién cobra.
      if (e.existente.personaId !== a.personaId) return e;
      const reciente = a.ctx.programas[0];
      const conCtx: EstadoVenta = {
        ...e,
        existente: { ...e.existente, ctx: a.ctx, programaPrevio: reciente?.id ?? "" },
      };
      return e.tipo === "extension" ? precargarTier(conCtx, reciente, tiers) : conCtx;
    }

    case "elegirProgramaPrevio": {
      const conPrograma: EstadoVenta = { ...e, existente: { ...e.existente, programaPrevio: a.id } };
      if (e.tipo !== "extension") return conPrograma;
      return precargarTier(conPrograma, e.existente.ctx?.programas.find((p) => p.id === a.id), tiers);
    }

    case "elegirTier": {
      const total = Number(a.id) || 0;
      // Al cambiar de tier la duración se recalcula sobre la del tier nuevo:
      // el bono de duración sobrevive al cambio (desde el 26-ago aplica a
      // todos los programas) pero su efecto cambia — 6 → 9 en el de 2.000,
      // 12 → 18 en los de un año. Solo se poda si el tier nuevo no tiene
      // duración que alargar.
      const mesesTier = mesesBaseDeTier(a.id, tiers);
      const bonos = podarBonos(mesesTier, e.bonos);
      const programa = {
        ...e.programa,
        tier: a.id,
        valorTotal: total,
        meses: mesesConBono(mesesTier, bonos) ?? mesesTier,
      };
      // Las cuotas se derivan del valor total: si ya había un plan montado,
      // hay que recalcularlo con el importe nuevo (si no, quedaban las del
      // tier anterior). `nCuotas` no se toca: la invariante
      // `nCuotas === 0 ⟺ cuotas === []` la mantienen fijarNCuotas y quitarCuota.
      return { ...e, programa, bonos, cobro: e.cobro.nCuotas > 0 ? conCuotas(e.cobro, total) : e.cobro };
    }

    case "editarValorTotal":
      // NO regenera las cuotas. Asimetría deliberada: escribir el total a
      // mano deja el plan viejo y hace saltar el aviso de descuadre.
      return { ...e, programa: { ...e.programa, valorTotal: a.valor } };

    case "editarMeses":
      return { ...e, programa: { ...e.programa, meses: a.valor } };

    // El bono de duración y el campo "Duración (meses)" son la misma cosa
    // vista dos veces: marcarlo alarga un 50 %, desmarcarlo devuelve el default
    // del tier. Dejar que se separaran permitiría guardar el bono con la
    // duración corta dentro — el RPC lo vuelve a forzar, pero el operador tiene
    // que VER los 9 (o los 18) antes de enviar, no descubrirlo después.
    case "alternarBono": {
      const bonos = e.bonos.includes(a.clave)
        ? e.bonos.filter((c) => c !== a.clave)
        : podarBonos(mesesBaseDeTier(e.programa.tier, tiers), [...e.bonos, a.clave]);
      return { ...e, bonos, programa: { ...e.programa, meses: mesesTrasBonos(e, bonos, tiers) } };
    }

    // El interruptor maestro: marca de una todos los bonos que apliquen al
    // tier elegido. Cada casilla se puede desmarcar después a mano.
    case "marcarBonosEvento": {
      const bonos = a.puesto ? bonosAplicables(mesesBaseDeTier(e.programa.tier, tiers)) : [];
      return { ...e, bonos, programa: { ...e.programa, meses: mesesTrasBonos(e, bonos, tiers) } };
    }

    // Se guarda crudo mientras se teclea y se normaliza al enviar: recortar
    // espacios en cada pulsación impediría escribir "consultoría extra".
    case "bonoLibre":
      return { ...e, bonoLibre: a.texto.slice(0, MAX_BONO_LIBRE) };

    case "editarFechaInicio":
      return { ...e, programa: { ...e.programa, fechaInicio: a.valor } };

    case "editarPagoMonto":
      return { ...e, cobro: conCuotas({ ...e.cobro, pagoMonto: a.valor }, e.programa.valorTotal) };

    case "editarPagoFecha":
      return { ...e, cobro: conCuotas({ ...e.cobro, pagoFecha: a.valor }, e.programa.valorTotal) };

    case "editarMetodo":
      return { ...e, cobro: { ...e.cobro, metodo: a.valor } };

    case "editarUsdRecibido":
      return { ...e, cobro: { ...e.cobro, usdRecibido: a.valor } };

    case "fijarNCuotas":
      return { ...e, cobro: conCuotas({ ...e.cobro, nCuotas: a.n }, e.programa.valorTotal) };

    case "editarCuotaMonto":
      return {
        ...e,
        cobro: {
          ...e.cobro,
          cuotas: e.cobro.cuotas.map((c, j) => (j === a.i ? { ...c, monto: a.valor } : c)),
        },
      };

    case "editarCuotaFecha":
      return {
        ...e,
        cobro: {
          ...e.cobro,
          cuotas: e.cobro.cuotas.map((c, j) => (j === a.i ? { ...c, fecha: a.valor } : c)),
        },
      };

    case "quitarCuota": {
      // Único sitio que resincroniza nCuotas a mano, para sostener la
      // invariante nCuotas === cuotas.length.
      const cuotas = e.cobro.cuotas.filter((_, j) => j !== a.i);
      return { ...e, cobro: { ...e.cobro, cuotas, nCuotas: cuotas.length } };
    }

    case "elegirAtribucion":
      return { ...e, comision: { ...e.comision, atribucion: a.atribucion } };

    case "elegirUpsellPor":
      return { ...e, comision: { ...e.comision, upsellPor: a.id } };
  }
}
