// ============================================================
// Bonos del evento 26/08 — helpers puros. Sin red ni base: se testean solos.
//
// Qué son: los 4 incentivos que Alex ofreció por cerrar en el directo del
// 26-ago-2026. Ninguno es una prestación nueva del negocio — los tres primeros
// son el tier comprado tomando prestado lo que ya incluye un tier superior
// (`tiers.n_consultorias`, `tiers.meses_default`, `tiers.acceso_discord`).
// Por eso el bono se guarda en la VENTA (`programas.bonos`) y no en el
// cliente: si renueva, la renovación es otra venta y los bonos caducan solos.
//
// Alex confirmó por WhatsApp (25-ago) que son SOLO para este evento, así que
// el catálogo es una constante y no una tabla: no hay ABM ni pantalla que
// mantener. El mecanismo sí es genérico — el próximo evento cambia esta lista.
//
// ⚠️ CORREGIDO EL 26-ago. La primera versión ató el bono de duración al id de
// tier "1800" y a un salto fijo a 9 meses. Berni lo desmintió el mismo día:
//   "No hay programa de 1800€: 2000, 3500 y 5000. El bono de 50% más de tiempo
//    es en todos. El de 2000 que son 6 meses pasa a 9 meses. Los otros dos que
//    son de 1 año, pasan de 12 meses a 18."
// La raíz del error no fue leer mal a Berni: fue preguntarle a la tabla `tiers`
// cuál era "el tier de 6 meses". La tabla contestaba 1800, porque `meses_default`
// del 2000 estaba en 4 y llevaba meses desactualizado. Por eso ahora NINGUNA
// función de este módulo recibe un id de tier: el bono depende de la DURACIÓN
// del programa, que es lo que Berni describió, y así un id equivocado no puede
// volver a colarse. Ver `docs/bonos-evento.md` § "El error del tier 1800".
// ============================================================

export type ClaveBono =
  | "consultoria_berni"
  | "consultoria_manuel"
  | "duracion_50"
  | "discord_portafolio";

export type Bono = {
  clave: ClaveBono;
  etiqueta: string;
  /** Qué mueve de verdad en el OS. Se muestra junto a la casilla. */
  efecto: string;
};

/**
 * El bono alarga el programa un 50 %. Berni, 26-ago: aplica a TODOS los
 * programas, y el resultado sale de la duración, no del precio:
 *   2.000 € →  6 meses →  9      3.500 € → 12 meses → 18
 *                                5.000 € → 12 meses → 18
 */
export const FACTOR_BONO_DURACION = 1.5;

export const BONOS_EVENTO: readonly Bono[] = [
  {
    clave: "consultoria_berni",
    etiqueta: "Consultoría extra 1 a 1 con Berni",
    efecto: "+1 consultoría al cupo",
  },
  {
    clave: "consultoria_manuel",
    etiqueta: "Consultoría extra con Manuel",
    efecto: "+1 consultoría al cupo",
  },
  {
    clave: "duracion_50",
    etiqueta: "+50 % de duración sin coste",
    efecto: "alarga el programa la mitad (6 → 9 meses · 12 → 18)",
  },
  {
    clave: "discord_portafolio",
    etiqueta: "Portafolio de Berni en tiempo real vía Discord",
    // Honestidad deliberada: `tiers.acceso_discord` hoy no la lee ni una
    // pantalla del OS, así que este bono no puede mover ningún número.
    // Queda registrado para que se vea a quién hay que invitar a mano.
    efecto: "queda registrado — el alta en Discord es manual",
  },
] as const;

export const CLAVES_BONOS: readonly ClaveBono[] = BONOS_EVENTO.map((b) => b.clave);

/** Los bonos que suman consultorías. Si mañana hay más, van aquí. */
const BONOS_CONSULTORIA: readonly ClaveBono[] = ["consultoria_berni", "consultoria_manuel"];

/**
 * Filtra a claves conocidas, deduplica y ordena según el catálogo.
 * El array llega de un `<form>` y de la base, así que no se confía en él:
 * una clave inventada se descarta en silencio en vez de acabar guardada.
 * La clave vieja `duracion_9m` cae por aquí sola — ya no está en el catálogo.
 */
export function normalizarBonos(bonos: readonly string[] | null | undefined): ClaveBono[] {
  if (!bonos?.length) return [];
  const puestos = new Set(bonos);
  return CLAVES_BONOS.filter((c) => puestos.has(c));
}

/** Consultorías que los bonos añaden ENCIMA de lo que incluye el tier. */
export function extraConsultorias(bonos: readonly string[] | null | undefined): number {
  const validos = normalizarBonos(bonos);
  return validos.filter((c) => BONOS_CONSULTORIA.includes(c)).length;
}

/**
 * Aplica el +50 % a una duración. Redondea HACIA ARRIBA a propósito: si algún
 * día se vende un programa de duración impar, el cliente se queda con el mes
 * de más. Prometer un bono y entregar de menos es peor que regalar un mes.
 * Con los tres programas reales (6 y 12) el redondeo nunca entra en juego.
 */
export function mesesConBonoDuracion(mesesBase: number | null | undefined): number | null {
  if (mesesBase == null) return null;
  if (!Number.isFinite(mesesBase) || mesesBase <= 0) return mesesBase;
  return Math.ceil(mesesBase * FACTOR_BONO_DURACION);
}

/**
 * La inversa: de la duración FINAL vuelve a la del catálogo. Hace falta porque
 * `crear_venta` pisa `programas.meses_duracion` con el resultado del bono, así
 * que a la hora de imprimir el contrato los 12 meses de partida ya no existen
 * en ninguna fila — solo el 18.
 *
 * NO se lee de `tiers.meses_default` a propósito: esa columna llevaba meses
 * desactualizada y es la raíz del error del tier 1800 (ver la cabecera). La
 * duración final es el dato fiable, y el factor es una constante.
 *
 * Devuelve null si la cuenta no es exacta —una duración impar que `Math.ceil`
 * redondeó—, porque un contrato con una suma que no cuadra es peor que uno sin
 * la suma. Con los tres programas reales (6→9, 12→18) siempre es exacta.
 */
function mesesBaseDeDuracionFinal(mesesFinales: number | null | undefined): number | null {
  if (mesesFinales == null || !Number.isFinite(mesesFinales) || mesesFinales <= 0) return null;
  const base = mesesFinales / FACTOR_BONO_DURACION;
  return Number.isInteger(base) && base > 0 ? base : null;
}

/**
 * Si el bono de duración tiene algo que hacer aquí. Ya no mira el tier: mira si
 * hay duración que alargar. Un vitalicio (OG, `meses_default` null) no la tiene.
 */
export function aplicaBonoDuracion(mesesBase: number | null | undefined): boolean {
  return mesesBase != null && Number.isFinite(mesesBase) && mesesBase > 0;
}

/**
 * Duración final en meses. `mesesBase` es la duración del programa SIN bono
 * (por defecto el `meses_default` del tier), para que marcar y desmarcar el
 * bono sea simétrico: 6 ↔ 9, 12 ↔ 18.
 */
export function mesesConBono(
  mesesBase: number | null,
  bonos: readonly string[] | null | undefined,
): number | null {
  const tieneBono = normalizarBonos(bonos).includes("duracion_50");
  if (!tieneBono || !aplicaBonoDuracion(mesesBase)) return mesesBase;
  return mesesConBonoDuracion(mesesBase);
}

/**
 * Los bonos que tienen sentido en este programa. Desde el 26-ago los cuatro
 * aplican siempre; el de duración solo desaparece si no hay duración que
 * alargar — mejor eso que enseñarlo marcable pero inerte.
 */
export function bonosAplicables(mesesBase: number | null | undefined): ClaveBono[] {
  return CLAVES_BONOS.filter((c) => c !== "duracion_50" || aplicaBonoDuracion(mesesBase));
}

/** Quita los bonos que no aplican. Se usa al cambiar de tier. */
export function podarBonos(
  mesesBase: number | null | undefined,
  bonos: readonly string[] | null | undefined,
): ClaveBono[] {
  const aplicables = new Set(bonosAplicables(mesesBase));
  return normalizarBonos(bonos).filter((c) => aplicables.has(c));
}

/** Frase corta para la ficha del cliente: "+2 consultorías · +50 % duración · Discord". */
export function resumenBonos(bonos: readonly string[] | null | undefined): string {
  const validos = normalizarBonos(bonos);
  const libres = bonosLibres(bonos);
  // Se mira también `libres`: una venta con SOLO un bono escrito a mano tiene
  // el catálogo vacío, y con el corte de antes no habría enseñado nada.
  if (!validos.length && !libres.length) return "";
  const partes: string[] = [];
  const n = extraConsultorias(validos);
  if (n > 0) partes.push(`+${n} ${n === 1 ? "consultoría" : "consultorías"}`);
  if (validos.includes("duracion_50")) partes.push("+50 % duración");
  if (validos.includes("discord_portafolio")) partes.push("Discord");
  // Los escritos a mano, con su texto. Sin esto un bono se guarda, se imprime
  // en el contrato y no se ve en ninguna pantalla del OS — que es justo lo que
  // hace invisible que `editar_bonos` lo borre.
  partes.push(...libres);
  return partes.join(" · ");
}

// ── Bonos escritos a mano ────────────────────────────────────────────────────
//
// El catálogo de arriba son los 4 del evento del 26/08, y son los que mueven
// números en el OS (cupo de consultorías, duración). Pero Berni sigue
// inventando bonos en cada cierre, y hasta hoy no había dónde anotarlos: el
// closer los prometía de palabra y no llegaban al contrato.
//
// Se guardan en la MISMA columna `programas.bonos`, con el prefijo `libre:`,
// y no como una tabla nueva: son texto que solo se imprime. Cuando uno se
// repita lo bastante, se sube al catálogo de arriba y pasa a mover números.
//
// Deliberadamente NO entran en `normalizarBonos` ni en `ClaveBono`: si un
// texto libre pudiera colarse como clave, `extraConsultorias` y `mesesConBono`
// tendrían que defenderse de él en cada llamada. Aquí se separan una vez.
export const PREFIJO_BONO_LIBRE = "libre:";

/** Tope de caracteres. Es una línea de un contrato, no un párrafo. */
export const MAX_BONO_LIBRE = 120;

/**
 * Normaliza lo que tecleó el closer. Devuelve null si no queda nada que
 * imprimir — así "   " no acaba siendo un bono vacío en el PDF.
 */
export function bonoLibreDe(texto: string | null | undefined): string | null {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_BONO_LIBRE);
  return limpio || null;
}

/** Los bonos escritos a mano que trae una venta, ya sin el prefijo. */
export function bonosLibres(bonos: readonly string[] | null | undefined): string[] {
  return (bonos ?? [])
    .filter((b) => typeof b === "string" && b.startsWith(PREFIJO_BONO_LIBRE))
    .map((b) => bonoLibreDe(b.slice(PREFIJO_BONO_LIBRE.length)))
    .filter((b): b is string => b !== null);
}

/**
 * Las etiquetas de TODOS los bonos de una venta, para imprimirlas en el
 * contrato: primero los del catálogo en su orden, después los escritos a mano
 * en el orden en que se guardaron.
 *
 * `mesesFinales` es la duración que ya trae el bono aplicado (la que imprime la
 * cláusula 1). Cuando se pasa, la etiqueta del bono de duración se completa con
 * la cuenta desglosada: "+50 % de duración sin coste (ya incluido: 12 meses de
 * catálogo + 6 de bono = 18)".
 *
 * Por qué: la cláusula 1 dice "18 meses" dos veces y los 12 de partida no
 * aparecen en ninguna parte del documento, así que el único número sobre el que
 * el cliente puede aplicar ese "+50 %" es el 18 que acaba de leer — y reclamar
 * 27 meses con el texto firmado de su parte. Paula eligió esta redacción
 * (opción B, "la cuenta explicada") el 9-sep-2026 frente a quitar el bono de la
 * lista: así queda constancia de que fue un regalo del evento y no se puede
 * leer dos veces.
 */
export function etiquetasBonos(
  bonos: readonly string[] | null | undefined,
  mesesFinales?: number | null,
): string[] {
  const base = mesesBaseDeDuracionFinal(mesesFinales);
  const delCatalogo = normalizarBonos(bonos).map((c) => {
    const { etiqueta } = BONOS_EVENTO.find((b) => b.clave === c)!;
    if (c !== "duracion_50" || base == null) return etiqueta;
    return `${etiqueta} (ya incluido: ${base} meses de catálogo + ${mesesFinales! - base} de bono = ${mesesFinales})`;
  });
  return [...delCatalogo, ...bonosLibres(bonos)];
}
