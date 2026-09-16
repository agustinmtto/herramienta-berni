import { createHash, randomBytes } from "node:crypto";

// ============================================================
// Las reglas de la firma del cliente, sin base de datos: qué es un enlace
// válido, cuándo caduca, qué tiene que traer el formulario, y cómo se escribe
// la línea de evidencia que va dentro del PDF. Todo lo que aquí se decide
// tiene test; lo que toca la base vive en contrato-firma-datos.ts.
//
// Sin `server-only` y sin imports `@/` a propósito: este fichero tiene tests
// y bajo vitest el alias no resuelve (misma regla que contrato-pdf.ts:2-4).
// ============================================================

export const DIAS_CADUCIDAD = 60; // decisión de Milo, 15-sep

export const CONSENTIMIENTO_VERSION = 1;
export const CONSENTIMIENTO =
  "He leído y acepto los términos y condiciones de este contrato. " +
  "Entiendo que se registrarán la fecha, la hora y la dirección IP desde la que firmo.";

// base64url de 24 bytes = 32 caracteres. Mismo alfabeto y misma longitud que
// el portal de estrategias (estrategias-datos.ts:80-82); el rango admite
// tokens más largos por si algún día crecen.
export const RE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function nuevoToken(): string {
  return randomBytes(24).toString("base64url");
}

/** `${base}/c/${token}`. Vacío si falta algo: mejor no mandar nada que mandar "/c/x". */
export function enlaceFirma(base: string, token: string): string {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  const t = (token ?? "").trim();
  if (!b || !t) return "";
  return `${b}/c/${t}`;
}

export function hashPdf(bytes: ArrayBuffer | Uint8Array | Buffer): string {
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return createHash("sha256").update(u8).digest("hex");
}

export function caducidad(desde: Date): string {
  return new Date(desde.getTime() + DIAS_CADUCIDAD * 24 * 60 * 60 * 1000).toISOString();
}

export type FilaEnlace = {
  firmado_at: string | null;
  enviado_cliente_at: string | null;
  token_expira_at: string | null;
};

/**
 * "firmado" gana a todo (incluso a un enlace ya caducado: firmar no se
 * deshace por el paso del tiempo). Después, cualquier cosa que no sea un
 * enlace enviado y vigente es "no_activo" — token sin enviar, sin fecha de
 * caducidad registrada, o caducado justo en el segundo de corte incluido.
 *
 * 🔴 CONSECUENCIA QUE NADIE MÁS DECLARA: UNA VEZ FIRMADO, EL ENLACE NO
 * CADUCA NUNCA. `firmado_at` se comprueba ANTES que `token_expira_at`, así
 * que pasados los DIAS_CADUCIDAD la página sigue respondiendo y el visor
 * sigue sirviendo el PDF firmado a quien tenga la URL, indefinidamente.
 *
 * Es deliberado y es lo correcto: el cliente tiene que poder volver a por su
 * copia, y no hay a quién pedírsela si el enlace muere. Pero conviene saber
 * que entonces los días que el correo de `emailContratoCliente` promete
 * (`DIAS_CADUCIDAD`, arriba) describen solo la ventana PARA FIRMAR, no el
 * acceso al documento.
 *
 * Quien quiera que la copia también caduque tiene que decidirlo aquí, y
 * sabiendo que deja a un cliente sin su contrato.
 *
 * La página pinta LO MISMO para inexistente, no enviado, caducado y
 * revocado: distinguirlos le confirmaría a quien pruebe enlaces cuáles
 * existen (misma decisión que el portal de estrategias).
 */
export function estadoDelEnlace(f: FilaEnlace, ahora: Date): "listo" | "firmado" | "no_activo" {
  // `!= null` a propósito, no una comprobación de verdad ("truthy"): el tipo
  // permite `firmado_at: ""`, y con `if (f.firmado_at)` ese caso se cuela
  // (falso) hasta el `"listo"` final si enviado_cliente_at y token_expira_at
  // están bien — justo el fallo abierto que este bloque existe para evitar.
  if (f.firmado_at != null) return "firmado";
  if (!f.enviado_cliente_at || !f.token_expira_at) return "no_activo";
  const expira = new Date(f.token_expira_at).getTime();
  // Fallo cerrado: un `token_expira_at` que no parsea da NaN, y `NaN <= x` es
  // `false` en JS — sin esta guarda, una fecha corrupta caería al `"listo"`
  // final en vez de al `"no_activo"` que promete el comentario de arriba.
  if (Number.isNaN(expira) || expira <= ahora.getTime()) return "no_activo";
  return "listo";
}

/**
 * `acepto` se comprueba antes que `nombre` a propósito: sin la casilla
 * marcada no importa lo que se haya escrito, y así lo reporta el error
 * cuando fallan los dos a la vez.
 */
export function validarFormularioFirma(x: {
  nombre: unknown;
  acepto: unknown;
}): { ok: true; nombre: string } | { ok: false; error: "nombre" | "acepto" } {
  if (x.acepto !== "si") return { ok: false, error: "acepto" };
  // No es una regla de negocio, es cerrar una permisividad de `unknown`: sin
  // esto, `{}` se convertiría en "[object Object]" (11 caracteres, pasa) y
  // `["a","b"]` en "a,b" (3 caracteres, pasa).
  if (typeof x.nombre !== "string") return { ok: false, error: "nombre" };
  const nombre = x.nombre.replace(/\s+/g, " ").trim();
  if (nombre.length < 3 || nombre.length > 120) return { ok: false, error: "nombre" };
  return { ok: true, nombre };
}

/** En hora de Madrid, que es la del contrato — no la del proceso (Vercel = UTC; Chile = UTC-4). */
export function fechaHoraMadrid(d: Date): { fecha: string; hora: string } {
  const p = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { fecha: `${v("day")}/${v("month")}/${v("year")}`, hora: `${v("hour")}:${v("minute")}` };
}

/**
 * La línea que va impresa bajo la firma. Nombra el hash del documento que el
 * cliente ACEPTÓ (el que se le mandó): el del PDF firmado no puede ir dentro
 * de sí mismo.
 */
export function lineaEvidencia(x: { nombre: string; firmadoAt: Date; ip: string | null; hash: string }): string {
  const { fecha, hora } = fechaHoraMadrid(x.firmadoAt);
  const desde = x.ip ? `desde la IP ${x.ip}` : "desde una IP no registrada";
  return (
    `Firmado electrónicamente por ${x.nombre} el ${fecha} a las ${hora} (Europe/Madrid) ${desde}. ` +
    `Huella SHA-256 del documento aceptado: ${x.hash}.`
  );
}

/**
 * Agentes que NO son el cliente. La lista es CORTA a propósito: el filtro que
 * hace el trabajo es el de `debeMarcarVisto`, que exige que el agente diga
 * "Mozilla". Todo navegador de una persona lo lleva desde hace treinta años,
 * así que `curl`, `wget`, `python-requests`, el fetcher de previsualización de
 * WhatsApp ("WhatsApp/2.x" a secas) o cualquier sonda casera se quedan fuera
 * sin necesitar una entrada aquí.
 *
 * Aquí abajo solo van los que SÍ se disfrazan de navegador, y cada entrada
 * tiene que ganarse el sitio con un agente concreto y con `Mozilla` en la
 * cadena — porque una entrada que no caza nada no es neutral: puede bloquear a
 * un cliente de verdad que lleve esa palabra.
 *
 *   bot      Googlebot, bingbot, Discordbot, TelegramBot, AhrefsBot,
 *            UptimeRobot… casi todo rastreador se pone "bot" en el nombre
 *   crawl    los que se identifican por la URL de su crawler y no dicen "bot"
 *   spider   Baiduspider, Sogou Spider
 *   slurp    Yahoo! Slurp
 *   preview  BingPreview y compañía
 *   headless HeadlessChrome — Puppeteer/Playwright de fábrica, que es con lo
 *            que está hecho medio escáner de enlaces moderno
 *   facebookexternalhit          la de Meta: Messenger e Instagram, que es por
 *                                donde habla este negocio. Manda las dos
 *                                formas, y una lleva "Mozilla/5.0 (compatible;"
 *   proofpoint, mimecast,
 *   barracuda, symantec,
 *   forcepoint                   los escáneres de enlaces de correo
 *                                corporativo. EL caso que motivó la función
 *
 * 🔴 Lo que se cayó de la lista el 16-sep, y por qué (la regla: si el bot no
 * dice "Mozilla", la entrada es redundante y solo puede hacer daño):
 *
 *   whatsapp  QUITADO, y es el importante. El que previsualiza manda
 *             "WhatsApp/2.x" sin "Mozilla", así que el filtro de arriba ya lo
 *             para. Lo único que conseguía la entrada era bloquear al
 *             NAVEGADOR INTEGRADO de WhatsApp, que manda una cadena completa
 *             de Chrome con "WhatsApp/" añadida — o sea, a un cliente de
 *             verdad leyendo su contrato, y por el canal por el que le llega
 *             el enlace a la mayoría. Decisión de Milo.
 *   telegram  redundante: su agente es "TelegramBot (like TwitterBot)", que ya
 *             cae por "bot"; y el navegador integrado de Telegram sí podría
 *             llevar "Telegram" en la cadena.
 *   discord   redundante por lo mismo: "Discordbot/2.0" cae por "bot".
 *   monitor,
 *   scan      no sé nombrar un solo agente con "Mozilla" que las lleve. Una
 *             entrada que no caza a nadie concreto es superstición, no filtro.
 */
const AGENTES_AUTOMATICOS =
  /bot|crawl|spider|slurp|preview|headless|facebookexternalhit|proofpoint|mimecast|barracuda|symantec|forcepoint/i;

/**
 * ¿Esta petición cuenta como que el cliente abrió su contrato?
 *
 * `visto_at` es lo que la pestaña de contratos le dirá a Alex ("ya lo vio") y
 * los eventos `abierto` son la evidencia de que el documento estuvo delante
 * de alguien antes de firmarse. Si lo primero que consta es un escáner de
 * enlaces de un correo corporativo, las dos cosas mienten.
 *
 * FALLA HACIA EL LADO SEGURO, y el lado seguro es NO marcar: un `visto_at`
 * que llega tarde no le hace daño a nadie; uno que llega antes de tiempo es
 * una afirmación falsa dentro de un expediente. Por eso se exige una prueba
 * positiva de navegador (el "Mozilla" de toda la vida) en vez de descartar
 * solo lo que reconocemos: la lista de bots nunca está completa, la de
 * navegadores sí.
 *
 * Lo que este filtro NO puede hacer, y conviene no engañarse: un escáner que
 * manda una cadena de Chrome limpia, sin marcador ninguno, es indistinguible
 * de una persona y marcará el contrato como visto. Contra eso no hay
 * user-agent que valga.
 *
 * `metodo`: los escáneres suelen pedir HEAD antes que GET. Ojo, esto solo se
 * puede comprobar desde un route handler — medido el 16-sep: en una página
 * RSC el método no llega ni por `headers()`, y `after()` corre igual en un
 * HEAD. Por eso la marca vive en `/c/<token>/pdf` y no en la página.
 */
export function debeMarcarVisto(x: { metodo: string; userAgent: string | null }): boolean {
  if (x.metodo !== "GET") return false;
  const ua = (x.userAgent ?? "").trim();
  if (!ua || !/mozilla/i.test(ua)) return false;
  return !AGENTES_AUTOMATICOS.test(ua);
}

/**
 * El nombre con el que el cliente se guarda su contrato. Lo ve él, así que
 * lleva su nombre y no el uuid del programa — igual que el adjunto que le
 * manda el equipo (`contrato-envio.ts:525`, que tiene hoy un gemelo privado de
 * esta misma normalización; conviene unificarlos cuando esa rama se calme).
 *
 * Sin acentos, sin espacios y sin nada que rompa un nombre de fichero en
 * Windows. De paso, lo que queda es ASCII puro: una cabecera
 * `Content-Disposition` con una ñ dentro obliga a la forma `filename*=UTF-8''`
 * y no todos los navegadores la leen igual.
 */
export function nombreArchivoContrato(nombre: string | null | undefined, firmado: boolean): string {
  const limpio = (nombre ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const base = firmado ? "Contrato-firmado" : "Contrato";
  // Sin nombre utilizable —uno entero en otro alfabeto— antes "contrato.pdf"
  // que un fichero llamado "-.pdf".
  return limpio ? `${base}-${limpio}.pdf` : `${base}.pdf`;
}
