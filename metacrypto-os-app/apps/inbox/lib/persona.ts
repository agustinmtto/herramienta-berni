// ============================================================
// Lógica pura de la edición de la ficha del cliente. Sin red ni base.
//
// Regla de este módulo (igual que venta-form.ts): NADA de imports "@/" en
// runtime — vitest no resuelve el alias. Solo relativos y `import type`.
//
// Lo que decide este archivo: qué campos han cambiado de verdad, si son
// válidos, y si quien edita tiene permiso para lo que pide. Lo que NO decide:
// nada que necesite mirar la base (que el teléfono no sea de otra persona,
// que el coach exista) — eso vive en el RPC `editar_persona` de la migración
// 0039, que es quien tiene la foto consistente bajo `for update`.
// ============================================================

import { aE164, soloDigitos } from "./telefono";

/** Los cinco valores del CHECK de `personas.estado` (migración 0039). */
export const ESTADOS_PERSONA = [
  "lead", "reservado", "cliente", "ex_cliente", "archivado",
] as const;
export type EstadoPersona = (typeof ESTADOS_PERSONA)[number];

/**
 * Cómo se dice cada estado en castellano. 'archivado' se explica en el propio
 * texto: es la diferencia que Berni pidió entre "se fue" (ex-cliente) y
 * "legacy que no vamos a tocar nunca" (los OG).
 *
 * Vivía dentro de `EditarCliente.tsx` y solo se usaba en el desplegable de
 * ese modal. Las dos pantallas que muestran el estado —la lista de clientes y
 * la cabecera de la ficha— imprimían el enum crudo: "ex_cliente", con guion
 * bajo. Está aquí para que haya un solo sitio donde se decide cómo se llama
 * cada estado.
 */
export const ETIQUETA_ESTADO: Record<string, string> = {
  lead: "Lead",
  reservado: "Reservado",
  cliente: "Cliente",
  ex_cliente: "Ex-cliente (se fue)",
  archivado: "Archivado (no contactar)",
};

/**
 * La etiqueta corta, para una celda de tabla o un sello donde la aclaración
 * entre paréntesis no cabe. Un estado desconocido se devuelve tal cual en vez
 * de romper: si algún día se añade uno a la base y no aquí, la pantalla
 * enseña el valor en vez de un hueco.
 */
export function etiquetaEstado(estado: string): string {
  return (ETIQUETA_ESTADO[estado] ?? estado).replace(/\s*\(.*\)$/, "");
}

/** Lo que el formulario manda, tal cual lo escribió el usuario. */
export type EntradaEdicion = {
  nombre: string;
  telefono: string;
  email: string;
  pais: string;
  coach_id: string;
  estado: string;
};

/** Lo que hay guardado ahora, para comparar y mandar solo la diferencia. */
export type FichaActual = {
  nombre: string | null;
  telefono_e164: string | null;
  email: string | null;
  pais: string | null;
  coach_id: string | null;
  estado: string;
};

/**
 * Campos del payload del RPC. La cadena vacía significa "no tocar", que es la
 * convención que ya usa `editar_cuota` (0016) — no "vaciar el campo". Esta
 * pantalla existe para RELLENAR huecos, y un vaciado accidental del teléfono
 * desvincularía el hilo de WhatsApp del cliente.
 */
export type CamposEdicion = {
  nombre: string;
  telefono_e164: string;
  email: string;
  pais: string;
  coach_id: string;
  estado: string;
};

export type ResultadoEdicion =
  | { ok: true; campos: CamposEdicion }
  | { ok: false; error: string };

// Deliberadamente laxo. Un validador de email "estricto" rechaza direcciones
// reales (subdominios largos, TLD nuevos, signos +) y aquí el coste de un
// falso negativo es alto: Berni no puede guardar el email que sí tiene. Esto
// solo caza el error de verdad frecuente — pegar algo que no es un email.
//
// Exportado: `lib/contrato-envio.ts` lo reusa para validar el email del
// cliente antes de mandarle el enlace de firma. Un segundo regex ahí sería
// una segunda definición de "qué es un email válido" que divergir con el
// tiempo — y de hecho ya divergió una vez (más laxo, sin exigir un TLD de
// dos caracteres) antes de que esta reutilización lo corrigiera.
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function prepararEdicion(
  entrada: EntradaEdicion,
  actual: FichaActual,
  permisos: { puedeCambiarEstado: boolean },
): ResultadoEdicion {
  const t = (s: string) => (s ?? "").trim();

  // Solo si es distinto de lo guardado. Comparar contra lo actual en vez de
  // mandarlo todo evita una fila de auditoría por cada guardado, aunque no se
  // haya tocado nada — el registro dejaría de servir para saber qué cambió.
  const distinto = (nuevo: string, viejo: string | null) =>
    nuevo !== "" && nuevo !== (viejo ?? "") ? nuevo : "";

  const nombre = distinto(t(entrada.nombre), actual.nombre);
  const email = distinto(t(entrada.email), actual.email);
  const pais = distinto(t(entrada.pais), actual.pais);
  const coach_id = distinto(t(entrada.coach_id), actual.coach_id);

  // El teléfono se compara CANONIZADO, no crudo: el formulario devuelve lo
  // que ve el usuario ("+34 657 12 34 56") y la base guarda "+34657123456".
  // Comparar los strings tal cual haría que el mismo número pareciera un
  // cambio cada vez que se abre y guarda la ficha.
  let telefono_e164 = "";
  const telRaw = t(entrada.telefono);
  if (telRaw !== "") {
    const canonico = aE164(telRaw);
    if (canonico === null) {
      return {
        ok: false,
        error:
          "El teléfono no parece válido: hace falta el prefijo del país y al menos 8 dígitos (p. ej. +54 9 11 2345 6789).",
      };
    }
    // Los dos lados por dígitos: lo guardado puede venir de una importación
    // vieja sin canonizar del todo.
    if (soloDigitos(canonico) !== soloDigitos(actual.telefono_e164)) {
      telefono_e164 = canonico;
    }
  }

  if (email !== "" && !RE_EMAIL.test(email)) {
    return { ok: false, error: `Ese email no parece válido: ${email}` };
  }

  const estadoPedido = t(entrada.estado);
  let estado = distinto(estadoPedido, actual.estado);
  if (estado !== "") {
    if (!(ESTADOS_PERSONA as readonly string[]).includes(estado)) {
      return { ok: false, error: `Estado no válido: ${estado}` };
    }
    // Se comprueba DESPUÉS de calcular `distinto`: reenviar el estado que ya
    // tiene no es un cambio y no debe chocar con el permiso. Si chocara,
    // Manuel —que puede editar datos pero no archivar— no podría guardar un
    // teléfono desde un formulario que envía todos los campos.
    if (!permisos.puedeCambiarEstado) {
      return {
        ok: false,
        error: "No tienes permiso para cambiar el estado del cliente.",
      };
    }
  }

  const campos: CamposEdicion = { nombre, telefono_e164, email, pais, coach_id, estado };
  if (Object.values(campos).every((v) => v === "")) {
    return { ok: false, error: "No hay nada que cambiar." };
  }
  return { ok: true, campos };
}

/**
 * El rol del equipo, tal como lo lee una persona.
 *
 * Berni pidió en CAMBIOS OS: «cambiar Coach por consultor, aquí y en cualquier
 * parte que aparezca la palabra coach». En la base el rol SIGUE siendo `coach`
 * —es un valor con check constraint (0001:11, 0029:37) del que cuelgan las
 * comisiones, el selector de consultor al vender y la clasificación de llamadas
 * de Fathom—, así que la palabra se traduce al PINTAR y no se renombra el dato.
 *
 * Existe aparte de `etiquetaRol` (lib/comisiones.ts) porque aquel está tipado a
 * `RolComision`, que no incluye `admin`: el selector del inbox sí puede mostrar
 * a un admin, y pasarle ese valor sería un error de tipos. Cae al valor crudo
 * para cualquier rol que se añada mañana.
 */
const ETIQUETA_ROL_EQUIPO: Record<string, string> = {
  coach: "consultor",
  closer: "closer",
  setter: "setter",
  admin: "admin",
};

export function etiquetaRolEquipo(rol: string | null | undefined): string {
  const r = (rol ?? "").trim().toLowerCase();
  return ETIQUETA_ROL_EQUIPO[r] ?? r;
}
