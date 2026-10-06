// Construcción del mensaje y del enlace de WhatsApp del CTA final (docs/03 §9).
// Port del lib/whatsapp.js del prototipo. Seguridad: el destino se normaliza a
// solo dígitos y el mensaje se pasa por encodeURIComponent — el input del lead
// no puede alterar el destinatario ni introducir parámetros al enlace.

const oneLine = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

export function buildWhatsAppMessage({
  name,
  answers = [],
  requestedVideo = null,
}: {
  name: string;
  answers?: { pregunta: string; respuesta: string }[];
  requestedVideo?: string | null;
}): string {
  const answerLines = answers
    .filter((item) => item && item.pregunta && item.respuesta)
    .map((item) => `- ${oneLine(item.pregunta)}: ${oneLine(item.respuesta)}`);

  return [
    "Hola, completé el diagnóstico de portafolio.",
    "",
    `Nombre: ${oneLine(name) || "Sin nombre"}`,
    "",
    "Mis respuestas:",
    ...answerLines,
    "",
    requestedVideo ? `Quiero recibir el video: ${oneLine(requestedVideo)}.` : "Quiero recibir el video recomendado para mi situación.",
  ].join("\n");
}

export function buildWhatsAppUrl({
  number,
  ...messageData
}: {
  number: string;
  name: string;
  answers?: { pregunta: string; respuesta: string }[];
  requestedVideo?: string | null;
}): string {
  const destination = String(number ?? "").replace(/\D/g, ""); // solo dígitos
  const message = buildWhatsAppMessage(messageData);
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}
