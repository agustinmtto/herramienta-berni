import { describe, it, expect } from "vitest";
import {
  citaViva, coachDeUsuarioGhl, estadoDeCita, enlaceDeCita, nombreDeCoach, primerNombre,
  horaEnZona, tocaRecordatorio1h, tocaAvisoSinEnlace, idMensajeIncierto, zonaValida,
} from "../sesiones";

describe("coachDeUsuarioGhl", () => {
  it("mapea la cuenta corporativa de Berni", () => {
    expect(coachDeUsuarioGhl("DmvcKL0fg38HFDLZZRI8")).toBe("6cbb5982-6051-4c00-bc98-97310140e23f");
  });
  it("mapea también la cuenta antigua de Berni, que aparece en el histórico", () => {
    expect(coachDeUsuarioGhl("hlQOxNZMgRZWtbahC2c4")).toBe("6cbb5982-6051-4c00-bc98-97310140e23f");
  });
  it("mapea a Manuel", () => {
    expect(coachDeUsuarioGhl("pb9C0LZCk0N2FNrL1feC")).toBe("bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1");
  });
  it("mapea a Iker, el coach que entra el 2-sep-2026", () => {
    expect(coachDeUsuarioGhl("ubF4xEEXrP3d7yovZAfH")).toBe("1826f965-d12f-4550-b7ac-673326f5f671");
  });
  it("un usuario desconocido no inventa coach", () => {
    expect(coachDeUsuarioGhl("XXXXXXXX")).toBeNull();
  });
});

describe("nombreDeCoach", () => {
  it("da el nombre que verá el cliente en la plantilla", () => {
    expect(nombreDeCoach("6cbb5982-6051-4c00-bc98-97310140e23f")).toBe("Berni");
    expect(nombreDeCoach("bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1")).toBe("Manuel");
    expect(nombreDeCoach("1826f965-d12f-4550-b7ac-673326f5f671")).toBe("Iker");
  });
  it("un coach desconocido no inventa nombre: la plantilla dice 'tu sesión con {{coach}}'", () => {
    expect(nombreDeCoach("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(nombreDeCoach(null)).toBeNull();
  });
  it("todo usuario de GHL mapeado tiene nombre", () => {
    // El mapa de coaches y el de nombres viven en el mismo fichero justo para
    // esto: si se añade un coach en uno y se olvida el otro, la cita se
    // sincroniza pero el mensaje no sale nunca, en silencio.
    for (const usuario of [
      "DmvcKL0fg38HFDLZZRI8", "hlQOxNZMgRZWtbahC2c4", "pb9C0LZCk0N2FNrL1feC",
      "ubF4xEEXrP3d7yovZAfH",
    ]) {
      expect(nombreDeCoach(coachDeUsuarioGhl(usuario))).not.toBeNull();
    }
  });
});

describe("estadoDeCita", () => {
  it("conserva el estado de GHL en minúsculas", () => {
    expect(estadoDeCita("Confirmed")).toBe("confirmed");
  });
  it("sin estado asume confirmada, que es como se crean", () => {
    expect(estadoDeCita(null)).toBe("confirmed");
  });
  it("una cadena vacía es ausencia de estado, no un estado", () => {
    // GHL manda "" donde no tiene dato — igual que con `address`.
    expect(estadoDeCita("")).toBe("confirmed");
  });
  it("quita los espacios de alrededor", () => {
    expect(estadoDeCita(" cancelled ")).toBe("cancelled");
  });
});

describe("citaViva — lista BLANCA: solo se envía a una cita en pie", () => {
  it("una cita confirmada está viva", () => {
    expect(citaViva("confirmed")).toBe(true);
  });
  it("una recién creada también", () => {
    expect(citaViva("new")).toBe(true);
    expect(citaViva("booked")).toBe(true);
  });
  it("una cancelada no manda nada", () => {
    expect(citaViva("cancelled")).toBe(false);
  });
  it("una cancelada con espacios tampoco", () => {
    // El fallo exacto de la lista negra: `estado === "cancelled"` dejaba
    // pasar `" cancelled"` y el cliente recibía el recordatorio de una
    // sesión que ya no existe.
    expect(citaViva(" cancelled ")).toBe(false);
  });
  it("un estado vacío no autoriza a enviar", () => {
    expect(citaViva("")).toBe(false);
    expect(citaViva(null)).toBe(false);
    expect(citaViva(undefined)).toBe(false);
  });
  it("un estado que GHL invente mañana no autoriza a enviar", () => {
    // Es la diferencia con la lista negra: esta falla hacia NO enviar.
    expect(citaViva("invalid")).toBe(false);
    expect(citaViva("rescheduled_por_ghl_en_2027")).toBe(false);
  });
  it("una sesión ya ocurrida no recibe recordatorio", () => {
    expect(citaViva("showed")).toBe(false);
    expect(citaViva("noshow")).toBe(false);
  });
  it("encaja con lo que devuelve estadoDeCita para una cita normal", () => {
    // Las dos funciones se usan encadenadas: el estado que se guarda es el
    // que luego decide el envío.
    expect(citaViva(estadoDeCita(null))).toBe(true);
    expect(citaViva(estadoDeCita("Confirmed"))).toBe(true);
    expect(citaViva(estadoDeCita("Cancelled"))).toBe(false);
  });
});

describe("enlaceDeCita", () => {
  it("devuelve el Meet cuando GHL lo generó", () => {
    expect(enlaceDeCita("https://meet.google.com/cgj-mvos-kjz")).toBe("https://meet.google.com/cgj-mvos-kjz");
  });
  it("una dirección vacía es ausencia de enlace, no una cadena vacía", () => {
    // Fue el caso real del 10-ago: `address` llegaba "" y había que detectarlo.
    expect(enlaceDeCita("")).toBeNull();
  });
  it("un texto que no es URL tampoco es enlace", () => {
    expect(enlaceDeCita("Oficina")).toBeNull();
  });
});

describe("primerNombre — el saludo de la plantilla", () => {
  it("se queda con la primera palabra de un nombre completo", () => {
    expect(primerNombre("Nombre Apellido Apellido")).toBe("Nombre");
  });
  it("tolera espacios de sobra", () => {
    expect(primerNombre("  Rodolfo   Elizondo ")).toBe("Rodolfo");
  });
  it("devuelve null cuando no hay nada usable, en vez de una cadena vacía", () => {
    // Una cadena vacía parece un nombre para quien la recibe y acaba en
    // "Hola ,". Con null, quien llama puede pasar a la siguiente fuente.
    expect(primerNombre("")).toBeNull();
    expect(primerNombre("   ")).toBeNull();
    expect(primerNombre(null)).toBeNull();
    expect(primerNombre(undefined)).toBeNull();
  });
});

describe("horaEnZona", () => {
  it("usa la zona del cliente, no la de Madrid", () => {
    // 18:00 en Madrid son las 10:00 en Monterrey: decirle 18:00 a Rodolfo
    // le hace perder la sesión.
    expect(horaEnZona("2026-08-10T18:00:00+02:00", "America/Monterrey")).toBe("10:00");
  });
  it("con zona de Madrid da la hora de Madrid", () => {
    expect(horaEnZona("2026-08-10T18:00:00+02:00", "Europe/Madrid")).toBe("18:00");
  });
  it("sin zona cae a Madrid", () => {
    expect(horaEnZona("2026-08-10T18:00:00+02:00", null)).toBe("18:00");
  });
  it("una zona inválida no revienta: cae a Madrid", () => {
    expect(horaEnZona("2026-08-10T18:00:00+02:00", "No/Existe")).toBe("18:00");
  });
});

describe("tocaRecordatorio1h", () => {
  const sesion = "2026-08-10T18:00:00+02:00"; // 16:00 UTC
  it("a 60 minutos, sí", () => {
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T15:00:00Z"))).toBe(true);
  });
  it("a 75 minutos (borde superior), sí", () => {
    // La ventana es ancha a propósito: aguanta dos pasadas fallidas del cron.
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T14:45:00Z"))).toBe(true);
  });
  it("a 45 minutos (borde inferior exacto), sí", () => {
    // Fija el borde inferior: cambiar `m >= 45` a `m >= 55` quebra este test.
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T15:15:00Z"))).toBe(true);
  });
  it("a 44 minutos (justo fuera del borde inferior), no", () => {
    // Fija que 44 min es fuera de la ventana.
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T15:16:00Z"))).toBe(false);
  });
  it("a 76 minutos (justo fuera del borde superior), no", () => {
    // Fija que 76 min excede el límite de 75.
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T14:44:00Z"))).toBe(false);
  });
  it("a 90 minutos todavía no", () => {
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T14:30:00Z"))).toBe(false);
  });
  it("a 30 minutos ya pasó la ventana", () => {
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T15:30:00Z"))).toBe(false);
  });
  it("una sesión ya empezada no genera recordatorio", () => {
    expect(tocaRecordatorio1h(sesion, new Date("2026-08-10T16:30:00Z"))).toBe(false);
  });
});

describe("tocaAvisoSinEnlace", () => {
  const sesion = "2026-08-10T18:00:00+02:00";
  it("a 90 minutos y sin enlace, avisa al coach", () => {
    expect(tocaAvisoSinEnlace(sesion, null, new Date("2026-08-10T14:30:00Z"))).toBe(true);
  });
  it("a 120 minutos (borde superior exacto), avisa", () => {
    // Fija el borde superior: cambiar `m <= 120` a `m <= 100` quebra este test.
    expect(tocaAvisoSinEnlace(sesion, null, new Date("2026-08-10T14:00:00Z"))).toBe(true);
  });
  it("a 121 minutos (justo fuera del borde superior), no", () => {
    // Fija que 121 min excede el límite de 120.
    expect(tocaAvisoSinEnlace(sesion, null, new Date("2026-08-10T13:59:00Z"))).toBe(false);
  });
  it("con enlace no avisa", () => {
    expect(tocaAvisoSinEnlace(sesion, "https://meet.google.com/abc", new Date("2026-08-10T14:30:00Z"))).toBe(false);
  });
  it("a 3 horas todavía no: da margen a que GHL lo genere", () => {
    expect(tocaAvisoSinEnlace(sesion, null, new Date("2026-08-10T13:00:00Z"))).toBe(false);
  });
  it("una sesión ya empezada no avisa: llega tarde y solo hace ruido", () => {
    expect(tocaAvisoSinEnlace(sesion, null, new Date("2026-08-10T16:30:00Z"))).toBe(false);
  });
});

describe("idMensajeIncierto", () => {
  it("compone un id estable a partir de sesión y plantilla", () => {
    expect(idMensajeIncierto("abc-123", "recordatorio_1h_es")).toBe("incierto:abc-123:recordatorio_1h_es");
  });
  it("es determinista: la misma sesión y plantilla siempre dan el mismo id", () => {
    // Es justo la propiedad que evita duplicados: si esta función se llama
    // dos veces para el mismo intento incierto, el upsert por
    // on_conflict=kapso_message_id debe ver el mismo valor las dos veces.
    expect(idMensajeIncierto("abc-123", "recordatorio_1h_es")).toBe(
      idMensajeIncierto("abc-123", "recordatorio_1h_es"),
    );
  });
  it("dos plantillas distintas de la misma sesión no chocan", () => {
    expect(idMensajeIncierto("abc-123", "confirmacion_sesion_es")).not.toBe(
      idMensajeIncierto("abc-123", "recordatorio_1h_es"),
    );
  });
  it("dos sesiones distintas con la misma plantilla no chocan", () => {
    expect(idMensajeIncierto("abc-123", "recordatorio_1h_es")).not.toBe(
      idMensajeIncierto("xyz-789", "recordatorio_1h_es"),
    );
  });
  it("en una sesión grupal, dos destinatarios inciertos no comparten id", () => {
    // Sin el teléfono en la clave, el segundo incierto de la misma sesión
    // haría upsert sobre la fila del primero: el registro del primero
    // desaparecería y la siguiente pasada le reenviaría el WhatsApp.
    expect(idMensajeIncierto("abc-123", "recordatorio_1h_es", "34600111222")).not.toBe(
      idMensajeIncierto("abc-123", "recordatorio_1h_es", "5215511122233"),
    );
  });
  it("con teléfono sigue siendo determinista", () => {
    expect(idMensajeIncierto("abc-123", "recordatorio_1h_es", "34600111222")).toBe(
      idMensajeIncierto("abc-123", "recordatorio_1h_es", "34600111222"),
    );
  });
  it("sin teléfono el id es EXACTAMENTE el de siempre: los inciertos 1-a-1 ya registrados siguen casando", () => {
    expect(idMensajeIncierto("abc-123", "recordatorio_1h_es", undefined)).toBe(
      "incierto:abc-123:recordatorio_1h_es",
    );
  });
});

describe("zonaValida", () => {
  it("acepta un timezone IANA real", () => {
    expect(zonaValida("America/Monterrey")).toBe(true);
  });
  it("acepta Europe/Madrid", () => {
    expect(zonaValida("Europe/Madrid")).toBe(true);
  });
  it("rechaza un timezone corrupto (presente pero inválido)", () => {
    // Es justo el caso que se le escapaba a `horaEnZona`/`fechaEnZona`: no
    // es null, así que un guard `if (!zona)` lo deja pasar, pero `Intl` lo
    // rechaza igual y antes eso caía en silencio a Europe/Madrid.
    expect(zonaValida("No/Existe")).toBe(false);
  });
  it("rechaza null", () => {
    expect(zonaValida(null)).toBe(false);
  });
  it("rechaza undefined", () => {
    expect(zonaValida(undefined)).toBe(false);
  });
  it("rechaza una cadena vacía", () => {
    expect(zonaValida("")).toBe(false);
  });
});
