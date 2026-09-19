"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAllocationResponse,
  progressFor,
  progressMessageFor,
  questions,
  wizardConfig,
} from "../lib/question-config";
import { buildDiagnosis } from "../lib/engine";
import { buildWhatsAppUrl } from "../lib/whatsapp";

const SCREENS = { HERO: "hero", WIZARD: "wizard", ANALYZING: "analysis", FINAL: "result" };

export default function Flow() {
  const [screen, setScreen] = useState(SCREENS.HERO);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [analyzing, setAnalyzing] = useState(0);
  const [contactError, setContactError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [started, setStarted] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const sessionIdRef = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : null);
  const visitedStagesRef = useRef([]);
  const transitionTimerRef = useRef(null);

  const contactIndex = questions.length - 1;
  const diagnosticQuestionCount = contactIndex;
  const isContact = qIndex === contactIndex;
  const question = questions[qIndex];

  const recordStage = (stage) => {
    if (stage && !visitedStagesRef.current.includes(stage)) {
      visitedStagesRef.current = [...visitedStagesRef.current, stage];
    }
    return visitedStagesRef.current;
  };

  const startWizard = () => {
    recordStage("start");
    recordStage(questions[0].trackingId);
    setStarted(true);
    setScreen(SCREENS.WIZARD);
  };

  const move = (delta) => {
    clearTimeout(transitionTimerRef.current);
    setTransitioning(false);
    setQIndex((current) => Math.max(0, Math.min(current + delta, contactIndex)));
  };

  const pick = (option) => {
    if (transitioning) return;
    setAnswers((current) => ({
      ...current,
      [question.id]: { answer: option.label, tags: option.tags, video: option.video },
    }));
    setTransitioning(true);
    transitionTimerRef.current = setTimeout(() => {
      setQIndex((current) => Math.min(current + 1, contactIndex));
      setTransitioning(false);
    }, 340);
  };

  const pickAllocation = (asset, range) => {
    setAnswers((current) => {
      const selections = { ...(current[question.id]?.selections || {}), [asset.id]: range };
      const response = buildAllocationResponse(question, selections);
      return {
        ...current,
        [question.id]: response
          ? { ...response, selections }
          : { answer: null, tags: [], selections },
      };
    });
  };

  const submitContact = (form) => {
    setContactError(null);
    const contact = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      consent: form.consent,
      website: (form.website || "").trim(),
    };
    if (!contact.name || !contact.email || !contact.phone || !contact.consent) {
      setContactError("Completá nombre, email, teléfono y aceptá recibir el diagnóstico.");
      return;
    }
    if (!/.+@.+\..+/.test(contact.email)) {
      setContactError("Ingresá un email válido.");
      return;
    }
    const phoneDigits = contact.phone.replace(/\D/g, "");
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      setContactError("Ingresá un teléfono válido con código de país.");
      return;
    }
    setAnswers((current) => ({ ...current, contact }));
    recordStage("analysis");
    setAnalyzing(0);
    setScreen(SCREENS.ANALYZING);
  };

  const sendLead = async (payload) => {
    if (sending) return;
    setSending(true);
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // El endpoint sigue siendo best-effort y no debe bloquear el diagnóstico.
    }
    setSending(false);
  };

  function buildPayload(abandoned = false, stages = visitedStagesRef.current) {
    const payloadAnswers = questions
      .filter((item) => item.type !== "contact" && answers[item.id]?.answer)
      .map((item) => ({ pregunta: item.title, respuesta: answers[item.id].answer }));
    const reachedStage = stages.at(-1) || "start";

    return {
      session_id: sessionIdRef.current,
      lead: abandoned
        ? null
        : {
            name: answers.contact?.name || "",
            email: answers.contact?.email || "",
            phone: answers.contact?.phone || "",
            consent: Boolean(answers.contact?.consent),
            website: answers.contact?.website || "",
          },
      signals: {
        dropoff_question: abandoned ? reachedStage : null,
        reached_stage: reachedStage,
        visited_stages: stages,
        finished_at: abandoned ? null : new Date().toISOString(),
      },
      answers: payloadAnswers,
    };
  }

  const advanceAnalysis = () => {
    if (analyzing < 4) {
      setAnalyzing((step) => step + 1);
      return;
    }
    if (!sent) {
      const finalStages = recordStage("result");
      sendLead(buildPayload(false, finalStages));
      setSent(true);
    }
    setScreen(SCREENS.FINAL);
  };

  const diagnosis = useMemo(() => {
    if (screen !== SCREENS.FINAL) return null;
    const lead = questions
      .filter((item) => item.type !== "contact")
      .map((item) => ({
        type: item.type || "option",
        title: item.title,
        answer: answers[item.id]?.answer || null,
        tags: answers[item.id]?.tags || [],
      }));
    return buildDiagnosis(lead);
  }, [screen, answers]);

  useEffect(() => {
    if (screen === SCREENS.WIZARD && question?.trackingId) recordStage(question.trackingId);
  }, [screen, question]);

  useEffect(() => () => clearTimeout(transitionTimerRef.current), []);

  useEffect(() => {
    const onLeave = () => {
      if (sent || !started || screen === SCREENS.FINAL) return;
      const payload = buildPayload(true);
      navigator.sendBeacon(
        "/api/lead",
        new Blob([JSON.stringify(payload)], { type: "application/json" })
      );
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  });

  if (screen === SCREENS.HERO) {
    return (
      <main className="page-shell hero-section">
        <div className="hero-copy">
          <span className="eyebrow">{wizardConfig.brand.eyebrow}</span>
          <h1 className="hero-title">
            {wizardConfig.brand.titleStart} <em>{wizardConfig.brand.titleEm}</em>
          </h1>
          <p className="hero-sub">{wizardConfig.brand.promise}</p>
          <div className="chip-row">
            {wizardConfig.brand.chips.map((chip) => <span className="chip" key={chip}>{chip}</span>)}
          </div>
        </div>

        <div className="report-preview" aria-label="Vista previa del diagnóstico">
          {wizardConfig.brand.preview.map((item, index) => (
            <div className={`preview-card preview-card-${index + 1}`} key={item.label}>
              <span className="preview-index">0{index + 1}</span>
              <span className="preview-label">{item.label}</span>
              <strong>{item.value}</strong>
              <span className="preview-line" />
            </div>
          ))}
        </div>

        <div className="hero-action">
          <p><span>✓</span> Detectá el principal desajuste de tu estrategia.</p>
          <p><span>✓</span> Recibí un plan de acción basado en tus respuestas.</p>
          <button className="btn-gold" onClick={startWizard}>Crear mi diagnóstico</button>
          <span className="trust-note">{wizardConfig.brand.trustNote}</span>
        </div>
      </main>
    );
  }

  if (screen === SCREENS.WIZARD) {
    const progress = progressFor(qIndex, diagnosticQuestionCount);
    const allocationComplete = question.type === "allocation" && Boolean(answers[question.id]?.answer);
    return (
      <main className="page-shell wizard-section">
        <div className="progress-block">
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Progreso del diagnóstico"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={progress}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-meta">
            <span>{progressMessageFor(qIndex, diagnosticQuestionCount)}</span>
            <strong>{progress}%</strong>
          </div>
        </div>

        <section className={`question-card${transitioning ? " is-confirming" : ""}`} key={question.id}>
          <span className="question-kicker">Análisis en curso</span>
          <h2 className="q-title">{question.title}</h2>
          {question.hint && <p className="q-hint">{question.hint}</p>}

          {isContact ? (
            <ContactForm onSubmit={submitContact} error={contactError} />
          ) : question.type === "allocation" ? (
            <AllocationQuestion question={question} answer={answers[question.id]} onPick={pickAllocation} />
          ) : (
            <div className="opt-list">
              {question.options.map((option) => {
                const selected = answers[question.id]?.answer === option.label;
                return (
                  <button
                    key={option.label}
                    className={`opt${selected ? " selected" : ""}`}
                    onClick={() => pick(option)}
                    type="button"
                    disabled={transitioning}
                    aria-pressed={selected}
                  >
                    <span className="opt-dot" />
                    <span className="opt-copy">{option.label}</span>
                    <span className="opt-arrow" aria-hidden="true">→</span>
                  </button>
                );
              })}
            </div>
          )}

          {question.type === "allocation" && (
            <button className="btn-gold opt-next" type="button" disabled={!allocationComplete} onClick={() => move(1)}>
              Confirmar distribución
            </button>
          )}
        </section>

        <div className="wizard-nav">
          <button className="nav-back" type="button" onClick={() => move(-1)} disabled={qIndex === 0 || transitioning}>
            ← Anterior
          </button>
        </div>
      </main>
    );
  }

  if (screen === SCREENS.ANALYZING) {
    const steps = ["situación", "portfolio", "riesgo", "decisiones", "plan"];
    return (
      <main className="page-shell analyzing-section">
        <span className="eyebrow">Procesando tus respuestas</span>
        <h2 className="analysis-title">Armando tu diagnóstico personalizado</h2>
        <p className="analysis-sub">Estamos cruzando la estructura de tu cartera con tu forma de tomar decisiones.</p>
        <div className="step-row">
          {steps.map((step, index) => (
            <div className="step" key={step}>
              <span>{step.toUpperCase()}</span>
              <span className={index === analyzing ? "state-active" : index < analyzing ? "state-done" : "state-pending"}>
                {index === analyzing ? "procesando..." : index < analyzing ? "✓ listo" : "en cola"}
              </span>
            </div>
          ))}
        </div>
        <AnalysisTimer step={analyzing} onDone={advanceAnalysis} />
      </main>
    );
  }

  if (screen === SCREENS.FINAL && diagnosis) {
    const selectedVideoId = answers[wizardConfig.videoSelectorQuestionId]?.video || "video1";
    const mappedVideo = wizardConfig.videos.items.find((video) => video.id === selectedVideoId);
    const whatsappAnswers = questions
      .filter((item) => item.type !== "contact" && answers[item.id]?.answer)
      .map((item) => ({ pregunta: item.title, respuesta: answers[item.id].answer }));
    const whatsappUrl = buildWhatsAppUrl({
      number: wizardConfig.finalCta.whatsappNumber,
      name: answers.contact?.name,
      answers: whatsappAnswers,
      requestedVideo: mappedVideo?.label,
    });

    return (
      <main className="page-shell result-section">
        <div className="diagnosis-sheet" id="diagnosis-sheet">
          <div className="result-head">
            <span className="eyebrow">Auditoría · Metacrypto Club</span>
            <h2>{answers.contact?.name}, tu portfolio está <em>bajo la lupa</em></h2>
          </div>

          <div className="section-block">
            <h3>Tu problema principal</h3>
            <Callout tone={diagnosis.sections[1].body.kind} text={diagnosis.sections[1].body.text} />
          </div>

          <div className="section-block">
            <h3>La señal que no conviene ignorar</h3>
            <Callout tone={diagnosis.sections[2].body.kind} text={diagnosis.sections[2].body.text} />
          </div>

          <div className="section-block">
            <h3>Tu plan de acción</h3>
            <ol className="plan-list">
              {diagnosis.sections[3].items.map((item) => <li key={item}>{item}</li>)}
            </ol>
          </div>

          <div className="metric-block">
            <h3>Tu métrica norte</h3>
            <p>Porcentaje de tu capital que responde a una regla de entrada, riesgo y salida definida.</p>
          </div>

          <div className="recursos-head">
            <span className="eyebrow">Tus recursos para resolverlo</span>
            <p>Seleccionamos el primero según el principal problema que marcaste.</p>
          </div>

          <div className="video-grid">
            {wizardConfig.videos.items.map((video) => (
              <div className={`video-card${video.id === mappedVideo?.id ? " featured" : ""}`} key={video.id}>
                <div className="video-box">
                  <span className="video-tag">{video.id === mappedVideo?.id ? "Elegido para vos" : "Recurso"}</span>
                  <div className="play-circle">▶</div>
                </div>
                <p className="video-desc">{video.label}</p>
              </div>
            ))}
          </div>

          <div className="final-cta">
            <span className="eyebrow">{wizardConfig.finalCta.eyebrow}</span>
            <p>{wizardConfig.finalCta.text}</p>
            <a className="btn-gold" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              {wizardConfig.finalCta.button}
            </a>
          </div>
        </div>
      </main>
    );
  }

  return null;
}

function AllocationQuestion({ question, answer, onPick }) {
  const selections = answer?.selections || {};
  return (
    <div className="allocation-list">
      {question.assets.map((asset) => (
        <fieldset className="allocation-card" key={asset.id}>
          <legend className="allocation-head">
            <span className={`asset-icon asset-${asset.id}`} aria-hidden="true">{asset.icon}</span>
            <span>
              <strong>{asset.label}</strong>
              <small>{asset.detail || asset.ticker}</small>
            </span>
          </legend>
          <div className="range-grid">
            {asset.ranges.map((range) => {
              const selected = selections[asset.id]?.label === range.label;
              return (
                <button
                  className={`range-option${selected ? " selected" : ""}`}
                  type="button"
                  key={range.label}
                  onClick={() => onPick(asset, range)}
                  aria-pressed={selected}
                >
                  {range.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function Callout({ tone, text }) {
  if (!text) return null;
  return <div className={`section-callout ${tone || "info"}`}>{text}</div>;
}

function AnalysisTimer({ step, onDone }) {
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), 850);
    return () => clearTimeout(timer);
  }, [step]);
  return null;
}

function ContactForm({ onSubmit, error }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", consent: false, website: "" });
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <div className="contact-grid">
      <div className="contact-value-note">
        <strong>¿Qué vas a recibir?</strong>
        <span>Tu principal desajuste, un plan de acción y un video elegido según tus respuestas.</span>
      </div>
      <div className="field">
        <label htmlFor="w-name">Nombre</label>
        <input id="w-name" value={form.name} onChange={update("name")} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="w-email">Email</label>
        <input id="w-email" type="email" value={form.email} onChange={update("email")} autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="w-phone">Teléfono (WhatsApp)</label>
        <input id="w-phone" type="tel" value={form.phone} onChange={update("phone")} autoComplete="tel" inputMode="tel" placeholder="+54 9 3585 000000" />
      </div>
      <div className="hp-field" aria-hidden="true">
        <label htmlFor="w-website">No completar</label>
        <input id="w-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={update("website")} />
      </div>
      <label className="consent-option">
        <input type="checkbox" checked={form.consent} onChange={(event) => setForm((current) => ({ ...current, consent: event.target.checked }))} />
        <span>Acepto recibir mi diagnóstico y que Metacrypto Club me contacte por email, teléfono o WhatsApp según mis respuestas.</span>
      </label>
      {error && <div className="contact-error" role="alert">{error}</div>}
      <button className="btn-gold opt-next" type="button" onClick={() => onSubmit(form)}>
        Ver mi diagnóstico personalizado
      </button>
    </div>
  );
}
