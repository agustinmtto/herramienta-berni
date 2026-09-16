// Traduce un fallo de envío de Kapso en algo que el equipo pueda accionar.
// Lógica pura: recibe el status y el cuerpo crudo, no toca la red.
//
// Tres cosas que este helper aprendió a golpes:
//
// 1. Un 5xx es una caída de Kapso (su proxy ni llegó a Meta) y se resuelve
//    reintentando. Incidente del 6-ago-2026: 500 con un HTML de Rails
//    (`PG::ReadOnlySqlTransaction`) y el inbox solo decía "HTTP 500".
// 2. Hay DOS formatos de error. Meta manda `{ error: { message, code } }`;
//    Kapso manda `{ error: "texto suelto" }`. Leer solo el de Meta dejaba el
//    mensaje real fuera.
// 3. La ventana de 24 h llega por dos caminos: el código 131047 de Meta, o un
//    422 de Kapso que corta ANTES de llamar a Meta (y por tanto sin código).
//    El 10-ago-2026, escribiendo a ese cliente, solo se contemplaba el primero: el
//    inbox habló de "plantilla rechazada" al mandar un texto y no ofreció la
//    salida real, que es reabrir con una plantilla.
//
// Los mensajes son neutros a propósito ("el mensaje", no "la plantilla"):
// este helper lo comparten /api/reply (texto y adjuntos) y /api/send-template.

export type ErrorEnvio = {
  mensaje: string;          // para el equipo, en el inbox
  crudo: string;            // para el log del servidor
  fueraDeVentana: boolean;  // 24 h agotadas → hay que reabrir con plantilla
};

const MAX_CRUDO = 500;

export function interpretarErrorEnvio(status: number, cuerpo: string): ErrorEnvio {
  const texto = (cuerpo ?? "").trim();
  const crudo = !texto
    ? "(cuerpo vacío)"
    : texto.length > MAX_CRUDO
      ? `${texto.slice(0, MAX_CRUDO)}…`
      : texto;

  // Se comprueba primero porque es un diagnóstico definitivo: da igual el
  // status con el que venga, la salida siempre es la misma.
  if (esFueraDeVentana(texto)) {
    return {
      // Explícito a propósito: quien lo lee no tiene por qué saber qué es
      // "la ventana de 24 h", y sin el motivo esto parece un fallo del OS.
      mensaje:
        "No salió: WhatsApp solo permite escribir libremente durante 24 h desde el último mensaje del cliente. Envía una plantilla para reabrir la conversación.",
      crudo,
      fueraDeVentana: true,
    };
  }

  // Un 5xx nunca es culpa de lo que se escribió: el consejo útil es reintentar.
  if (status >= 500) {
    return {
      mensaje: "Kapso tuvo un problema temporal y no envió el mensaje. Espera un minuto y reintenta.",
      crudo,
      fueraDeVentana: false,
    };
  }

  return {
    mensaje: mensajeDelServidor(texto) ?? `El envío fue rechazado (HTTP ${status}).`,
    crudo,
    fueraDeVentana: false,
  };
}

// Meta usa `{ error: { message } }`; Kapso, `{ error: "texto" }`.
function mensajeDelServidor(texto: string): string | null {
  try {
    const err = JSON.parse(texto)?.error;
    if (typeof err === "string" && err) return err;
    const msg = err?.message;
    return typeof msg === "string" && msg ? msg : null;
  } catch {
    return null;
  }
}

// 131047 = código de Meta. El texto = el corte previo de Kapso, que no lleva código.
function esFueraDeVentana(texto: string): boolean {
  return texto.includes("131047") || /outside the 24-hour window/i.test(texto);
}
