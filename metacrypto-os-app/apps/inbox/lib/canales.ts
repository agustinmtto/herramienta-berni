import { createHash } from "node:crypto";
// `import type` y no un import normal: este fichero tiene tests, y un lib con
// tests no puede resolver el alias `@/` en runtime bajo vitest. Un import de
// tipo se borra al compilar, así que no llega a runtime y no rompe nada.
import type { EstadoWa } from "@/lib/wa-estado";

// ============================================================
// Por dónde sale cada aviso al cliente, y cómo se le pone nombre único a un
// envío de correo.
//
// Las dos piezas viven juntas porque las dos son "política de canal": una
// decide si se manda, la otra impide que se mande dos veces.
// ============================================================

export type TipoEmail =
  | "estrategia"
  | "confirmacion_sesion"
  | "recordatorio_1h"
  | "invitacion_calendario"
  | "aviso_venta_equipo"
  // Esta lista y la CHECK de `emails_enviados.tipo` (0057) se mueven JUNTAS.
  // Si el código manda un tipo que la base no acepta, el correo sale y el
  // registro falla: el incidente del 12-ago otra vez (0054, líneas 12-15).
  | "contrato"
  // El enlace de firma al CLIENTE (0065). Distinto de "contrato", que es la
  // copia interna al equipo con el PDF adjunto.
  | "contrato_cliente";

// ── D2 · D3 ───────────────────────────────────────────────────────────────
// El email sale SIEMPRE; WhatsApp solo si el canal está vivo.
//
// Decisión de Milo del 3-sep-2026, con su coste asumido: mientras los dos
// canales funcionen, el cliente recibe el mismo aviso dos veces. Se elige
// entrega máxima sobre elegancia, viniendo de un canal único que se cayó
// entero sin avisar.
//
// Está en una función de una línea a propósito (D3): el día que la política
// cambie a "email solo si WhatsApp está caído", se cambia aquí y en ningún
// otro sitio. Los tres puntos de llamada no saben de política.
export function canales(wa: EstadoWa): { whatsapp: boolean; email: boolean } {
  return { whatsapp: !wa.bloqueado, email: true };
}

// ── La clave de idempotencia ──────────────────────────────────────────────
// Hace dos trabajos con el mismo valor:
//   1. Viaja como cabecera `Idempotency-Key` a Resend → dentro de 24 h, dos
//      peticiones iguales producen UN correo.
//   2. Es `unique` en `emails_enviados` → esa protección NO caduca. La de
//      Resend sí, a las 24 h.
//
// El segundo trabajo es el que importa: el incidente del 12-ago (el mismo
// recordatorio enviado 7 veces) ocurrió porque el envío salía y el registro
// fallaba. Aquí el registro es una restricción de la base, no una consulta.
const MAX_CLAVE = 256; // límite de Resend

// ── Los dos constructores que hay que usar ────────────────────────────────
//
// `claveIdempotencia` es el mecanismo; estos dos son la política. Existen
// porque componer la referencia a mano se puede hacer mal de dos maneras, y
// las dos fallan en silencio y para siempre. Una revisión adversarial del
// 3-sep las encontró antes de que llegaran a producción; cuatro lentes
// independientes dieron con la primera.
//
// 🔴 1. **El token del portal NO sirve como referencia de una estrategia.**
//    `portal_accesos.persona_id` es UNIQUE — un cliente, un enlace vivo — y
//    `crear_estrategia` hace get-or-create: el token NUNCA cambia por
//    publicarle una estrategia más. Usarlo haría la clave constante por
//    cliente: la primera estrategia sale y la SEGUNDA choca contra el índice
//    único y no sale nunca. La unidad de negocio es la estrategia.
export function claveEstrategia(estrategiaId: string): string {
  const id = (estrategiaId ?? "").trim();
  if (!id) throw new Error("claveEstrategia: hace falta el id de la estrategia.");
  return claveIdempotencia("estrategia", id);
}

// 🔴 2. **Una sesión reagendada conserva su id.** GHL mantiene el
//    `appointment_id` y el sync pisa `fecha` en el upsert, así que
//    `sesiones.id` no cambia. Sin la fecha dentro, el recordatorio de la
//    sesión NUEVA se toma por ya enviado y el cliente se queda sin aviso de
//    la sesión que sí ocurre. Con la fecha, mover una sesión genera clave
//    nueva y vuelve a avisar — que es justo lo que hay que hacer.
//
// 🔴 3. **Un aviso grupal necesita el destinatario dentro.** El recordatorio
//    de las sesiones recurrentes va a TODA la audiencia sobre UNA sola fila
//    de `sesiones`: sin `destinatario`, los 109 clientes comparten clave y
//    solo el primero recibe el correo — los otros 108 se descartan como
//    duplicados, aquí y también en Resend. Para el caso 1-a-1 se omite.
export function claveSesion(
  tipo: Exclude<TipoEmail, "estrategia">,
  sesionId: string,
  fechaIso: string,
  destinatario?: string,
): string {
  const s = (sesionId ?? "").trim();
  const f = (fechaIso ?? "").trim();
  const d = (destinatario ?? "").trim().toLowerCase();
  if (!s) throw new Error("claveSesion: hace falta el id de la sesión.");
  if (!f) throw new Error("claveSesion: hace falta la fecha de la sesión.");
  return claveIdempotencia(tipo, d ? `${s}:${f}:${d}` : `${s}:${f}`);
}

// 🔴 4. El aviso de cierre es al EQUIPO, y desde el 8-sep va en UN SOLO correo
//    con todo el equipo en el "para" — no uno por persona. Por eso la clave es
//    del PAGO y ya no lleva el id del miembro dentro.
//
//    Antes sí lo llevaba, y era imprescindible: con seis envíos separados, sin
//    el miembro en la clave el primero "ganaba" y los otros cinco se
//    descartaban como duplicados. Al pasar a un envío, esa defensa se vuelve
//    justo lo contrario — seis claves para un correo dejarían seis filas y
//    permitirían seis reenvíos del mismo aviso.
export function claveAvisoVentaEquipo(pagoId: string): string {
  const p = (pagoId ?? "").trim();
  if (!p) throw new Error("claveAvisoVentaEquipo: hace falta el id del pago.");
  return claveIdempotencia("aviso_venta_equipo", p);
}

// 🔴 5. El contrato: UN correo con los tres en el "para", UNA clave.
//
//    Nació con el id del miembro dentro, como los dos de arriba, porque salían
//    tres correos separados y sin él el primero ganaba la clave y los otros dos
//    se descartaban como duplicados. Con un solo envío se INVIERTE: varias
//    claves para un mismo correo dejarían varias filas en `emails_enviados` y
//    permitirían reenviarlo. Mismo cambio que hizo el aviso de venta.
//
//    La referencia es el PROGRAMA y no el pago, a diferencia del aviso de
//    venta. No es un detalle de estilo: un programa puede recibir más pagos
//    (las cuotas), y con `pagoId` dentro, un segundo cobro del mismo programa
//    daría clave nueva y mandaría el contrato por segunda vez. El contrato es
//    del programa, que es lo que el índice único de `contratos.programa_id`
//    (0057) ya declara en la base.
//    `intento` solo lo usa el reenvío manual. El envío automático NO lo pasa,
//    y ahí está la gracia: sin sufijo, dos pasadas del hook comparten clave y
//    la segunda se descarta. Un reenvío es lo contrario — una persona pidiendo
//    a propósito que salga otra vez —, así que necesita clave nueva o
//    `yaSeEnvioEmail` lo frenaría y devolvería un éxito falso.
export function claveContrato(programaId: string, intento?: string): string {
  const p = (programaId ?? "").trim();
  if (!p) throw new Error("claveContrato: hace falta el id del programa.");
  const i = (intento ?? "").trim();
  return claveIdempotencia("contrato", i ? `${p}:${i}` : p);
}

// 🔴 6. El enlace de firma al cliente: el token entra en la clave, pero
//    HASHEADO — la clave depende de él y no lo contiene.
//
//    Al contrario que `claveContrato` de arriba —donde `intento` es opcional
//    y solo lo usa el reenvío manual—, aquí el token no es opcional: cada
//    reenvío genera un token nuevo (rota el anterior, 0065), así que un
//    reenvío YA ES una referencia distinta sin necesitar un sufijo aparte.
//    Sin el token en la clave, el segundo envío (con enlace nuevo) se
//    descartaría como duplicado del primero y el cliente se quedaría con un
//    enlace roto sin saberlo.
//
//    🔴 POR QUÉ LA HUELLA Y NO EL TOKEN. Este token es una CREDENCIAL VIVA:
//    quien lo tenga abre `/c/<token>` y firma en nombre del cliente hasta que
//    caduque. Y una clave de idempotencia no se queda en memoria — viaja a
//    Resend como cabecera, se guarda para siempre en
//    `emails_enviados.idempotency_key` y sale por consola en los dos
//    `console.error` de `lib/email-envio.ts`, o sea a los logs de Vercel.
//    Escrito entero, cualquiera que pueda leer esa tabla o esos registros
//    puede firmar contratos ajenos. Es el único sitio del repo donde una
//    credencial viva saldría del buzón de su dueño: `claveEstrategia` usa el
//    id de la estrategia, no el token del portal.
//
//    La huella conserva la semántica ENTERA, que es lo único que la clave
//    necesita: es determinista (el mismo token da la misma clave, así que el
//    doble envío se sigue frenando) e inyectiva en la práctica (un token
//    nuevo da clave nueva, así que el reenvío sigue saliendo). Lo único que
//    se pierde es poder leer el token en la tabla, que es justo el objetivo.
//
//    64 bits de huella: el espacio que tiene que separar son los envíos de UN
//    programa —unos pocos—, no el universo de tokens.
export function claveContratoCliente(programaId: string, token: string): string {
  const p = (programaId ?? "").trim();
  const t = (token ?? "").trim();
  if (!p || !t) throw new Error("claveContratoCliente: hacen falta el programa y el token.");
  return claveIdempotencia("contrato_cliente", `${p}:${huella(t)}`);
}

/** sha256 recortado a 16 hex. Para meter en una clave algo que DEPENDE de un
    secreto sin que el secreto viaje con ella. */
function huella(secreto: string): string {
  return createHash("sha256").update(secreto).digest("hex").slice(0, 16);
}

export function claveIdempotencia(tipo: TipoEmail, referencia: string): string {
  const prefijo = `mcc:${tipo}:`;
  const clave = prefijo + referencia;
  if (clave.length <= MAX_CLAVE) return clave;

  // Recortar por las bravas sería un fallo silencioso y grave: dos referencias
  // que comparten prefijo darían la MISMA clave, y la segunda se descartaría
  // como duplicado. Traducido: un cliente que no recibe su estrategia porque
  // la de otro "ya se envió". La huella conserva la unicidad y siempre cabe.
  //
  // En la práctica no entra por aquí —un uuid son 36 caracteres y un token de
  // portal menos de 64—, pero el día que alguien pase algo largo, esto falla
  // bien en vez de mal.
  return prefijo + createHash("sha256").update(referencia).digest("hex");
}

// ── La invitación de calendario ───────────────────────────────────────────
//
// A diferencia de los avisos, esta se manda UNA vez… salvo que cambie el
// horario. Entonces hay que reenviarla con el MISMO UID y un SEQUENCE mayor,
// para que los calendarios actualicen el evento en vez de duplicarlo.
//
// La huella del horario dentro de la clave es lo que da esa propiedad gratis:
// mientras el horario no cambie, la clave es la misma y el antiduplicados la
// frena; en cuanto cambia, la clave es nueva y sale sola. Sin la huella
// habría que acordarse de forzar el reenvío a mano — y nadie se acuerda.
export function claveInvitacion(reglaId: string, huella: string, destinatario: string): string {
  const r = (reglaId ?? "").trim();
  const h = (huella ?? "").trim();
  const d = (destinatario ?? "").trim().toLowerCase();
  if (!r || !h || !d) throw new Error("claveInvitacion: faltan regla, huella o destinatario.");
  return claveIdempotencia("invitacion_calendario", `${r}:${h}:${d}`);
}

// Solo lo que el cliente VE en su calendario. Si la huella cambiara con
// cualquier edición de la fila —el coach, la audiencia, la duración—, cada
// retoque dispararía 109 correos. Cambiar de coach no mueve el evento.
export function huellaHorario(regla: {
  dia_semana: number;
  hora: string | null;
  enlace: string | null;
}): string {
  return `${regla.dia_semana}-${(regla.hora ?? "").slice(0, 5)}-${regla.enlace ?? ""}`;
}

// ── A dónde va el contrato ───────────────────────────────────────────────────

/**
 * La decisión, separada de la lectura para poder probarla sin base de datos.
 * Es la regla que decide si un documento legal sale al equipo, a un buzón de
 * pruebas, o no sale: merece un test propio.
 */
export function decidirDestinatarios(
  modo: string | null,
  lista: string | null,
  respaldoEnv: string | undefined,
): string[] | null {
  if (modo === "off") return [];

  if (modo === "on") {
    const dirs = repartir(lista);
    return dirs.length > 0 ? dirs : null;
  }

  // Ni "on" ni "off": la tabla no contestó, o trae un valor que no entendemos.
  // Solo el respaldo explícito de la variable de entorno rescata esto.
  const respaldo = repartir(respaldoEnv);
  return respaldo.length > 0 ? respaldo : null;
}

function repartir(crudo: string | null | undefined): string[] {
  return (crudo ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
