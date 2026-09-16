// ============================================================
// El interruptor de la caída de WhatsApp.
//
// El 2-sep-2026 Meta baneó la WABA de MCC (`141014`). Durante casi tres
// horas el OS siguió aceptando mensajes sin decir nada: Kapso devolvía
// **200**, y el fallo real —`131031 "Business Account locked"`— llegaba
// después por el webhook de estado. Como `wa_mensajes.status` se queda
// congelado en "sent" para siempre, en el inbox los mensajes se veían
// enviados. Dos clientes se quedaron esperando un plan que nadie mandó, y
// los dos crons de `vercel.json` siguieron disparando plantillas cada 5
// minutos contra un canal muerto.
//
// Un 200 de Kapso NO es una entrega. Mientras el canal esté caído, el único
// comportamiento honesto es no llamar y decir por qué.
//
// La variable `WA_BLOQUEADO_MOTIVO` es el interruptor Y el mensaje: su valor
// es lo que se le enseña al equipo. Se apaga borrándola en Vercel (requiere
// redespliegue, que para volver a encender WhatsApp es un acto deliberado,
// no una urgencia).
// ============================================================

export type EstadoWa = {
  bloqueado: boolean;
  motivo: string; // vacío cuando no está bloqueado
};

export function estadoWa(env: Record<string, string | undefined> = process.env): EstadoWa {
  const motivo = (env.WA_BLOQUEADO_MOTIVO ?? "").trim();
  return motivo ? { bloqueado: true, motivo } : { bloqueado: false, motivo: "" };
}
