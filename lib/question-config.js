// Configuración del wizard — fuente de contenido para el flujo, el diagnóstico y WhatsApp.
// Las ocho preguntas definitivas y sus restricciones están documentadas en docs/03 §3.

export const wizardConfig = {
  brand: {
    name: "Metacrypto Club",
    eyebrow: "Diagnóstico personalizado de portfolio",
    titleStart: "Descubrí qué está frenando",
    titleEm: "tu portfolio cripto",
    promise:
      "Analizamos cómo invertís, cómo está distribuido tu capital y qué decisiones están limitando tu estrategia. Al final recibís un diagnóstico personalizado con tu principal desajuste y un plan concreto para corregirlo.",
    chips: ["Menos de 3 minutos", "100% personalizado", "Gratis"],
    trustNote: "Sin cálculos manuales. Una pregunta por pantalla.",
    preview: [
      { label: "Tu situación", value: "Exposición y capital" },
      { label: "Tu riesgo", value: "Decisiones bajo presión" },
      { label: "Tu plan", value: "Próximos pasos" },
    ],
  },

  videoSelectorQuestionId: "challenge",
  videos: {
    host: "placeholder",
    items: [
      { id: "video1", label: "Cómo estructurar una cartera sólida", url: "" },
      { id: "video2", label: "Cómo definir entradas y salidas", url: "" },
      { id: "video3", label: "Cómo invertir con reglas y controlar el riesgo", url: "" },
    ],
  },

  finalCta: {
    eyebrow: "Siguiente paso personalizado",
    text: "Tengo un video donde te explico cómo solucionaría exactamente el principal problema que detecté en tu portfolio. Te lo mando por WhatsApp.",
    button: "Recibir mi video por WhatsApp",
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

const allocationRanges = [
  { label: "0%", level: "zero" },
  { label: "1-10%", level: "minimal" },
  { label: "10-25%", level: "low" },
  { label: "25-50%", level: "medium" },
  { label: "50-75%", level: "high" },
  { label: "75-100%", level: "dominant" },
];

export const questions = [
  {
    id: "situation",
    trackingId: "q1",
    title: "¿Qué describe mejor tu situación actual con las criptomonedas?",
    options: [
      { label: "Estoy 100% expuesto, pero no tengo claro si mi portfolio está bien", tags: ["exposure-full", "plan-unclear"] },
      { label: "Estoy bastante expuesto pero no sé cómo aportar el resto de liquidez", tags: ["exposure-high", "liquidity-undeployed"] },
      { label: "Estoy esperando una oportunidad para aumentar posiciones", tags: ["exposure-waiting", "liquidity-ready"] },
      { label: "Estoy completamente fuera del mercado", tags: ["exposure-none"] },
    ],
  },
  {
    id: "challenge",
    trackingId: "q2",
    title: "¿Qué es lo que más te cuesta ahora mismo?",
    options: [
      { label: "Saber qué comprar", tags: ["pain-buy"], video: "video1" },
      { label: "Saber cuándo comprar o vender", tags: ["pain-timing"], video: "video2" },
      { label: "Construir la cartera correcta", tags: ["pain-allocation"], video: "video1" },
      { label: "Gestionar el riesgo", tags: ["pain-risk"], video: "video3" },
      { label: "Tener un plan y no improvisar", tags: ["pain-plan"], video: "video3" },
      { label: "Saber si mi cartera está demasiado concentrada", tags: ["pain-concentration"], video: "video1" },
    ],
  },
  {
    id: "allocation",
    trackingId: "q3",
    type: "allocation",
    title: "¿Cómo se distribuye tu portfolio hoy?",
    hint: "Elegí un rango aproximado para cada bloque. No hace falta calcular porcentajes exactos.",
    assets: [
      { id: "btc", label: "Bitcoin", ticker: "BTC", icon: "₿", ranges: allocationRanges },
      { id: "eth", label: "Ethereum", ticker: "ETH", icon: "Ξ", ranges: allocationRanges },
      { id: "alts", label: "Altcoins", ticker: "ALT", icon: "A", detail: "Sin incluir BTC ni ETH", ranges: allocationRanges },
      { id: "stables", label: "Stablecoins", ticker: "USD", icon: "$", detail: "USDT, USDC o liquidez", ranges: allocationRanges },
    ],
  },
  {
    id: "capital",
    trackingId: "q4",
    title: "¿Con qué cantidad de capital estás trabajando actualmente o tienes previsto destinar a cripto durante este ciclo?",
    hint: "No necesitamos saber la cantidad exacta. El rango nos permite adaptar mejor el diagnóstico a tu situación.",
    options: [
      { label: "Menos de $10k", tags: ["cap-low"] },
      { label: "$10k–25k", tags: ["cap-mid", "hot-cap"] },
      { label: "$25k–50k", tags: ["cap-mid", "hot-cap"] },
      { label: "$50k–100k", tags: ["cap-high", "hot-cap"] },
      { label: "$100k–250k", tags: ["cap-high", "hot-cap"] },
      { label: "$250k+", tags: ["cap-very-high", "hot-cap"] },
    ],
  },
  {
    id: "horizon",
    trackingId: "q5",
    title: "¿Cuál es tu horizonte de tiempo con estas inversiones?",
    options: [
      { label: "Menos de 6 meses", tags: ["horizon-short"] },
      { label: "De 6 meses a 1 año", tags: ["horizon-short"] },
      { label: "1-2 años", tags: ["horizon-medium"] },
      { label: "El ciclo cripto completo (3 años aprox.)", tags: ["horizon-cycle"] },
      { label: "5+ años", tags: ["horizon-long"] },
    ],
  },
  {
    id: "drawdown",
    trackingId: "q6",
    title: "Imagina que mañana hay una noticia negativa y tu portfolio ha caído un 30%. ¿Qué harías?",
    options: [
      { label: "Vendo todo y espero a que pase la noticia", tags: ["drawdown-exit"] },
      { label: "Vendo parcialmente para reducir riesgo", tags: ["drawdown-reduce"] },
      { label: "Mantengo, no toco nada", tags: ["drawdown-hold"] },
      { label: "Aprovecho para comprar y/o aportar más liquidez", tags: ["drawdown-buy"] },
    ],
  },
  {
    id: "influence",
    trackingId: "q7",
    title: "¿Qué influye más en tus decisiones de inversión?",
    options: [
      { label: "Tengo reglas claras y un sistema propio", tags: ["decision-system"] },
      { label: "Tengo un consultor o sigo una estrategia externa", tags: ["decision-advisor"] },
      { label: "Sigo principalmente análisis de personas que veo en redes", tags: ["decision-social"] },
      { label: "Decido según noticias, eventos y lo que creo que va a pasar", tags: ["decision-news"] },
      { label: "Miro el precio con frecuencia y reacciono según lo que veo", tags: ["decision-price"] },
      { label: "No tengo un sistema definido", tags: ["decision-none"] },
    ],
  },
  {
    id: "rules",
    trackingId: "q8",
    title: "¿Tienes reglas claras sobre cuándo aumentar, reducir o cerrar una posición?",
    options: [
      { label: "Sí, tengo un sistema claro", tags: ["rules-clear"] },
      { label: "Más o menos, pero no lo sigo siempre", tags: ["rules-inconsistent"] },
      { label: "Voy improvisando según lo que veo", tags: ["rules-improvise"] },
      { label: "No tengo reglas claras", tags: ["rules-none"] },
    ],
  },
  {
    id: "contact",
    trackingId: "contact",
    title: "Tu diagnóstico personalizado está listo",
    hint: "Decinos dónde enviártelo y desbloqueá tu resultado.",
    type: "contact",
  },
];

const progressCurve = [18, 34, 46, 52, 62, 73, 86, 93];

// Recibe la etapa visible: 0...7 para preguntas y 8 para contacto.
export function progressFor(stageIndex, totalQuestions = 8) {
  if (stageIndex >= totalQuestions) return 97;
  return progressCurve[Math.max(0, Math.min(stageIndex, progressCurve.length - 1))];
}

export function progressMessageFor(stageIndex, totalQuestions = 8) {
  if (stageIndex >= totalQuestions) return "Tu diagnóstico está casi listo";
  if (stageIndex === totalQuestions - 1) return "Última pregunta";
  if (stageIndex >= totalQuestions - 2) return "Casi terminamos";
  if (stageIndex === 2) return "Ahora vamos a leer tu portfolio";
  if (stageIndex <= 1) return "Tu diagnóstico ya empezó";
  return "Estamos construyendo tu diagnóstico";
}

export function buildAllocationResponse(question, selections) {
  const assets = question.assets || [];
  const complete = assets.every((asset) => selections[asset.id]);
  if (!complete) return null;

  return {
    answer: assets.map((asset) => `${asset.ticker}: ${selections[asset.id].label}`).join(" · "),
    tags: assets.map((asset) => `${asset.id}-${selections[asset.id].level}`),
    allocation: Object.fromEntries(assets.map((asset) => [asset.id, selections[asset.id].label])),
  };
}
