// Config del Quiz Funnel portado al OS (docs/11 D1). Fuente de contenido:
// lib/question-config.js del repo del prototipo (herramienta-berni).
//
// Los `optionId`/`assetId` son IDs ESTABLES y deben coincidir 1:1 con la
// definición publicada en `quiz_versiones` (migración 0068): el backend
// valida cada respuesta contra esa definición y rechaza opciones ajenas
// (docs/11 §5). Cambiar un texto acá no rompe nada; cambiar un id, sí —
// para eso se publica una versión nueva del quiz, no se edita la vieja.

export const QUIZ_VERSION = "diagnostico-cripto-v1-a";
export const SCHEMA_VERSION = 1;
export const CONSENT_VERSION = "contacto-v1";

export interface QuizOption {
  optionId: string;
  label: string;
  tags: string[];
  video?: string;
}

export interface QuizAssetRange {
  id: string;
  label: string;
}

export interface QuizAsset {
  id: string;
  label: string;
  ticker: string;
  icon: string;
  detail?: string;
  ranges: QuizAssetRange[];
}

export interface QuizQuestion {
  id: string;
  trackingId: string;
  title: string;
  hint?: string;
  type?: "allocation" | "contact";
  options?: QuizOption[];
  assets?: QuizAsset[];
}

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
      "Revisá el plan periódico, sin cambiarlo por cada movimiento del mercado.",
    ],
    closing: "Tus respuestas son el punto de partida. Escribinos por WhatsApp para revisar tu situación y recibir el diagnóstico completo de tu portfolio.",
    disclaimer: "Documento educativo. No constituye asesoramiento financiero personalizado.",
  },
};

const allocationRanges: QuizAssetRange[] = [
  { id: "zero", label: "0%" },
  { id: "minimal", label: "1-10%" },
  { id: "low", label: "10-25%" },
  { id: "medium", label: "25-50%" },
  { id: "high", label: "50-75%" },
  { id: "dominant", label: "75-100%" },
];

// Orden de presentación de las preguntas diagnósticas (sin la de contacto):
// define `order` en el contrato y la posición del paso en el wizard.
export const QUESTIONS_ORDER = [
  "situation",
  "challenge",
  "allocation",
  "capital",
  "horizon",
  "drawdown",
  "influence",
  "rules",
];

export const questions: QuizQuestion[] = [  {
    id: "situation",
    trackingId: "q1",
    title: "¿Qué describe mejor tu situación actual con las criptomonedas?",
    options: [
      { optionId: "exposure_full_unclear", label: "Estoy 100% expuesto, pero no tengo claro si mi portfolio está bien", tags: ["exposure-full", "plan-unclear"] },
      { optionId: "exposure_high_undeployed", label: "Estoy bastante expuesto pero no sé cómo aportar el resto de liquidez", tags: ["exposure-high", "liquidity-undeployed"] },
      { optionId: "exposure_waiting_ready", label: "Estoy esperando una oportunidad para aumentar posiciones", tags: ["exposure-waiting", "liquidity-ready"] },
      { optionId: "exposure_none", label: "Estoy completamente fuera del mercado", tags: ["exposure-none"] },
    ],
  },
  {
    id: "challenge",
    trackingId: "q2",
    title: "¿Qué es lo que más te cuesta ahora mismo?",
    options: [
      { optionId: "pain_buy", label: "Saber qué comprar", tags: ["pain-buy"], video: "video1" },
      { optionId: "pain_timing", label: "Saber cuándo comprar o vender", tags: ["pain-timing"], video: "video2" },
      { optionId: "pain_allocation", label: "Construir la cartera correcta", tags: ["pain-allocation"], video: "video1" },
      { optionId: "pain_risk", label: "Gestionar el riesgo", tags: ["pain-risk"], video: "video3" },
      { optionId: "pain_plan", label: "Tener un plan y no improvisar", tags: ["pain-plan"], video: "video3" },
      { optionId: "pain_concentration", label: "Saber si mi cartera está demasiado concentrada", tags: ["pain-concentration"], video: "video1" },
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
      { optionId: "capital_lt_10k", label: "Menos de 10.000 USD", tags: ["cap-low"] },
      { optionId: "capital_10k_25k", label: "Entre 10.000 y 25.000 USD", tags: ["cap-mid", "hot-cap"] },
      { optionId: "capital_25k_50k", label: "Entre 25.000 y 50.000 USD", tags: ["cap-mid", "hot-cap"] },
      { optionId: "capital_50k_100k", label: "Entre 50.000 y 100.000 USD", tags: ["cap-high", "hot-cap"] },
      { optionId: "capital_100k_250k", label: "Entre 100.000 y 250.000 USD", tags: ["cap-high", "hot-cap"] },
      { optionId: "capital_gt_250k", label: "Más de 250.000 USD", tags: ["cap-very-high", "hot-cap"] },
    ],
  },
  {
    id: "horizon",
    trackingId: "q5",
    title: "¿Cuál es tu horizonte de tiempo con estas inversiones?",
    options: [
      { optionId: "horizon_lt_6m", label: "Menos de 6 meses", tags: ["horizon-short"] },
      { optionId: "horizon_6m_12m", label: "De 6 meses a 1 año", tags: ["horizon-short"] },
      { optionId: "horizon_1_2y", label: "1-2 años", tags: ["horizon-medium"] },
      { optionId: "horizon_cycle_3y", label: "El ciclo cripto completo (3 años aprox.)", tags: ["horizon-cycle"] },
      { optionId: "horizon_5y_plus", label: "5+ años", tags: ["horizon-long"] },
    ],
  },
  {
    id: "drawdown",
    trackingId: "q6",
    title: "Imagina que mañana hay una noticia negativa y tu portfolio ha caído un 30%. ¿Qué harías?",
    options: [
      { optionId: "drawdown_sell_all", label: "Vendo todo y espero a que pase la noticia", tags: ["drawdown-exit"] },
      { optionId: "drawdown_sell_partial", label: "Vendo parcialmente para reducir riesgo", tags: ["drawdown-reduce"] },
      { optionId: "drawdown_hold", label: "Mantengo, no toco nada", tags: ["drawdown-hold"] },
      { optionId: "drawdown_buy_more", label: "Aprovecho para comprar y/o aportar más liquidez", tags: ["drawdown-buy"] },
    ],
  },
  {
    id: "influence",
    trackingId: "q7",
    title: "¿Qué influye más en tus decisiones de inversión?",
    options: [
      { optionId: "decision_own_system", label: "Tengo reglas claras y un sistema propio", tags: ["decision-system"] },
      { optionId: "decision_advisor", label: "Tengo un consultor o sigo una estrategia externa", tags: ["decision-advisor"] },
      { optionId: "decision_social", label: "Sigo principalmente análisis de personas que veo en redes", tags: ["decision-social"] },
      { optionId: "decision_news", label: "Decido según noticias, eventos y lo que creo que va a pasar", tags: ["decision-news"] },
      { optionId: "decision_price_reaction", label: "Miro el precio con frecuencia y reacciono según lo que veo", tags: ["decision-price"] },
      { optionId: "decision_none", label: "No tengo un sistema definido", tags: ["decision-none"] },
    ],
  },
  {
    id: "rules",
    trackingId: "q8",
    title: "¿Tienes reglas claras sobre cuándo aumentar, reducir o cerrar una posición?",
    options: [
      { optionId: "rules_clear_system", label: "Sí, tengo un sistema claro", tags: ["rules-clear"] },
      { optionId: "rules_inconsistent", label: "Más o menos, pero no lo sigo siempre", tags: ["rules-inconsistent"] },
      { optionId: "rules_improvising", label: "Voy improvisando según lo que veo", tags: ["rules-improvise"] },
      { optionId: "rules_none", label: "No tengo reglas claras", tags: ["rules-none"] },
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

export function progressFor(stageIndex: number, totalQuestions = 8): number {
  if (stageIndex >= totalQuestions) return 97;
  return progressCurve[Math.max(0, Math.min(stageIndex, progressCurve.length - 1))];
}

export function progressMessageFor(stageIndex: number, totalQuestions = 8): string {
  if (stageIndex >= totalQuestions) return "Tu diagnóstico está casi listo";
  if (stageIndex === totalQuestions - 1) return "Última pregunta";
  if (stageIndex >= totalQuestions - 2) return "Casi terminamos";
  if (stageIndex === 2) return "Ahora vamos a leer tu portfolio";
  if (stageIndex <= 1) return "Tu diagnóstico ya empezó";
  return "Estamos construyendo tu diagnóstico";
}

export interface AllocationSelection {
  id: string;
  label: string;
}

// Respuesta de la pregunta de composición: texto legible + tags por activo +
// selección por activo. La forma textual sigue siendo el contrato visible.
export function buildAllocationResponse(
  question: QuizQuestion,
  selections: Record<string, AllocationSelection>
): { answer: string; tags: string[]; allocation: Record<string, string> } | null {
  const assets = question.assets || [];
  const complete = assets.every((asset) => selections[asset.id]);
  if (!complete) return null;

  return {
    answer: assets.map((asset) => `${asset.ticker}: ${selections[asset.id].label}`).join(" · "),
    tags: assets.map((asset) => `${asset.id}-${selections[asset.id].id}`),
    allocation: Object.fromEntries(assets.map((asset) => [asset.id, selections[asset.id].label])),
  };
}
