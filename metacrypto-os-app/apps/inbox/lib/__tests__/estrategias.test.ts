import { describe, it, expect } from "vitest";
import {
  normalizarUrl, estadoEstrategia, etiquetaEstado, estrategiasParaCliente,
  fechaLarga, fechaCorta, resumenCliente, enmascarar, validarFormulario, enlacePortal,
} from "../estrategias";

// Datos reales de MCC: las landings vivas de Airtable.
const EJEMPLO = "https://invierteconberni.com/cliente-000";
const HOY = "2026-08-20";

describe("normalizarUrl", () => {
  it("deja intacta una URL que ya viene bien", () => {
    expect(normalizarUrl(EJEMPLO)).toBe(EJEMPLO);
  });

  it("le pone https:// a lo que Berni copia sin esquema", () => {
    expect(normalizarUrl("invierteconberni.com/cliente-000")).toBe(EJEMPLO);
  });

  it("quita los espacios de pegar desde la barra del navegador", () => {
    expect(normalizarUrl("  https://invierteconberni.com/cliente-017  "))
      .toBe("https://invierteconberni.com/cliente-017");
  });

  it("quita la barra final solo cuando no hay ruta, para que dos pegados coincidan", () => {
    expect(normalizarUrl("https://invierteconberni.com/")).toBe("https://invierteconberni.com");
    // Con ruta la barra puede ser significativa: no se toca.
    expect(normalizarUrl("https://invierteconberni.com/cliente-000/"))
      .toBe("https://invierteconberni.com/cliente-000/");
  });

  it("rechaza lo vacío", () => {
    expect(normalizarUrl("")).toBeNull();
    expect(normalizarUrl("   ")).toBeNull();
    expect(normalizarUrl(null)).toBeNull();
    expect(normalizarUrl(undefined)).toBeNull();
  });

  // Esto acaba en un href del portal del cliente: si pasa, es XSS.
  it("rechaza esquemas peligrosos", () => {
    expect(normalizarUrl("javascript:alert(1)")).toBeNull();
    expect(normalizarUrl("  JavaScript:alert(1)")).toBeNull();
    expect(normalizarUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(normalizarUrl("vbscript:msgbox")).toBeNull();
  });

  it("rechaza lo que no tiene pinta de dominio", () => {
    expect(normalizarUrl("cliente-000")).toBeNull();
    expect(normalizarUrl("https://localhost")).toBeNull();
  });
});

describe("estadoEstrategia", () => {
  it("visible con fecha pasada es visible", () => {
    expect(estadoEstrategia({ fecha_lanzamiento: "2026-08-12", visible: true }, HOY)).toBe("visible");
  });

  it("visible con fecha de hoy ya cuenta como visible", () => {
    expect(estadoEstrategia({ fecha_lanzamiento: HOY, visible: true }, HOY)).toBe("visible");
  });

  it("visible con fecha futura es programada", () => {
    expect(estadoEstrategia({ fecha_lanzamiento: "2026-09-01", visible: true }, HOY)).toBe("programada");
  });

  it("oculta gana sobre la fecha", () => {
    expect(estadoEstrategia({ fecha_lanzamiento: "2026-09-01", visible: false }, HOY)).toBe("oculta");
    expect(estadoEstrategia({ fecha_lanzamiento: "2026-06-04", visible: false }, HOY)).toBe("oculta");
  });

  it("las etiquetas están en el idioma del equipo", () => {
    expect(etiquetaEstado("visible")).toBe("Visible");
    expect(etiquetaEstado("programada")).toBe("Programada");
    expect(etiquetaEstado("oculta")).toBe("Oculta");
  });
});

describe("estrategiasParaCliente", () => {
  const lista = [
    { fecha_lanzamiento: "2026-06-04", visible: true, t: "reposicionamiento" },
    { fecha_lanzamiento: "2026-08-12", visible: true, t: "short escalonado" },
    { fecha_lanzamiento: "2026-09-30", visible: true, t: "programada" },
    { fecha_lanzamiento: "2026-07-01", visible: false, t: "retirada" },
  ];

  it("devuelve solo las visibles y ya lanzadas, la más reciente primero", () => {
    expect(estrategiasParaCliente(lista, HOY).map((e) => e.t))
      .toEqual(["short escalonado", "reposicionamiento"]);
  });

  it("una programada aparece cuando llega su día", () => {
    expect(estrategiasParaCliente(lista, "2026-09-30").map((e) => e.t))
      .toEqual(["programada", "short escalonado", "reposicionamiento"]);
  });

  it("no rompe con la lista vacía", () => {
    expect(estrategiasParaCliente([], HOY)).toEqual([]);
  });

  it("no muta la lista original", () => {
    const copia = [...lista];
    estrategiasParaCliente(lista, HOY);
    expect(lista).toEqual(copia);
  });
});

describe("fechas", () => {
  it("formato largo para el cliente, sin año", () => {
    expect(fechaLarga("2026-08-12")).toBe("12 de agosto");
    expect(fechaLarga("2026-06-04")).toBe("4 de junio");
    expect(fechaLarga("2026-01-31")).toBe("31 de enero");
    expect(fechaLarga("2026-12-01")).toBe("1 de diciembre");
  });

  it("formato corto para la tabla del equipo", () => {
    expect(fechaCorta("2026-08-12")).toBe("12 ago 2026");
    expect(fechaCorta("2026-06-04")).toBe("4 jun 2026");
  });

  it("devuelve cadena vacía con basura en vez de reventar la página", () => {
    expect(fechaLarga("")).toBe("");
    expect(fechaLarga("12/08/2026")).toBe("");
    expect(fechaLarga("2026-13-01")).toBe("");
    expect(fechaCorta("no es una fecha")).toBe("");
  });
});

describe("resumenCliente", () => {
  it("cuenta y nombra la última", () => {
    expect(resumenCliente(["2026-06-04", "2026-08-12"])).toBe("2 estrategias · última el 12 de agosto");
  });

  it("singular con una sola", () => {
    expect(resumenCliente(["2026-08-12"])).toBe("1 estrategia · última el 12 de agosto");
  });

  it("null sin ninguna, para que la pantalla enseñe el estado vacío", () => {
    expect(resumenCliente([])).toBeNull();
  });

  it("ignora las fechas corruptas en vez de contarlas", () => {
    expect(resumenCliente(["", "2026-08-12", "basura"])).toBe("1 estrategia · última el 12 de agosto");
  });
});

describe("enmascarar", () => {
  it("no delata la longitud de una contraseña larga", () => {
    expect(enmascarar("EJEMPLOBTC123")).toBe("••••••••••••");
    expect(enmascarar("UNACONTRASENAMUYMUYLARGA")).toBe("••••••••••••"); // tope de 12
  });

  it("tampoco delata que es cortísima", () => {
    expect(enmascarar("ab")).toBe("••••••"); // mínimo de 6
  });

  it("sin contraseña no pinta nada", () => {
    expect(enmascarar(null)).toBe("");
    expect(enmascarar("")).toBe("");
    expect(enmascarar(undefined)).toBe("");
  });
});

describe("validarFormulario", () => {
  const ok = { persona_id: "8f3c…", titulo: "Short Escalonado BTC", url: EJEMPLO };

  it("acepta un alta completa", () => {
    expect(validarFormulario(ok)).toBeNull();
  });

  it("acepta la URL sin esquema, porque normalizarUrl la arregla", () => {
    expect(validarFormulario({ ...ok, url: "invierteconberni.com/cliente-000" })).toBeNull();
  });

  it("pide el cliente antes que nada", () => {
    expect(validarFormulario({ ...ok, persona_id: "" })).toBe("Elige el cliente.");
  });

  it("pide el título", () => {
    expect(validarFormulario({ ...ok, titulo: "   " })).toBe("La estrategia necesita un título.");
  });

  it("explica qué hacer cuando el enlace no vale", () => {
    expect(validarFormulario({ ...ok, url: "javascript:alert(1)" }))
      .toBe("El enlace no es válido. Pega la URL completa de la estrategia.");
    expect(validarFormulario({ ...ok, url: "" }))
      .toBe("El enlace no es válido. Pega la URL completa de la estrategia.");
  });
});

describe("enlacePortal", () => {
  it("compone el enlace que viaja por WhatsApp", () => {
    expect(enlacePortal("https://mcc.club", "7f3a9c2e")).toBe("https://mcc.club/e/7f3a9c2e");
  });

  it("aguanta la barra final de la env var", () => {
    expect(enlacePortal("https://mcc.club/", "7f3a9c2e")).toBe("https://mcc.club/e/7f3a9c2e");
    expect(enlacePortal("https://mcc.club///", "7f3a9c2e")).toBe("https://mcc.club/e/7f3a9c2e");
  });

  // Si la env var falta, es mejor no mandar nada que mandar "/e/token" suelto:
  // el aviso lo detecta y aborta antes de gastar una plantilla.
  it("devuelve vacío si falta la base o el token", () => {
    expect(enlacePortal("", "7f3a9c2e")).toBe("");
    expect(enlacePortal("https://mcc.club", "")).toBe("");
  });
});
