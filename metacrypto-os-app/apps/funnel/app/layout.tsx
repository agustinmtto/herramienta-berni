import type { ReactNode } from "react";

// Layout raíz de la app pública del funnel. Aislado del OS a propósito: sin
// cookies del sistema, sin importar nada del inbox (docs/00, separación).
export const metadata = {
  title: "Metacrypto Club — Diagnóstico de Portfolio",
  description: "Diagnosticá tu portfolio de cripto: 8 preguntas, tu plan de acción y un video para resolverlo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
