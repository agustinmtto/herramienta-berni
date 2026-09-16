import { describe, it, expect } from "vitest";
import { prepararEdicion, ESTADOS_PERSONA, type FichaActual } from "../persona";

const ACTUAL: FichaActual = {
  nombre: "Nombre Ejemplo",
  telefono_e164: null,
  email: null,
  pais: "Argentina",
  coach_id: null,
  estado: "cliente",
};

const VACIO = { nombre: "", telefono: "", email: "", pais: "", coach_id: "", estado: "" };
const PERMISO = { puedeCambiarEstado: true };

function ok(r: ReturnType<typeof prepararEdicion>) {
  if (!r.ok) throw new Error(`esperaba ok, salió: ${r.error}`);
  return r.campos;
}

describe("prepararEdicion — solo manda lo que cambia", () => {
  it("rellenar un hueco manda ese campo y nada más", () => {
    const c = ok(prepararEdicion({ ...VACIO, telefono: "+54 9 11 2345 6789" }, ACTUAL, PERMISO));
    expect(c.telefono_e164).toBe("+5491123456789");
    expect(c.nombre).toBe("");
    expect(c.email).toBe("");
    expect(c.pais).toBe("");
    expect(c.estado).toBe("");
  });

  it("un campo reenviado igual NO se manda: no ensucia la auditoría", () => {
    const r = prepararEdicion({ ...VACIO, nombre: "Nombre Ejemplo", pais: "Argentina" }, ACTUAL, PERMISO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nada que cambiar/i);
  });

  // El caso que de verdad muerde: el formulario devuelve el teléfono tal y
  // como lo ve el usuario. Si se compara el string crudo contra el guardado,
  // "+34 657 12 34 56" parece distinto de "+34657123456" y cada guardado
  // dejaría una fila de auditoría fantasma "cambió el teléfono... por el mismo".
  it("el mismo teléfono escrito con espacios no cuenta como cambio", () => {
    const actual = { ...ACTUAL, telefono_e164: "+34657123456" };
    const r = prepararEdicion({ ...VACIO, telefono: "+34 657 12 34 56" }, actual, PERMISO);
    expect(r.ok).toBe(false);
  });

  it("normaliza el prefijo internacional escrito con 00", () => {
    const c = ok(prepararEdicion({ ...VACIO, telefono: "0034657123456" }, ACTUAL, PERMISO));
    expect(c.telefono_e164).toBe("+34657123456");
  });

  it("recorta los espacios de alrededor antes de comparar", () => {
    const r = prepararEdicion({ ...VACIO, nombre: "  Nombre Ejemplo  " }, ACTUAL, PERMISO);
    expect(r.ok).toBe(false);
  });

  it("un nombre de verdad distinto sí se manda", () => {
    const c = ok(prepararEdicion({ ...VACIO, nombre: "Alan Núñez" }, ACTUAL, PERMISO));
    expect(c.nombre).toBe("Alan Núñez");
  });
});

describe("prepararEdicion — validaciones", () => {
  it("rechaza un teléfono demasiado corto para ser internacional", () => {
    const r = prepararEdicion({ ...VACIO, telefono: "6571234" }, ACTUAL, PERMISO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/tel[ée]fono/i);
  });

  it("rechaza un teléfono que no tiene dígitos", () => {
    const r = prepararEdicion({ ...VACIO, telefono: "no lo tengo" }, ACTUAL, PERMISO);
    expect(r.ok).toBe(false);
  });

  it("rechaza un email sin arroba", () => {
    const r = prepararEdicion({ ...VACIO, email: "alan.gmail.com" }, ACTUAL, PERMISO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/email/i);
  });

  it("acepta un email normal", () => {
    const c = ok(prepararEdicion({ ...VACIO, email: "persona.ejemplo@gmail.com" }, ACTUAL, PERMISO));
    expect(c.email).toBe("persona.ejemplo@gmail.com");
  });

  it("rechaza un estado que no existe", () => {
    const r = prepararEdicion({ ...VACIO, estado: "moroso" }, ACTUAL, PERMISO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/estado/i);
  });

  it("los estados válidos son los cinco del CHECK de la base", () => {
    expect([...ESTADOS_PERSONA]).toEqual(
      ["lead", "reservado", "cliente", "ex_cliente", "archivado"],
    );
  });
});

describe("prepararEdicion — el permiso de estado se comprueba aquí", () => {
  // Manuel tiene el módulo `clientes` (necesita poder añadir teléfonos) pero
  // no `acceso_total`. Archivar a un cliente no es corregir un dato: saca a
  // una persona de todas las listas del OS. Sin esta comprobación el campo
  // deshabilitado del formulario sería la única defensa, y un `<select>`
  // deshabilitado se salta con el inspector del navegador en diez segundos.
  it("sin permiso, cambiar el estado se rechaza", () => {
    const r = prepararEdicion(
      { ...VACIO, estado: "archivado" }, ACTUAL, { puedeCambiarEstado: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permiso/i);
  });

  it("sin permiso, el resto de campos se siguen pudiendo editar", () => {
    const c = ok(prepararEdicion(
      { ...VACIO, telefono: "+5491123456789" }, ACTUAL, { puedeCambiarEstado: false },
    ));
    expect(c.telefono_e164).toBe("+5491123456789");
  });

  // Reenviar el estado que YA tiene no es un cambio, así que no debe chocar
  // con el permiso: si chocara, Manuel no podría guardar un teléfono desde un
  // formulario que envía todos los campos, incluido el estado sin tocar.
  it("sin permiso, reenviar el mismo estado no bloquea el guardado", () => {
    const c = ok(prepararEdicion(
      { ...VACIO, estado: "cliente", telefono: "+5491123456789" },
      ACTUAL,
      { puedeCambiarEstado: false },
    ));
    expect(c.estado).toBe("");
    expect(c.telefono_e164).toBe("+5491123456789");
  });
});
