import { describe, it, expect } from "vitest";
import { parcheDeAtribucion, guardarAtribucion, type Atribucion } from "../guardar-atribucion";

const DANI = "11111111-1111-1111-1111-111111111111";

describe("parcheDeAtribucion", () => {
  it("sella atribucion_at cuando hubo decision", () => {
    const p = parcheDeAtribucion({
      sourceId: "wa_set_db", setterId: DANI, closerId: null,
      upsellPorId: null, ghlAppointmentId: "cita1", decidido: true,
    });
    expect(p.source_id).toBe("wa_set_db");
    expect(p.setter_id).toBe(DANI);
    expect(typeof p.atribucion_at).toBe("string");
  });

  it("sella igual cuando la decision es NO vino de agenda", () => {
    // Es la distincion que hace funcionar la bandeja: "lo mire y no tiene
    // fuente" tiene que salir de la lista igual que "lo mire y es de Dani".
    const p = parcheDeAtribucion({
      sourceId: null, setterId: null, closerId: null,
      upsellPorId: null, ghlAppointmentId: null, decidido: true,
    });
    expect(p.source_id).toBeNull();
    expect(p.atribucion_at).not.toBeNull();
  });

  it("NO sella si se dejo para despues", () => {
    const p = parcheDeAtribucion({
      sourceId: null, setterId: null, closerId: null,
      upsellPorId: null, ghlAppointmentId: null, decidido: false,
    });
    expect(p.atribucion_at).toBeNull();
  });

  it("convierte las cadenas vacias del FormData en null, no en cadena vacia", () => {
    // Un "" en una columna uuid revienta el PATCH; un "" en source_id crearia
    // una fuente fantasma que no existe en el catalogo.
    const p = parcheDeAtribucion({
      sourceId: "", setterId: "", closerId: "",
      upsellPorId: "", ghlAppointmentId: "", decidido: true,
    } as unknown as Atribucion);
    expect(p.source_id).toBeNull();
    expect(p.setter_id).toBeNull();
    expect(p.closer_id).toBeNull();
    expect(p.upsell_por_id).toBeNull();
    expect(p.ghl_appointment_id).toBeNull();
  });
});

describe("guardarAtribucion", () => {
  it("guarda ambas mitades cuando el pago se ata exitosamente", async () => {
    const pagoId = "pago-123";
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db",
      setterId: DANI,
      closerId: null,
      upsellPorId: null,
      ghlAppointmentId: null,
      decidido: true,
    };

    const llamadas: Array<{ metodo: string; path: string; cuerpo?: unknown; prefer?: string }> = [];
    const rest = async (metodo: string, path: string, cuerpo?: unknown, prefer?: string) => {
      llamadas.push({ metodo, path, cuerpo, prefer });
      // PostgREST con `Prefer: return=representation` devuelve la(s) fila(s)
      // afectadas en el cuerpo — así es como `atarPago` confirma que de
      // verdad tocó algo.
      if (metodo === "PATCH" && path.startsWith("pagos")) return { status: 200, json: [{ id: pagoId }] };
      return { status: 204, json: {} };
    };

    const resultado = await guardarAtribucion(
      programaId,
      pagoId,
      atribucion,
      rest,
    );

    expect(resultado.pagoAtado).toBe(true);
    expect(resultado.atribucionGuardada).toBe(true);

    // Verificar que se hicieron las dos llamadas en orden
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0].metodo).toBe("PATCH");
    expect(llamadas[0].path).toBe(`pagos?id=eq.${pagoId}`);
    expect(llamadas[0].cuerpo).toEqual({ programa_id: programaId });
    expect(llamadas[0].prefer).toBe("return=representation");

    expect(llamadas[1].metodo).toBe("PATCH");
    expect(llamadas[1].path).toBe(`programas?id=eq.${programaId}`);
    // Cuando atar es exitoso, la atribución se sella
    const parche = llamadas[1].cuerpo as Record<string, unknown>;
    expect(parche.source_id).toBe("wa_set_db");
    expect(parche.setter_id).toBe(DANI);
    expect(typeof parche.atribucion_at).toBe("string");
  });

  it("NO sella atribucion_at si el pago falla (status >= 300)", async () => {
    const pagoId = "pago-123";
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db",
      setterId: DANI,
      closerId: null,
      upsellPorId: null,
      ghlAppointmentId: null,
      decidido: true,
    };

    const llamadas: Array<{ metodo: string; path: string; cuerpo?: unknown }> = [];
    const rest = async (metodo: string, path: string, cuerpo?: unknown) => {
      llamadas.push({ metodo, path, cuerpo });
      // Primera llamada (pago) falla, segunda es exitosa
      if (metodo === "PATCH" && path.startsWith("pagos")) {
        return { status: 500, json: {} };
      }
      return { status: 204, json: {} };
    };

    const resultado = await guardarAtribucion(
      programaId,
      pagoId,
      atribucion,
      rest,
    );

    expect(resultado.pagoAtado).toBe(false);
    expect(resultado.atribucionGuardada).toBe(true);

    // Se intentó guardar, pero sin sellar
    expect(llamadas).toHaveLength(2);
    const parche = llamadas[1].cuerpo as Record<string, unknown>;
    expect(parche.source_id).toBe("wa_set_db");
    expect(parche.atribucion_at).toBeNull();
  });

  it("NO sella atribucion_at aunque decidido=true si el pago lance excepción", async () => {
    // CRÍTICO: esta combinación (decidido: true + excepción en pago) es la que
    // prueba que la lógica depende del estado del pago, no solo de decidido.
    // Sin este test, un cambio futuro que ignorara pagoAtado pasaría verde.
    const pagoId = "pago-123";
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db",
      setterId: DANI,
      closerId: "alex-id",
      upsellPorId: "upsell-id",
      ghlAppointmentId: "cita-789",
      decidido: true, // SÍ decidido, pero el pago lanzará excepción
    };

    const llamadas: Array<{ metodo: string; path: string; cuerpo?: unknown }> = [];
    const rest = async (metodo: string, path: string, cuerpo?: unknown) => {
      llamadas.push({ metodo, path, cuerpo });
      // Primera llamada lanza
      if (metodo === "PATCH" && path.startsWith("pagos")) {
        throw new Error("Red caída");
      }
      return { status: 204, json: {} };
    };

    const resultado = await guardarAtribucion(
      programaId,
      pagoId,
      atribucion,
      rest,
    );

    expect(resultado.pagoAtado).toBe(false);
    expect(resultado.atribucionGuardada).toBe(true);

    // Se guardó la atribución, pero sin sellar.
    // El punto crítico: a pesar de decidido=true, atribucion_at es null
    // porque el pago no se ató exitosamente.
    const parche = llamadas[1].cuerpo as Record<string, unknown>;
    expect(parche.source_id).toBe("wa_set_db");
    expect(parche.setter_id).toBe(DANI);
    expect(parche.closer_id).toBe("alex-id");
    expect(parche.upsell_por_id).toBe("upsell-id");
    expect(parche.ghl_appointment_id).toBe("cita-789");
    // Este es el assertion crítico: aunque decidido sea true, no se sella
    // porque el pago no se ató
    expect(parche.atribucion_at).toBeNull();
  });

  it("devuelve false si el segundo PATCH falla, sin lanzar", async () => {
    const pagoId = "pago-123";
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db",
      setterId: DANI,
      closerId: null,
      upsellPorId: null,
      ghlAppointmentId: null,
      decidido: true,
    };

    const rest = async (metodo: string, path: string, _cuerpo?: unknown) => {
      // Primera llamada (pago) exitosa, segunda falla
      if (metodo === "PATCH" && path.startsWith("pagos")) {
        return { status: 200, json: [{ id: pagoId }] };
      }
      return { status: 500, json: { error: "No se pudo guardar atribución" } };
    };

    const resultado = await guardarAtribucion(
      programaId,
      pagoId,
      atribucion,
      rest,
    );

    expect(resultado.pagoAtado).toBe(true);
    expect(resultado.atribucionGuardada).toBe(false);
  });

  it("NO sella atribucion_at si el PATCH del pago da 204 sin tocar ninguna fila", async () => {
    // El fallo que motiva este fix: `status < 300` daba `true` en un 204 que
    // no encontró el `pagoId` (borrado, o un id que nunca existió) — la misma
    // forma del fallo del cron que devolvía `{ok:true}` sin escribir. Con
    // `Prefer: return=representation`, PostgREST responde con un array VACÍO
    // cuando el filtro no casa con nada, aunque el status siga siendo de éxito.
    const pagoId = "pago-fantasma";
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db", setterId: DANI, closerId: null,
      upsellPorId: null, ghlAppointmentId: null, decidido: true,
    };

    const rest = async (metodo: string, path: string, _cuerpo?: unknown) => {
      if (metodo === "PATCH" && path.startsWith("pagos")) {
        return { status: 204, json: [] }; // "éxito" que no tocó nada
      }
      return { status: 204, json: {} };
    };

    const resultado = await guardarAtribucion(programaId, pagoId, atribucion, rest);

    expect(resultado.pagoAtado).toBe(false);
  });

  it("con varios pagos, sella solo si TODOS se atan", async () => {
    // La corrección desde /atribucion puede encontrar más de un pago
    // colgado directamente del programa. Uno huérfano basta para que la
    // venta siga en la bandeja — no vale que "la mayoría" se atara.
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db", setterId: DANI, closerId: null,
      upsellPorId: null, ghlAppointmentId: null, decidido: true,
    };

    const rest = async (metodo: string, path: string, _cuerpo?: unknown) => {
      if (metodo === "PATCH" && path === "pagos?id=eq.pago-ok") {
        return { status: 200, json: [{ id: "pago-ok" }] };
      }
      if (metodo === "PATCH" && path === "pagos?id=eq.pago-huerfano") {
        return { status: 204, json: [] };
      }
      return { status: 204, json: {} };
    };

    const resultado = await guardarAtribucion(
      programaId, ["pago-ok", "pago-huerfano"], atribucion, rest,
    );

    expect(resultado.pagoAtado).toBe(false);
  });

  it("con varios pagos, sella si TODOS se atan", async () => {
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db", setterId: DANI, closerId: null,
      upsellPorId: null, ghlAppointmentId: null, decidido: true,
    };

    const rest = async (metodo: string, path: string, _cuerpo?: unknown) => {
      if (metodo === "PATCH" && path.startsWith("pagos?id=eq.")) {
        const id = path.replace("pagos?id=eq.", "");
        return { status: 200, json: [{ id }] };
      }
      return { status: 204, json: {} };
    };

    const resultado = await guardarAtribucion(
      programaId, ["pago-1", "pago-2"], atribucion, rest,
    );

    expect(resultado.pagoAtado).toBe(true);
    expect(resultado.atribucionGuardada).toBe(true);
  });

  it("un array de pagos vacío no ata nada y no sella", async () => {
    // No debería llegar aquí (quien llama valida antes), pero si llegara, no
    // se inventa un éxito vacío.
    const programaId = "prog-456";
    const atribucion: Atribucion = {
      sourceId: "wa_set_db", setterId: DANI, closerId: null,
      upsellPorId: null, ghlAppointmentId: null, decidido: true,
    };
    const rest = async () => ({ status: 204, json: {} });

    const resultado = await guardarAtribucion(programaId, [], atribucion, rest);

    expect(resultado.pagoAtado).toBe(false);
  });
});
