// Construcción del mensaje y del enlace de WhatsApp del CTA final (docs/03 §9).
// Seguridad: el destino se normaliza a solo dígitos y el mensaje se pasa por
// encodeURIComponent — el input del lead no puede alterar el destinatario ni
// introducir parámetros al enlace (docs/09-security).

// Colapsa cualquier whitespace (saltos, tabs) a un solo espacio y recorta bordes.
const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Arma el texto del mensaje: saludo + nombre + cada respuesta en una línea.
// Se usa en el CTA final y sus tests (test/security.test.mjs).
export function buildWhatsAppMessage({ name, answers = [], segment = null }) {
  const answerLines = answers
    .filter((item) => item && item.pregunta && item.respuesta)
    .map((item) => `- ${oneLine(item.pregunta)}: ${oneLine(item.respuesta)}`);

  // Última línea: la pregunta de segmentación (elige el video).
  if (segment && segment.pregunta && segment.respuesta) {
    answerLines.push(`- ${oneLine(segment.pregunta)}: ${oneLine(segment.respuesta)}`);
  }

  return [
    "Hola, completé el diagnóstico de portafolio.",
    "",
    `Nombre: ${oneLine(name) || "Sin nombre"}`,
    "",
    "Mis respuestas:",
    ...answerLines,
    "",
    "Quiero recibir mi diagnóstico completo.",
  ].join("\n");
}

// Devuelve el enlace wa.me final: número saneado + mensaje URL-encoded.
export function buildWhatsAppUrl({ number, ...messageData }) {
  const destination = String(number ?? "").replace(/\D/g, ""); // solo dígitos
  const message = buildWhatsAppMessage(messageData);
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}
