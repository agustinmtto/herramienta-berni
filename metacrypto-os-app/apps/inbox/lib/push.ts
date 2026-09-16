// Decisión pura de las notificaciones del inbox: A QUIÉN se avisa y QUÉ se
// enseña. Sin red y sin base de datos, para que se pueda probar entero.
// El envío de verdad vive en `lib/push-envio.ts`.
//
// El import de `./modulos` es RELATIVO a propósito: un lib con tests no puede
// resolver el alias `@/` en tiempo de ejecución bajo vitest (solo vale para
// `import type`). `modulos.ts` no importa nada, así que entra limpio.
import { homePath, puedeVer } from "./modulos";

export type MiembroPush = {
  id: string;
  activo: boolean;
  acceso_total: boolean;
  modulos: string[] | null;
  // Texto libre en la base (columna con CHECK). Se trata como desconocido si
  // no es uno de los tres valores: un dato raro no debe acabar avisando a
  // alguien que no tocaba.
  push_alcance: string;
};

/**
 * Quién debe recibir el aviso de un mensaje entrante de esta conversación.
 *
 * El filtro de módulo va aquí, EN EL ENVÍO, y no al suscribirse: si a alguien
 * le retiran `inbox`, sus avisos paran solos sin que nadie tenga que acordarse
 * de darle de baja. Sin este filtro, un setter suscrito recibiría en su
 * pantalla bloqueada el nombre de un cliente que no puede abrir dentro del OS.
 */
export function destinatarios(
  miembros: MiembroPush[],
  conv: { coach_asignado: string | null },
): MiembroPush[] {
  return miembros.filter((m) => {
    if (!m.activo) return false;
    if (!puedeVer({ acceso_total: m.acceso_total, modulos: m.modulos }, "inbox")) return false;
    if (m.push_alcance === "todas") return true;
    // Las conversaciones sin coach entran aquí a propósito: son la mayoría
    // (76 de 106 el 19-ago) y si no avisaran a nadie, la función parecería
    // rota justo en los mensajes que más urgen — los de clientes nuevos.
    if (m.push_alcance === "asignadas") {
      return conv.coach_asignado === null || conv.coach_asignado === m.id;
    }
    return false;
  });
}

/**
 * Lo que se lee en la pantalla bloqueada. Decisión de Milo (19-ago): solo el
 * nombre del cliente, nunca el texto del mensaje.
 *
 * Además de discreto, deja el contenido del cliente fuera de la carga del
 * push, y hace que audio, foto, sticker y texto se anuncien igual — sin casos
 * especiales que mantener por cada tipo de mensaje.
 */
export function contenidoAviso(nombre: string | null, telefono: string) {
  return {
    title: nombre?.trim() || telefono,
    body: "Nuevo mensaje",
  };
}

/**
 * La clave pública VAPID viaja como base64url y `pushManager.subscribe` la
 * exige como bytes. Es cinco líneas de nada, pero si se equivoca el relleno o
 * no se cambian los caracteres `-_` por `+/`, el navegador rechaza la
 * suscripción con un error genérico que no dice qué pasa.
 */
export function claveVapidABytes(base64url: string) {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(base64);
  // El ArrayBuffer se reserva explícitamente: `new Uint8Array(n)` se tipa como
  // `Uint8Array<ArrayBufferLike>` y `applicationServerKey` exige uno
  // respaldado por `ArrayBuffer` a secas (podría ser un SharedArrayBuffer).
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

/* ---------------- Aviso de nueva venta ---------------- */

export type MiembroVenta = {
  id: string;
  nombre: string | null;
  activo: boolean;
  acceso_total: boolean;
  modulos: string[] | null;
};

/**
 * Quién recibe el aviso de un nuevo cierre: TODO el equipo activo, sin filtro
 * de módulo. Es lo contrario que `destinatarios` (inbox) y es a propósito —
 * petición de Alex (3-sep): el cierre lo celebra todo el equipo. La privacidad
 * va en el contenido (sin monto, ver `contenidoAvisoVenta`) y en el destino
 * del clic (`urlAvisoVenta`), no en recortar la lista.
 */
export function destinatariosVenta<T extends MiembroVenta>(miembros: T[]): T[] {
  return miembros.filter((m) => m.activo);
}

/**
 * Quién se queda fuera del aviso de un cierre concreto.
 *
 * Por defecto no se filtra a nadie: `aviso_venta_alcance` vale 'todas' para
 * todo el equipo (0058) y eso conserva la regla de Alex del 3-sep, "el cierre
 * lo celebra todo el equipo".
 *
 * La excepción es 'asignadas': esa persona solo se entera de las ventas donde
 * figura como setter. Se estrena con Dani (Milo, 8-sep).
 *
 * ⚠️ Sin setter en la venta (`setterId` null) nadie con 'asignadas' recibe
 * nada. Es deliberado y tiene coste real: `programas.setter_id` es opcional y
 * viene relleno en menos de la mitad de las ventas, así que quien esté en
 * 'asignadas' se perderá algunas suyas. La alternativa —mandárselo a todos
 * cuando no se sabe de quién es— sería peor: convertiría "solo las mías" en
 * "las mías y la mitad de las ajenas".
 *
 * NO confundir `aviso_venta_alcance` con `push_alcance`: el segundo gobierna
 * las notificaciones del inbox y hoy vale 'ninguna' para media plantilla.
 */
export type MiembroAlcanceVenta = { id: string; aviso_venta_alcance?: string | null };

export function filtrarPorAlcanceVenta<T extends MiembroAlcanceVenta>(
  miembros: T[],
  setterId: string | null,
): T[] {
  return miembros.filter(
    (m) => m.aviso_venta_alcance !== "asignadas" || (!!setterId && m.id === setterId),
  );
}

// Cómo se acredita cada tipo de venta. En "nueva" el autor es el closer; en
// ascensión/extensión la regla de comisiones (Berni, 12-ago — lib/comisiones.ts)
// dice que "da igual quién cerró": el autor es quien hizo la venta, y llamarle
// closer sería mentir. Un tipo fuera de esta tabla se trata como desconocido.
const ETIQUETA_VENTA: Record<string, { tipo: string | null; autor: (a: string) => string }> = {
  nueva: { tipo: null, autor: (a) => `closer: ${a}` },
  ascension: { tipo: "ascensión", autor: (a) => `por ${a}` },
  extension: { tipo: "extensión", autor: (a) => `por ${a}` },
};

/**
 * Qué se enseña en la pantalla bloqueada: cliente, tipo de cierre y autor.
 * Ni el monto NI EL TIER entran como parámetro: en el catálogo real el id del
 * tier ES el precio en euros ('2000', '3500', '5000'…) y su nombre es
 * "€5.000 / 12 meses" — los dos son el dato que este aviso promete no enseñar.
 */
export function contenidoAvisoVenta(v: {
  nombre: string | null;
  tipo: string;
  autor: string | null;
}): { title: string; body: string } {
  const etiqueta = ETIQUETA_VENTA[v.tipo] ?? { tipo: null, autor: (a: string) => `por ${a}` };
  const autor = v.autor?.trim();
  const partes = [
    // El sustituto de un nombre ausente depende del tipo: una ascensión o
    // extensión es de un cliente que YA existe — "Cliente nuevo" mentiría.
    v.nombre?.trim() || (v.tipo === "nueva" ? "Cliente nuevo" : "Cliente"),
    etiqueta.tipo,
    autor ? etiqueta.autor(autor) : null,
  ].filter((p): p is string => !!p);
  return { title: "🎉 Nuevo cierre", body: partes.join(" · ") };
}

/**
 * Sin importe ni tier, como el de la venta: la firma se celebra, no se
 * cuantifica. Misma regla del 3-sep que protege `contenidoAvisoVenta` — en
 * el catálogo real el id del tier ES el precio en euros.
 */
export function contenidoAvisoContratoFirmado(v: { nombre: string | null }): { title: string; body: string } {
  return { title: "🖊️ Contrato firmado", body: v.nombre?.trim() || "Cliente" };
}

/**
 * A dónde lleva el clic: a la ficha del cliente si el miembro puede abrirla,
 * y si no, a su pantalla de inicio — sin esto, un setter sin el módulo
 * `clientes` se estamparía contra un "sin permiso". Desde el centro de
 * novedades, homePath ya nunca devuelve "/login" para un miembro activo (su
 * último recurso es /novedades); la rama null queda como red por si algún
 * día volviera a producir un destino inválido — el aviso iría sin URL y el
 * service worker se limitaría a enfocar la app.
 */
export function urlAvisoVenta(m: MiembroVenta, personaId: string): string | null {
  if (puedeVer(m, "clientes")) return `/clientes/${personaId}`;
  const inicio = homePath(m);
  return inicio === "/login" ? null : inicio;
}
