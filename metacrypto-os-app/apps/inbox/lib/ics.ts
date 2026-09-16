// ============================================================
// Genera la invitación de calendario de una sesión grupal recurrente.
//
// Sustituye al recordatorio de WhatsApp/email de las sesiones fijas: en vez
// de avisar dos veces por semana para siempre (~940 correos al mes), la
// sesión entra UNA vez en el calendario del cliente y a partir de ahí le
// avisa su propia agenda.
//
// Cinco reglas que salieron de una investigación verificada (3-sep-2026) y
// que no se ven leyendo el código. Las cinco fallan en silencio:
//
// 1. 🔴 **Una serie por evento.** Una RRULE no lleva hora: la hereda de
//    DTSTART. `FREQ=WEEKLY;BYDAY=SU,WE` con DTSTART el domingo a las 19:00
//    pone el miércoles TAMBIÉN a las 19:00, cuando la sesión es a las 20:00.
//    Y `BYHOUR=19,20` es peor: con FREQ=WEEKLY ambas partes expanden y salen
//    cuatro sesiones semanales. Dos series = dos VEVENT, dos UID, dos ficheros
//    (RFC 5546 §3.2.2 no admite varios UID en un REQUEST).
//
// 2. 🔴 **Hora local con TZID, nunca UTC.** Con sufijo Z la recurrencia se
//    clava al instante absoluto: en España la sesión se vería a las 19:00
//    hasta el cambio de hora y a las 18:00 después. El RFC lo recomienda
//    explícitamente para recurrentes (§3.8.5.3).
//
// 3. **VTIMEZONE incluido.** Con TZID pero sin la definición, algunos
//    clientes no saben resolver la zona y caen a la del sistema.
//
// 4. **DTEND obligatorio en la práctica.** Sin él, un VEVENT con DTSTART
//    DATE-TIME dura cero y desaparece de la franja horaria de la agenda.
//
// 5. **CRLF y plegado a 75 octetos.** Es formato, no estética: una línea
//    larga sin plegar rompe el fichero en clientes estrictos.
//
// Lo que NO se puede prometer: Google Calendar ignora el VALARM (los avisos
// son ajuste privado de cada usuario), así que un cliente con Gmail verá su
// recordatorio por defecto, no el nuestro. Se incluye igual porque Apple y
// Outlook sí lo respetan. Por eso el correo dice "añade la sesión a tu
// calendario" y no "te avisamos una hora antes".
// ============================================================

// Índice = getUTCDay(): 0 es domingo.
export const DIAS_ICS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export type ArgsIcs = {
  uid: string; // ESTABLE por serie: es lo que permite actualizar en vez de duplicar
  resumen: string;
  descripcion?: string;
  inicio: string; // "YYYY-MM-DDTHH:MM:SS" en hora LOCAL de `zona`, sin Z
  duracionMin: number;
  zona: string;
  diaSemana: number; // 0=domingo … 6=sábado
  organizador: string;
  asistente?: string;
  enlace?: string;
  secuencia?: number;
  cancelar?: boolean;
  dtstamp: string; // ISO. Se INYECTA: `new Date()` haría el fichero no determinista y los tests inútiles
};

export function icsSesionRecurrente(a: ArgsIcs): string {
  const dia = DIAS_ICS[a.diaSemana];
  if (!dia) throw new Error(`icsSesionRecurrente: día de la semana inválido: ${a.diaSemana}`);

  const inicio = compacto(a.inicio);
  const fin = compacto(sumarMinutos(a.inicio, a.duracionMin));
  const metodo = a.cancelar ? "CANCEL" : "REQUEST";

  const desc = [a.descripcion, a.enlace ? `Enlace: ${a.enlace}` : null]
    .filter(Boolean)
    .join("\n");

  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MetaCrypto Club//OS//ES",
    "CALSCALE:GREGORIAN",
    `METHOD:${metodo}`,
    ...bloqueZona(a.zona),
    "BEGIN:VEVENT",
    `UID:${a.uid}`,
    `DTSTAMP:${compacto(a.dtstamp.replace(/[-:]/g, "").replace(/\.\d+/, ""))}Z`,
    `DTSTART;TZID=${a.zona}:${inicio}`,
    `DTEND;TZID=${a.zona}:${fin}`,
    // Sin UNTIL ni COUNT: eterno, como se pidió. La serie se corta con un
    // CANCEL, no con una fecha de caducidad que habría que recordar renovar.
    `RRULE:FREQ=WEEKLY;BYDAY=${dia}`,
    `SEQUENCE:${a.secuencia ?? 0}`,
    `STATUS:${a.cancelar ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${escapar(a.resumen)}`,
    ...(desc ? [`DESCRIPTION:${escapar(desc)}`] : []),
    ...(a.enlace ? [`LOCATION:${escapar(a.enlace)}`] : []),
    `ORGANIZER:mailto:${a.organizador}`,
    ...(a.asistente
      ? [`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.asistente}`]
      : []),
    "TRANSP:OPAQUE",
    // Google lo ignora (usa el aviso por defecto del usuario); Apple y
    // Outlook lo respetan. Dos de tres es mejor que ninguno.
    ...(a.cancelar
      ? []
      : ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT1H", `DESCRIPTION:${escapar(a.resumen)}`, "END:VALARM"]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lineas.map(plegar).join("\r\n") + "\r\n";
}

// "2026-09-06T19:00:00" → "20260906T190000"
function compacto(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z$/, "");
}

// Suma minutos a una hora LOCAL sin pasar por UTC. Tratar la cadena local
// como UTC y volver es seguro aquí porque solo se usa para calcular el fin
// desde el inicio: el desfase se cancela, y así el resultado no depende de la
// zona del proceso — la trampa que ya mordió en `lib/format.ts`.
function sumarMinutos(iso: string, minutos: number): string {
  const t = new Date(`${iso}Z`).getTime() + minutos * 60_000;
  return new Date(t).toISOString().slice(0, 19);
}

// RFC 5545 §3.3.11: en un valor TEXT hay que escapar \ ; , y los saltos.
function escapar(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545 §3.1: ninguna línea pasa de 75 OCTETOS (no caracteres), y la
// continuación empieza por un espacio. Se cuenta en bytes porque "ó" ocupa
// dos y partir por caracteres desbordaría el límite en textos con acentos.
function plegar(linea: string): string {
  if (Buffer.byteLength(linea, "utf8") <= 75) return linea;
  const trozos: string[] = [];
  let actual = "";
  let limite = 75;
  for (const ch of linea) {
    if (Buffer.byteLength(actual + ch, "utf8") > limite) {
      trozos.push(actual);
      actual = " " + ch; // el espacio de continuación cuenta para el límite
      limite = 75;
      continue;
    }
    actual += ch;
  }
  if (actual) trozos.push(actual);
  return trozos.join("\r\n");
}

// Definición de zona. Solo Europe/Madrid por ahora: es la de las dos sesiones
// grupales. Reglas de la UE — último domingo de marzo y de octubre.
//
// Deliberadamente NO se genera desde `Intl`: una definición inventada al
// vuelo que se equivoque en el cambio de hora movería la sesión una hora dos
// veces al año, en todos los calendarios y sin avisar. Una zona nueva se
// añade aquí a mano y con su test.
function bloqueZona(zona: string): string[] {
  if (zona !== "Europe/Madrid") {
    throw new Error(
      `icsSesionRecurrente: no hay definición VTIMEZONE para "${zona}". Añádela a mano en lib/ics.ts.`,
    );
  }
  return [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Madrid",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

/**
 * Puente entre `proximaOcurrencia` (instante UTC) y lo que el .ics necesita
 * (hora de pared de la zona).
 *
 * Del instante se toma SOLO la fecha, resuelta en la zona con `Intl` — que es
 * lo único que sabe si ese día había horario de verano. La hora la pone la
 * regla, porque es la hora de pared que el cliente ve en su calendario.
 *
 * Hacerlo al revés —derivar la hora del instante con un offset fijo— desfasa
 * una hora en la semana del cambio horario, y es el error que `lib/format.ts`
 * ya cometió una vez con las fechas del OS.
 */
export function inicioLocalDeRegla(
  instanteUtcIso: string,
  hora: string | null,
  zona: string,
): string | null {
  const h = (hora ?? "").trim();
  if (!h) return null;
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instanteUtcIso)); // en-CA da "YYYY-MM-DD"
  return `${partes}T${h.slice(0, 8).padEnd(8, ":00").slice(0, 8)}`;
}
