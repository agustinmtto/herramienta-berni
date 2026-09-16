import { describe, it, expect } from "vitest";
import {
  validarConfirmacion,
  confirmarFuenteConRest,
  esNivelValido,
  NIVELES_FUENTE,
  type EntradaConfirmarFuente,
} from "../confirmar-fuente";

const DANI = "11111111-1111-1111-1111-111111111111";

describe("esNivelValido / NIVELES_FUENTE", () => {
  it("son exactamente los cuatro del CHECK de la migración 0028", () => {
    expect(NIVELES_FUENTE).toEqual(["setter", "canal", "contenido", "campana"]);
  });
  it("acepta los cuatro niveles válidos", () => {
    for (const n of NIVELES_FUENTE) expect(esNivelValido(n)).toBe(true);
  });
  it("rechaza cualquier otro valor", () => {
    expect(esNivelValido("")).toBe(false);
    expect(esNivelValido("Setter")).toBe(false); // mayúscula: no es el mismo valor del CHECK
    expect(esNivelValido("influencer")).toBe(false);
  });
});

describe("validarConfirmacion", () => {
  const base: EntradaConfirmarFuente = {
    sourceId: "igreel_shortmayo",
    fuente: "Instagram",
    nivel: "contenido",
    setterId: null,
  };

  it("acepta una entrada completa y recorta espacios de la fuente", () => {
    const r = validarConfirmacion({ ...base, fuente: "  Instagram  " });
    expect(r).toEqual({ ok: true, datos: { fuente: "Instagram", nivel: "contenido", setterId: null } });
  });

  it("rechaza fuente vacía — NO se apoya en el disabled del cliente", () => {
    expect(validarConfirmacion({ ...base, fuente: "" })).toEqual({
      ok: false,
      error: "La fuente necesita un nombre legible antes de poder confirmarse.",
    });
  });

  it("rechaza fuente que es solo espacios", () => {
    const r = validarConfirmacion({ ...base, fuente: "   " });
    expect(r.ok).toBe(false);
  });

  it("rechaza un nivel fuera del CHECK de la base", () => {
    const r = validarConfirmacion({ ...base, nivel: "influencer" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Nivel inválido");
  });

  it("rechaza si falta el source_id", () => {
    expect(validarConfirmacion({ ...base, sourceId: "" })).toEqual({
      ok: false,
      error: "Falta la fuente a confirmar.",
    });
  });

  it("una cadena vacía de setterId se normaliza a null (sin setter)", () => {
    const r = validarConfirmacion({ ...base, setterId: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.setterId).toBeNull();
  });

  it("conserva un setterId no vacío", () => {
    const r = validarConfirmacion({ ...base, setterId: DANI });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.setterId).toBe(DANI);
  });
});

describe("confirmarFuenteConRest", () => {
  const base: EntradaConfirmarFuente = {
    sourceId: "igreel_shortmayo",
    fuente: "Instagram",
    nivel: "contenido",
    setterId: null,
  };

  it("confirma sin setter: no consulta team_members y guarda los dos campos en null", async () => {
    const llamadas: Array<{ m: string; path: string; body?: unknown }> = [];
    const rest = async (m: string, path: string, body?: unknown) => {
      llamadas.push({ m, path, body });
      return { status: 200, json: [{ source_id: base.sourceId }] };
    };

    const r = await confirmarFuenteConRest(base, rest);
    expect(r).toEqual({ ok: true, setterNombre: null });
    expect(llamadas).toHaveLength(1); // sin setter: no hace falta resolver nombre
    expect(llamadas[0].m).toBe("PATCH");
    expect(llamadas[0].path).toBe("fuentes_atribucion?source_id=eq.igreel_shortmayo");
    expect(llamadas[0].body).toEqual({
      fuente: "Instagram",
      nivel: "contenido",
      setter_id: null,
      setter_nombre: null,
      confirmado: true,
    });
  });

  it("con setter: resuelve el nombre desde team_members, NUNCA desde el input", async () => {
    const llamadas: Array<{ m: string; path: string; body?: unknown }> = [];
    const rest = async (m: string, path: string, body?: unknown) => {
      llamadas.push({ m, path, body });
      if (m === "GET" && path.startsWith("team_members")) {
        return { status: 200, json: [{ id: DANI, nombre: "Dani Bertólez" }] };
      }
      return { status: 200, json: [{ source_id: base.sourceId }] };
    };

    const r = await confirmarFuenteConRest({ ...base, setterId: DANI }, rest);
    expect(r).toEqual({ ok: true, setterNombre: "Dani Bertólez" });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0].path).toBe(`team_members?id=eq.${DANI}&select=id,nombre&limit=1`);
    const patch = llamadas[1].body as Record<string, unknown>;
    // El nombre que se guarda es el que devolvió team_members, no un valor
    // que hubiera podido llegar (y no llegó) en el input.
    expect(patch.setter_id).toBe(DANI);
    expect(patch.setter_nombre).toBe("Dani Bertólez");
  });

  it("un setterId que ya no existe en el equipo se rechaza, no se guarda huérfano", async () => {
    const rest = async (m: string, path: string) => {
      if (m === "GET" && path.startsWith("team_members")) return { status: 200, json: [] };
      return { status: 200, json: [{ source_id: base.sourceId }] };
    };
    const r = await confirmarFuenteConRest({ ...base, setterId: "un-id-de-baja" }, rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ya no existe");
  });

  it("rechaza fuente vacía ANTES de tocar la base — la validación de servidor manda", async () => {
    let llamado = false;
    const rest = async () => {
      llamado = true;
      return { status: 200, json: [] };
    };
    const r = await confirmarFuenteConRest({ ...base, fuente: "   " }, rest);
    expect(r.ok).toBe(false);
    expect(llamado).toBe(false);
  });

  it("un PATCH que no toca ninguna fila (fuente ya confirmada por otra pestaña) es un fallo, no un éxito vacío", async () => {
    // Mismo fallo que motivó `return=representation` en atarPago
    // (guardar-atribucion.ts): un 204/200 con array vacío no es un éxito.
    const rest = async (m: string) => {
      if (m === "PATCH") return { status: 200, json: [] };
      return { status: 200, json: [] };
    };
    const r = await confirmarFuenteConRest(base, rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ya se haya confirmado");
  });

  it("un status >= 300 en el PATCH es un fallo aunque el body venga vacío", async () => {
    const rest = async (m: string) => {
      if (m === "PATCH") return { status: 500, json: null };
      return { status: 200, json: [] };
    };
    const r = await confirmarFuenteConRest(base, rest);
    expect(r.ok).toBe(false);
  });

  it("una excepción de red al guardar se traduce a error, no se propaga", async () => {
    const rest = async (m: string) => {
      if (m === "PATCH") throw new Error("Red caída");
      return { status: 200, json: [] };
    };
    await expect(confirmarFuenteConRest(base, rest)).resolves.toEqual({
      ok: false,
      error: "No se pudo guardar la confirmación (error de conexión). Reintenta.",
    });
  });

  it("una excepción de red al resolver el setter se traduce a error, no se propaga", async () => {
    const rest = async (m: string) => {
      if (m === "GET") throw new Error("Red caída");
      return { status: 200, json: [] };
    };
    await expect(confirmarFuenteConRest({ ...base, setterId: DANI }, rest)).resolves.toEqual({
      ok: false,
      error: "No se pudo comprobar el setter elegido (error de conexión). Reintenta.",
    });
  });

  it("un nivel inválido se rechaza aunque venga con setter y fuente correctos", async () => {
    let llamado = false;
    const rest = async () => {
      llamado = true;
      return { status: 200, json: [] };
    };
    const r = await confirmarFuenteConRest({ ...base, nivel: "otra-cosa" }, rest);
    expect(r.ok).toBe(false);
    expect(llamado).toBe(false);
  });
});
