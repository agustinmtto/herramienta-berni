import { describe, it, expect } from "vitest";
import { generarCuotas, addMonths, telefonoE164 } from "../venta";

describe("addMonths", () => {
  it("suma un mes normal", () => expect(addMonths("2026-08-15", 1)).toBe("2026-09-15"));
  it("ajusta fin de mes", () => expect(addMonths("2026-01-31", 1)).toBe("2026-02-28"));
  it("cruza el año", () => expect(addMonths("2026-11-30", 2)).toBe("2027-01-30"));
  it("fecha vacía devuelve '' (no lanza RangeError)", () => {
    expect(() => addMonths("", 1)).not.toThrow();
    expect(addMonths("", 1)).toBe("");
  });
  it("fecha malformada devuelve ''", () => {
    expect(addMonths("2026-8-3", 1)).toBe("");
    expect(addMonths("no-es-fecha", 1)).toBe("");
    expect(addMonths("2026-13-01", 1)).toBe("");
    expect(addMonths("2026-02-30", 1)).toBe("");
  });
});

describe("generarCuotas", () => {
  it("divide exacto", () => {
    expect(generarCuotas(1800, 600, 2, "2026-07-30")).toEqual([
      { monto: 600, fecha: "2026-08-30" },
      { monto: 600, fecha: "2026-09-30" },
    ]);
  });
  it("genera euros enteros; la última cuota absorbe la diferencia", () => {
    const c = generarCuotas(5000, 1000, 3, "2026-08-03");
    expect(c.map((x) => x.monto)).toEqual([1333, 1333, 1334]);
    expect(c.map((x) => x.fecha)).toEqual(["2026-09-03", "2026-10-03", "2026-11-03"]);
  });
  it("restante con céntimos: enteras salvo la última, y la suma cuadra", () => {
    const c = generarCuotas(1000, 100.5, 2, "2026-08-03");
    expect(c.map((x) => x.monto)).toEqual([449, 450.5]);
    expect(c.reduce((s, x) => s + x.monto, 0)).toBeCloseTo(899.5, 2);
  });
  it("restante <= 0 genera montos 0 (Alex los edita)", () => {
    expect(generarCuotas(1000, 1500, 2, "2026-08-03").map((x) => x.monto)).toEqual([0, 0]);
  });
  it("n=0 devuelve []", () => expect(generarCuotas(1000, 1000, 0, "2026-08-03")).toEqual([]));
  it("fecha vacía devuelve [] (no lanza RangeError)", () => {
    expect(() => generarCuotas(1800, 600, 2, "")).not.toThrow();
    expect(generarCuotas(1800, 600, 2, "")).toEqual([]);
  });
  it("fecha malformada devuelve []", () => {
    expect(generarCuotas(1800, 600, 2, "2026-8-3")).toEqual([]);
    expect(generarCuotas(1800, 600, 2, "abc")).toEqual([]);
    expect(generarCuotas(1800, 600, 2, "2026-02-31")).toEqual([]);
  });
});

describe("telefonoE164", () => {
  it("concatena y limpia", () => expect(telefonoE164("+34", "620 111 444")).toBe("+34620111444"));
  it("tolera prefijo sin +", () => expect(telefonoE164("34", "620111444")).toBe("+34620111444"));
  it("null si vacío", () => expect(telefonoE164("+34", "")).toBeNull());

  // Sin prefijo de país (la opción "Otro" del selector) no se puede adivinar el
  // país: guardar el número pelado produce un E.164 falso que WhatsApp da por
  // entregado sin que llegue a nadie. Es como nació +593595000111222.
  describe("sin prefijo de país", () => {
    it("un número pelado NO se guarda: no hay forma de saber el país", () => {
      expect(telefonoE164("", "981394196")).toBeNull();
    });

    it("si el número trae su propio + , se acepta", () => {
      expect(telefonoE164("", "+595 000 111 222")).toBe("+595000111222");
    });

    it("acepta también el 00 internacional a la europea", () => {
      expect(telefonoE164("", "0034620111444")).toBe("+34620111444");
    });

    it("un número internacional demasiado corto tampoco cuela", () => {
      expect(telefonoE164("", "+123")).toBeNull();
    });
  });

  // otro cliente, 12-ago-2026: su ficha acabó con +972972500111222 —
  // el prefijo de Israel pegado sobre un número que YA lo traía. WhatsApp abrió
  // dos conversaciones: la del número real recibió la confirmación de sesión y
  // quedó huérfana, y la del número inventado se llevó la bienvenida. Es el
  // mismo daño que +593595000111222 (un cliente), pero por la otra puerta.
  describe("el número ya trae su prefijo", () => {
    it("respeta el + que escribió el usuario en vez de pegarle el prefijo encima", () => {
      expect(telefonoE164("+972", "+972500111222")).toBe("+972500111222");
    });

    it("lo mismo con el 00 internacional", () => {
      expect(telefonoE164("+34", "0034620111444")).toBe("+34620111444");
    });

    // Sin `+` no hay declaración explícita, así que hace falta un criterio:
    // se descuenta el prefijo sólo si lo que queda detrás sigue siendo un
    // número completo (9 dígitos o más). El caso real de Gabriel entra aquí.
    it("detecta el prefijo duplicado aunque venga en dígitos pelados", () => {
      expect(telefonoE164("+972", "972500111222")).toBe("+972500111222");
    });

    it("no se confunde con un número nacional que empieza igual que su país", () => {
      // México: 10 dígitos nacionales. Quitarle el 52 dejaría 8 — demasiado
      // corto para ser un número entero, así que el 52 es parte del número.
      expect(telefonoE164("+52", "5212345678")).toBe("+525212345678");
    });

    it("un número nacional israelí que empieza por 972 se queda intacto", () => {
      // 9 dígitos nacionales: quitar el 972 dejaría 6, que no es un número.
      expect(telefonoE164("+972", "972345678")).toBe("+972972345678");
    });

    it("sigue funcionando el caso normal, sin duplicado", () => {
      expect(telefonoE164("+972", "500111222")).toBe("+972500111222");
      expect(telefonoE164("+34", "620111444")).toBe("+34620111444");
    });
  });
});
