import type { Metadata } from "next";
import { QuizFlow } from "./quiz-flow";

export const metadata: Metadata = {
  title: "Diagnóstico de Portfolio Cripto — Metacrypto Club",
  description: "Respondé unas preguntas y recibí un diagnóstico gratuito de tu portfolio cripto.",
};

export default function QuizPage() {
  return <QuizFlow />;
}
