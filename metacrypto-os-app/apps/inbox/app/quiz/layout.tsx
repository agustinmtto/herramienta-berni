import { Oswald, Sora, JetBrains_Mono } from "next/font/google";
import "../quiz.css";

// Layout propio del funnel público /quiz (docs/11 D1). Carga las tipografías
// del design system del quiz (docs/04 del repo prototipo) como variables y
// aplica la clase raíz .quiz-page, que aísla TODOS los estilos del funnel:
// nada de acá compite con inbox.css ni con las pantallas internas del OS.

const oswald = Oswald({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-oswald" });
const sora = Sora({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-sora" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono" });

export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`quiz-page ${oswald.variable} ${sora.variable} ${mono.variable}`}>
      {children}
    </div>
  );
}
