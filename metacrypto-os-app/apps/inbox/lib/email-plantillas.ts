// ============================================================
// Las plantillas de correo del OS. Funciones puras: reciben datos y
// devuelven { asunto, html, texto }. Sin red, sin base, sin librería.
//
// Las cuatro primeras las lee un CLIENTE. La quinta (`emailAvisoVentaEquipo`)
// la lee el EQUIPO — comparte el envoltorio visual y la guarda de "ningún
// importe", pero no la de "ninguna credencial" (D6): no hay portal de por
// medio.
//
// Por qué a mano y no con las plantillas del panel de Resend: la copia que
// lee el cliente tiene que vivir en git, con revisión e historial. Una copia
// editable desde un panel externo se cambia sin que nadie lo vea.
//
// Dos reglas que los tests vigilan y que no son de estilo:
//
//  · **Ninguna credencial** (D6). El patrón "enlace + Contraseña: X" es el
//    candidato más probable al baneo de la WABA del 2-sep. Cambiar de canal
//    no lo arregla. El acceso viaja en el token del portal.
//  · **Ningún importe.** Los ids de tier SON el precio ('5000') y
//    `tiers.nombre` es "€5.000 / 12 meses". Meter el tier en un correo es
//    mandarle el precio a alguien que quizá pagó otra cosa, sin vuelta atrás.
//
// El HTML lleva los estilos EN LÍNEA a propósito: Gmail descarta las hojas de
// estilo y buena parte de lo que va en <style>. Aquí la regla de "nada de
// estilos en línea" del OS no aplica — es el único formato que sobrevive.
// ============================================================

export type Correo = { asunto: string; html: string; texto: string };

const REPLY_A = "info@invierteconberni.com";

// El nombre entra en HTML: un apellido con `<` rompería el correo, y un campo
// de nombre es dato de fuera (viene de GHL y de Airtable, no de nosotros).
function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Solo el nombre de pila, igual que las plantillas de WhatsApp aprobadas.
function pila(nombre: string): string {
  return (nombre ?? "").trim().split(/\s+/)[0] ?? "";
}

// "Hola Alicia," o, si no sabemos el nombre, "Hola,". Nunca "Hola , ".
function saludo(nombre: string): string {
  const n = pila(nombre);
  return n ? `Hola ${n},` : "Hola,";
}

function envoltorio(cuerpoHtml: string): string {
  return [
    '<div style="margin:0;padding:24px 16px;background:#f6f6f4;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 26px;color:#1c1c1a;font-size:15px;line-height:1.55;">',
    cuerpoHtml,
    '<hr style="border:none;border-top:1px solid #e6e4de;margin:24px 0 14px;">',
    `<p style="margin:0;font-size:12px;color:#78766e;">MetaCrypto Club · Si tienes cualquier duda, responde a este correo (${REPLY_A}).</p>`,
    "</div></div>",
  ].join("");
}

function boton(enlace: string, texto: string): string {
  return `<p style="margin:22px 0;"><a href="${enlace}" style="display:inline-block;background:#1c1c1a;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;">${texto}</a></p>`;
}

// Debajo del botón, el enlace en claro: si el cliente lee en texto plano o su
// cliente no pinta el botón, tiene que poder copiarlo igual.
function enlaceLiteral(enlace: string): string {
  return `<p style="margin:0;font-size:13px;color:#78766e;word-break:break-all;">O copia este enlace: ${enlace}</p>`;
}

const PIE_TEXTO = `\n\n—\nMetaCrypto Club · Si tienes cualquier duda, responde a este correo (${REPLY_A}).`;

// ── 1. La estrategia ──────────────────────────────────────────────────────
export function emailEstrategia(d: { nombre: string; enlace: string }): Correo {
  const n = pila(d.nombre);
  return {
    asunto: n ? `Tu estrategia de inversión, ${n}` : "Tu estrategia de inversión",
    html: envoltorio(
      `<p style="margin:0 0 14px;">${escapar(saludo(d.nombre))}</p>` +
        "<p style=\"margin:0;\">Aquí tienes la estrategia de inversión que hablamos. Entra cuando quieras: el enlace es tuyo y las que te vayamos preparando aparecerán ahí mismo.</p>" +
        boton(d.enlace, "Ver mi estrategia") +
        enlaceLiteral(d.enlace),
    ),
    texto:
      `${saludo(d.nombre)}\n\n` +
      "Aquí tienes la estrategia de inversión que hablamos. Entra cuando quieras: el enlace es tuyo y las que te vayamos preparando aparecerán ahí mismo.\n\n" +
      `${d.enlace}${PIE_TEXTO}`,
  };
}

// ── 2. La confirmación de sesión ──────────────────────────────────────────
export function emailConfirmacionSesion(d: {
  nombre: string;
  coach: string;
  cuando: string;
  enlace: string; // puede venir vacío: ver abajo
}): Correo {
  // La confirmación de WhatsApp (`confirmacion_sesion_es`) NO lleva enlace —
  // sus variables son nombre, coach y fecha—, así que al espejarla aquí el
  // enlace puede llegar vacío. Pintar el botón igualmente daría un
  // "Entrar a la sesión" que apunta a la nada, y eso es PEOR que no tener
  // botón: el cliente lo pulsa. El enlace de Zoom suele llegar más tarde, y
  // para eso está el recordatorio de 1 hora, que sí lo exige.
  const enlace = (d.enlace ?? "").trim();
  return {
    asunto: `Sesión confirmada: ${d.cuando}`.replace(/[\r\n]+/g, " ").slice(0, 120),
    html: envoltorio(
      `<p style="margin:0 0 14px;">${escapar(saludo(d.nombre))}</p>` +
        `<p style="margin:0 0 4px;">Tu sesión con <strong>${escapar(d.coach)}</strong> está confirmada:</p>` +
        `<p style="margin:0;font-size:17px;font-weight:600;">${escapar(d.cuando)}</p>` +
        (enlace
          ? boton(enlace, "Entrar a la sesión") + enlaceLiteral(enlace)
          : '<p style="margin:18px 0 0;font-size:13px;color:#78766e;">Te enviaremos el enlace de la videollamada antes de la sesión.</p>'),
    ),
    texto:
      `${saludo(d.nombre)}\n\n` +
      `Tu sesión con ${d.coach} está confirmada:\n${d.cuando}\n\n` +
      (enlace
        ? `Entra por aquí: ${enlace}`
        : "Te enviaremos el enlace de la videollamada antes de la sesión.") +
      PIE_TEXTO,
  };
}

// ── 3. El recordatorio de 1 hora ──────────────────────────────────────────
export function emailRecordatorio1h(d: {
  nombre: string;
  coach: string;
  hora: string;
  enlace: string;
}): Correo {
  return {
    asunto: "Tu sesión es en 1 hora",
    html: envoltorio(
      `<p style="margin:0 0 14px;">${escapar(saludo(d.nombre))}</p>` +
        `<p style="margin:0;">Te recordamos que tu sesión con <strong>${escapar(d.coach)}</strong> empieza a las <strong>${escapar(d.hora)}</strong>.</p>` +
        boton(d.enlace, "Entrar a la sesión") +
        enlaceLiteral(d.enlace),
    ),
    texto:
      `${saludo(d.nombre)}\n\n` +
      `Te recordamos que tu sesión con ${d.coach} empieza a las ${d.hora}.\n\n` +
      `Entra por aquí: ${d.enlace}${PIE_TEXTO}`,
  };
}

// ── 4. La invitación al calendario ────────────────────────────────────────
// Sustituye al recordatorio de las sesiones grupales: en vez de avisar dos
// veces por semana para siempre, la sesión entra UNA vez en su calendario.
//
// El texto dice "añádelas a tu calendario", NO "te avisaremos una hora
// antes". Es deliberado: Google Calendar ignora el VALARM del fichero (los
// avisos son ajuste privado de cada usuario), así que a un cliente con Gmail
// le sonará su recordatorio por defecto. Prometer una hora sería mentirle a
// la mayoría de la lista.
export function emailInvitacionCalendario(d: {
  nombre: string;
  sesiones: { titulo: string; cuando: string }[];
}): Correo {
  const lista = d.sesiones.map((s) => `${s.titulo} — ${s.cuando}`);
  return {
    asunto: "Tus sesiones en directo, en tu calendario",
    html: envoltorio(
      `<p style="margin:0 0 14px;">${escapar(saludo(d.nombre))}</p>` +
        "<p style=\"margin:0 0 14px;\">Te adjuntamos las sesiones en directo para que las añadas a tu calendario. Se repiten cada semana, así que con añadirlas una vez ya las tienes siempre.</p>" +
        `<ul style="margin:0 0 4px;padding-left:18px;">${d.sesiones
          .map((s) => `<li style="margin-bottom:4px;"><strong>${escapar(s.titulo)}</strong> — ${escapar(s.cuando)}</li>`)
          .join("")}</ul>` +
        '<p style="margin:14px 0 0;font-size:13px;color:#78766e;"><strong>Los horarios son de Madrid.</strong> Al añadirlas, tu calendario las pondrá automáticamente en tu hora local — así que si vives en otro país verás otra hora, y es la correcta.</p>' +
        '<p style="margin:10px 0 0;font-size:13px;color:#78766e;">Abre los dos archivos adjuntos y tu calendario hará el resto. Si usas Gmail, el aviso previo será el que tengas configurado por defecto.</p>',
    ),
    texto:
      `${saludo(d.nombre)}\n\n` +
      "Te adjuntamos las sesiones en directo para que las añadas a tu calendario. Se repiten cada semana, así que con añadirlas una vez ya las tienes siempre.\n\n" +
      lista.map((l) => `· ${l}`).join("\n") +
      "\n\nLos horarios son de Madrid. Al añadirlas, tu calendario las pondrá automáticamente en tu hora local: si vives en otro país verás otra hora, y es la correcta." +
      "\n\nAbre los dos archivos adjuntos y tu calendario hará el resto. Si usas Gmail, el aviso previo será el que tengas configurado por defecto." +
      PIE_TEXTO,
  };
}

// ── 5. El aviso de cierre al equipo ───────────────────────────────────────
// Segundo canal del mismo aviso que ya sale por push (`contenidoAvisoVenta`
// en lib/push.ts): `titulo` y `resumen` vienen de ahí tal cual, para que el
// texto no diverja entre los dos canales. Misma guarda que las cuatro
// anteriores: NINGÚN IMPORTE — los ids de tier SON el precio en euros
// ('5000') y una pantalla "sin dinero" no puede filtrar uno.
//
// `enlace` puede llegar null (recipiente sin PORTAL_BASE_URL configurado, o
// sin destino válido): mismo criterio que `emailConfirmacionSesion` — un
// botón a la nada es peor que ningún botón.
// El correo del contrato. Va al EQUIPO, no al cliente — por eso no usa
// `saludo()` con el nombre del cliente ni el remitente de siempre: sale con
// `EMAIL_FROM_EQUIPO`, igual que el aviso de cierre (ver el comentario de
// remitente en lib/aviso-venta-email.ts:16-19).
//
// El enlace NO es opcional como en el aviso de venta. Un aviso sin enlace
// sigue avisando; un correo de contrato sin forma de llegar al contrato no
// sirve para nada, y dejarlo nullable invitaría a mandarlo así.
/**
 * El contrato va ADJUNTO, no enlazado. Decisión de Patricio del 8-sep.
 *
 * Nació con un botón "Ver el contrato" que llevaba al OS, para que el documento
 * viviera detrás de la sesión y no quedara copiado en tres buzones. Se cambió
 * por un motivo concreto: **Paula no tiene el módulo de ventas**, y la ruta que
 * sirve el PDF lo exige — le llegaba un correo que no podía abrir. Adjuntarlo
 * lo resuelve sin tocar permisos.
 *
 * Lo que se resigna: el PDF pasa a vivir en tres bandejas y es reenviable a
 * cualquiera. El adjunto se arma en `contrato-envio.ts`; aquí solo va el texto.
 */
export function emailContrato(d: {
  cliente: string;
  tipo: "venta_nueva" | "ampliacion";
  // Una recorrección (hallazgo #2 de Milo, PR #3: los bonos cambiaron
  // después del envío original) tiene que verse distinta en la bandeja —
  // mismo asunto de siempre no avisa que este PDF reemplaza a uno anterior.
  recorregido?: boolean;
}): Correo {
  const que = d.tipo === "venta_nueva" ? "Contrato de prestación de servicios" : "Contrato de ampliación";
  const asunto = d.recorregido ? `${que} recorregido · ${d.cliente}` : `${que} · ${d.cliente}`;
  const parrafo = d.recorregido
    ? `Se corrigió un dato de la venta de ${escapar(d.cliente)} y este contrato reemplaza al enviado antes.`
    : `Generado automáticamente al registrarse la venta de ${escapar(d.cliente)}.`;
  const parrafoTexto = d.recorregido
    ? `Se corrigió un dato de la venta de ${d.cliente} y este contrato reemplaza al enviado antes.`
    : `Generado automáticamente al registrarse la venta de ${d.cliente}.`;
  return {
    asunto,
    html: envoltorio(
      `<p style="margin:0 0 4px;font-size:18px;font-weight:600;">${escapar(que)}${d.recorregido ? " — recorregido" : ""}</p>` +
        `<p style="margin:0;">${parrafo}</p>` +
        `<p style="margin:12px 0 0;">El contrato va adjunto a este correo, en PDF.</p>`,
    ),
    texto:
      `${que}${d.recorregido ? " — recorregido" : ""}\n${parrafoTexto}` +
      `\n\nEl contrato va adjunto a este correo, en PDF.` +
      PIE_TEXTO,
  };
}

/**
 * El correo con el enlace de firma. Sale desde EMAIL_FROM (la identidad de
 * Berni, la que el cliente conoce), no desde EMAIL_FROM_EQUIPO — eso lo
 * decide `contrato-envio.ts` (Task 13), no esta plantilla.
 *
 * Sin PDF adjunto a propósito: lo que firma el cliente es lo que sirve
 * `/c/<token>`, y un adjunto sería una segunda copia que podría no coincidir
 * si Alex edita el texto entre el envío y la firma (ver `texto_final` en la
 * 0065). El botón lleva a leerlo y firmarlo ahí, nunca a un fichero suelto.
 */
export function emailContratoCliente(d: { cliente: string; enlace: string; dias: number }): Correo {
  const n = pila(d.cliente);
  const saludoTxt = n ? `Hola, ${n}` : "Hola";
  const cuerpo =
    "Aquí tienes tu contrato con MetaCrypto Club. Léelo con calma y, si estás de acuerdo, fírmalo desde este enlace escribiendo tu nombre:";
  // "Si no lo firmas": la caducidad solo corre mientras el contrato está sin
  // firmar. Una vez firmado, el enlace sigue sirviendo la copia firmada para
  // siempre (`estadoDelEnlace` mira `firmado_at` antes que la caducidad), y
  // decirle al cliente que su copia caduca en 60 días sería falso.
  const pieEnlace = `El enlace es personal. Si no lo firmas, caduca en ${d.dias} días.`;
  return {
    asunto: "Tu contrato con MetaCrypto Club",
    html: envoltorio(
      `<p style="margin:0 0 14px;font-size:18px;font-weight:600;">${escapar(saludoTxt)}</p>` +
        `<p style="margin:0;">${cuerpo}</p>` +
        boton(d.enlace, "Leer y firmar el contrato") +
        enlaceLiteral(d.enlace) +
        `<p style="margin:18px 0 0;font-size:13px;color:#78766e;">${escapar(pieEnlace)}</p>`,
    ),
    texto: `${saludoTxt}.\n\n${cuerpo}\n\n${d.enlace}\n\n${pieEnlace}` + PIE_TEXTO,
  };
}

export function emailAvisoVentaEquipo(d: {
  titulo: string;
  resumen: string;
  enlace: string | null;
}): Correo {
  return {
    asunto: d.titulo,
    html: envoltorio(
      `<p style="margin:0 0 4px;font-size:18px;font-weight:600;">${escapar(d.titulo)}</p>` +
        `<p style="margin:0;">${escapar(d.resumen)}</p>` +
        (d.enlace ? boton(d.enlace, "Ver en el OS") + enlaceLiteral(d.enlace) : ""),
    ),
    texto:
      `${d.titulo}\n${d.resumen}` +
      (d.enlace ? `\n\nVer en el OS: ${d.enlace}` : "") +
      PIE_TEXTO,
  };
}
