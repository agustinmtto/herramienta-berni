// ============================================================
// Traduce el `last_event` de Resend al estado que el OS necesita saber.
//
// Es la pieza que impide que el canal de email herede el defecto que causó el
// incidente del 2-sep: `wa_mensajes.status` se queda en "sent" para siempre
// porque nadie le pregunta a Kapso, y por eso el OS dio por enviados durante
// tres horas mensajes que Meta estaba tirando.
//
// Aquí se pregunta. Los webhooks de Resend son de plan de pago, así que en vez
// de esperar un empujón se consulta `GET /emails/{id}` desde un cron. La
// información es la misma y además el estado acaba en NUESTRA base, no
// dependiendo de que un webhook llegue.
//
// Valores tomados de la documentación de Resend (event-types), no de memoria:
// sent · delivered · bounced · delivery_delayed · failed · opened · clicked ·
// complained · scheduled · received · suppressed.
// ============================================================

export type EstadoEmail = "entregado" | "rebotado" | "quejado" | "rechazado";

// Lista BLANCA. Un evento que Resend invente mañana devuelve null y la fila se
// queda como está para volver a mirarla: adivinar sería peor que esperar.
const POR_EVENTO: Record<string, EstadoEmail> = {
  delivered: "entregado",
  // No se puede abrir ni pulsar lo que no llegó. Tratarlos como "pendiente"
  // dejaría filas colgadas para siempre en el caso más favorable posible.
  opened: "entregado",
  clicked: "entregado",

  bounced: "rebotado",

  // Llegó, y el cliente lo marcó como spam. Es lo CONTRARIO de un rebote —la
  // entrega funcionó— y para la reputación del dominio es la peor señal que
  // existe. Tiene estado propio porque colapsarlo en "rebotado" perdería
  // justo el dato por el que hay que llamar a esa persona.
  quejado: "quejado",
  complained: "quejado",

  failed: "rechazado",
  // Resend lo bloqueó, casi siempre porque esa dirección ya rebotó antes.
  // Nunca llegó a salir.
  suppressed: "rechazado",
};

export function estadoDesdeEvento(evento: string | null | undefined): EstadoEmail | null {
  // El webhook manda "email.delivered"; el GET manda "delivered". Se acepta
  // cualquiera de las dos formas para que la fuente no importe.
  const e = (evento ?? "").trim().toLowerCase().replace(/^email\./, "");
  return POR_EVENTO[e] ?? null;
}

// Cuánto se sigue preguntando por una fila sin resolver. Resend retiene 30
// días, pero un correo que a los tres días no ha resuelto no va a resolver:
// seguir consultándolo gasta llamadas en cada pasada, para siempre.
const DIAS_MAX = 3;

export function caducado(creadoEn: string | null | undefined, ahora: Date): boolean {
  const t = Date.parse(creadoEn ?? "");
  // Una fecha ilegible se trata como caducada, no como reciente: al revés,
  // esa fila se consultaría en cada pasada eternamente. Caducar es el error
  // barato — deja de preguntar y la fila queda visible como sin confirmar.
  if (Number.isNaN(t)) return true;
  return ahora.getTime() - t > DIAS_MAX * 24 * 3600 * 1000;
}
