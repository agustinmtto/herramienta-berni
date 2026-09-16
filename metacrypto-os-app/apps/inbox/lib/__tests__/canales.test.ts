import { describe, it, expect } from "vitest";
import { canales, claveIdempotencia, claveEstrategia, claveSesion, claveInvitacion, claveAvisoVentaEquipo, claveContratoCliente, huellaHorario } from "../canales";

// D2 (Milo, 3-sep-2026): el email sale SIEMPRE, no solo cuando WhatsApp está
// caído. Coste aceptado a conciencia: el cliente recibe el mismo aviso dos
// veces. D3: esa política vive en UNA función, para que cambiarla no sea una
// operación quirúrgica por tres ficheros.

describe("canales — qué sale por dónde", () => {
  it("con WhatsApp vivo salen los dos", () => {
    expect(canales({ bloqueado: false, motivo: "" })).toEqual({ whatsapp: true, email: true });
  });

  it("con WhatsApp caído sale solo el email", () => {
    expect(canales({ bloqueado: true, motivo: "Meta baneó la cuenta" })).toEqual({
      whatsapp: false,
      email: true,
    });
  });

  // Esta es la que fija D2. Si alguien cambia la política a "email solo si WA
  // caído", este test cae y le obliga a venir aquí a hacerlo a propósito.
  it("el email NUNCA depende del estado de WhatsApp (D2)", () => {
    expect(canales({ bloqueado: false, motivo: "" }).email).toBe(true);
    expect(canales({ bloqueado: true, motivo: "x" }).email).toBe(true);
  });
});

describe("claveIdempotencia — el antiduplicados que no caduca", () => {
  it("es determinista: la misma entrada da la misma clave", () => {
    const a = claveIdempotencia("recordatorio_1h", "sesion-abc");
    const b = claveIdempotencia("recordatorio_1h", "sesion-abc");
    expect(a).toBe(b);
  });

  it("distingue el tipo: dos avisos de la MISMA sesión no se pisan", () => {
    // Sin esto, la confirmación suprimiría el recordatorio de la misma sesión.
    expect(claveIdempotencia("confirmacion_sesion", "s1")).not.toBe(
      claveIdempotencia("recordatorio_1h", "s1"),
    );
  });

  it("distingue el destino: dos sesiones del mismo tipo no se pisan", () => {
    expect(claveIdempotencia("recordatorio_1h", "s1")).not.toBe(
      claveIdempotencia("recordatorio_1h", "s2"),
    );
  });

  // Resend rechaza claves de más de 256 caracteres. Un token de portal o un
  // uuid caben de sobra, pero el límite se fija aquí para que nadie meta
  // mañana algo largo (un asunto, un email) sin que salte.
  it("nunca pasa de 256 caracteres, ni con una referencia larguísima", () => {
    const largo = "x".repeat(500);
    expect(claveIdempotencia("estrategia", largo).length).toBeLessThanOrEqual(256);
  });

  it("aun recortada, dos referencias largas distintas siguen dando claves distintas", () => {
    // Recortar por las bravas haría colisionar dos tokens que comparten
    // prefijo — y una colisión aquí significa un cliente que NO recibe su
    // estrategia porque la de otro ya "se envió".
    const a = claveIdempotencia("estrategia", "t".repeat(300) + "A");
    const b = claveIdempotencia("estrategia", "t".repeat(300) + "B");
    expect(a).not.toBe(b);
  });

  it("lleva prefijo de MCC, para que se lea en la base al depurar", () => {
    expect(claveIdempotencia("estrategia", "tok")).toMatch(/^mcc:estrategia:/);
  });
});

// ============================================================
// Los dos constructores de clave, y los dos fallos que existen para impedir.
//
// Los encontró una revisión adversarial del 3-sep: cuatro lentes
// independientes convergieron en el mismo defecto. Ninguno de los dos se ve
// leyendo el código — los dos exigen conocer el modelo de datos.
// ============================================================

describe("claveEstrategia — el token del portal NO sirve como clave", () => {
  // `portal_accesos.persona_id` es UNIQUE: un cliente, un enlace vivo, y el
  // token NUNCA cambia por publicarle una estrategia más. Usarlo como clave
  // convierte la clave en una constante por cliente: la primera estrategia
  // se envía y la segunda choca contra el índice único y NO SALE NUNCA.
  // Por eso la unidad es la estrategia, no la persona ni el enlace.
  it("dos estrategias del mismo cliente dan claves distintas", () => {
    expect(claveEstrategia("estrategia-btc")).not.toBe(claveEstrategia("estrategia-eth"));
  });

  it("es determinista para la misma estrategia", () => {
    expect(claveEstrategia("e1")).toBe(claveEstrategia("e1"));
  });

  it("no acepta una clave vacía: sin id no hay antiduplicados", () => {
    expect(() => claveEstrategia("")).toThrow();
  });
});

describe("claveSesion — una sesión que se mueve vuelve a avisar", () => {
  // Al reagendar, GHL conserva el `appointment_id`, el sync pisa `fecha` en
  // el upsert y `sesiones.id` no cambia. Sin la fecha en la clave, el
  // recordatorio de la sesión NUEVA se toma por ya enviado: el cliente se
  // queda sin aviso de la sesión que sí ocurre, y sin un log que lo diga.
  it("la misma sesión en otra fecha da otra clave", () => {
    expect(claveSesion("recordatorio_1h", "s1", "2026-09-07T09:00:00Z")).not.toBe(
      claveSesion("recordatorio_1h", "s1", "2026-09-09T17:00:00Z"),
    );
  });

  it("la misma sesión en la misma fecha da la misma clave", () => {
    const f = "2026-09-07T09:00:00Z";
    expect(claveSesion("recordatorio_1h", "s1", f)).toBe(claveSesion("recordatorio_1h", "s1", f));
  });

  it("confirmación y recordatorio de la misma sesión no se pisan", () => {
    const f = "2026-09-07T09:00:00Z";
    expect(claveSesion("confirmacion_sesion", "s1", f)).not.toBe(
      claveSesion("recordatorio_1h", "s1", f),
    );
  });

  it("no acepta sesión ni fecha vacías", () => {
    expect(() => claveSesion("recordatorio_1h", "", "2026-09-07T09:00:00Z")).toThrow();
    expect(() => claveSesion("recordatorio_1h", "s1", "")).toThrow();
  });
});

describe("claveSesion con destinatario — el aviso grupal", () => {
  // El recordatorio grupal va a TODA la audiencia sobre UNA sola fila de
  // `sesiones`. Sin el destinatario dentro, los 109 clientes comparten clave:
  // el primero se lleva el correo y los otros 108 se descartan como
  // duplicados. Resend además deduplicaría por su lado con la misma clave,
  // así que ni siquiera saldría de aquí.
  const F = "2026-09-09T20:00:00Z";

  it("dos destinatarios de la MISMA sesión dan claves distintas", () => {
    expect(claveSesion("recordatorio_1h", "s1", F, "ana@x.com")).not.toBe(
      claveSesion("recordatorio_1h", "s1", F, "luis@x.com"),
    );
  });

  it("el mismo destinatario en la misma sesión da la misma clave", () => {
    expect(claveSesion("recordatorio_1h", "s1", F, "ana@x.com")).toBe(
      claveSesion("recordatorio_1h", "s1", F, "ana@x.com"),
    );
  });

  it("sin destinatario sigue funcionando: es el caso 1-a-1", () => {
    expect(claveSesion("recordatorio_1h", "s1", F)).toBeTruthy();
  });

  it("con y sin destinatario NO son la misma clave", () => {
    expect(claveSesion("recordatorio_1h", "s1", F)).not.toBe(
      claveSesion("recordatorio_1h", "s1", F, "ana@x.com"),
    );
  });
});

describe("claveAvisoVentaEquipo — una venta, UN correo a todo el equipo", () => {
  // Desde el 8-sep el aviso de cierre va en un solo correo con todo el equipo
  // en el "para". Antes eran seis correos y la clave llevaba dentro el id del
  // miembro, porque si no el primero ganaba y los otros cinco se descartaban
  // como duplicados. Con un solo envío esa defensa sobra y estorba: seis
  // claves para un correo dejarían seis filas y permitirían seis reenvíos.
  it("la misma venta da siempre la misma clave", () => {
    expect(claveAvisoVentaEquipo("pago-1")).toBe(claveAvisoVentaEquipo("pago-1"));
  });

  it("otra venta da otra clave", () => {
    expect(claveAvisoVentaEquipo("pago-1")).not.toBe(claveAvisoVentaEquipo("pago-2"));
  });

  it("la clave ya no depende de ningún miembro del equipo", () => {
    // Fija el cambio: un argumento de más no puede alterar el resultado, para
    // que nadie reintroduzca por accidente una clave por persona.
    const clave = claveAvisoVentaEquipo("pago-1");
    expect((claveAvisoVentaEquipo as (p: string, extra?: string) => string)("pago-1", "miembro-a")).toBe(clave);
  });

  it("no acepta un pago vacío", () => {
    expect(() => claveAvisoVentaEquipo("")).toThrow();
    expect(() => claveAvisoVentaEquipo("   ")).toThrow();
  });
});

describe("claveContratoCliente — un enlace, un correo, y el token no viaja", () => {
  // 🔴 LA PROPIEDAD QUE MÁS IMPORTA DE LAS TRES. La clave se guarda para
  // siempre en `emails_enviados.idempotency_key` y sale por consola en
  // `lib/email-envio.ts`: si llevara el token dentro, quien pueda leer esa
  // tabla o los logs de Vercel podría abrir `/c/<token>` y firmar en nombre
  // del cliente. El token es una credencial viva, no un identificador.
  it("NO contiene el token — ni entero ni en trozos", () => {
    const token = "6Kx2nQ9pLmR4tY7wZ0aB3cD5";
    const clave = claveContratoCliente("prog-1", token);
    expect(clave).not.toContain(token);
    // Y tampoco un prefijo suyo: un recorte también sería material filtrado.
    expect(clave).not.toContain(token.slice(0, 12));
  });

  it("el programa sí va en claro: la clave se sigue pudiendo rastrear", () => {
    expect(claveContratoCliente("prog-1", "tok-A")).toMatch(/^mcc:contrato_cliente:prog-1:[0-9a-f]{16}$/);
  });

  it("reenviar (token nuevo) es otro correo", () => {
    expect(claveContratoCliente("prog-1", "tok-A")).not.toBe(claveContratoCliente("prog-1", "tok-B"));
  });

  it("el mismo token da la misma clave: el doble envío se sigue frenando", () => {
    expect(claveContratoCliente("prog-1", "tok-A")).toBe(claveContratoCliente("prog-1", "tok-A"));
  });

  it("dos programas con el mismo token no se pisan", () => {
    expect(claveContratoCliente("prog-1", "tok-A")).not.toBe(claveContratoCliente("prog-2", "tok-A"));
  });

  it("lanza sin programa o sin token", () => {
    expect(() => claveContratoCliente("", "tok")).toThrow();
    expect(() => claveContratoCliente("prog-1", "")).toThrow();
  });
});

describe("claveInvitacion — reenviar cuando cambia el horario, no antes", () => {
  it("es estable mientras el horario no cambie", () => {
    expect(claveInvitacion("r1", "0-19:00", "ana@x.com")).toBe(
      claveInvitacion("r1", "0-19:00", "ana@x.com"),
    );
  });

  it("cambiar la hora produce clave nueva, y por tanto reenvío", () => {
    // Es lo que se busca: Berni mueve el domingo de 19:00 a 20:00, sale una
    // invitación nueva con el MISMO UID y SEQUENCE+1, y los calendarios
    // actualizan el evento en vez de duplicarlo.
    expect(claveInvitacion("r1", "0-19:00", "ana@x.com")).not.toBe(
      claveInvitacion("r1", "0-20:00", "ana@x.com"),
    );
  });

  it("cada destinatario tiene la suya", () => {
    expect(claveInvitacion("r1", "0-19:00", "ana@x.com")).not.toBe(
      claveInvitacion("r1", "0-19:00", "luis@x.com"),
    );
  });

  it("dos reglas distintas no se pisan", () => {
    expect(claveInvitacion("r1", "0-19:00", "ana@x.com")).not.toBe(
      claveInvitacion("r2", "0-19:00", "ana@x.com"),
    );
  });

  it("el email no distingue mayúsculas", () => {
    expect(claveInvitacion("r1", "0-19:00", "Ana@X.com")).toBe(
      claveInvitacion("r1", "0-19:00", "ana@x.com"),
    );
  });
});

describe("huellaHorario — qué cambios obligan a reenviar", () => {
  it("día y hora entran en la huella", () => {
    expect(huellaHorario({ dia_semana: 0, hora: "19:00:00", enlace: null })).not.toBe(
      huellaHorario({ dia_semana: 3, hora: "19:00:00", enlace: null }),
    );
    expect(huellaHorario({ dia_semana: 0, hora: "19:00:00", enlace: null })).not.toBe(
      huellaHorario({ dia_semana: 0, hora: "20:00:00", enlace: null }),
    );
  });

  it("el enlace también: si cambia el Zoom, el evento del calendario miente", () => {
    expect(huellaHorario({ dia_semana: 0, hora: "19:00:00", enlace: "https://a" })).not.toBe(
      huellaHorario({ dia_semana: 0, hora: "19:00:00", enlace: "https://b" }),
    );
  });

  it("no cambia por cosas que no afectan al evento", () => {
    // Si la huella cambiara por cualquier edición de la fila, cada retoque
    // dispararía 109 correos.
    const a = huellaHorario({ dia_semana: 0, hora: "19:00:00", enlace: "https://a", coach_id: "c1" } as any);
    const b = huellaHorario({ dia_semana: 0, hora: "19:00:00", enlace: "https://a", coach_id: "c2" } as any);
    expect(a).toBe(b);
  });
});
