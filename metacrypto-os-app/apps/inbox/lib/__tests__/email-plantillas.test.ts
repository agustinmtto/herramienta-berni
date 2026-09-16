import { describe, it, expect } from "vitest";
import { emailEstrategia, emailConfirmacionSesion, emailRecordatorio1h, emailInvitacionCalendario, emailContrato, emailContratoCliente } from "../email-plantillas";

const LINK = "https://metacrypto-inbox.vercel.app/e/tok3n-largo-no-adivinable";
const ZOOM = "https://us06web.zoom.us/j/81342996433";

const TODAS = [
  ["estrategia", () => emailEstrategia({ nombre: "Alicia", enlace: LINK })],
  [
    "confirmacion_sesion",
    () => emailConfirmacionSesion({ nombre: "Alicia", coach: "Manuel", cuando: "viernes, 4 de septiembre a las 18:00", enlace: ZOOM }),
  ],
  [
    "recordatorio_1h",
    () => emailRecordatorio1h({ nombre: "Alicia", coach: "Manuel", hora: "18:00", enlace: ZOOM }),
  ],
] as const;

describe("las tres plantillas — forma común", () => {
  for (const [nombre, hacer] of TODAS) {
    it(`${nombre}: trae asunto, html y texto, los tres con contenido`, () => {
      const { asunto, html, texto } = hacer();
      expect(asunto.trim().length).toBeGreaterThan(0);
      expect(html.trim().length).toBeGreaterThan(0);
      expect(texto.trim().length).toBeGreaterThan(0);
    });

    it(`${nombre}: el enlace está en el HTML Y en el texto plano`, () => {
      // Un correo solo-HTML es ilegible para quien bloquea HTML y puntúa peor
      // en los filtros. Si el enlace solo vive en una versión, la otra es
      // basura: el cliente no puede llegar a lo que le mandamos.
      const { html, texto } = hacer();
      const enlace = nombre === "estrategia" ? LINK : ZOOM;
      expect(html).toContain(enlace);
      expect(texto).toContain(enlace);
    });

    it(`${nombre}: la versión de texto no lleva etiquetas HTML`, () => {
      expect(hacer().texto).not.toMatch(/<[a-z/][^>]*>/i);
    });

    it(`${nombre}: el asunto cabe en una línea y no lleva saltos`, () => {
      // Un salto de línea en una cabecera de correo la parte: es inyección de
      // cabecera, y algunos servidores la rechazan entera.
      const { asunto } = hacer();
      expect(asunto).not.toMatch(/[\r\n]/);
      expect(asunto.length).toBeLessThanOrEqual(120);
    });
  }
});

// ── D6, guarda de regresión ───────────────────────────────────────────────
// El patrón `enlace + "Contraseña: EJEMPLOBTC123"` en texto libre es el
// candidato más probable al baneo de la WABA del 2-sep. Que el canal ahora
// sea email no lo convierte en buena idea: las contraseñas eran además
// adivinables (NOMBRE+BTC123) sobre slugs secuenciales (cliente-074).
describe("D6 — ninguna plantilla lleva una credencial", () => {
  for (const [nombre, hacer] of TODAS) {
    it(`${nombre}: no dice "contraseña" ni "password" ni "clave"`, () => {
      const { asunto, html, texto } = hacer();
      const todo = `${asunto} ${html} ${texto}`.toLowerCase();
      expect(todo).not.toMatch(/contrase|password|\bclave\b/);
    });
  }

  it("la de estrategia manda al portal, no a la URL cruda del documento", () => {
    const { html, texto } = emailEstrategia({ nombre: "Alicia", enlace: LINK });
    expect(`${html} ${texto}`).not.toMatch(/invierteconberni\.com\/cliente-\d+/);
  });
});

// ── La trampa del tier ────────────────────────────────────────────────────
// Los ids de tier SON el precio en euros ('2000','3500','5000') y
// `tiers.nombre` es literalmente "€5.000 / 12 meses". El día que alguien
// añada "tu plan: {{tier}}" a una plantilla, le manda el precio a un cliente
// que quizá pagó otra cosa — y un email no se puede desenviar.
describe("ninguna plantilla filtra precios", () => {
  for (const [nombre, hacer] of TODAS) {
    it(`${nombre}: no lleva importes en euros ni dólares`, () => {
      const { asunto, html, texto } = hacer();
      expect(`${asunto} ${html} ${texto}`).not.toMatch(/[€$]\s?\d|\d\s?(?:€|EUR|USD)/i);
    });
  }
});

describe("nombres que faltan o vienen sucios", () => {
  it("sin nombre no saluda con un hueco: nada de “Hola , ”", () => {
    const { html, texto } = emailEstrategia({ nombre: "", enlace: LINK });
    // Lo que se prohíbe es el HUECO donde debía ir el nombre — un espacio
    // entre "Hola" y la coma. "Hola," a secas es la salida correcta y tiene
    // que seguir permitida.
    expect(`${html} ${texto}`).not.toMatch(/Hola\s+,/);
    expect(texto).toContain("Hola,");
  });

  it("usa solo el nombre de pila, como las plantillas de WhatsApp", () => {
    const { texto } = emailEstrategia({ nombre: "Jose Manuel Alvarez", enlace: LINK });
    expect(texto).toContain("Jose");
    expect(texto).not.toContain("Alvarez");
  });

  it("escapa el HTML del nombre: un apellido con < no puede romper el correo", () => {
    const { html } = emailEstrategia({ nombre: "<script>x</script>", enlace: LINK });
    expect(html).not.toContain("<script>");
  });
});

// La confirmación de WhatsApp NO lleva enlace: sus variables son nombre,
// coach y fecha. Al espejarla en email es fácil pasar `enlace ?? ""` y
// acabar pintando un botón "Entrar a la sesión" que apunta a la nada — que
// es peor que no tener botón, porque el cliente lo pulsa.
describe("emailConfirmacionSesion sin enlace de videollamada", () => {
  const sinEnlace = () =>
    emailConfirmacionSesion({ nombre: "Ana", coach: "Manuel", cuando: "viernes a las 18:00", enlace: "" });

  it("no pinta un botón vacío", () => {
    expect(sinEnlace().html).not.toMatch(/href=["']["']/);
  });

  it("no invita a entrar a ningún sitio", () => {
    const { html, texto } = sinEnlace();
    expect(`${html} ${texto}`).not.toMatch(/Entrar a la sesión|Entra por aquí/);
  });

  it("pero sigue confirmando: la fecha y el coach son el contenido real", () => {
    const { html, texto } = sinEnlace();
    expect(html).toContain("viernes a las 18:00");
    expect(texto).toContain("Manuel");
  });

  it("con enlace sí lo pinta", () => {
    const c = emailConfirmacionSesion({ nombre: "Ana", coach: "Manuel", cuando: "x", enlace: "https://zoom.us/j/1" });
    expect(c.html).toContain("https://zoom.us/j/1");
  });
});

describe("emailInvitacionCalendario", () => {
  const inv = () =>
    emailInvitacionCalendario({
      nombre: "Milo",
      sesiones: [
        { titulo: "Sesión con Berni", cuando: "domingos a las 19:00" },
        { titulo: "Sesión con Manuel", cuando: "miércoles a las 20:00" },
      ],
    });

  it("lista las dos sesiones", () => {
    const { html, texto } = inv();
    for (const s of ["domingos a las 19:00", "miércoles a las 20:00"]) {
      expect(html).toContain(s);
      expect(texto).toContain(s);
    }
  });

  it("NO promete un aviso a una hora concreta", () => {
    // Google ignora el VALARM: prometerlo sería mentirle a la mayoría de la
    // lista. El correo invita a añadir, no promete avisar.
    const { asunto, html, texto } = inv();
    expect(`${asunto} ${html} ${texto}`).not.toMatch(/te avisa|recordar[eé]|una hora antes/i);
  });

  it("avisa a los de Gmail de que el aviso será el suyo", () => {
    expect(inv().texto).toMatch(/Gmail/);
  });

  it("sigue sin filtrar precios ni credenciales", () => {
    const { asunto, html, texto } = inv();
    const todo = `${asunto} ${html} ${texto}`;
    expect(todo).not.toMatch(/[€$]\s?\d|\d\s?(?:€|EUR|USD)/i);
    expect(todo.toLowerCase()).not.toMatch(/contrase|password/);
  });
});

// Encontrado probando de verdad, el 3-sep: la invitación llegó a un buzón en
// Chile, el correo decía "domingos a las 19:00" y Google Calendar la ponía a
// las 14:00. Las dos cosas eran correctas —19:00 de Madrid son las 14:00 en
// Santiago— pero puestas juntas parecen un error, y quien lo leyó fue el que
// construyó el sistema. Un cliente da por hecho que algo falla.
describe("la invitación explica el desfase horario", () => {
  const inv = () =>
    emailInvitacionCalendario({
      nombre: "Milo",
      sesiones: [{ titulo: "Sesión con Berni", cuando: "domingos a las 19:00" }],
    });

  it("dice que la hora es la de Madrid", () => {
    expect(`${inv().html} ${inv().texto}`).toMatch(/Madrid/);
  });

  it("avisa de que el calendario lo pondrá en su hora local", () => {
    const { html, texto } = inv();
    for (const s of [html, texto]) expect(s).toMatch(/hora local/i);
  });
});

describe("emailContrato — asunto de una recorrección", () => {
  it("agrega 'recorregido' al asunto cuando recorregido=true", () => {
    const normal = emailContrato({ cliente: "Ana Rodríguez", tipo: "venta_nueva" });
    const recorregido = emailContrato({ cliente: "Ana Rodríguez", tipo: "venta_nueva", recorregido: true });
    expect(normal.asunto).toBe("Contrato de prestación de servicios · Ana Rodríguez");
    expect(recorregido.asunto).toBe("Contrato de prestación de servicios recorregido · Ana Rodríguez");
    expect(recorregido.asunto).not.toBe(normal.asunto);
  });

  it("sin recorregido, el asunto no cambia respecto al que ya existía", () => {
    const r = emailContrato({ cliente: "Bernardo Silva", tipo: "ampliacion" });
    expect(r.asunto).toBe("Contrato de ampliación · Bernardo Silva");
  });

  it("el cuerpo (html y texto) también marca que es una recorrección", () => {
    const r = emailContrato({ cliente: "Carla Muñoz", tipo: "venta_nueva", recorregido: true });
    expect(r.html).toMatch(/recorregido/i);
    expect(r.texto).toMatch(/recorregido/i);
  });
});

describe("emailContratoCliente — el enlace de firma", () => {
  const c = emailContratoCliente({ cliente: "Ana Rodríguez", enlace: "https://os.invierteconberni.com/c/tok3n", dias: 60 });
  it("saluda por el nombre de pila y lleva el enlace en html y en texto", () => {
    expect(c.asunto).toBe("Tu contrato con MetaCrypto Club");
    expect(c.html).toContain("Hola, Ana");
    expect(c.html).toContain('href="https://os.invierteconberni.com/c/tok3n"');
    expect(c.texto).toContain("https://os.invierteconberni.com/c/tok3n");
  });
  it("dice cuánto dura el enlace", () => {
    expect(c.texto).toContain("caduca en 60 días");
  });
  it("escapa el nombre en el html", () => {
    const x = emailContratoCliente({ cliente: "<b>x</b>", enlace: "https://x/c/t", dias: 60 });
    expect(x.html).not.toContain("<b>x</b>");
  });
});
