import { Oswald, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Layout raíz del App Router. Carga las 3 tipografías del design system
// (docs/04-design-system.md) como variables CSS: Oswald para títulos,
// Sora para texto, JetBrains Mono para detalles tipo código.
const oswald = Oswald({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-oswald" });
const sora = Sora({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-sora" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono" });

// Metadata de la pestaña / SEO básico (se muestra en resultados de búsqueda).
export const metadata = {
  title: "Diagnóstico de Portfolio Cripto — Metacrypto Club",
  description: "Respondé unas preguntas y recibí un diagnóstico gratuito de tu portfolio cripto.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className={`${oswald.variable} ${sora.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
