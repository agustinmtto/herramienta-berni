import { describe, it, expect } from "vitest";
import { money, moneyExacta, num, dateEs, monthLabel, colorPersona } from "../format";
import { money2 } from "../cuotas";

// Intl inserta un espacio ESTRECHO NO SEPARABLE (U+202F) antes del símbolo de
// moneda en es-ES, no un espacio normal. Comparar contra " €" escrito a mano
// falla por un carácter invisible, así que se normaliza.
const n = (s: string) => s.replace(/ | /g, " ");

describe("money", () => {
  // La razón de existir de este fichero: hasta el 2-sep-2026 money() redondeaba
  // a euros enteros y convivía con dos funciones que sí daban céntimos, así que
  // el mismo pago se veía "752 €" en una pantalla y "751,50 €" en otra.
  it("siempre lleva dos decimales", () => {
    expect(n(money(751.5))).toBe("751,50 €");
    expect(n(money(1000))).toBe("1000,00 €");
  });

  it("separa los miles", () => {
    expect(n(money(44567.83))).toBe("44.567,83 €");
  });

  it("no pierde el céntimo por acumulación", () => {
    // Tres líneas de 250,50 sumaban 751,50 y se pintaban como 251+251+251=753.
    const lineas = [250.5, 250.5, 250.5];
    const suma = lineas.reduce((s, x) => s + x, 0);
    expect(n(money(suma))).toBe("751,50 €");
    expect(lineas.map((x) => n(money(x)))).toEqual(["250,50 €", "250,50 €", "250,50 €"]);
  });

  it("respeta la divisa", () => {
    expect(n(money(1234.5, "USD"))).toContain("1234,50");
    expect(n(money(1234.5, "USD"))).toContain("US$");
  });

  it("un negativo conserva el signo", () => {
    expect(n(money(-400))).toContain("400,00");
    expect(n(money(-400)).startsWith("-")).toBe(true);
  });

  // 0,00 € es un hecho ("no cobra comisión"); null es un dato ausente. Los dos
  // se pintan igual a propósito: quien tiene que distinguirlos lo hace antes
  // de llamar aquí, con un "—". Ver la regla 3 del §8 del spec.
  it("null y undefined se tratan como cero, no como NaN", () => {
    expect(n(money(null))).toBe("0,00 €");
    expect(n(money(undefined))).toBe("0,00 €");
  });
});

describe("los alias que quedan de las tres funciones", () => {
  // Existían moneyExacta (format.ts) y money2 (cuotas.ts), idénticas entre sí
  // y en ficheros distintos. Ahora las tres son la misma; el test lo fija para
  // que no vuelvan a divergir mientras las llamadas migran.
  it("moneyExacta y money2 dan exactamente lo mismo que money", () => {
    for (const v of [0, 1, 250.5, 751.5, 44567.83, -400]) {
      expect(moneyExacta(v)).toBe(money(v));
      expect(money2(v)).toBe(money(v));
    }
  });

  it("y también con divisa", () => {
    expect(money2(1078.2, "USD")).toBe(money(1078.2, "USD"));
  });
});

describe("num", () => {
  it("cuenta cosas, no dinero: sin decimales", () => {
    expect(num(1234)).toBe("1234");
    // es-ES no agrupa a partir de cuatro dígitos, solo de cinco. No es un
    // fallo: es la convención del locale, y `num` la respeta.
    expect(n(num(12345))).toBe("12.345");
  });

  it("null es cero", () => {
    expect(num(null)).toBe("0");
  });
});

describe("dateEs", () => {
  it("da día, mes abreviado y año corto", () => {
    expect(dateEs("2026-09-07")).toMatch(/07 sept 26/);
  });

  // Se pinta en tablas donde la celda vacía se leería como "falta un dato".
  it("sin fecha devuelve una raya, no una fecha inventada", () => {
    expect(dateEs(null)).toBe("—");
  });

  // EL BUG QUE ESTE FICHERO ENCONTRÓ. Esta suite corre en America/Santiago
  // (UTC−4) en la máquina de Milo, y antes del arreglo dateEs("2026-09-07")
  // devolvía "06 sept 26": `new Date("YYYY-MM-DD")` es medianoche UTC y al
  // formatearla en una zona negativa cae al día anterior. En Vercel (UTC) no
  // se veía, pero estas funciones también corren en el navegador.
  //
  // El test es fuerte porque corre en la zona de quien lo ejecuta: si alguien
  // quita el `timeZone: "UTC"`, falla en América y en Asia. En Europa pasaría
  // igualmente, así que se comprueba además el borde de fin de mes, que se
  // rompe en cuanto la zona se mueve en cualquier dirección.
  it("una fecha de calendario no se mueve con la zona de quien la mira", () => {
    expect(dateEs("2026-01-01")).toMatch(/01 ene 26/);
    expect(dateEs("2026-12-31")).toMatch(/31 dic 26/);
    expect(dateEs("2026-03-01")).toMatch(/01 mar 26/);
  });
});

describe("monthLabel", () => {
  it("da mes abreviado y año", () => {
    expect(monthLabel("2026-08-01")).toMatch(/ago/);
    expect(monthLabel("2026-08-01")).toMatch(/2026/);
  });

  // El día 1 es el borde: en una zona negativa caía al mes anterior, y esta
  // etiqueta rotula el "Próximo mes" de /cuotas y las filas de /pnl.
  it("el día 1 no se va al mes anterior", () => {
    expect(monthLabel("2026-01-01")).toMatch(/ene/);
    expect(monthLabel("2026-08-01")).toMatch(/ago/);
  });
});

describe("colorPersona", () => {
  // SE-4: el mismo consultor tiene que verse igual en Sesiones y en
  // Comisiones — de ahí el mapa fijo por id, no un hash que podría coincidir
  // con verde/rojo/azul/naranja (ya reservados para asistencia/origen).
  it("los consultores conocidos usan su color fijo, no el hash", () => {
    expect(colorPersona("bb8f5cbe-65f0-4652-9f86-2d8c6f0584c1")).toBe("c-manuel");
    expect(colorPersona("6cbb5982-6051-4c00-bc98-97310140e23f")).toBe("c-berni");
  });

  it("un id fuera del mapa fijo cae al hash genérico, siempre el mismo", () => {
    const c1 = colorPersona("un-id-cualquiera");
    const c2 = colorPersona("un-id-cualquiera");
    expect(c1).toBe(c2);
    expect(["green", "yellow", "orange", "red", "blue", "purple", "gold"]).toContain(c1);
  });
});
