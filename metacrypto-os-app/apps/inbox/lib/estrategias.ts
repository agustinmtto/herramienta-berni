// Lógica pura del módulo de Estrategias.
//
// CERO imports de valor. Este fichero tiene tests en `__tests__/estrategias.test.ts`
// y el repo no tiene config de vitest, así que el alias `@/` NO se resuelve en
// runtime: un `import { x } from "@/lib/loquesea"` compila con Next y revienta
// en los tests. Sólo `import type` (que desaparece al compilar) o rutas
// relativas. Misma invariante que `lib/servicio.ts` y `lib/push.ts`.

export type EstadoEstrategia = "visible" | "programada" | "oculta";

export type EstrategiaBase = {
  fecha_lanzamiento: string; // ISO yyyy-mm-dd
  visible: boolean;
};

/**
 * Normaliza lo que el equipo pega en el formulario.
 *
 * Berni copia el enlace de la barra del navegador, así que llega con espacios
 * al principio, a veces sin esquema y a veces con una barra final. Guardarlo
 * tal cual significa que dos filas idénticas no se parecen entre sí y que un
 * `invierteconberni.com/cliente-000` sin `https://` se convierte en un enlace
 * relativo dentro del portal — el cliente acabaría en
 * `mcc.club/e/<token>/invierteconberni.com/...`, que no existe.
 *
 * Devuelve null si no hay nada aprovechable.
 */
export function normalizarUrl(entrada: string | null | undefined): string | null {
  const s = (entrada ?? "").trim();
  if (!s) return null;
  // `javascript:` y `data:` fuera: esto acaba en un href del portal.
  if (/^\s*(javascript|data|vbscript):/i.test(s)) return null;
  const conEsquema = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(conEsquema);
  } catch {
    return null;
  }
  if (!u.hostname.includes(".")) return null; // "https://localhost" y typos sueltos
  // Sin barra final para que dos pegados del mismo enlace se vean iguales.
  const limpio = u.toString();
  return limpio.endsWith("/") && u.pathname === "/" ? limpio.slice(0, -1) : limpio;
}

/**
 * Qué estado enseñar en el módulo del equipo.
 *
 * `programada` NO es un estado en la base: es `visible` con la fecha en el
 * futuro. Se deriva en vez de guardarse para que no exista la posibilidad de
 * que la columna y la fecha se contradigan.
 */
export function estadoEstrategia(e: EstrategiaBase, hoy: string): EstadoEstrategia {
  if (!e.visible) return "oculta";
  return e.fecha_lanzamiento > hoy ? "programada" : "visible";
}

export function etiquetaEstado(estado: EstadoEstrategia): string {
  return estado === "visible" ? "Visible" : estado === "programada" ? "Programada" : "Oculta";
}

/**
 * Las que el cliente ve en su portal.
 *
 * El filtro por `visible` ya lo hace la consulta; esto quita además las que
 * tienen fecha futura. Va aquí y no en el SQL a propósito: es una regla de
 * negocio ("una estrategia programada todavía no es suya") y se puede probar
 * sin base de datos.
 */
export function estrategiasParaCliente<T extends EstrategiaBase>(lista: T[], hoy: string): T[] {
  return lista
    .filter((e) => e.visible && e.fecha_lanzamiento <= hoy)
    .sort((a, b) => (a.fecha_lanzamiento < b.fecha_lanzamiento ? 1 : -1));
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-08-12" → "12 de agosto". Sin año: el cliente mira su plan reciente. */
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return "";
  return `${Number(m[3])} de ${mes}`;
}

/** "2026-08-12" → "12 ago 2026", para la tabla del equipo. */
export function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return "";
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return "";
  return `${Number(m[3])} ${mes.slice(0, 3)} ${m[1]}`;
}

/**
 * La línea que ve el cliente bajo su nombre.
 *
 * Con cero estrategias devuelve null y la pantalla enseña el estado vacío: un
 * cliente puede llegar por su enlace antes de que le publiquen nada (por
 * ejemplo si le reenvían el WhatsApp de otro momento), y "0 estrategias" es
 * una forma fea de recibirle.
 */
export function resumenCliente(fechas: string[]): string | null {
  const validas = fechas.filter((f) => fechaLarga(f) !== "").sort();
  if (validas.length === 0) return null;
  const ultima = validas[validas.length - 1];
  const n = validas.length;
  return `${n} ${n === 1 ? "estrategia" : "estrategias"} · última el ${fechaLarga(ultima)}`;
}

/** Los puntos que sustituyen a la contraseña hasta que el cliente pulsa Mostrar. */
export function enmascarar(password: string | null | undefined): string {
  const n = (password ?? "").length;
  if (n === 0) return "";
  return "•".repeat(Math.min(Math.max(n, 6), 12));
}

/**
 * Valida lo que llega del formulario ANTES de tocar la base.
 *
 * Devuelve el primer error en el idioma del equipo, o null si está todo. El
 * RPC vuelve a validar por su cuenta: esto es para no ir a la red a por un
 * error que se ve desde aquí, no la única defensa.
 */
export function validarFormulario(f: {
  persona_id?: string | null;
  titulo?: string | null;
  url?: string | null;
}): string | null {
  if (!(f.persona_id ?? "").trim()) return "Elige el cliente.";
  if (!(f.titulo ?? "").trim()) return "La estrategia necesita un título.";
  const url = normalizarUrl(f.url);
  if (!url) return "El enlace no es válido. Pega la URL completa de la estrategia.";
  return null;
}

/**
 * El enlace del portal que se le manda al cliente.
 *
 * `base` viene de una env var y no de `VERCEL_URL`: la URL que Vercel inyecta
 * es la del deployment (`...-hash.vercel.app`), distinta en cada despliegue.
 * Un enlace así en un WhatsApp deja de funcionar al siguiente deploy, y el
 * cliente ya lo tiene guardado.
 */
export function enlacePortal(base: string, token: string): string {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  const t = (token ?? "").trim();
  if (!b || !t) return "";
  return `${b}/e/${t}`;
}
