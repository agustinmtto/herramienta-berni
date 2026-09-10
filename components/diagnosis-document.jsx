import { wizardConfig } from "../lib/question-config";

export default function DiagnosisDocument({ name }) {
  const document = wizardConfig.diagnosisDocument;
  const leadName = name?.trim() || "Inversor";

  return (
    <article className="diagnosis-document" id="diagnosis-document">
      <header className="doc-header">
        <span className="doc-eyebrow">{document.eyebrow}</span>
        <h1>{document.title}</h1>
        <p>
          Preparado para <strong>{leadName}</strong>
        </p>
      </header>

      <section className="doc-intro">
        <p>{document.intro}</p>
      </section>

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

      <section className="doc-closing">
        <h2>El siguiente paso</h2>
        <p>{document.closing}</p>
      </section>

      <footer className="doc-footer">{document.disclaimer}</footer>
    </article>
  );
}
