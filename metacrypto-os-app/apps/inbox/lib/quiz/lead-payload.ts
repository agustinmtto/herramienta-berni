// Constructor del payload del contrato JSON (docs/11 §5) usado por el funnel.
// Toda la forma del contrato vive acá para que los tests la cubran entera y el
// componente de UI solo decida QUÉ evento manda y cuándo.

import {
  CONSENT_VERSION,
  QUESTIONS_ORDER,
  QUIZ_VERSION,
  SCHEMA_VERSION,
  buildAllocationResponse,
  questions,
  type AllocationSelection,
} from "./question-config";

export type QuizEvent = "started" | "progress" | "dropped" | "completed";

export interface LeadContact {
  name: string;
  email: string;
  phone: string; // ya compuesto con prefijo, ej. "+5493585000000"
  country: string; // ISO 3166-1 alpha-2
  consent: boolean;
  website?: string; // honeypot: el humano no lo rellena
}

export interface SourceData {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
}

export interface QuizAnswerState {
  answer: string | null;
  tags: string[];
  optionId?: string;
  optionValue?: unknown;
  video?: string;
  selections?: Record<string, AllocationSelection>;
  answeredAt?: string;
}

export interface ContractAnswer {
  question_id: string;
  type: string;
  question_text: string;
  order: number;
  answer_id: string | null;
  answer_text: string | null;
  value: unknown;
  answered_at: string | null;
}

// Captura automática de atribución (docs/11 §6): el usuario no completa nada.
export function capturarSource(): SourceData {
  const source: SourceData = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, referrer: null };
  if (typeof window === "undefined") return source;
  const params = new URLSearchParams(window.location.search);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = params.get(key);
    if (v) source[key] = v.slice(0, 200);
  }
  if (document.referrer) source.referrer = document.referrer.slice(0, 500);
  return source;
}

// Prefijos del selector de país del formulario (docs/11 D12). El servidor
// revalida el teléfono igual: nunca confiamos en el navegador.
export const COUNTRIES: { code: string; prefix: string; label: string }[] = [
  { code: "AR", prefix: "54", label: "Argentina" },
  { code: "BO", prefix: "591", label: "Bolivia" },
  { code: "BR", prefix: "55", label: "Brasil" },
  { code: "CA", prefix: "1", label: "Canadá" },
  { code: "CL", prefix: "56", label: "Chile" },
  { code: "CO", prefix: "57", label: "Colombia" },
  { code: "CR", prefix: "506", label: "Costa Rica" },
  { code: "EC", prefix: "593", label: "Ecuador" },
  { code: "ES", prefix: "34", label: "España" },
  { code: "US", prefix: "1", label: "Estados Unidos" },
  { code: "MX", prefix: "52", label: "México" },
  { code: "PA", prefix: "507", label: "Panamá" },
  { code: "PY", prefix: "595", label: "Paraguay" },
  { code: "PE", prefix: "51", label: "Perú" },
  { code: "DO", prefix: "1809", label: "Rep. Dominicana" },
  { code: "UY", prefix: "598", label: "Uruguay" },
  { code: "VE", prefix: "58", label: "Venezuela" },
];

// Teléfono E.164 desde selector + número local: solo dígitos, sin ceros de
// salida de línea. El endpoint revalida el formato completo (docs/09).
export function composePhone(countryPrefix: string, localNumber: string): string {
  let digits = localNumber.replace(/\D/g, "");
  if (countryPrefix === "54") digits = digits.replace(/^0+/, ""); // troncal ARG
  return `+${countryPrefix}${digits}`;
}

// Mapea el estado de respuestas del wizard al arreglo de respuestas del
// contrato: IDs estables + snapshot de texto + valor estructurado.
export function buildContractAnswers(
  answers: Record<string, QuizAnswerState>,
  order: string[]
): ContractAnswer[] {
  const result: ContractAnswer[] = [];
  for (const question of questions) {
    if (question.type === "contact") continue;
    const state = answers[question.id];
    if (!state) continue;
    const idx = order.indexOf(question.id);
    const base = {
      question_id: question.id,
      type: question.type === "allocation" ? "allocation" : (question.contractType ?? "single_choice"),
      question_text: question.title,
      order: idx >= 0 ? idx + 1 : 0,
      answered_at: state.answeredAt ?? null,
    };
    if (question.type === "allocation" && state.selections) {
      const response = buildAllocationResponse(question, state.selections);
      result.push({
        ...base,
        answer_id: null,
        answer_text: response?.answer ?? null,
        value: question.assets!.map((asset) => ({ asset_id: asset.id, level: state.selections![asset.id]?.id ?? null })),
      });
    } else {
      result.push({
        ...base,
        answer_id: state.optionId ?? null,
        answer_text: state.answer ?? null,
        value: state.optionValue ?? null,
      });
    }
  }
  return result;
}

export interface BuildPayloadArgs {
  event: QuizEvent;
  sessionId: string;
  source: SourceData;
  stepId: string;
  stepIndex: number;
  visited: string[];
  contact?: LeadContact | null;
  answers?: Record<string, QuizAnswerState>;
  diagnosisSnapshot?: { version: string; result: unknown } | null;
}

export function buildQuizPayload(args: BuildPayloadArgs): Record<string, unknown> {
  const { event, sessionId, source, stepId, stepIndex, visited } = args;
  const payload: Record<string, unknown> = {
    schema_version: SCHEMA_VERSION,
    quiz_version: QUIZ_VERSION,
    session_id: sessionId,
    event,
    occurred_at: new Date().toISOString(),
    source,
    progress: { step_id: stepId, step_index: stepIndex },
  };

  if (event === "completed") {
    const contact = args.contact!;
    payload.lead = {
      name: contact.name.trim().slice(0, 120),
      email: contact.email.trim().toLowerCase(),
      phone: contact.phone,
      country: contact.country || null,
      consent: {
        accepted: contact.consent === true,
        version: CONSENT_VERSION,
        accepted_at: new Date().toISOString(),
      },
    };
    payload.answers = buildContractAnswers(args.answers ?? {}, QUESTIONS_ORDER);
    if (args.diagnosisSnapshot) payload.diagnosis = args.diagnosisSnapshot;
    payload.client_context = {
      locale: typeof navigator !== "undefined" ? navigator.language : "es-AR",
      timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
    };
  }

  return payload;
}
