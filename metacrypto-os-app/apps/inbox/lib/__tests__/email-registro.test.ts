import { describe, it, expect } from "vitest";
import { decidirRegistro } from "../email";

// ============================================================
// La diferencia que separa el email de WhatsApp, y que hay que escribir a
// mano porque el instinto heredado de `enviarPlantilla` es el CONTRARIO.
//
// En WhatsApp, un envío con resultado incierto (5xx de Kapso) hay que
// registrarlo aunque no conste, porque reintentarlo puede duplicar el mensaje
// al cliente — y no hay forma de saberlo. Eso es `registrarEnvioIncierto`.
//
// En email NO: la `Idempotency-Key` es determinista y Resend deduplica 24 h.
// Reintentar un envío incierto es SEGURO, y las pasadas de los crons están a
// 5 minutos, muy dentro de esa ventana. Así que lo incierto NO se registra:
// se deja que la pasada siguiente lo reintente, y Resend garantiza que al
// cliente le llega uno.
//
// Registrar lo incierto aquí sería copiar una defensa que en este canal solo
// hace daño: convertiría un fallo temporal de red en un aviso perdido para
// siempre.
// ============================================================

describe("decidirRegistro — qué queda escrito en emails_enviados", () => {
  it("un envío bueno se registra como 'enviado', nunca como 'entregado'", () => {
    // 'enviado' es "Resend lo aceptó". La entrega solo la confirma
    // `last_event`. Es la distinción que a wa_mensajes le falta y por la que
    // el incidente duró tres horas.
    const d = decidirRegistro({ ok: true, status: 200, resendId: "abc" });
    expect(d).toEqual({ registrar: true, estado: "enviado" });
  });

  it("un 5xx NO se registra: la pasada siguiente lo reintenta y Resend deduplica", () => {
    const d = decidirRegistro({ ok: false, status: 500, incierto: true, error: "5xx" });
    expect(d.registrar).toBe(false);
  });

  it("una caída de red tampoco se registra", () => {
    const d = decidirRegistro({ ok: false, status: 0, incierto: true, error: "red" });
    expect(d.registrar).toBe(false);
  });

  it("un 429 NO se registra aunque sea 4xx: el límite de ritmo se pasa solo", () => {
    // Trampa fácil: `incierto` es false en un 4xx, así que la regla ingenua
    // ("registra todo lo que no sea incierto") daría por perdido el aviso
    // para siempre por una limitación de un minuto.
    const d = decidirRegistro({ ok: false, status: 429, incierto: false, error: "429" });
    expect(d.registrar).toBe(false);
  });

  it("un rechazo duro sí se registra, para que se vea que no salió", () => {
    const d = decidirRegistro({ ok: false, status: 422, incierto: false, error: "Invalid `to`" });
    expect(d).toEqual({ registrar: true, estado: "rechazado" });
  });

  it("una dirección que falta se registra como rechazo: reintentar no la crea", () => {
    const d = decidirRegistro({ ok: false, status: 400, incierto: false, error: "sin email" });
    expect(d.registrar).toBe(true);
    expect(d.estado).toBe("rechazado");
  });

  it("falta de configuración NO se registra: se arregla y vuelve a intentarse", () => {
    // Un 501 es "falta RESEND_API_KEY". Registrarlo como rechazo dejaría al
    // cliente sin su aviso aunque la variable se arregle cinco minutos
    // después — el mismo fallo que el comentario de sesiones/sync advierte
    // para los guards locales de WhatsApp.
    const d = decidirRegistro({ ok: false, status: 501, incierto: false, error: "falta key" });
    expect(d.registrar).toBe(false);
  });
});

// ── El fallo que una auditoría adversarial destapó el 4-sep ───────────────
// La regla original era una lista de EXCEPCIONES reintentables (incierto, 429,
// 501). Todo lo demás se daba por rechazo permanente — y eso incluye el 401
// (clave rotada o mal copiada) y el 403 (dominio sin verificar). Los dos se
// arreglan en cinco minutos, pero la fila quedaba escrita con su
// `idempotency_key` UNIQUE y `yaSeEnvioEmail` devolvía true para siempre: ese
// cliente no volvía a recibir ese correo jamás.
//
// La ironía es que `lib/email.ts` ya tenía un mensaje redactado a mano para el
// 403 de "dominio no verificado". Estaba previsto como situación transitoria
// en el texto y tratado como definitiva en la lógica.
//
// La regla se invierte: se registra rechazo solo para lo que NO se arregla
// solo. La duda cae del lado de reintentar, porque la Idempotency-Key hace
// que un reintento de más sea gratis y un aviso perdido no se recupere.
describe("errores de credencial y configuración son transitorios", () => {
  it("un 401 (clave mal o rotada) NO quema la clave", () => {
    expect(decidirRegistro({ ok: false, status: 401, incierto: false, error: "unauthorized" }).registrar).toBe(false);
  });

  it("un 403 (dominio sin verificar) tampoco", () => {
    expect(decidirRegistro({ ok: false, status: 403, incierto: false, error: "not verified" }).registrar).toBe(false);
  });

  it("un 408 y un 409 tampoco: tiempo agotado y conflicto se reintentan", () => {
    expect(decidirRegistro({ ok: false, status: 408, incierto: false, error: "timeout" }).registrar).toBe(false);
    expect(decidirRegistro({ ok: false, status: 409, incierto: false, error: "conflict" }).registrar).toBe(false);
  });

  it("pero un 422 sí: el payload es inválido y reintentarlo no lo arregla", () => {
    expect(decidirRegistro({ ok: false, status: 422, incierto: false, error: "invalid" })).toEqual({
      registrar: true,
      estado: "rechazado",
    });
  });

  it("y un 400 sí: destinatario que falta o dirección imposible", () => {
    expect(decidirRegistro({ ok: false, status: 400, incierto: false, error: "sin email" }).registrar).toBe(true);
  });

  it("un 4xx que Resend invente mañana se REINTENTA, no se quema", () => {
    // La regla nueva es lista blanca de "permanente". Ante un código
    // desconocido, el error barato es reintentar: la Idempotency-Key impide
    // el duplicado, y quemar la clave no tiene vuelta atrás.
    expect(decidirRegistro({ ok: false, status: 418, incierto: false, error: "?" }).registrar).toBe(false);
  });
});
