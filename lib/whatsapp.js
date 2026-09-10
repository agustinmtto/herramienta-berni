const oneLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function buildWhatsAppMessage({ name, answers = [], segment = null }) {
  const answerLines = answers
    .filter((item) => item && item.pregunta && item.respuesta)
    .map((item) => `- ${oneLine(item.pregunta)}: ${oneLine(item.respuesta)}`);

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

export function buildWhatsAppUrl({ number, ...messageData }) {
  const destination = String(number ?? "").replace(/\D/g, "");
  const message = buildWhatsAppMessage(messageData);
  return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
}
