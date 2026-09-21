"use client";

// Flow del Quiz Funnel portado al OS (docs/11 Fase B). Original: components/
// flow.jsx del repo prototipo. Cambios de esta versión:
//   - session_id persistente en sessionStorage (sobrevive recargas)
//   - UTMs + referrer capturados al iniciar (docs/11 §6)
//   - eventos del contrato nuevo: started / progress / dropped / completed
//     (docs/11 §5) — el endpoint valida y el RPC persiste
//   - el contacto se PERSISTE antes de mostrar el resultado (docs/11 Fase B.6):
//     si el POST falla, se muestra error y se puede reintentar
//   - selector de país/prefijo en el contacto (docs/11 D12)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildAllocationResponse,
  progressFor,
  progressMessageFor,
  questions,
  wizardConfig,
  type AllocationSelection,
  type QuizAssetRange,
  type QuizQuestion,
} from "@/lib/quiz/question-config";
import { buildDiagnosis, type Diagnosis, type DiagnosisBody } from "@/lib/quiz/engine";
import { buildWhatsAppUrl } from "@/lib/quiz/whatsapp";
import {
  COUNTRIES,
  buildQuizPayload,
  capturarSource,
  composePhone,
  type QuizAnswerState,
  type SourceData,
} from "@/lib/quiz/lead-payload";

const SCREENS = { HERO: "hero", WIZARD: "wizard", ANALYZING: "analysis", FINAL: "result" } as const;
type Screen = (typeof SCREENS)[keyof typeof SCREENS];

const SESSION_KEY = "quiz.session_id";
const STEPS = ["start", ...questions.map((q) => q.id)];

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function QuizFlow() {
  const [screen, setScreen] = useState<Screen>(SCREENS.HERO);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizAnswerState>>({});
  const [analyzing, setAnalyzing] = useState(0);
  const [contactError, setContactError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [leadName, setLeadName] = useState("");

  const sessionIdRef = useRef<string | null>(null);
  const sourceRef = useRef<SourceData | null>(null);
  const visitedStagesRef = useRef<string[]>([]);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);

  // Los hooks de envío viven en callbacks estables para no re-registrar
  // listeners en cada render (el efecto de pagehide del original corría sin
  // array de dependencias a propósito: acá usamos refs para lo mismo).
  const sendEvent = useCallback(async (event: string, extra: Record<string, unknown>) => {
    if (!sessionIdRef.current) return;
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildQuizPayload({
            event: event as never,
            sessionId: sessionIdRef.current,
            source: sourceRef.current ?? capturarSource(),
            stepId: extra.stepId as string,
            stepIndex: extra.stepIndex as number,
            visited: visitedStagesRef.current,
            ...extra,
          })
        ),
        keepalive: true,
      });
    } catch {
      // started/progress son best-effort: no bloquean la navegación del quiz.
    }
  }, []);

  const recordStage = useCallback((stage: string) => {
    if (stage && !visitedStagesRef.current.includes(stage)) {
      visitedStagesRef.current = [...visitedStagesRef.current, stage];
    }
    return visitedStagesRef.current;
  }, []);

  const startWizard = () => {
    if (!sessionIdRef.current) sessionIdRef.current = getOrCreateSessionId();
    if (!sourceRef.current) sourceRef.current = capturarSource();
    recordStage("start");
    recordStage(questions[0].trackingId);
    setStarted(true);
    setScreen(SCREENS.WIZARD);
    sendEvent("started", { stepId: "start", stepIndex: 0 });
  };

  // Avanza a un índice concreto y avisa al endpoint (progress). El efecto
  // NUNCA va dentro del updater de setQIndex: React puede invocarlo dos veces
  // (StrictMode) y duplicaría el envío.
  const goTo = useCallback((next: number) => {
    setQIndex(next);
    sendEvent("progress", { stepId: questions[next]?.id ?? "contact", stepIndex: next });
  }, [sendEvent]);

  const move = (delta: number) => {
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    setTransitioning(false);
    setQIndex((current) => Math.max(0, Math.min(current + delta, questions.length - 1)));
  };

  const pick = (question: QuizQuestion, option: { optionId: string; label: string; tags: string[]; video?: string }) => {
    if (transitioning) return;
    setAnswers((current) => ({
      ...current,
      [question.id]: {
        answer: option.label,
        tags: option.tags,
        optionId: option.optionId,
        video: option.video,
        answeredAt: new Date().toISOString(),
      },
    }));
    setTransitioning(true);
    transitionTimerRef.current = setTimeout(() => {
      setQIndex((current) => Math.min(current + 1, questions.length - 1));
      setTransitioning(false);
    }, 340);
    // El progress se emite con el índice siguiente al que ya se movió el foco
    // visual: si el usuario abandona en la transición, el beacon llega con el
    // último paso confirmado, no con el que no llegó a ver.
    goTo(Math.min(qIndex + 1, questions.length - 1));
  };

  const pickAllocation = (question: QuizQuestion, asset: { id: string }, range: QuizAssetRange) => {
    setAnswers((current) => {
      const selections: Record<string, AllocationSelection> = { ...(current[question.id]?.selections || {}), [asset.id]: { id: range.id, label: range.label } };
      const response = buildAllocationResponse(question, selections);
      return {
        ...current,
        [question.id]: response
          ? { ...response, selections, answeredAt: new Date().toISOString() }
          : { answer: null, tags: [], selections },
      };
    });
  };

  const confirmAllocation = () => {
    setTransitioning(true);
    transitionTimerRef.current = setTimeout(() => {
      setTransitioning(false);
    }, 200);
    goTo(Math.min(qIndex + 1, questions.length - 1));
  };

  const submitContact = async (form: {
    name: string;
    email: string;
    phoneLocal: string;
    country: string;
    consent: boolean;
    website: string;
  }) => {
    setContactError(null);
    const name = form.name.trim();
    const email = form.email.trim();
    const phone = composePhone(form.country, form.phoneLocal);
    if (!name || !email || !form.phoneLocal.trim() || !form.consent) {
      setContactError("Completá nombre, email, teléfono y aceptá recibir el diagnóstico.");
      return;
    }
    if (!/.+@.+\..+/.test(email)) {
      setContactError("Ingresá un email válido.");
      return;
    }
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      setContactError("Ingresá un teléfono válido (sin el 0 ni el 15).");
      return;
    }

    const contact = { name, email, phone, country: form.country, consent: form.consent, website: form.website };
    const contactState: QuizAnswerState = { answer: null, tags: [] };
    const finalAnswers: Record<string, QuizAnswerState> = { ...answers, contact: contactState };
    const diagnosisSnapshot = buildDiagnosis(
      questions
        .filter((item) => item.type !== "contact")
        .map((item) => ({
          type: item.type || "option",
          title: item.title,
          answer: finalAnswers[item.id]?.answer || null,
          tags: finalAnswers[item.id]?.tags || [],
        }))
    );
    const stages = recordStage("analysis");

    // El contacto se persiste ANTES de mostrar el resultado (docs/11 Fase B.6).
    // Si falla, el lead ve el error y reintenta: no se pierde ni se finge éxito.
    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildQuizPayload({
            event: "completed",
            sessionId: sessionIdRef.current!,
            source: sourceRef.current ?? capturarSource(),
            stepId: "result",
            stepIndex: STEPS.length,
            visited: stages,
            contact,
            answers: finalAnswers,
            diagnosisSnapshot: { version: "diagnostico-v1", result: diagnosisSnapshot },
          })
        ),
      });
      if (!response.ok) {
        setContactError("No pudimos guardar tu diagnóstico. Revisá los datos e intentá de nuevo.");
        return;
      }
    } catch {
      setContactError("Problema de conexión. Intentá de nuevo en unos segundos.");
      return;
    }

    completedRef.current = true;
    setLeadName(name);
    setDiagnosis(diagnosisSnapshot);
    setAnalyzing(0);
    setScreen(SCREENS.ANALYZING);
  };

  const advanceAnalysis = useCallback(() => {
    setAnalyzing((step) => {
      if (step < 4) return step + 1;
      recordStage("result");
      setScreen(SCREENS.FINAL);
      return step;
    });
  }, [recordStage]);

  useEffect(() => {
    if (screen === SCREENS.WIZARD && questions[qIndex]?.trackingId) recordStage(questions[qIndex].trackingId);
  }, [screen, qIndex, recordStage]);

  useEffect(() => () => { if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current); }, []);

  useEffect(() => {
    const onLeave = () => {
      if (completedRef.current || !started || screen === SCREENS.FINAL) return;
      if (!sessionIdRef.current) return;
      const payload = buildQuizPayload({
        event: "dropped",
        sessionId: sessionIdRef.current,
        source: sourceRef.current ?? capturarSource(),
        stepId: visitedStagesRef.current.at(-1) || "start",
        stepIndex: visitedStagesRef.current.length,
        visited: visitedStagesRef.current,
      });
      navigator.sendBeacon("/api/lead", new Blob([JSON.stringify(payload)], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [started, screen]);

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

  const question = questions[qIndex];
  const isContact = question.type === "contact";
  const diagnosticQuestionCount = questions.length - 1;

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
            aria-valuemin={0}
            aria-valuemax={100}
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
              {question.options!.map((option) => {
                const selected = answers[question.id]?.answer === option.label;
                return (
                  <button
                    key={option.optionId}
                    className={`opt${selected ? " selected" : ""}`}
                    onClick={() => pick(question, option)}
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
            <button className="btn-gold opt-next" type="button" disabled={!allocationComplete} onClick={confirmAllocation}>
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
        <AnalysisTimer onDone={advanceAnalysis} />
      </main>
    );
  }

  if (screen === SCREENS.FINAL && diagnosis) {
    const selectedVideoId = answers[wizardConfig.videoSelectorQuestionId]?.video || "video1";
    const mappedVideo = wizardConfig.videos.items.find((video) => video.id === selectedVideoId);
    const whatsappAnswers = questions
      .filter((item) => item.type !== "contact" && answers[item.id]?.answer)
      .map((item) => ({ pregunta: item.title, respuesta: answers[item.id].answer! }));
    const whatsappUrl = buildWhatsAppUrl({
      number: wizardConfig.finalCta.whatsappNumber,
      name: leadName,
      answers: whatsappAnswers,
      requestedVideo: mappedVideo?.label,
    });
    return (
      <main className="page-shell result-section">
        <div className="diagnosis-sheet" id="diagnosis-sheet">
          <div className="result-head">
            <span className="eyebrow">Auditoría · Metacrypto Club</span>
            <h2>{leadName}, tu portfolio está <em>bajo la lupa</em></h2>
          </div>

          <div className="section-block">
            <h3>Tu problema principal</h3>
            <Callout tone={(diagnosis.sections[1].body as DiagnosisBody).kind} text={(diagnosis.sections[1].body as DiagnosisBody).text} />
          </div>

          <div className="section-block">
            <h3>La señal que no conviene ignorar</h3>
            <Callout tone={(diagnosis.sections[2].body as DiagnosisBody).kind} text={(diagnosis.sections[2].body as DiagnosisBody).text} />
          </div>

          <div className="section-block">
            <h3>Tu plan de acción</h3>
            <ol className="plan-list">
              {diagnosis.sections[3].items!.map((item) => <li key={item}>{item}</li>)}
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

function AllocationQuestion({
  question,
  answer,
  onPick,
}: {
  question: QuizQuestion;
  answer?: QuizAnswerState;
  onPick: (question: QuizQuestion, asset: { id: string }, range: QuizAssetRange) => void;
}) {
  const selections = answer?.selections || {};
  return (
    <div className="allocation-list">
      {question.assets!.map((asset) => (
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
                  onClick={() => onPick(question, asset, range)}
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

function Callout({ tone, text }: { tone: string; text: string }) {
  if (!text) return null;
  return <div className={`section-callout ${tone}`}>{text}</div>;
}

function AnalysisTimer({ onDone }: { onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), 850);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

function ContactForm({
  onSubmit,
  error,
}: {
  onSubmit: (form: { name: string; email: string; phoneLocal: string; country: string; consent: boolean; website: string }) => void;
  error: string | null;
}) {
  const [form, setForm] = useState({ name: "", email: "", phoneLocal: "", country: "AR", consent: false, website: "" });
  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const country = useMemo(() => COUNTRIES.find((c) => c.code === form.country) ?? COUNTRIES[0], [form.country]);
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
      <div className="field field-phone">
        <label htmlFor="w-phone">Teléfono (WhatsApp)</label>
        <div className="phone-row">
          <select id="w-country" value={form.country} onChange={update("country")} aria-label="Código de país">
            {COUNTRIES.map((c) => (
              <option key={`${c.code}-${c.prefix}`} value={c.code}>+{c.prefix}</option>
            ))}
          </select>
          <input
            id="w-phone"
            type="tel"
            value={form.phoneLocal}
            onChange={update("phoneLocal")}
            autoComplete="tel-national"
            inputMode="tel"
            placeholder={`9 3585 000000`}
          />
        </div>
        <small className="phone-hint">{country.label} · +{country.prefix}. Sin 0 ni 15.</small>
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
