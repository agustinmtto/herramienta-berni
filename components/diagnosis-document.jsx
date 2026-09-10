import { wizardConfig } from "../lib/question-config";

// diagnosis-document.jsx — documento HTML fijo del diagnóstico (versión transitoria).
// Todos los textos vienen de wizardConfig.diagnosisDocument (lib/question-config.js),
// solo se personaliza con el nombre del lead. Este mismo nodo es el que convierte
// lib/pdf.js a imagen para armar el PDF descargable.
// Cuando entre la entrega definitiva por email (Resend), este diseño es el insumo.
export default function DiagnosisDocument({ name }) {
  const document = wizardConfig.diagnosisDocument;
  const leadName = name?.trim() || "Inversor"; // fallback si el lead no cargó su nombre

  return (
    <article className="diagnosis-document" id="diagnosis-document">
      {/* Encabezado: marca + título + nombre del lead */}
      <header className="doc-header">
        <span className="doc-eyebrow">{document.eyebrow}</span>
        <h1>{document.title}</h1>
        <p>
          Preparado para <strong>{leadName}</strong>
        </p>
      </header>

      {/* Intro: la idea fuerza del documento */}
      <section className="doc-intro">
        <p>{document.intro}</p>
      </section>

      {/* Sección 01: los 3 pilares (estructura / liquidez / disciplina) */}
      <section className="doc-section">
        <span className="doc-index">01</span>
        <div>
          <h2>Los pilares de una cartera sólida</h2>
          <div className="doc-pillars">
            {document.pillars.map((pillar) => (
              <div className="doc-pillar" key={pillar.title}>
                <h3>{pillar.title}</h3>
                <p>{pillar.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sección 02: plan de acción numerado (acciones concretas) */}
      <section className="doc-section">
        <span className="doc-index">02</span>
        <div>
          <h2>Tu plan base de acción</h2>
          <ol className="doc-actions">
            {document.actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ol>
        </div>
      </section>

      {/* Cierre: llamado al siguiente paso (WhatsApp) */}
      <section className="doc-closing">
        <h2>El siguiente paso</h2>
        <p>{document.closing}</p>
      </section>

      {/* Disclaimer legal: documento educativo, no asesoramiento personalizado */}
      <footer className="doc-footer">{document.disclaimer}</footer>
    </article>
  );
}
