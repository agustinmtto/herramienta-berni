import { describe, it, expect } from "vitest";
import { aE164, soloDigitos, variantesE164 } from "../telefono";

describe("soloDigitos — clave canónica de la conversación", () => {
  it("quita el + y los espacios de un E.164 escrito a mano", () => {
    expect(soloDigitos("+56 961 111 666")).toBe("56961111666");
  });

  it("deja intacto lo que ya viene como wa_id", () => {
    // Kapso manda el wa_id en dígitos: no debe cambiar nada.
    expect(soloDigitos("56961111666")).toBe("56961111666");
  });

  it("ignora guiones y paréntesis", () => {
    expect(soloDigitos("+1 (201) 011-1888")).toBe("12010111888");
  });

  it("devuelve cadena vacía si no hay dígitos", () => {
    expect(soloDigitos("sin número")).toBe("");
  });

  it("tolera null y undefined", () => {
    expect(soloDigitos(null)).toBe("");
    expect(soloDigitos(undefined)).toBe("");
  });
});

describe("variantesE164 — para cruzar con personas", () => {
  it("da las dos formas, con + primero", () => {
    // personas guarda "+56961111666"; Kapso manda "56961111666".
    // Sin esto el cruce no encuentra nunca al cliente.
    expect(variantesE164("56961111666")).toEqual(["+56961111666", "56961111666"]);
  });

  it("parte de un número con + y llega al mismo par", () => {
    expect(variantesE164("+56961111666")).toEqual(["+56961111666", "56961111666"]);
  });

  it("sin dígitos no hay nada que buscar", () => {
    expect(variantesE164("")).toEqual([]);
  });
});

describe("aE164 — forma canónica para GUARDAR en personas", () => {
  it("normaliza un teléfono de GoHighLevel escrito con espacios", () => {
    // GHL devuelve el número tal cual lo tecleó quien creó el contacto.
    expect(aE164("+34 657 111 555")).toBe("+34657111555");
  });

  it("añade el + al número que llega solo con dígitos", () => {
    expect(aE164("528180111777")).toBe("+528180111777");
  });

  it("convierte el prefijo internacional 00 en +", () => {
    // "+0034657111555" no cruza con nada y encima parece correcto.
    expect(aE164("0034657111555")).toBe("+34657111555");
  });

  it("ignora guiones y paréntesis", () => {
    expect(aE164("+1 (201) 011-1888")).toBe("+12010111888");
  });

  it("no inventa un número donde no lo hay", () => {
    expect(aE164("")).toBeNull();
    expect(aE164(null)).toBeNull();
    expect(aE164(undefined)).toBeNull();
    expect(aE164("sin número")).toBeNull();
  });

  it("rechaza lo que es demasiado corto para ser internacional", () => {
    // Una extensión interna guardada en el campo de teléfono: escribirla en
    // `personas.telefono_e164` deja un canónico falso que rompe los cruces.
    expect(aE164("1234")).toBeNull();
  });

  it("es idempotente: aplicarlo a su propia salida no cambia nada", () => {
    expect(aE164(aE164("+34 657 111 555"))).toBe("+34657111555");
  });
});
