// Notas automáticas del formulario del evento 26/08: qué contestó el lead al
// agendar, escrito como nota en su contacto de GHL para que Berni y Alex lo
// lean antes de la llamada. Lógica pura; el I/O vive en
// app/api/ghl/evento-notas/route.ts.
//
// Los campos se leen por ID DE CUSTOM FIELD, nunca por fieldKey ni por merge
// tag: dos de estos campos comparten la misma fieldKey (Berni los creó
// duplicando el de capital, y la key es inmutable), así que cualquier lectura
// por key es ambigua. El ID es único siempre — es la única referencia segura.

export const CALENDARIO_EVENTO = "qXHMfM3O3sWphI90W0K2"; // Llamada de Admisión | Evento 26/08

// En el orden del formulario. La pregunta se escribe aquí tal cual se ve en el
// form (no el nombre del custom field): la nota es para leerla un humano que
// tiene el formulario en la cabeza.
export const CAMPOS_FORMULARIO: { id: string; pregunta: string }[] = [
  { id: "Sp4ubnvKDK899Na4R0Ke", pregunta: "¿Cuál crees que es tu necesidad principal?" },
  { id: "i2LXyrBAMfZ5evKqK96M", pregunta: "¿Con cuáles te identificas?" },
  {
    id: "YSuyCdgRy8vQATZNScr0",
    pregunta: "¿Capital disponible o a invertir en los próximos 12 meses?",
  },
  {
    id: "bXDI4i0WyXR5tmgvSEfu",
    pregunta: "¿Dispuesto a invertir en el acompañamiento?",
  },
  { id: "HROVMwpARQpr0xtNxRmq", pregunta: "Compromiso de asistencia (5 BONUS)" },
];

// Un custom field de GHL vale string (radio/texto), array (checkbox) o nada.
// Se normaliza a lista de strings no vacíos; una lista vacía significa "no
// contestó" y la nota lo dice explícitamente en vez de omitir la pregunta —
// que falte una respuesta también es información para la llamada.
export function valoresDeCampo(
  customFields: { id?: string; value?: unknown }[] | null | undefined,
  campoId: string,
): string[] {
  const v = (customFields ?? []).find((f) => f.id === campoId)?.value;
  const lista = Array.isArray(v) ? v : v == null ? [] : [v];
  return lista.map((x) => String(x).trim()).filter((x) => x.length > 0);
}

// La marca de idempotencia va DENTRO del cuerpo de la nota: el antiduplicados
// pregunta a las notas ya escritas, igual que el de WhatsApp pregunta a
// `wa_mensajes` — una nota que existe es la prueba de que se creó, sin tabla
// de estado aparte que pueda mentir.
export function marcaDeNota(appointmentId: string): string {
  return `[auto:evento-2608 cita:${appointmentId}]`;
}

export function notaYaExiste(
  notas: { body?: string | null }[] | null | undefined,
  appointmentId: string,
): boolean {
  const marca = marcaDeNota(appointmentId);
  return (notas ?? []).some((n) => (n.body ?? "").includes(marca));
}

export function construirNota(args: {
  appointmentId: string;
  startTime: string;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  customFields: { id?: string; value?: unknown }[] | null | undefined;
}): string {
  // Hora en Madrid: la nota es para el equipo (España), no para el lead.
  let cuando = "";
  try {
    cuando = new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(args.startTime));
  } catch {
    cuando = args.startTime;
  }

  const lineas: string[] = [
    "📋 Formulario del evento 26/08 — respuestas al agendar",
    "",
    `🕐 Cita: ${cuando} (hora Madrid)`,
    `👤 ${args.nombre ?? "(sin nombre)"} · ${args.email ?? "(sin email)"} · ${args.telefono ?? "(sin teléfono)"}`,
    "",
  ];
  for (const campo of CAMPOS_FORMULARIO) {
    const valores = valoresDeCampo(args.customFields, campo.id);
    lineas.push(`▸ ${campo.pregunta}`);
    if (valores.length === 0) {
      lineas.push("   (sin respuesta)");
    } else {
      for (const v of valores) lineas.push(`   · ${v}`);
    }
  }
  lineas.push("", marcaDeNota(args.appointmentId));
  return lineas.join("\n");
}
