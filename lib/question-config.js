// Config de la wizard — spec-first: docs/03-especificacion.md §2-§3 + §9
// Las preguntas son placeholders genéricos hasta que Berni entregue las reales (bloqueante #1).
// Para cambiar contenido (preguntas, videos, CTA) solo editar acá: no hay que tocar componentes.
//
// Estructura del objeto:
// - brand: textos de la pantalla inicial (hero).
// - questions: lista de preguntas; cada una es type:"option" (opciones con tags) o
//   type:"contact" (form de contacto al final del wizard). Los tags alimentan el motor.
// - segmentQuestion + videos: pantalla final (elige uno de 3 videos según la opción).
// - finalCta: CTA de WhatsApp (texto + número destino).
// - diagnosisDocument: textos del documento PDF/diagnóstico fijo de la pantalla final.

export const wizardConfig = {
  brand: {
    name: "Metacrypto Club",
    eyebrow: "Diagnóstico personalizado",
    titleStart: "Tu portfolio cripto,",
    titleEm: "bajo la lupa",
    chips: ["100% personalizado", "Gratis"],
    trustNote: "Sin registro. Respondés y recibís tu diagnóstico.",
  },

  segmentQuestion: {
    // Final screen question (docs/03 §9): maps each option to one of 3 videos
    id: "path",
    title: "¿Qué te interesa más ahora mismo?",
    options: [
      { label: "Proteger lo que ya tengo", video: "video1" },
      { label: "Hacer crecer mi portfolio", video: "video2" },
      { label: "Entrar mejor que hasta ahora", video: "video3" },
    ],
  },

  videos: {
    host: "placeholder",
    items: [
      { id: "video1", label: "Video 1 — genérico", url: "" },
      { id: "video2", label: "Video 2 — genérico", url: "" },
      { id: "video3", label: "Video 3 — variable", url: "" },
    ],
  },

  finalCta: {
    text: "Si quieres recibir el diagnóstico completo de tu portafolio, escríbenos por WhatsApp.",
    button: "Escríbenos",
    whatsappNumber: "5493585401429",
  },

  diagnosisDocument: {
    eyebrow: "Metacrypto Club · Diagnóstico base",
    title: "Una estrategia antes que una apuesta",
    intro: "Un portfolio no mejora por sumar activos, sino por asignar a cada posición un objetivo, un límite de riesgo y una regla de salida.",
    pillars: [
      { title: "Estructura", text: "Separá el núcleo de largo plazo de las posiciones tácticas y evitá que una sola idea domine tu resultado." },
      { title: "Liquidez", text: "Definí de antemano cuánto capital queda en reserva y bajo qué condiciones concretas vas a desplegarlo." },
      { title: "Disciplina", text: "Tomá decisiones con reglas escritas, no como reacción a la volatilidad, las noticias o el miedo a quedar afuera." },
    ],
    actions: [
      "Anotá el porcentaje objetivo de cada bloque de tu portfolio.",
      "Definí niveles de entrada, reducción y salida antes de operar.",
      "Concentrá el capital en posiciones que puedas explicar y seguir.",
      "Revisá el plan periódicamente, sin cambiarlo por cada movimiento del mercado.",
    ],
    closing: "Tus respuestas son el punto de partida. Escribinos por WhatsApp para revisar tu situación y recibir el diagnóstico completo de tu portfolio.",
    disclaimer: "Documento educativo. No constituye asesoramiento financiero personalizado.",
  },
};

// Preguntas del wizard en orden. Cada opción lleva "tags" que usa el motor determinístico
// (lib/engine.js) para armar el diagnóstico. La última (type:"contact") pide nombre/email/teléfono.
// "hot-cap" = lead con capital > 10.000 USD → se marca como caliente para llamada de triaje.
export const questions = [
  {
    id: "capital",
    title: "¿Cuánto capital total tenés invertido en cripto?",
    hint: "Incluyendo lo que hoy está en el portfolio, en lo que sea.",
    options: [
      { label: "Menos de 5k", tags: ["cap-low"] },
      { label: "5k a 15k", tags: ["cap-low"] },
      { label: "15k a 40k", tags: ["cap-mid"] },
      { label: "40k a 100k", tags: ["cap-mid"] },
      { label: "Más de 100k", tags: ["cap-high", "hot-cap"] },
    ],
  },
  {
    id: "liquidity",
    title: "¿Cuánto capital disponible fuera de cripto tenés hoy?",
    hint: "Efectivo, plazo fijo, stables... lo que podrías usar para invertir.",
    options: [
      { label: "Nada, todo está en el portfolio", tags: ["liq-none"] },
      { label: "Un poco, menos del 20% de lo invertido", tags: ["liq-short"] },
      { label: "Entre 20% y 50% de lo invertido", tags: ["liq-mid"] },
      { label: "Más del 50% de lo invertido", tags: ["liq-high"] },
    ],
  },
  {
    id: "contribution",
    title: "¿Aportás todos los meses?",
    hint: "Aunque sea poca cosa, importa el hábito.",
    options: [
      { label: "No aporto", tags: ["contrib-none"] },
      { label: "A veces, cuando sale", tags: ["contrib-sporadic"] },
      { label: "Sí, cada mes", tags: ["contrib-monthly"] },
      { label: "Sí, y automático cada semana", tags: ["contrib-auto"] },
    ],
  },
  {
    id: "risk",
    title: "¿Cómo describirías tu tolerancia al riesgo?",
    hint: "Sé honesto, esto dispara todo el análisis.",
    options: [
      { label: "Muy conservador", tags: ["risk-low"] },
      { label: "Conservador", tags: ["risk-low"] },
      { label: "Moderado", tags: ["risk-mid"] },
      { label: "Agresivo", tags: ["risk-high"] },
      { label: "Muy agresivo", tags: ["risk-high"] },
    ],
  },
  {
    id: "experience",
    title: "¿Hace cuánto operás cripto?",
    options: [
      { label: "Recién empiezo", tags: ["exp-new"] },
      { label: "Menos de 1 año", tags: ["exp-some"] },
      { label: "1 a 3 años", tags: ["exp-mid"] },
      { label: "Más de 3 años", tags: ["exp-old"] },
    ],
  },
  {
    id: "allocation",
    title: "¿En qué está tu portfolio hoy, en líneas generales?",
    options: [
      { label: "Casi todo Bitcoin", tags: ["alloc-btc"] },
      { label: "Bitcoin y Ethereum", tags: ["alloc-majors"] },
      { label: "Bastante en stables", tags: ["alloc-stables"] },
      { label: "Muchas altcoins", tags: ["alloc-alts"] },
    ],
  },
  {
    id: "spread",
    title: "¿Cuántos activos distintos tenés?",
    hint: "Contando todo: majors, altcoins, stables.",
    options: [
      { label: "1 o 2", tags: ["spread-low"] },
      { label: "3 a 5", tags: ["spread-mid"] },
      { label: "6 a 10", tags: ["spread-high"] },
      { label: "Más de 10", tags: ["spread-high"] },
    ],
  },
  {
    id: "pain",
    title: "¿Qué te quita más el sueño de tu portfolio?",
    options: [
      { label: "La volatilidad", tags: ["pain-volatility"] },
      { label: "No saber cuándo vender", tags: ["pain-exit"] },
      { label: "Quedarme fuera de una subida", tags: ["pain-miss"] },
      { label: "No tener un plan claro", tags: ["pain-noplan"] },
    ],
  },
  {
    id: "contact",
    title: "¿A dónde te mandamos tu diagnóstico?",
    hint: "Lo personalizamos y te lo hacemos llegar.",
    type: "contact",
  },
];

// Barra de progreso "mentirosa" (estrategia en docs/03 §3): la 1era respuesta ya muestra 33%,
// luego trepa lento hasta ~93% para que el lead no sienta el cuestionario largo.
export const progressFor = (answered, total) => {
  if (answered === 0) return 0;
  if (answered === 1) return 33;
  const linear = (answered - 1) / Math.max(total - 1, 1);
  return Math.round(33 + 60 * linear);
};
