// Deterministic engine stub — docs/03 §4. Generic rules over option tags
// until Berni defines the real questions (blocker #1 of docs/06).
// The prototype (index.html) `buildDiagnosis` is the tonal/structural reference.

export function buildDiagnosis(lead, segmentOption) {
  const tags = lead.flatMap((a) => a.tags || []);
  const hot = tags.includes("hot-cap");

  const sections = [
    {
      title: "Tu situación real",
      body: lead
        .filter((a) => a.type !== "contact")
        .map((a) => `Pregunta: ${a.title} → Respuesta: ${a.answer}`)
        .join(" · "),
    },
    {
      title: "El desajuste principal",
      body: mismatch(tags),
    },
    {
      title: "El coste de tu liquidez parada",
      body: liquidityPitch(tags),
    },
    {
      title: "Tu plan de acción",
      items: actionPlan(tags),
    },
  ];

  return { hot, sections, cta: true };
}

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

function liquidityPitch(tags) {
  if (tags.includes("liq-high")) return { kind: "highlight", text: "Veo dólar parado; quedar fuera es un riesgo real." };
  if (tags.includes("liq-none")) return { kind: "info", text: "Sin munición disponible; así es como se pierde el sprint." };
  return { kind: "info", text: "Liquidez equilibrada; revisá el plan de despliegue." };
}

function actionPlan(tags) {
  const steps = [];
  if (tags.includes("spread-high")) steps.push("Consolidar la dispersión de activos.");
  if (tags.includes("liq-high")) steps.push("Ponerle un plan al capital parado.");
  if (tags.includes("pain-exit")) steps.push("Definir reglas de salida.");
  if (tags.includes("contrib-none") || tags.includes("contrib-sporadic")) steps.push("Automatizar aportes.");
  if (tags.includes("pain-noplan")) steps.push("Armar un plan escrito a 12 meses.");
  return steps.length ? steps : ["Auditar el portfolio en detalle."];
}
