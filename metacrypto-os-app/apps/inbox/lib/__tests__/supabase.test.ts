import { describe, it, expect } from "vitest";
import { patronLike } from "../supabase";

describe("patronLike — un literal dentro de un filtro ilike de PostgREST", () => {
  it("escapa el guion bajo, que en LIKE es comodín de un carácter", () => {
    // El caso que manda: sin esto, buscar el email `juan_perez@x.com` casa
    // también con `juanXperez@x.com`, y el cruce de sesiones mandaría el
    // WhatsApp al teléfono de otra persona.
    expect(patronLike("juan_perez@x.com")).toBe("juan\\_perez@x.com");
  });

  it("escapa el porcentaje, que en LIKE casa con cualquier cosa", () => {
    expect(patronLike("a%b@x.com")).toBe("a\\%b@x.com");
  });

  it("escapa la barra invertida primero, sin re-escapar las que añade", () => {
    // Si `_` se escapara antes que `\`, la barra recién puesta se duplicaría
    // y el patrón buscaría una barra literal seguida de comodín.
    expect(patronLike("a\\_b")).toBe("a\\\\\\_b");
  });

  it("deja intacto un email corriente", () => {
    expect(patronLike("cliente2.ejemplo@gmail.com")).toBe("cliente2.ejemplo@gmail.com");
  });

  it("no toca los puntos ni las mayúsculas: no es un regex ni normaliza", () => {
    // Quien compara sigue teniendo que confirmar en cliente; esto solo
    // estrecha la búsqueda.
    expect(patronLike("Cliente2.Ejemplo@Gmail.com")).toBe("Cliente2.Ejemplo@Gmail.com");
  });
});
