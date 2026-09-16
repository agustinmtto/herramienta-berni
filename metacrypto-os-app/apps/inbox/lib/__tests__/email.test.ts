import { describe, it, expect, vi, afterEach } from "vitest";
import { enviarEmail } from "../email";
import type { ResultadoEmail } from "../email";

// Estrecha la unión Y afirma de paso: si el envío salió bien cuando el test
// esperaba un fallo, se entera aquí y no en un `undefined` silencioso.
function fallo(r: ResultadoEmail) {
  if (r.ok) throw new Error("se esperaba un fallo y el envío salió bien");
  return r;
}
function exito(r: ResultadoEmail) {
  if (!r.ok) throw new Error(`se esperaba éxito: ${r.error}`);
  return r;
}

// `lib/email.ts` NO importa Supabase a propósito: así se puede importar aquí
// y probar los guards de verdad, no leyendo el fuente. El registro en la base
// vive en `lib/email-envio.ts`, que es quien lo compone.

const ENV_OK = {
  RESEND_API_KEY: "re_prueba",
  EMAIL_FROM: "Berni · MetaCrypto Club <berni@send.invierteconberni.com>",
  EMAIL_REPLY_TO: "info@invierteconberni.com",
};

const ARGS = {
  to: "alicia@example.com",
  asunto: "Tu estrategia de inversión, Alicia",
  html: "<p>hola</p>",
  texto: "hola",
  idempotencyKey: "mcc:estrategia:tok3n",
};

// Tipada porque el test inspecciona la llamada: sin parámetros declarados,
// `mock.calls[0]` es una tupla vacía y `tsc` no deja leer url ni init.
type Llamada = [string, { method: string; headers: Record<string, string>; body: string }];

function fetchFalso(status: number, cuerpo: string) {
  return vi.fn(async (_url: string, _init: unknown) => new Response(cuerpo, { status }));
}

function llamada(f: ReturnType<typeof fetchFalso>, i = 0): Llamada {
  return f.mock.calls[i] as unknown as Llamada;
}

afterEach(() => vi.unstubAllGlobals());

describe("enviarEmail — guards locales, antes de tocar la red", () => {
  it("sin RESEND_API_KEY no llama a Resend y lo dice", async () => {
    const f = fetchFalso(200, "{}");
    vi.stubGlobal("fetch", f);
    const r = await enviarEmail(ARGS, { ...ENV_OK, RESEND_API_KEY: "" });
    expect(fallo(r).status).toBe(501);
    // `incierto: false` = con CERTEZA no salió nada. Es lo que mira quien
    // llama para decidir si registrar el intento; marcarlo mal aquí
    // suprimiría el aviso para siempre.
    expect(fallo(r).incierto).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("sin EMAIL_FROM tampoco llama: un From vacío lo rechaza Resend igual", async () => {
    const f = fetchFalso(200, "{}");
    vi.stubGlobal("fetch", f);
    const r = await enviarEmail(ARGS, { ...ENV_OK, EMAIL_FROM: "" });
    expect(fallo(r).status).toBe(501);
    expect(f).not.toHaveBeenCalled();
  });

  it("sin destinatario no gasta una llamada", async () => {
    const f = fetchFalso(200, "{}");
    vi.stubGlobal("fetch", f);
    const r = await enviarEmail({ ...ARGS, to: "  " }, ENV_OK);
    expect(fallo(r).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("sin clave de idempotencia se niega: es el antiduplicados entero", async () => {
    const f = fetchFalso(200, "{}");
    vi.stubGlobal("fetch", f);
    const r = await enviarEmail({ ...ARGS, idempotencyKey: "" }, ENV_OK);
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("enviarEmail — la petición que sale", () => {
  it("va al endpoint de Resend con el Bearer y la clave de idempotencia", async () => {
    const f = fetchFalso(200, JSON.stringify({ id: "49a3999c-0ce1" }));
    vi.stubGlobal("fetch", f);
    await enviarEmail(ARGS, ENV_OK);

    const [url, init] = llamada(f);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_prueba");
    expect(init.headers["Idempotency-Key"]).toBe("mcc:estrategia:tok3n");
  });

  it("manda HTML y texto plano, y el Reply-To al buzón real", async () => {
    const f = fetchFalso(200, JSON.stringify({ id: "x" }));
    vi.stubGlobal("fetch", f);
    await enviarEmail(ARGS, ENV_OK);

    const cuerpo = JSON.parse(llamada(f)[1].body);
    expect(cuerpo.html).toBe("<p>hola</p>");
    expect(cuerpo.text).toBe("hola");
    expect(cuerpo.to).toEqual(["alicia@example.com"]);
    // Nadie debe responder a send.invierteconberni.com: ahí no hay buzón.
    expect(cuerpo.reply_to).toBe("info@invierteconberni.com");
  });

  it("devuelve el id de Resend, que es lo que permite consultar la entrega", async () => {
    vi.stubGlobal("fetch", fetchFalso(200, JSON.stringify({ id: "49a3999c-0ce1" })));
    const r = await enviarEmail(ARGS, ENV_OK);
    expect(exito(r).resendId).toBe("49a3999c-0ce1");
  });
});

describe("enviarEmail — cuando Resend falla", () => {
  it("un 5xx queda INCIERTO: el correo puede haber salido igual", async () => {
    vi.stubGlobal("fetch", fetchFalso(500, "<html>error</html>"));
    const r = await enviarEmail(ARGS, ENV_OK);
    expect(fallo(r).incierto).toBe(true);
  });

  it("un 4xx es un rechazo seguro: no salió nada", async () => {
    vi.stubGlobal("fetch", fetchFalso(422, JSON.stringify({ message: "Invalid `to` field" })));
    const r = await enviarEmail(ARGS, ENV_OK);
    expect(fallo(r).incierto).toBe(false);
  });

  it("un 403 de dominio sin verificar se explica, no se suelta el HTTP a pelo", async () => {
    vi.stubGlobal(
      "fetch",
      fetchFalso(403, JSON.stringify({ message: "The send.invierteconberni.com domain is not verified" })),
    );
    const r = await enviarEmail(ARGS, ENV_OK);
    expect(fallo(r).error).toMatch(/verif/i);
  });

  it("si la red se cae, no lanza: devuelve incierto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const r = await enviarEmail(ARGS, ENV_OK);
    expect(fallo(r).incierto).toBe(true);
  });

  it("un 200 con cuerpo sin id no se da por bueno", async () => {
    // Mismo modo de fallo que el 200 de Kapso sin `messages[0].id`: aceptar
    // esto como envío bueno es exactamente lo que dejó mensajes fantasma.
    vi.stubGlobal("fetch", fetchFalso(200, JSON.stringify({})));
    const r = await enviarEmail(ARGS, ENV_OK);
    expect(r.ok).toBe(false);
  });
});
