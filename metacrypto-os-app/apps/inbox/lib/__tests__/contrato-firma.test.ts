import { describe, it, expect } from "vitest";
import {
  DIAS_CADUCIDAD, CONSENTIMIENTO, RE_TOKEN, nuevoToken, enlaceFirma, hashPdf, caducidad,
  estadoDelEnlace, validarFormularioFirma, fechaHoraMadrid, lineaEvidencia, debeMarcarVisto, nombreArchivoContrato,
} from "../contrato-firma";

describe("token y enlace", () => {
  it("el token es base64url de 24 bytes y pasa su propio regex", () => {
    const t = nuevoToken();
    expect(t).toHaveLength(32);
    expect(RE_TOKEN.test(t)).toBe(true);
    expect(nuevoToken()).not.toBe(t);
  });

  it("el enlace es /c/<token> y aguanta la barra final", () => {
    expect(enlaceFirma("https://os.invierteconberni.com/", "abc")).toBe("https://os.invierteconberni.com/c/abc");
    expect(enlaceFirma("", "abc")).toBe("");
    expect(enlaceFirma("https://x", "")).toBe("");
  });

  it("la caducidad son 60 días exactos", () => {
    expect(DIAS_CADUCIDAD).toBe(60);
    expect(caducidad(new Date("2026-09-16T10:00:00Z"))).toBe("2026-11-15T10:00:00.000Z");
  });
});

describe("hashPdf", () => {
  it("sha256 hex, estable, y distinto para bytes distintos", () => {
    const a = hashPdf(Buffer.from("%PDF-1.4 hola"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPdf(Buffer.from("%PDF-1.4 hola"))).toBe(a);
    expect(hashPdf(Buffer.from("%PDF-1.4 adiós"))).not.toBe(a);
  });
});

describe("estadoDelEnlace — la misma pantalla para todo lo que no sea 'listo'", () => {
  const ahora = new Date("2026-09-16T10:00:00Z");
  it("firmado gana a todo", () => {
    expect(estadoDelEnlace({ firmado_at: "2026-09-15T00:00:00Z", enviado_cliente_at: null, token_expira_at: null }, ahora)).toBe("firmado");
  });
  it("sin enviar o sin caducidad → no activo", () => {
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: null, token_expira_at: "2026-12-01T00:00:00Z" }, ahora)).toBe("no_activo");
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: "2026-09-10T00:00:00Z", token_expira_at: null }, ahora)).toBe("no_activo");
  });
  it("caducado → no activo; vigente → listo", () => {
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: "2026-07-01T00:00:00Z", token_expira_at: "2026-08-30T00:00:00Z" }, ahora)).toBe("no_activo");
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: "2026-09-10T00:00:00Z", token_expira_at: "2026-11-09T00:00:00Z" }, ahora)).toBe("listo");
  });
  it("caducidad justo en el límite (igual a ahora) → no activo", () => {
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: "2026-07-01T00:00:00Z", token_expira_at: "2026-09-16T10:00:00Z" }, ahora)).toBe("no_activo");
  });
  it("caducado por un segundo → no activo", () => {
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: "2026-07-01T00:00:00Z", token_expira_at: "2026-09-16T09:59:59Z" }, ahora)).toBe("no_activo");
  });
  it("firmado Y además caducado → firmado (gana igual)", () => {
    expect(estadoDelEnlace({ firmado_at: "2026-08-01T00:00:00Z", enviado_cliente_at: "2026-07-01T00:00:00Z", token_expira_at: "2026-07-31T00:00:00Z" }, ahora)).toBe("firmado");
  });
  it("un segundo antes de caducar → listo", () => {
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: "2026-07-01T00:00:00Z", token_expira_at: "2026-09-16T10:00:01Z" }, ahora)).toBe("listo");
  });
  it("token_expira_at corrupto (no parsea como fecha) → no activo, no 'listo' por defecto", () => {
    expect(estadoDelEnlace({ firmado_at: null, enviado_cliente_at: "2026-07-01T00:00:00Z", token_expira_at: "no-es-una-fecha" }, ahora)).toBe("no_activo");
  });
  it("firmado_at vacío ('') no cae al 'listo' final: cuenta como firmado, no se cuela por el truthy check", () => {
    // El tipo permite "". Con `if (f.firmado_at)` (comprobación de verdad),
    // "" es falso y el caso se cuela hasta el "listo" del final aunque el
    // enlace esté enviado y vigente — el fallo abierto real que corrige
    // `!= null`. La entrada de abajo tiene enviado_cliente_at y
    // token_expira_at válidos a propósito: es la que demuestra el fallo.
    expect(estadoDelEnlace({ firmado_at: "", enviado_cliente_at: "2026-09-10T00:00:00Z", token_expira_at: "2026-11-09T00:00:00Z" }, ahora)).toBe("firmado");
  });
});

describe("validarFormularioFirma", () => {
  it("exige la casilla y un nombre de verdad", () => {
    expect(validarFormularioFirma({ nombre: "Ana Rodríguez", acepto: "si" })).toEqual({ ok: true, nombre: "Ana Rodríguez" });
    expect(validarFormularioFirma({ nombre: "Ana Rodríguez", acepto: null })).toEqual({ ok: false, error: "acepto" });
    expect(validarFormularioFirma({ nombre: "  ", acepto: "si" })).toEqual({ ok: false, error: "nombre" });
    expect(validarFormularioFirma({ nombre: "A", acepto: "si" })).toEqual({ ok: false, error: "nombre" });
  });
  it("recorta espacios y limita a 120 caracteres", () => {
    const r = validarFormularioFirma({ nombre: "  Ana   Rodríguez  ", acepto: "si" });
    expect(r).toEqual({ ok: true, nombre: "Ana Rodríguez" });
    expect(validarFormularioFirma({ nombre: "x".repeat(200), acepto: "si" })).toEqual({ ok: false, error: "nombre" });
  });
  it("el checkbox sin marcar (false) también es error de acepto, aunque el nombre sea válido", () => {
    expect(validarFormularioFirma({ nombre: "Ana Rodríguez", acepto: false })).toEqual({ ok: false, error: "acepto" });
    expect(validarFormularioFirma({ nombre: "Ana Rodríguez", acepto: undefined })).toEqual({ ok: false, error: "acepto" });
  });
  it("acepto manda primero: nombre vacío Y sin aceptar reporta 'acepto'", () => {
    expect(validarFormularioFirma({ nombre: "", acepto: null })).toEqual({ ok: false, error: "acepto" });
  });
  it("exactamente 120 caracteres (tras recortar) es válido; 121 no", () => {
    expect(validarFormularioFirma({ nombre: "x".repeat(120), acepto: "si" })).toEqual({ ok: true, nombre: "x".repeat(120) });
    expect(validarFormularioFirma({ nombre: "x".repeat(121), acepto: "si" })).toEqual({ ok: false, error: "nombre" });
  });
  it("nombre no-string se rechaza (no se convierte): number, objeto y array fallan aunque 'parezcan' válidos al convertirlos", () => {
    // 123 → "123" (3 caracteres) pasaría el filtro de longitud si se convirtiera;
    // {} → "[object Object]" (11) y ["a","b"] → "a,b" (3) también colarían.
    // Ninguno debe llegar a ok:true: solo un string de verdad vale como nombre.
    expect(validarFormularioFirma({ nombre: 123 as unknown, acepto: "si" })).toEqual({ ok: false, error: "nombre" });
    expect(validarFormularioFirma({ nombre: {} as unknown, acepto: "si" })).toEqual({ ok: false, error: "nombre" });
    expect(validarFormularioFirma({ nombre: ["a", "b"] as unknown, acepto: "si" })).toEqual({ ok: false, error: "nombre" });
    expect(validarFormularioFirma({ nombre: undefined, acepto: "si" })).toEqual({ ok: false, error: "nombre" });
  });
});

describe("evidencia", () => {
  it("la fecha y la hora van en Europe/Madrid, no en la del proceso (verano, CEST = UTC+2)", () => {
    // 22:30 UTC del 16-sep = 00:30 del 17-sep en Madrid (CEST).
    expect(fechaHoraMadrid(new Date("2026-09-16T22:30:00Z"))).toEqual({ fecha: "17/09/2026", hora: "00:30" });
  });
  it("en invierno Madrid es CET = UTC+1, no el mismo +2 fijo que en verano", () => {
    // 23:30 UTC del 15-ene = 00:30 del 16-ene en Madrid (CET, +1). Si alguien
    // sustituyera el huso IANA por un desplazamiento fijo de +2 (copiado del
    // test de septiembre), este caso pasaría a dar "16/01/2026" "01:30" y el
    // test lo pillaría.
    expect(fechaHoraMadrid(new Date("2026-01-15T23:30:00Z"))).toEqual({ fecha: "16/01/2026", hora: "00:30" });
  });
  it("la línea dice quién, cuándo, desde dónde y sobre qué documento", () => {
    const l = lineaEvidencia({ nombre: "Ana Rodríguez", firmadoAt: new Date("2026-09-16T08:42:00Z"), ip: "83.1.2.3", hash: "ab".repeat(32) });
    expect(l).toBe(
      "Firmado electrónicamente por Ana Rodríguez el 16/09/2026 a las 10:42 (Europe/Madrid) desde la IP 83.1.2.3. " +
      "Huella SHA-256 del documento aceptado: " + "ab".repeat(32) + ".",
    );
  });
  it("sin IP lo dice, en vez de inventarla", () => {
    expect(lineaEvidencia({ nombre: "A B", firmadoAt: new Date("2026-09-16T08:42:00Z"), ip: null, hash: "0".repeat(64) })).toContain("desde una IP no registrada");
  });
  it("el consentimiento avisa de que se registra la IP", () => {
    expect(CONSENTIMIENTO).toMatch(/dirección IP/);
  });
});

describe("debeMarcarVisto — quién cuenta como que el cliente abrió su contrato", () => {
  // Cadenas reales, no inventadas: lo que mandan de verdad los que van a
  // pulsar este enlace antes que el cliente.
  const CHROME_ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36";
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

  it("un navegador de móvil pidiendo el PDF sí cuenta", () => {
    expect(debeMarcarVisto({ metodo: "GET", userAgent: CHROME_ANDROID })).toBe(true);
    expect(debeMarcarVisto({ metodo: "GET", userAgent: SAFARI_IPHONE })).toBe(true);
  });

  it("🔴 el NAVEGADOR INTEGRADO de WhatsApp es un cliente, no un bot", () => {
    // El enlace llega por WhatsApp: éste es el camino por el que va a entrar
    // la mayoría. Manda una cadena completa de Chrome con "WhatsApp/" pegada
    // detrás, y hasta el 16-sep la entrada `whatsapp` de la lista lo bloqueaba
    // — o sea, no daba por visto justo al cliente que sí estaba leyendo.
    expect(debeMarcarVisto({
      metodo: "GET",
      userAgent: CHROME_ANDROID + " WhatsApp/2.24.12.78 A",
    })).toBe(true);
  });

  it("y el que previsualiza el enlace en WhatsApp sigue fuera, sin necesitar la entrada", () => {
    // "WhatsApp/2.x" a secas: no dice "Mozilla", así que lo para el filtro de
    // arriba. Esto es lo que hace que quitar `whatsapp` de la lista no abra
    // ningún agujero.
    expect(debeMarcarVisto({ metodo: "GET", userAgent: "WhatsApp/2.23.20.0 A" })).toBe(false);
    expect(debeMarcarVisto({ metodo: "GET", userAgent: "WhatsApp/2.19.81 i" })).toBe(false);
  });

  it("HEAD nunca cuenta, aunque venga con cara de navegador", () => {
    // Es lo primero que hace un escáner de enlaces: HEAD y después GET.
    expect(debeMarcarVisto({ metodo: "HEAD", userAgent: CHROME_ANDROID })).toBe(false);
    expect(debeMarcarVisto({ metodo: "POST", userAgent: CHROME_ANDROID })).toBe(false);
  });

  it("sin user-agent no se marca: ante la duda, no", () => {
    expect(debeMarcarVisto({ metodo: "GET", userAgent: null })).toBe(false);
    expect(debeMarcarVisto({ metodo: "GET", userAgent: "   " })).toBe(false);
  });

  it("lo que no dice ser un navegador no se marca, esté o no en la lista", () => {
    // El filtro que hace el trabajo grueso: la lista de bots nunca está
    // completa, la de navegadores sí. `curl` y `python-requests` no aparecen
    // en AGENTES_AUTOMATICOS y aun así se quedan fuera.
    expect(debeMarcarVisto({ metodo: "GET", userAgent: "curl/8.4.0" })).toBe(false);
    expect(debeMarcarVisto({ metodo: "GET", userAgent: "python-requests/2.32.3" })).toBe(false);
  });

  it("los que sí se disfrazan de navegador y están en la lista", () => {
    const fuera = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible; BingPreview/1.0b)",
      "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) Mozilla/5.0",
      // Estos dos ya no tienen entrada propia: caen por "bot", que es parte de
      // su nombre. Siguen aquí para que se vea que quitarlas no los soltó.
      "Mozilla/5.0 (compatible; TelegramBot; +https://core.telegram.org/bots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36",
      "Mozilla/5.0 (compatible; proofpoint-urldefense)",
      "Mozilla/5.0 (compatible; Mimecast Link Protect)",
    ];
    for (const ua of fuera) {
      expect(debeMarcarVisto({ metodo: "GET", userAgent: ua }), ua).toBe(false);
    }
  });
});

describe("nombreArchivoContrato", () => {
  it("lleva el nombre del cliente, sin acentos ni espacios", () => {
    expect(nombreArchivoContrato("Ana Rodríguez Peña", false)).toBe("Contrato-Ana-Rodriguez-Pena.pdf");
    expect(nombreArchivoContrato("Ana Rodríguez Peña", true)).toBe("Contrato-firmado-Ana-Rodriguez-Pena.pdf");
  });

  it("nada que rompa una cabecera Content-Disposition ni un nombre de fichero", () => {
    // Las comillas partirían la cabecera; las barras, la ruta. Solo sale
    // [A-Za-z0-9-], así que tampoco hace falta la forma `filename*=UTF-8''`.
    expect(nombreArchivoContrato('Ana "La Jefa" / O\u0027Neill', false)).toBe("Contrato-Ana-La-Jefa-O-Neill.pdf");
    expect(nombreArchivoContrato("../../etc/passwd", false)).toBe("Contrato-etc-passwd.pdf");
  });

  it("sin nombre utilizable, un nombre de verdad y no '-.pdf'", () => {
    expect(nombreArchivoContrato(null, false)).toBe("Contrato.pdf");
    expect(nombreArchivoContrato("", true)).toBe("Contrato-firmado.pdf");
    expect(nombreArchivoContrato("北京", false)).toBe("Contrato.pdf");
  });
});
