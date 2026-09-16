// ============================================================
// Envío de un correo por Resend. Solo eso.
//
// NO importa Supabase a propósito. El registro en `emails_enviados` vive en
// `lib/email-envio.ts`, que compone las dos cosas. La separación no es
// estética: un lib que importa `@/lib/supabase` no se puede importar bajo
// vitest (el alias `@/` no resuelve en runtime), y eso convertiría los guards
// en algo que solo se puede comprobar leyendo el fuente. Aquí se comprueban
// de verdad, con la red simulada.
//
// El contrato de vuelta tiene la MISMA FORMA que `EnvioPlantillaResult` —una
// unión discriminada por `ok`— pero no es el mismo tipo: aquí la rama buena
// lleva `resendId` y no `registrado`, porque el registro en la base lo hace
// otro módulo. Copiar la forma es lo que hace barato tener dos canales: los
// puntos de llamada ya saben tratarla.
//
//   `incierto` distingue "no llegué a llamar" (guard local: con certeza no
//   salió nada) de "llamé y falló de forma ambigua" (5xx, red caída: puede
//   haber salido igual). Quien llama debe mirar `incierto`, NUNCA `status`:
//   los guards locales usan códigos ≥500 (501) sin que eso signifique que
//   hubo una llamada real.
//
// Sin reintento automático, por lo mismo que en `enviarPlantilla`: si Resend
// acepta y falla nuestro registro, un reintento duplica el correo al cliente.
// La `Idempotency-Key` cubre ese hueco mucho mejor que un reintento ciego.
// ============================================================

const ENDPOINT = "https://api.resend.com/emails";

// Unión discriminada, con la MISMA forma que `EnvioPlantillaResult`: en la
// rama buena no hay `error` ni `incierto`, y en la mala no hay `resendId`.
//
// No es cosmética. Un objeto plano con campos opcionales deja escribir
// `if (r.error)` sobre un envío correcto y leer `undefined` sin que nadie se
// queje; la unión hace que el compilador obligue a mirar `ok` primero, que es
// exactamente la disciplina que `enviarYCubrirIncierto` y `avisarEstrategia`
// ya aplican con las plantillas.
export type ResultadoEmail =
  | { ok: true; status: number; resendId: string }
  | { ok: false; error: string; status: number; incierto: boolean };

type Env = Record<string, string | undefined>;

export async function enviarEmail(
  args: {
    // Uno o varios. Varios = UN correo con todos en el "para", no N correos:
    // así el equipo lo ve como una conversación y el envío cuenta como uno
    // solo contra el límite de Resend. Nace para el aviso de cierre, que iba
    // a seis direcciones y gastaba seis envíos para decir lo mismo.
    to: string | string[];
    asunto: string;
    html: string;
    texto: string;
    idempotencyKey: string;
    // Los adjuntos van en el tipo, no colados con un `@ts-expect-error`: es
    // el único punto de toda la API de Resend donde se controla un
    // Content-Type, y de él depende que un .ics llegue como invitación y no
    // como fichero descargable.
    adjuntos?: { filename: string; content: string; content_type: string }[];
    // Remitente de ESTE envío, si no debe ser el de siempre. Nace para el
    // aviso al equipo: `EMAIL_FROM` lleva la identidad "Berni · MetaCrypto
    // Club" para hablarle a un CLIENTE, y usarla con Berni como destinatario
    // haría que se avisara "a sí mismo". Sin este campo, `EMAIL_FROM` de
    // siempre.
    from?: string;
  },
  env: Env = process.env,
): Promise<ResultadoEmail> {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const from = (args.from ?? env.EMAIL_FROM ?? "").trim();
  const replyTo = (env.EMAIL_REPLY_TO ?? "").trim();

  // ── Guards locales. Los cuatro antes del fetch, todos con incierto:false ──
  if (!apiKey) {
    return { ok: false, error: "Falta RESEND_API_KEY en las env vars de Vercel.", status: 501, incierto: false };
  }
  if (!from) {
    return { ok: false, error: "Falta EMAIL_FROM (o el remitente del canal) en las env vars de Vercel.", status: 501, incierto: false };
  }
  const destinos = (Array.isArray(args.to) ? args.to : [args.to])
    .map((d) => (d ?? "").trim())
    .filter(Boolean);
  if (destinos.length === 0) {
    return { ok: false, error: "El cliente no tiene email registrado.", status: 400, incierto: false };
  }
  // Sin clave no hay antiduplicados, ni el de Resend ni el nuestro. Preferimos
  // no mandar a mandar sin red: es justo el escenario de los 7 reenvíos.
  if (!args.idempotencyKey?.trim()) {
    return { ok: false, error: "Falta la clave de idempotencia del envío.", status: 400, incierto: false };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": args.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: destinos,
        subject: args.asunto,
        html: args.html,
        text: args.texto,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(args.adjuntos?.length ? { attachments: args.adjuntos } : {}),
      }),
    });
  } catch (e) {
    // La petición pudo llegar y morir la respuesta. Incierto, no fallo seguro.
    return {
      ok: false,
      error: `No se pudo contactar con Resend: ${e instanceof Error ? e.message : "error de red"}.`,
      status: 0,
      incierto: true,
    };
  }

  // Como texto y no `res.json()`: cuando un proveedor se cae devuelve HTML, y
  // con json() ese detalle se pierde en un `null`. Lección del 500 de Kapso
  // del 6-ago, que dejó el error real fuera del log.
  const bruto = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = bruto ? JSON.parse(bruto) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    console.error("[email] resend rechazó el envío", res.status, bruto.slice(0, 500));
    return {
      ok: false,
      error: mensajeDeError(res.status, data?.message ?? data?.error?.message),
      status: res.status,
      incierto: res.status >= 500,
    };
  }

  // Un 200 sin id no es un envío. Mismo modo de fallo que el 200 de Kapso sin
  // `messages[0].id`: darlo por bueno deja una fila que dice "enviado" sin
  // nada con qué comprobarlo después.
  const resendId = typeof data?.id === "string" ? data.id : "";
  if (!resendId) {
    console.error("[email] resend devolvió 200 sin id", bruto.slice(0, 300));
    return {
      ok: false,
      error: "Resend aceptó la petición pero no devolvió un id de correo.",
      status: res.status,
      incierto: true,
    };
  }

  return { ok: true, status: res.status, resendId };
}

// ── Qué queda escrito en `emails_enviados` ────────────────────────────────
//
// Aquí el email se comporta AL REVÉS que WhatsApp, y conviene tenerlo claro
// porque el instinto heredado de `enviarPlantilla` lleva a lo contrario.
//
// En WhatsApp, un envío incierto (5xx de Kapso) HAY que registrarlo aunque no
// conste: reintentarlo puede duplicar el mensaje y no hay forma de saberlo.
// Eso es lo que hace `registrarEnvioIncierto`.
//
// En email no hace falta: la `Idempotency-Key` es determinista y Resend
// deduplica 24 h. Reintentar es seguro, y los crons pasan cada 5 minutos —
// muy dentro de esa ventana. Así que lo reintentable NO se registra y la
// pasada siguiente lo vuelve a intentar; Resend garantiza que al cliente le
// llegue uno solo.
//
// Copiar aquí la defensa de WhatsApp convertiría un fallo de red de un minuto
// en un aviso perdido para siempre.
export function decidirRegistro(r: ResultadoEmail): { registrar: boolean; estado: string } {
  if (r.ok) return { registrar: true, estado: "enviado" };

  // 🔴 La regla es lista BLANCA de lo permanente, no lista negra de lo
  // reintentable. Al revés —que es como nació— un 401 (clave rotada o mal
  // copiada) y un 403 (dominio sin verificar) se registraban como rechazo
  // definitivo: la fila quedaba escrita con su `idempotency_key` UNIQUE y
  // `yaSeEnvioEmail` devolvía true PARA SIEMPRE. Ese cliente no volvía a
  // recibir ese correo aunque la credencial se arreglara cinco minutos
  // después.
  //
  // Lo destapó una auditoría adversarial el 4-sep, y la ironía es que este
  // mismo fichero ya tenía un mensaje redactado a mano para el 403 de
  // "dominio no verificado": estaba previsto como transitorio en el texto y
  // tratado como definitivo en la lógica.
  //
  // Solo son permanentes los que reintentar no arregla: el payload es
  // inválido (422) o falta el destinatario (400, incluidos los guards
  // locales). Todo lo demás —credenciales, configuración, límites, red, y
  // cualquier código que Resend invente mañana— se reintenta.
  //
  // La duda cae del lado de reintentar a propósito: con la Idempotency-Key un
  // reintento de más es gratis, y un aviso quemado no se recupera.
  const PERMANENTES = new Set([400, 422]);
  if (!PERMANENTES.has(r.status)) return { registrar: false, estado: "" };

  return { registrar: true, estado: "rechazado" };
}

// Traduce el fallo a algo que el equipo pueda accionar, en vez de un HTTP a
// pelo. El 403 de dominio sin verificar es el que más va a aparecer durante
// la puesta en marcha, y "HTTP 403" no le dice a nadie qué hacer.
function mensajeDeError(status: number, mensaje?: string): string {
  const m = (mensaje ?? "").trim();
  if (status === 403 && /verif/i.test(m)) {
    return "El dominio de envío no está verificado en Resend todavía. Revisa los registros DNS del subdominio.";
  }
  if (status === 429) {
    return "Resend está limitando el ritmo de envío (429). El aviso no salió; se reintentará en la pasada siguiente.";
  }
  if (status >= 500) {
    return "Resend tuvo un problema temporal. El correo puede haber salido igualmente — no lo reenvíes a ciegas.";
  }
  return m || `Resend rechazó el envío (HTTP ${status}).`;
}
