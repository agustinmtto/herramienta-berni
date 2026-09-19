// Motor determinístico del diagnóstico. Cada opción suma tags estables y estas
// reglas los convierten en observaciones y acciones sin IA ni inferencias libres.

export function buildDiagnosis(lead) {
  const tags = lead.flatMap((answer) => answer.tags || []);

  return {
    hot: tags.includes("hot-cap"),
    sections: [
      {
        title: "Tu situación real",
        body: lead
          .filter((answer) => answer.type !== "contact")
          .map((answer) => `Pregunta: ${answer.title} → Respuesta: ${answer.answer}`)
          .join(" · "),
      },
      { title: "El desajuste principal", body: mainMismatch(tags) },
      { title: "La señal que no conviene ignorar", body: riskSignal(tags) },
      { title: "Tu plan de acción", items: actionPlan(tags) },
    ],
    cta: true,
  };
}

function mainMismatch(tags) {
  const reactsToMarket = hasAny(tags, ["decision-social", "decision-news", "decision-price", "decision-none"]);
  const lacksRules = hasAny(tags, ["rules-none", "rules-improvise", "rules-inconsistent"]);
  const concentrated = hasAny(tags, ["btc-dominant", "eth-dominant", "alts-dominant", "pain-concentration"]);

  if (reactsToMarket && lacksRules) {
    return {
      kind: "warning",
      text: "Tu principal riesgo no parece ser elegir una moneda equivocada, sino tomar decisiones sin un sistema estable. El mercado está definiendo tus movimientos por vos.",
    };
  }
  if (tags.includes("drawdown-exit") && hasAny(tags, ["horizon-cycle", "horizon-long"])) {
    return {
      kind: "warning",
      text: "Tu horizonte es de largo plazo, pero tu reacción ante una caída es de corto plazo. Esa contradicción puede convertir volatilidad temporal en pérdidas definitivas.",
    };
  }
  if (concentrated) {
    return {
      kind: "warning",
      text: "Tu cartera muestra una concentración que necesita límites explícitos. Sin porcentajes objetivo, una sola posición puede terminar controlando todo el resultado.",
    };
  }
  if (hasAny(tags, ["exposure-none", "exposure-waiting"]) && hasAny(tags, ["pain-buy", "pain-timing"])) {
    return {
      kind: "info",
      text: "Tenés capital o intención de entrar, pero todavía no existe un criterio claro de ejecución. El problema no es esperar: es esperar sin condiciones definidas.",
    };
  }
  return {
    kind: "info",
    text: "La base de tu estrategia es razonable, pero todavía hay decisiones importantes que dependen más de la interpretación del momento que de reglas escritas.",
  };
}

function riskSignal(tags) {
  if (tags.includes("alts-dominant")) {
    return { kind: "warning", text: "Las altcoins dominan tu exposición. Una caída correlacionada puede afectar varias posiciones al mismo tiempo aunque parezcan proyectos distintos." };
  }
  if (tags.includes("drawdown-buy") && !tags.includes("rules-clear")) {
    return { kind: "warning", text: "Aumentarías exposición durante una caída, pero no aparece una regla clara para hacerlo. Comprar más sin límites también es una decisión de riesgo." };
  }
  if (hasAny(tags, ["decision-social", "decision-news", "decision-price"])) {
    return { kind: "info", text: "Tus decisiones reciben demasiado ruido externo. Cuanto más cambia la fuente, más difícil es medir si tu estrategia realmente funciona." };
  }
  if (tags.includes("exposure-full")) {
    return { kind: "info", text: "Estar completamente expuesto reduce tu capacidad de reaccionar. Definir liquidez objetivo es parte del plan, no capital desperdiciado." };
  }
  return { kind: "highlight", text: "Tu mayor oportunidad está en convertir criterios generales en reglas medibles de entrada, tamaño y salida." };
}

function actionPlan(tags) {
  const steps = [];
  if (hasAny(tags, ["rules-none", "rules-improvise", "rules-inconsistent"])) {
    steps.push("Escribir una regla concreta para aumentar, reducir y cerrar cada posición.");
  }
  if (hasAny(tags, ["pain-allocation", "pain-concentration", "btc-dominant", "eth-dominant", "alts-dominant"])) {
    steps.push("Definir porcentajes objetivo y un límite máximo por bloque del portfolio.");
  }
  if (hasAny(tags, ["pain-timing", "exposure-waiting", "exposure-none"])) {
    steps.push("Dividir las entradas en tramos y fijar por adelantado qué condición activa cada uno.");
  }
  if (hasAny(tags, ["pain-risk", "drawdown-exit", "drawdown-reduce", "drawdown-buy"])) {
    steps.push("Establecer cuánto puede caer la cartera y cada posición antes de tomar una decisión.");
  }
  if (hasAny(tags, ["decision-social", "decision-news", "decision-price", "decision-none"])) {
    steps.push("Registrar cada decisión y su motivo para separar el sistema del ruido del mercado.");
  }
  if (tags.includes("exposure-full")) {
    steps.push("Definir una reserva de liquidez que permita actuar sin vender posiciones por urgencia.");
  }
  return steps.length ? steps.slice(0, 4) : ["Documentar tu asignación actual y auditarla contra objetivos de riesgo y horizonte."];
}

function hasAny(tags, candidates) {
  return candidates.some((tag) => tags.includes(tag));
}
