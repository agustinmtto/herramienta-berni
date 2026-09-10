"use client";

import { useMemo, useState } from "react";
import { wizardConfig, questions, progressFor } from "../lib/question-config";
import { buildDiagnosis } from "../lib/engine";

const SCREENS = { HERO: "hero", WIZARD: "wizard", SEGMENT: "segment", ANALYZING: "analyzing", RESULT: "result", VIDEO: "video" };

export default function Flow() {
  const [screen, setScreen] = useState(SCREENS.HERO);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [segIndex, setSegIndex] = useState(null);
  const [analyzing, setAnalyzing] = useState(0);
  const [contactError, setContactError] = useState(null);
  const [sending, setSending] = useState(false);

  const contact = questions.length - 1;
  const isContact = qIndex === contact;
  const question = questions[qIndex];
  const answered = Object.keys(answers).filter((k) => k !== "contact").length;

  const pick = (option) => {
    const next = { ...answers, [question.id]: { answer: option.label, title: question.title, tags: option.tags } };
    next[question.id].tags = option.tags;
    setAnswers(next);
  };
  const move = (delta) => setQIndex((i) => Math.max(0, Math.min(i + delta, contact)));

  const startWizard = () => setScreen(SCREENS.WIZARD);

  const submitContact = async (form) => {
    setContactError(null);
    if (!form.name.length || !form.email.length || !form.consent) {
      setContactError("Completá nombre, email y aceptá el consentimiento para poder enviarte el diagnóstico.");
      return;
    }
    const merged = { ...answers, contact: { name: form.name, email: form.email, consent: true } };
    setAnswers(merged);
    setScreen(SCREENS.SEGMENT);
  };

  const sendLead = async (payload) => {
    setSending(true);
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // silent for now; stub endpoint
    }
    setSending(false);
  };

  const finishSegment = (index) => {
    setSegIndex(index);
    setAnalyzing(0);
    setScreen(SCREENS.ANALYZING);
  };

  const advanceAnalysis = () => {
    if (analyzing < 4) {
      setAnalyzing((s) => s + 1);
      return;
    }
    const payload = buildPayload();
    sendLead(payload);
    setScreen(SCREENS.RESULT);
  };

  const finishResult = async () => {
    const payload = buildPayload();
    sendLead(payload);
    setScreen(SCREENS.VIDEO);
  };

  function buildPayload() {
    const payloadAnswers = questions
      .filter((q) => q.type !== "contact")
      .map((q) => ({
        pregunta: q.title,
        respuesta: answers[q.id] ? answers[q.id].answer : null,
      }));
    payloadAnswers.push({
      pregunta: wizardConfig.segmentQuestion.title,
      respuesta: segIndex !== null ? wizardConfig.segmentQuestion.options[segIndex].label : null,
    });
    return {
      session_id: crypto.randomUUID(),
      lead: {
        name: answers.contact ? answers.contact.name : "",
        email: answers.contact ? answers.contact.email : "",
        consent: Boolean(answers.contact),
      },
      signals: { dropoff_question: null, finished_at: new Date().toISOString() },
      answers: payloadAnswers,
    };
  }

  const diagnosis = useMemo(() => {
    if (screen !== SCREENS.RESULT && screen !== SCREENS.VIDEO) return null;
    const lead = questions.map((q) => {
      const cur = answers[q.id];
      return { type: q.type || "option", title: q.title, answer: cur ? cur.answer : null, tags: cur ? cur.tags : [] };
    });
    return buildDiagnosis(lead, wizardConfig.segmentQuestion.options[segIndex || 0]);
  }, [screen, answers, segIndex]);

  if (screen === SCREENS.HERO) {
    return (
      <main className="page-shell hero-section">
        <span className="eyebrow">{wizardConfig.brand.eyebrow}</span>
        <h1 className="hero-title">
          {wizardConfig.brand.titleStart} <em>{wizardConfig.brand.titleEm}</em>
        </h1>
        <p className="hero-sub">
          Respondé unas preguntas sobre tu situación y te armamos un diagnóstico con lo que hoy no está funcionando
          y qué hacer al respecto.
        </p>
        <div className="chip-row">
          {wizardConfig.brand.chips.map((c) => (
            <span className="chip" key={c}>{c}</span>
          ))}
        </div>
        <button className="btn-gold" onClick={startWizard}>Empezar el diagnóstico</button>
        <span className="trust-note">{wizardConfig.brand.trustNote}</span>
      </main>
    );
  }

  if (screen === SCREENS.WIZARD) {
    return (
      <main className="page-shell wizard-section">
        <div className="progress-row">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressFor(answered, contact)}%` }} />
          </div>
          <div className="progress-label">{`[0${Math.max(qIndex + 1)}] ${answered + 1} / ${contact + 1}`}</div>
        </div>

        <span className="q-index">{`PREGUNTA 0${answered + 1}`}</span>
        <h2 className="q-title">{question.title}</h2>
        {question.hint && <p className="q-hint">{question.hint}</p>}

        {isContact ? (
          <ContactForm onSubmit={submitContact} error={contactError} />
        ) : (
          <div className="opt-list">
            {question.options.map((option) => (
              <button
                key={option.label}
                className={`opt${answers[question.id] && answers[question.id].answer === option.label ? " selected" : ""}`}
                onClick={() => pick(option)}
                type="button"
              >
                <span className="opt-dot" />
                {option.label}
              </button>
            ))}
            {answers[question.id] && (
              <button
                className="btn-gold opt-next"
                type="button"
                onClick={() => (qIndex === contact ? null : move(1))}
              >
                Siguiente
              </button>
            )}
          </div>
        )}

        <div className="wizard-nav">
          <button className="nav-back" type="button" onClick={() => move(-1)} disabled={qIndex === 0}>
            Anterior
          </button>
        </div>
      </main>
    );
  }

  if (screen === SCREENS.SEGMENT) {
    return (
      <main className="page-shell wizard-section">
        <span className="q-index">ÚLTIMA PREGUNTA</span>
        <h2 className="q-title">{wizardConfig.segmentQuestion.title}</h2>
        <div className="opt-list">
          {wizardConfig.segmentQuestion.options.map((option, i) => (
            <button key={option.label} className="opt" type="button" onClick={() => finishSegment(i)}>
              <span className="opt-dot" />
              {option.label}
            </button>
          ))}
        </div>
        <div className="wizard-nav">
          <button className="nav-back" type="button" onClick={() => setScreen(SCREENS.WIZARD)}>
            Anterior
          </button>
        </div>
      </main>
    );
  }

  if (screen === SCREENS.ANALYZING) {
    const steps = ["perfil", "portfolio", "desajustes", "liquidez", "plan"];
    return (
      <main className="page-shell analyzing-section">
        <span className="eyebrow">Procesando</span>
        <h2 className="analysis-title">Armando tu diagnóstico</h2>
        <div className="step-row">
          {steps.map((s, i) => (
            <div className="step" key={s}>
              <span>{s.toUpperCase()}</span>
              <span className={
                i === analyzing ? "state-active" : i < analyzing ? "state-done" : "state-pending"
              }>
                {i === analyzing ? "procesando..." : i < analyzing ? "✓ listo" : "en cola"}
              </span>
            </div>
          ))}
        </div>
        <Timer key={analyzing} advance={advanceAnalysis} />
      </main>
    );
  }

  if (screen === SCREENS.RESULT && diagnosis) {
    return (
      <main className="page-shell result-section">
        <div className="result-head">
          <span className="eyebrow">Tu diagnóstico</span>
          <h2>Tu portfolio, <em>bajo la lupa</em></h2>
        </div>
        {diagnosis.sections.map((sec, i) => (
          <div className="section-block" key={sec.title}>
            <h3>{`0${i + 1} · ${sec.title}`}</h3>
            {sec.body && <Callout tone={sec.body.kind} text={sec.body.text} />}
            {sec.items && (
              <ol className="plan-list">
                {sec.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ol>
            )}
          </div>
        ))}
        <div className="final-cta">
          <p>{wizardConfig.finalCta.text}</p>
          <button className="btn-gold" type="button" onClick={finishResult} disabled={sending}>
            {sending ? "Enviando..." : "Ver el video de regalo"}
          </button>
        </div>
      </main>
    );
  }

  if (screen === SCREENS.VIDEO && diagnosis) {
    const video = wizardConfig.videos.items.find((v) => v.id === wizardConfig.segmentQuestion.options[segIndex || 0].video);
    return (
      <main className="page-shell video-section">
        <span className="eyebrow">Tunel final</span>
        <VideoBox video={video} />
        <div className="final-cta">
          <p>{wizardConfig.finalCta.text}</p>
          <a className="btn-gold" href={wizardConfig.finalCta.url || "#"} style={{ alignSelf: "center" }}>
            {wizardConfig.finalCta.button}
          </a>
        </div>
      </main>
    );
  }

  return null;
}

function Callout({ tone, text }) {
  if (!text) return null;
  return <div className={`section-callout ${tone || "info"}`}>{text}</div>;
}

function VideoBox({ video }) {
  return (
    <>
      <div className="video-box">
        <div className="play-circle">▶</div>
        <span className="video-placeholder-tag">placeholder · sin video hosteado</span>
      </div>
      <div className="video-caption">{video ? video.label : ""}</div>
    </>
  );
}

function Timer({ advance }) {
  if (typeof window !== "undefined") {
    window.setTimeout(advance, 950);
  }
  return null;
}

function ContactForm({ onSubmit, error }) {
  const [form, setForm] = useState({ name: "", email: "", consent: false });
  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="contact-grid">
      <div className="field">
        <label htmlFor="w-name">Nombre</label>
        <input id="w-name" value={form.name} onChange={update("name")} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="w-email">Email</label>
        <input id="w-email" type="email" value={form.email} onChange={update("email")} autoComplete="email" />
      </div>
      <label className="opt" style={{ cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => setForm({ ...form, consent: e.target.checked })}
        />
        Acepto recibir mi diagnóstico por email
      </label>
      {error && <div className="contact-error">{error}</div>}
      <button className="btn-gold opt-next" type="button" onClick={() => onSubmit(form)}>
        Enviar
      </button>
    </div>
  );
}
