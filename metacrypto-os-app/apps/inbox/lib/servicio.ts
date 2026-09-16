// Lógica pura del módulo de servicio (las consultorías). Sin acceso a datos:
// todo lo que decide qué se cuenta, qué se muestra y cómo se lee una nota vive
// aquí para poder testearlo.
//
// SIN IMPORTS EN RUNTIME, a propósito: no hay config de vitest en este proyecto,
// así que un `import { x } from "@/lib/…"` real (no `import type`) rompe los
// tests con "Cannot find package". Por eso el resto de libs con tests
// (timeline.ts, sesiones.ts, comisiones.ts) sólo importan tipos. `Intl` es
// global y no necesita import.

export type EstadoAsistencia = "asistio" | "no_asistio" | "reprogramada" | null;

export type DireccionOperacion = "short" | "long" | "spot" | "etfs" | "esperar";
export type EstadoOperacion = "ejecutada" | "ordenes_puestas" | "planificada" | null;

export type Operacion = {
  direccion: DireccionOperacion;
  activo: string | null;
  capital: number | string | null;
  apalancamiento: string | null;
  zona_entrada: string | null;
  objetivo: string | null;
  estado: EstadoOperacion;
};

// El motivo que la migración 0066 escribe en `consultorias_ajuste_motivo` para
// los clientes cuyo cupo se congeló al cambiar el catálogo 2026: no es que
// alguien lo tocara, es que se les respeta el número que ya tenían contratado.
// Cualquier otro valor de `ajusteMotivo` (o su ausencia con `ajustado` true) es
// un ajuste manual real — el caso que existía antes de esta migración.
export const MOTIVO_CONGELADO_CATALOGO = "catalogo_2026";

export type Cupo = {
  incluidas: number | null;   // null = sin programa activo, no se sabe
  ajustado: boolean;
  /** Por qué `ajustado` es true. Ver `MOTIVO_CONGELADO_CATALOGO`. */
  ajusteMotivo?: string | null;
  hechas: number;
  /** Consultorías que vienen de los bonos del evento (0 en la inmensa mayoría). */
  extraBonos?: number;
};

// ---------------------------------------------------------------------------
// Asistencia
// ---------------------------------------------------------------------------

// `null` es "sin registrar", no "no asistió". La diferencia importa: son las
// sesiones que el KPI naranja persigue para que nadie las deje colgando.
export function etiquetaAsistencia(e: EstadoAsistencia): string {
  switch (e) {
    case "asistio":      return "Asistió";
    case "no_asistio":   return "No asistió";
    case "reprogramada": return "Reprogramada";
    default:             return "Sin registrar";
  }
}

// Sólo "asistió" consume una consultoría del cupo. Una reprogramada no se hizo
// y una a la que el cliente no vino tampoco debería gastarle el cupo — si algún
// día se decide cobrar los no-shows, este es el único sitio donde cambiarlo.
export function consumeCupo(e: EstadoAsistencia): boolean {
  return e === "asistio";
}

// ---------------------------------------------------------------------------
// Numeración
// ---------------------------------------------------------------------------

// El número se cuenta POR CLIENTE, no por coach: la primera sesión es la 1 y la
// siguiente la 2 aunque cambie de coach entre una y otra. (Airtable numeraba
// por coach y por eso 18 clientes tenían el número repetido.)
//
// Las reprogramadas no gastan número, igual que en v_sesiones_cliente. Esta
// función existe para que el formulario pueda anticipar el número ANTES de
// guardar; la verdad la sigue teniendo la vista.
export function siguienteNumero(
  sesiones: { estado_asistencia: EstadoAsistencia }[],
): number {
  return sesiones.filter((s) => s.estado_asistencia !== "reprogramada").length + 1;
}

// ---------------------------------------------------------------------------
// Cupo de consultorías
// ---------------------------------------------------------------------------

// Nunca negativo: 5 de los 75 clientes con sesiones ya superaron lo que su tier
// incluye. Un "-1 pendientes" no significa nada para nadie.
// `null` cuando no hay programa activo: "no lo sé" y "cero" son cosas distintas.
export function pendientesDeCupo({ incluidas, hechas }: Cupo): number | null {
  if (incluidas === null || incluidas === undefined) return null;
  return Math.max(0, incluidas - hechas);
}

// El texto que ve el coach al elegir cliente en el formulario.
export function resumenCupo(cupo: Cupo): string {
  const { incluidas, ajustado, hechas } = cupo;
  const pend = pendientesDeCupo(cupo);
  const llevadas = `Lleva ${hechas} ${hechas === 1 ? "sesión" : "sesiones"}`;

  if (incluidas === null || incluidas === undefined) {
    return `${llevadas} · sin programa activo, no se sabe cuántas incluye`;
  }

  // El paréntesis explica por qué el número no es el del tier. Sin esto, un
  // cupo de 3 en un tier que incluye 1 parece un error del sistema — y lo que
  // pasa entonces es que nadie se fía del cupo.
  //
  // Dos motivos distintos para el mismo booleano `ajustado`: congelado por el
  // catálogo (su cupo es el que contrató, no se toca) y ajuste manual real
  // (alguien cambió el número a mano). Decirlos igual invitaría a "arreglar"
  // el primero borrándolo — que es justo como se regalarían las consultorías
  // que la migración 0066 congela.
  const extra = cupo.extraBonos ?? 0;
  const motivos: string[] = [];
  if (ajustado) {
    motivos.push(
      cupo.ajusteMotivo === MOTIVO_CONGELADO_CATALOGO
        ? "congelado al cambiar el catálogo"
        : "ajustado a mano",
    );
  }
  if (extra > 0) motivos.push(`+${extra} por ${extra === 1 ? "bono" : "bonos"} del evento`);
  const deCuantas = `de ${incluidas} incluidas${motivos.length ? ` (${motivos.join(" · ")})` : ""}`;
  if (pend === 0 && hechas > incluidas) {
    return `${llevadas} ${deCuantas} · ya se pasó en ${hechas - incluidas}`;
  }
  if (pend === 0) return `${llevadas} ${deCuantas} · no le quedan`;
  return `${llevadas} ${deCuantas} · le ${pend === 1 ? "queda" : "quedan"} ${pend}`;
}

// ---------------------------------------------------------------------------
// Operaciones recomendadas
// ---------------------------------------------------------------------------

const NOMBRE_DIRECCION: Record<DireccionOperacion, string> = {
  short:   "Short",
  long:    "Long",
  spot:    "Spot",
  etfs:    "ETFs",
  esperar: "Esperar",
};

const NOMBRE_ESTADO_OP: Record<Exclude<EstadoOperacion, null>, string> = {
  ejecutada:       "Ejecutada",
  ordenes_puestas: "Órdenes puestas",
  planificada:     "Planificada",
};

export function nombreDireccion(d: DireccionOperacion): string {
  return NOMBRE_DIRECCION[d] ?? d;
}

export function nombreEstadoOperacion(e: EstadoOperacion): string | null {
  return e ? (NOMBRE_ESTADO_OP[e] ?? e) : null;
}

// "Short BTC · 5.000 € · 2x · entrada 64–65,5K · objetivo 96K"
//
// El apalancamiento se omite cuando la dirección es "esperar": no se apalanca
// una espera, y arrastrar el 2x por defecto del formulario a esa línea sería
// escribir algo que nadie dijo.
export function etiquetaOperacion(op: Operacion): string {
  const partes: string[] = [];
  partes.push([nombreDireccion(op.direccion), op.activo?.trim()].filter(Boolean).join(" "));

  const capital = formatearCapital(op.capital);
  if (capital) partes.push(capital);
  if (op.apalancamiento && op.direccion !== "esperar") partes.push(op.apalancamiento);
  if (op.zona_entrada) partes.push(`entrada ${op.zona_entrada}`);
  if (op.objetivo) partes.push(`objetivo ${op.objetivo}`);

  return partes.join(" · ");
}

// El capital llega como número desde la base y como texto desde el formulario
// ("15.000", tal cual lo teclea el coach): el `replace` de los puntos evita que
// eso se lea como quince euros con decimales.
//
// El formato replica el de `money()` de lib/format.ts (es-ES, sin céntimos) en
// vez de importarlo, por la razón de la cabecera. Si algún día se añade config
// de vitest con el alias, esto debería pasar a `money()`.
function formatearCapital(v: number | string | null): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat("es-ES", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Lectura de la ficha operativa escrita dentro de una nota
// ---------------------------------------------------------------------------

export type PistaFicha = { clase: string; texto: string };

// Las 70 notas con texto llevan la ficha operativa escrita a mano, casi siempre
// en mayúsculas: "ENTRADA AL SHORT ... APALANCAMIENTO 2X ... SE VA A UTILIZAR
// OKX ... PL: 96K". Esto la LEE para proponerla, nunca para guardarla sola:
// convertir una lectura en registros que nadie confirmó sería inventar datos.
export function detectarFichaOperativa(nota: string | null): PistaFicha[] {
  if (!nota) return [];
  const pistas: PistaFicha[] = [];

  if (/\bSHORTS?\b/i.test(nota)) pistas.push({ clase: "red",    texto: "Short" });
  if (/\bLONGS?\b/i.test(nota))  pistas.push({ clase: "green",  texto: "Long" });
  if (/\bETFs?\b/i.test(nota))   pistas.push({ clase: "blue",   texto: "ETFs" });

  const apal = nota.match(/\b(\d+)\s*X\b/i);
  if (apal) pistas.push({ clase: "purple", texto: `Apalancamiento ${apal[1]}x` });

  const exch = nota.match(/\b(OKX|BINANCE|BITSO|BYBIT|KRAKEN|COINBASE)\b/i);
  if (exch) pistas.push({ clase: "blue", texto: exch[1].toUpperCase() });

  // Los importes se repiten dentro de una misma nota ("15K" en dos frases
  // distintas). Sin deduplicar, la fila de pistas sale con el mismo número tres
  // veces y parece que hay tres operaciones donde hay una.
  const cifras = [...nota.matchAll(/\b(\d+(?:[.,]\d+)?)\s*K\b/gi)].map((m) => m[1]);
  for (const k of [...new Set(cifras)].slice(0, 4)) {
    pistas.push({ clase: "gold", texto: `${k}K` });
  }

  return pistas;
}
