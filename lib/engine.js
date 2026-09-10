// Motor determinístico (stub) — docs/03 §4. Reglas genéricas sobre los tags
// de cada opción hasta que Berni defina las preguntas reales (bloqueante #1).
// Se trae el algoritmo del prototipo (prototipos/index.html: buildDiagnosis),
// es el referente de tono y estructura del diagnóstico.
//
// Cómo funciona (simple): cada respuesta de la wizard suma "tags" (definidos
// en question-config.js). Este motor analiza la combinación de tags y arma
// el diagnóstico: secciones fijas con textos + plan de acción + flag hot (lead caliente).
//
// El lead viene como arreglo de respuestas: { title, answer, tags[] }.

export function buildDiagnosis(lead, segmentOption) {
  // Aplana todos los tags de todas las respuestas para decirle al motor.
  const tags = lead.flatMap((a) => a.tags || []);
  const hot = tags.includes("hot-cap"); // lead caliente: capital > 10.000 USD

  const sections = [
    {
      title: "Tu situación real",
      body: lead
        .filter((a) => a.type !== "contact") // descarta los campos de contacto
        .map((a) => `Pregunta: ${a.title} → Respuesta: ${a.answer}`)
        .join(" · "),
    },
    {
      title: "El desajuste principal",
      body: mismatch(tags), // texto según desacuerdo perfil vs portfolio
    },
    {
      title: "El coste de tu liquidez parada",
      body: liquidityPitch(tags), // texto según cuánta munición tiene parada
    },
    {
      title: "Tu plan de acción",
      items: actionPlan(tags), // lista de pasos según señales dolorosas
    },
  ];

  return { hot, sections, cta: true }; // cta: siempre mostrar el CTA de WhatsApp
}

// Detecta si el perfil declarado choca con cómo está armado el portfolio.
// kind maneja el estilo visual del callout en pantalla (warning/info).
function mismatch(tags) {
  const lowRisk = tags.includes("risk-low");
  const alts = tags.includes("alloc-alts");
  const highSpread = tags.includes("spread-high");
  if (lowRisk && (alts || highSpread)) {
    return { kind: "warning", text: "Tu cartera y tu perfil están peleados: perfil conservador con exposición difusa." };
  }
  if (tags.includes("risk-high") && tags.includes("alloc-stables")) {
    return { kind: "info", text: "Perfil agresivo: tu problema es de ejecución." };
  }
  return { kind: "info", text: "Tu estructura es coherente, pero aún queda margen de optimización." };
}

// Mensaje principal según cuánto capital líquido fuera de cripto tiene parado.
function liquidityPitch(tags) {
  if (tags.includes("liq-high")) return { kind: "highlight", text: "Veo dólar parado; quedar fuera es un riesgo real." };
  if (tags.includes("liq-none")) return { kind: "info", text: "Sin munición disponible; así es como se pierde el sprint." };
  return { kind: "info", text: "Liquidez equilibrada; revisá el plan de despliegue." };
}

// Arma el plan de acción: un paso por cada señal (tag) encontrada.
// Si no matchea nada, da el paso genérico de auditoría.
function actionPlan(tags) {
  const steps = [];
  if (tags.includes("spread-high")) steps.push("Consolidar la dispersión de activos.");
  if (tags.includes("liq-high")) steps.push("Ponerle un plan al capital parado.");
  if (tags.includes("pain-exit")) steps.push("Definir reglas de salida.");
  if (tags.includes("contrib-none") || tags.includes("contrib-sporadic")) steps.push("Automatizar aportes.");
  if (tags.includes("pain-noplan")) steps.push("Armar un plan escrito a 12 meses.");
  return steps.length ? steps : ["Auditar el portfolio en detalle."];
}
