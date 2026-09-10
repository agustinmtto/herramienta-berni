"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { wizardConfig, questions, progressFor } from "../lib/question-config";
import { buildDiagnosis } from "../lib/engine";
import { buildWhatsAppUrl } from "../lib/whatsapp";
import DiagnosisDocument from "./diagnosis-document";

const SCREENS = { HERO: "hero", WIZARD: "wizard", SEGMENT: "segment", ANALYZING: "analyzing", FINAL: "final" };

export default function Flow() {
  const [screen, setScreen] = useState(SCREENS.HERO);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [segIndex, setSegIndex] = useState(null);
  const [analyzing, setAnalyzing] = useState(0);
  const [contactError, setContactError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [started, setStarted] = useState(false);
  const sessionIdRef = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : null);

  const contact = questions.length - 1;
  const isContact = qIndex === contact;
  const question = questions[qIndex];
  const answered = Object.keys(answers).filter((k) => k !== "contact").length;

  const startWizard = () => {
    setStarted(true);
    setScreen(SCREENS.WIZARD);
  };

  const pick = (option) => {
    setAnswers({ ...answers, [question.id]: { answer: option.label, tags: option.tags } });
  };
  const move = (delta) => setQIndex((i) => Math.max(0, Math.min(i + delta, contact)));

  const submitContact = (form) => {
    setContactError(null);
    const contact = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      consent: form.consent,
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
    setAnswers({ ...answers, contact });
    setScreen(SCREENS.SEGMENT);
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
    if (!sent) {
      sendLead(buildPayload(false));
      setSent(true);
    }
    setScreen(SCREENS.FINAL);
  };

  function buildPayload(abandoned = false) {
    if (abandoned) {
      const partial = questions
        .filter((q) => q.type !== "contact" && answers[q.id])
        .map((q) => ({ pregunta: q.title, respuesta: answers[q.id].answer }));
      return {
        session_id: sessionIdRef.current,
        lead: null,
        signals: { dropoff_question: null, finished_at: new Date().toISOString() },
        answers: partial,
      };
    }
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
      session_id: sessionIdRef.current,
      lead: {
        name: answers.contact ? answers.contact.name : "",
        email: answers.contact ? answers.contact.email : "",
        phone: answers.contact ? answers.contact.phone : "",
        consent: Boolean(answers.contact),
      },
      signals: { dropoff_question: null, finished_at: new Date().toISOString() },
      answers: payloadAnswers,
    };
  }

  const diagnosis = useMemo(() => {
    if (screen !== SCREENS.FINAL) return null;
    const lead = questions.map((q) => {
      const cur = answers[q.id];
      return { type: q.type || "option", title: q.title, answer: cur ? cur.answer : null, tags: cur ? cur.tags : [] };
    });
    return buildDiagnosis(lead, wizardConfig.segmentQuestion.options[segIndex || 0]);
  }, [screen, answers, segIndex]);

  // Dropoff tracking — docs/03 §6: the key metric is how far the lead got.
  useEffect(() => {
    const onLeave = () => {
      if (sent || !started) return;
      const inWizard = screen === SCREENS.WIZARD;
      const runProgress = [SCREENS.WIZARD, SCREENS.SEGMENT, SCREENS.ANALYZING].includes(screen);
      if (runProgress) {
        const payload = buildPayload(true);
        payload.signals.dropoff_question = inWizard && question ? question.title : wizardConfig.segmentQuestion.title;
        navigator.sendBeacon("/api/lead", JSON.stringify(payload));
      }
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  });

  if (screen === SCREENS.HERO) {
    return (
      <main className="page-shell hero-section">
        <span className="eyebrow">{wizardConfig.brand.eyebrow}</span>
        <h1 className="hero-title">
          {wizardConfig.brand.titleStart} <em>{wizardConfig.brand.titleEm}</em>
        </h1>
        <p className="hero-sub">
          Respondé unas preguntas sobre tu situación y recibí un diagnóstico de lo que no está funcionando y qué
          hacer al respecto.
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
        </div>

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
              <button className="btn-gold opt-next" type="button" onClick={() => move(1)}>
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
              <span className={i === analyzing ? "state-active" : i < analyzing ? "state-done" : "state-pending"}>
                {i === analyzing ? "procesando..." : i < analyzing ? "✓ listo" : "en cola"}
              </span>
            </div>
          ))}
        </div>
        <AnalysisTimer step={analyzing} onDone={advanceAnalysis} />
      </main>
    );
  }

  if (screen === SCREENS.FINAL && diagnosis) {
    const mappedVideo = wizardConfig.videos.items.find(
      (v) => v.id === wizardConfig.segmentQuestion.options[segIndex || 0].video
    );
    const whatsappAnswers = questions
      .filter((q) => q.type !== "contact" && answers[q.id])
      .map((q) => ({ pregunta: q.title, respuesta: answers[q.id].answer }));
    const segmentOption = wizardConfig.segmentQuestion.options[segIndex || 0];
    const whatsappUrl = buildWhatsAppUrl({
      number: wizardConfig.finalCta.whatsappNumber,
      name: answers.contact?.name,
      answers: whatsappAnswers,
      segment: { pregunta: wizardConfig.segmentQuestion.title, respuesta: segmentOption.label },
    });
    return (
      <main className="page-shell result-section">
        <button
          className="pdf-btn"
          type="button"
          onClick={() => import("../lib/pdf").then((m) => m.downloadDiagnosisPdf(answers.contact?.name))}
        >
          Descargar diagnóstico PDF
        </button>

        <div className="diagnosis-sheet" id="diagnosis-sheet">
          <div className="result-head">
            <span className="eyebrow">Auditoría · Metacrypto Club</span>
            <h2>Mi portfolio <em>bajo la lupa</em></h2>
          </div>

        <div className="section-block">
          <h3>Tu problema principal</h3>
          <Callout tone={diagnosis.sections[1].body.kind} text={diagnosis.sections[1].body.text} />
        </div>

        <div className="section-block">
          <h3>El coste de tu liquidez parada</h3>
          <Callout tone={diagnosis.sections[2].body.kind} text={diagnosis.sections[2].body.text} />
        </div>

        <div className="section-block">
          <h3>Tu plan de acción</h3>
          <ol className="plan-list">
            {diagnosis.sections[3].items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ol>
        </div>

        <div className="metric-block">
          <h3>Tu métrica norte</h3>
          <p>Capital con plan estructurado + despliegue del dinero parado.</p>
        </div>

        <div className="recursos-head">
          <span className="eyebrow">Tus recursos para resolverlo</span>
          <p>Todo lo que necesitás para ejecutar el plan, sin pagar nada.</p>
        </div>

        <div className="video-grid">
          {wizardConfig.videos.items.map((v) => (
            <div className={`video-card${mappedVideo && v.id === mappedVideo.id ? " featured" : ""}`} key={v.id}>
              <div className="video-box">
                <span className="video-tag">{v.id === mappedVideo?.id ? "Tu problema específico" : "Recurso"}</span>
                <div className="play-circle">▶</div>
                <div className="video-label">{v.label}</div>
              </div>
              <p className="video-desc">{v.label}</p>
            </div>
          ))}
        </div>

        <div className="final-cta">
          <p>{wizardConfig.finalCta.text}</p>
          <a className="btn-gold" href={whatsappUrl} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "center" }}>
            {wizardConfig.finalCta.button}
          </a>
        </div>
        </div>
        <div className="pdf-render-host" aria-hidden="true">
          <DiagnosisDocument name={answers.contact?.name} />
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

function AnalysisTimer({ step, onDone }) {
  const doneRef = useRef(false);
  useEffect(() => {
    doneRef.current = false;
    const t = setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }, 950);
    return () => {
      doneRef.current = true;
      clearTimeout(t);
    };
  }, [step, onDone]);
  return null;
}

function ContactForm({ onSubmit, error }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", consent: false });
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
      <div className="field">
        <label htmlFor="w-phone">Teléfono (WhatsApp)</label>
        <input
          id="w-phone"
          type="tel"
          value={form.phone}
          onChange={update("phone")}
          autoComplete="tel"
          inputMode="tel"
          placeholder="+54 9 3585 000000"
        />
      </div>
      <label className="opt" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
        Acepto recibir mi diagnóstico y que me contacten por email, teléfono o WhatsApp
      </label>
      {error && <div className="contact-error">{error}</div>}
      <button className="btn-gold opt-next" type="button" onClick={() => onSubmit(form)}>
        Ver mi diagnóstico
      </button>
    </div>
  );
}
