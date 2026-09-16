// ============================================================
// Compone las dos mitades del canal de email: `enviarEmail` (que habla con
// Resend y no sabe nada de la base) y el registro en `emails_enviados`.
//
// Existe como módulo aparte para que `lib/email.ts` siga siendo importable en
// vitest — y por tanto sus guards comprobables de verdad. Aquí ya se importa
// Supabase, así que este fichero no se puede cargar en un test; lo que se
// prueba de él es la lógica pura que vive en `email.ts` y `canales.ts`.
//
// Pero componer aquí no es solo un apaño de tests: es lo que impide que un
// punto de llamada envíe sin registrar. Ese olvido es exactamente el incidente
// del 12-ago (el mismo recordatorio 7 veces). Los puntos de llamada usan
// `enviarYRegistrarEmail`, nunca `enviarEmail` a pelo.
// ============================================================
import { rest } from "@/lib/supabase";
import { enviarEmail, decidirRegistro, type ResultadoEmail } from "@/lib/email";
import type { TipoEmail } from "@/lib/canales";

/**
 * ¿Ya salió este correo?
 *
 * Consulta `emails_enviados`, NUNCA `wa_mensajes`. Es la decisión D5: con los
 * dos canales activos a la vez, compartir el antiduplicados haría que un
 * envío de WhatsApp suprimiera el correo.
 *
 * Ante un fallo de la consulta devuelve `true` (no enviar), igual que
 * `yaSeEnvio` en el cron de sesiones: un falso "ya enviado" cuesta un aviso;
 * un falso "no enviado" cuesta un duplicado en cada pasada del cron, cada 5
 * minutos, hasta que la base vuelva.
 */
export async function yaSeEnvioEmail(clave: string): Promise<boolean> {
  const r = await rest<{ id: string }[]>(
    "GET",
    `emails_enviados?idempotency_key=eq.${encodeURIComponent(clave)}&select=id&limit=1`,
  );
  if (r.status >= 300) {
    console.error("[email] no se pudo consultar el antiduplicados", r.status, r.json, clave);
    return true;
  }
  return Array.isArray(r.json) && r.json.length > 0;
}

export type EnvioEmailArgs = {
  // Varios destinatarios = UN correo a todos (ver `enviarEmail`), y por tanto
  // UNA fila en `emails_enviados` con la lista entera en `destinatario`.
  to: string | string[];
  asunto: string;
  html: string;
  texto: string;
  clave: string; // de claveEstrategia() o claveSesion(), nunca compuesta a mano
  tipo: TipoEmail;
  personaId?: string;
  sesionId?: string;
  from?: string; // ver el comentario de `from` en enviarEmail (lib/email.ts)
  // El campo ya existía en `enviarEmail` (lib/email.ts:55) pero no llegaba
  // hasta aquí, así que el único camino a un adjunto era llamar a `enviarEmail`
  // a pelo — justo lo que la cabecera de este fichero prohíbe, porque saltarse
  // esta puerta es enviar sin registrar. Nace para el PDF del contrato.
  adjuntos?: { filename: string; content: string; content_type: string }[];
};

export type ResultadoEnvioEmail = ResultadoEmail & { yaEstaba?: boolean };

/**
 * Envía y deja constancia. Es la única puerta que deben usar los crons y las
 * server actions.
 *
 * Orden: consultar → enviar → registrar. No se reserva la fila antes de
 * enviar (el patrón "reserva con caducidad") porque aquí no hace falta: la
 * `Idempotency-Key` viaja a Resend en la misma petición y le impide mandar
 * dos veces durante 24 h, que cubre de sobra la ventana entre dos pasadas del
 * cron. Es la protección que a WhatsApp le falta y por la que allí sí hubo
 * que inventar `registrarEnvioIncierto`.
 */
export async function enviarYRegistrarEmail(
  args: EnvioEmailArgs,
): Promise<ResultadoEnvioEmail> {
  if (await yaSeEnvioEmail(args.clave)) {
    return { ok: true, status: 200, resendId: "", yaEstaba: true };
  }

  const envio = await enviarEmail({
    to: args.to,
    asunto: args.asunto,
    html: args.html,
    texto: args.texto,
    idempotencyKey: args.clave,
    from: args.from,
    adjuntos: args.adjuntos,
  });

  const { registrar, estado } = decidirRegistro(envio);
  if (!registrar) {
    // Reintentable (5xx, red, 429, falta de configuración): NO se escribe
    // nada, para que la pasada siguiente lo vuelva a intentar. Resend
    // deduplica si el primero llegó a salir.
    if (!envio.ok) {
      console.error("[email] envío no registrado, se reintentará", args.tipo, envio.status, envio.error);
    }
    return envio;
  }

  const fila = {
    persona_id: args.personaId ?? null,
    sesion_id: args.sesionId ?? null,
    tipo: args.tipo,
    destinatario: Array.isArray(args.to) ? args.to.join(", ") : args.to,
    idempotency_key: args.clave,
    resend_id: envio.ok ? envio.resendId : null,
    estado,
    error: envio.ok ? null : envio.error,
  };
  const ins = await rest("POST", "emails_enviados", fila, "return=minimal");

  // El 23505 es la restricción única: otra pasada ganó la carrera y ya
  // escribió esta clave. No es un error — es el antiduplicados haciendo su
  // trabajo, y el cliente recibió un solo correo porque Resend también
  // deduplicó con la misma clave.
  if (ins.status >= 300 && ins.status !== 409) {
    console.error("[email] EL CORREO SALIÓ PERO NO QUEDÓ REGISTRADO", ins.status, ins.json, args.clave);
  }
  return envio;
}
