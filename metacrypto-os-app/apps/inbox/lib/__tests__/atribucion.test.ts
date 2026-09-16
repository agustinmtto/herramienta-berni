import { describe, it, expect } from "vitest";
import {
  miembroDeUsuarioGhl, CALENDARIOS_VENTA, CALENDARIOS_NO_VENTA, estadoDeCita,
  calendariosDeVenta,
} from "../atribucion";

const ALEX = "25b94e5d-109d-4f89-87a8-ca17ad40072a";
const BERNI = "6cbb5982-6051-4c00-bc98-97310140e23f";
const MANUEL = "bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1";
const IKER = "1826f965-d12f-4550-b7ac-673326f5f671";

describe("miembroDeUsuarioGhl", () => {
  it("mapea la cuenta de gmail de Alex", () => {
    expect(miembroDeUsuarioGhl("sXWPy4fCRo6yFEeVcODd")).toBe(ALEX);
  });
  it("mapea también su cuenta corporativa: son la misma persona", () => {
    // 141 citas van al gmail y 6 al corporativo. Sin las dos, sus números
    // salen partidos.
    expect(miembroDeUsuarioGhl("N4gTwYQ3fx9HP70lkT9n")).toBe(ALEX);
  });
  it("mapea las dos cuentas de Berni", () => {
    expect(miembroDeUsuarioGhl("DmvcKL0fg38HFDLZZRI8")).toBe(BERNI);
    expect(miembroDeUsuarioGhl("hlQOxNZMgRZWtbahC2c4")).toBe(BERNI);
  });
  it("mapea a Manuel", () => {
    expect(miembroDeUsuarioGhl("pb9C0LZCk0N2FNrL1feC")).toBe(MANUEL);
  });
  it("mapea a Iker", () => {
    // Es coach, no closer: hoy no cierra ventas. Se mapea igual para que su
    // actividad quede atribuible el día que aparezca en una cita, en vez de
    // caer al null silencioso.
    expect(miembroDeUsuarioGhl("ubF4xEEXrP3d7yovZAfH")).toBe(IKER);
  });
  it("un usuario desconocido no inventa a nadie", () => {
    expect(miembroDeUsuarioGhl("XXXXXXXX")).toBeNull();
    expect(miembroDeUsuarioGhl(null)).toBeNull();
  });
});

describe("CALENDARIOS_VENTA — la red por si GHL no contesta el catálogo", () => {
  it("son los de venta conocidos, y NINGUNO de consultoría", () => {
    expect(CALENDARIOS_VENTA).toEqual([
      "ZBDAnmWbsDMFAKls805h",
      "xeLDQNZArAbWMkGUaCV3",
      "VHxkFpFgBEXR5PlJWeN8",
      // El del evento 26/08: se añade aquí también porque la red tiene que
      // saber todo lo que ya sabemos. La lista de verdad la da GHL.
      "qXHMfM3O3sWphI90W0K2",
    ]);
    // Los de consultoría son de servicio: una venta nunca sale de ahí.
    expect(CALENDARIOS_VENTA).not.toContain("mQvGZMNXeQhKHBjXgdA5");
    expect(CALENDARIOS_VENTA).not.toContain("UCpATrysC6kK1mezCMgF");
    expect(CALENDARIOS_VENTA).not.toContain("iCAZAvZpFmdXuMhhnK1x");
  });
});

describe("CALENDARIOS_NO_VENTA — la lista negra", () => {
  it("están los TRES calendarios de consultoría, Iker incluido", () => {
    // El de Iker se creó el 2-sep-2026. Si faltara aquí, sus consultorías
    // saldrían como opción de "qué llamada cerró la venta" — el fallo del
    // calendario del evento 26/08, pero al revés.
    expect(CALENDARIOS_NO_VENTA).toEqual([
      "mQvGZMNXeQhKHBjXgdA5",
      "UCpATrysC6kK1mezCMgF",
      "iCAZAvZpFmdXuMhhnK1x",
    ]);
  });
});

describe("estadoDeCita — qué pasó con la llamada", () => {
  // Es el dato que MÁS distingue una cita de otra. De las 215 citas de venta
  // de GHL, 56 (el 26 %) están canceladas, y hasta el 13-ago el selector las
  // ofrecía exactamente igual que las que sí ocurrieron: se podía atribuir una
  // comisión a una llamada que no pasó.
  it("distingue la que ocurrió de la que no", () => {
    expect(estadoDeCita("showed")).toEqual({ texto: "asistió", tono: "ok" });
    expect(estadoDeCita("cancelled").tono).toBe("malo");
    expect(estadoDeCita("noshow").tono).toBe("malo");
  });

  it("una cita futura no es un problema: es 'pendiente', no 'malo'", () => {
    // Pintar de rojo una llamada que simplemente todavía no ha ocurrido haría
    // que el aviso perdiera valor justo donde importa.
    expect(estadoDeCita("confirmed")).toEqual({
      texto: "agendada, aún no ha pasado", tono: "pendiente",
    });
  });

  it("un estado desconocido se enseña crudo, no se disfraza de normal", () => {
    // `invalid` existe en los datos reales (1 cita), y GHL puede inventar
    // estados nuevos. Uno que no sabemos leer no puede parecerse a "asistió".
    expect(estadoDeCita("invalid").texto).toBe("estado «invalid»");
    expect(estadoDeCita("loQueSea").texto).toBe("estado «loQueSea»");
  });

  it("sin estado lo dice, en vez de callarse", () => {
    expect(estadoDeCita(null).texto).toBe("sin estado");
    expect(estadoDeCita(undefined).texto).toBe("sin estado");
  });
});

describe("calendariosDeVenta — de dónde salen las llamadas que se pueden atribuir", () => {
  // El 27-ago-2026 Alex subió la venta de Yajaira y su llamada NO aparecía en
  // el selector. No era el email (el contacto se encontraba bien por teléfono
  // y por email): su única cita vivía en `qXHMfM3O3sWphI90W0K2` — "Llamada de
  // Admisión | Evento 26/08" —, un calendario que Berni creó para el evento y
  // que nadie añadió a la lista de tres ids escrita a mano. 40 citas de ese
  // evento eran invisibles para el OS. Ese es el fallo que esta función
  // existe para no repetir: la lista se le PREGUNTA a GHL.
  const CATALOGO = [
    { id: "UCpATrysC6kK1mezCMgF", nombre: "Consultoria con Manuel" },
    { id: "VHxkFpFgBEXR5PlJWeN8", nombre: "Admisión con Berni" },
    { id: "ZBDAnmWbsDMFAKls805h", nombre: "Llamada de Estrategia | Metacrypto Club" },
    { id: "mQvGZMNXeQhKHBjXgdA5", nombre: "Consultoría con Berni" },
    { id: "qXHMfM3O3sWphI90W0K2", nombre: "Llamada de Admisión | Evento 26/08" },
    { id: "xeLDQNZArAbWMkGUaCV3", nombre: "Llamada de Estrategia - Metacrypto Club" },
  ];

  it("un calendario nuevo que nadie hardcodeó entra solo", () => {
    const ids = calendariosDeVenta(CATALOGO).map((c) => c.id);
    expect(ids).toContain("qXHMfM3O3sWphI90W0K2");
  });

  it("los de consultoría siguen fuera: una venta nunca sale de una consultoría", () => {
    const ids = calendariosDeVenta(CATALOGO).map((c) => c.id);
    expect(ids).not.toContain("mQvGZMNXeQhKHBjXgdA5");
    expect(ids).not.toContain("UCpATrysC6kK1mezCMgF");
    expect(ids).toHaveLength(4);
  });

  it("un calendario APAGADO sigue contando", () => {
    // El del evento 26/08 se desactivará cuando pase el evento, y sus citas
    // seguirán siendo las que cerraron esas ventas. Filtrar por `activo`
    // volvería a esconderlas — el mismo fallo, tres semanas después.
    const ids = calendariosDeVenta([
      { id: "qXHMfM3O3sWphI90W0K2", nombre: "Evento 26/08", activo: false },
    ]).map((c) => c.id);
    expect(ids).toEqual(["qXHMfM3O3sWphI90W0K2"]);
  });

  it("si GHL no contesta cae a la lista conocida, NUNCA a lista vacía", () => {
    // Lista vacía = cero citas que ofrecer, y eso en pantalla se lee igual
    // que "este cliente no vino de agenda". Se atribuiría a ciegas.
    expect(calendariosDeVenta(null).map((c) => c.id)).toEqual(CALENDARIOS_VENTA);
    expect(calendariosDeVenta([]).map((c) => c.id)).toEqual(CALENDARIOS_VENTA);
  });

  it("el nombre sale del catálogo, y si falta del mapa conocido", () => {
    expect(calendariosDeVenta([{ id: "ZBDAnmWbsDMFAKls805h", nombre: "Renombrado en GHL" }]))
      .toEqual([{ id: "ZBDAnmWbsDMFAKls805h", nombre: "Renombrado en GHL" }]);
    expect(calendariosDeVenta([{ id: "ZBDAnmWbsDMFAKls805h", nombre: null }]))
      .toEqual([{ id: "ZBDAnmWbsDMFAKls805h", nombre: "Llamada de Estrategia" }]);
    expect(calendariosDeVenta([{ id: "nuevoSinNombre", nombre: "" }]))
      .toEqual([{ id: "nuevoSinNombre", nombre: null }]);
  });
});
