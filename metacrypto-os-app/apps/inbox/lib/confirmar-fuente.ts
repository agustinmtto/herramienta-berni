// ============================================================
// Confirmar una fuente de `fuentes_atribucion` (validación pura + capa de
// datos inyectable — sin `server-only`, se importa desde tests). Es la única
// puerta para pasar una fila de `confirmado=false` a `true` sin editar la
// base a mano.
//
// Por qué importa: `/api/ghl/citas` inserta una fila PROVISIONAL
// (confirmado=false) cada vez que aparece un Source_ID que GHL nunca había
// visto — Berni acuña uno nuevo por cada pieza de contenido. Mientras la
// fila siga sin confirmar, `comisionesDePago` (lib/comisiones.ts) la trata
// como incidencia `fuente_sin_confirmar` y NO paga ninguna comisión sobre
// los pagos que la usen. Sin esta action, la única forma de destrabarlos era
// entrar a Supabase a mano.
// ============================================================

// Espejo exacto del CHECK de `fuentes_atribucion.nivel` (migración 0028). Si
// alguien cambia el CHECK en la base sin tocar esto — o al revés — el
// desplegable del formulario deja de mentir en silencio: hay que actualizar
// los dos sitios a la vez, y un test lo nota si se olvidan.
export const NIVELES_FUENTE = ["setter", "canal", "contenido", "campana"] as const;
export type NivelFuente = (typeof NIVELES_FUENTE)[number];

export function esNivelValido(v: string): v is NivelFuente {
  return (NIVELES_FUENTE as readonly string[]).includes(v);
}

export type EntradaConfirmarFuente = {
  sourceId: string;
  fuente: string;
  nivel: string;
  // "" o null = sin setter — legítimo: AutoSetter, orgánico y las piezas de
  // contenido no llevan setter. Un id no vacío se resuelve contra
  // `team_members` en `confirmarFuenteConRest`: nunca se confía en un
  // `setter_nombre` que llegue suelto del formulario, precisamente para que
  // nombre e id no puedan quedar incoherentes.
  setterId: string | null;
};

export type ConfirmacionValida = { fuente: string; nivel: NivelFuente; setterId: string | null };
export type ValidacionConfirmarFuente =
  | { ok: true; datos: ConfirmacionValida }
  | { ok: false; error: string };

// La única validación que cuenta es esta, del lado del servidor. El
// `disabled` del botón en el cliente es una comodidad de UX, no una defensa
// — esa lección ya costó cara una vez (ver `puedeEnviarBienvenida` /
// bienvenida.ts): una acción anterior selló un campo apoyándose solo en el
// `disabled` de un formulario. `fuente` y `nivel` son NOT NULL en el
// esquema (0028); `nivel` además lleva un CHECK que revienta con cualquier
// valor fuera de las cuatro opciones — de ahí que se rechace aquí, antes de
// que Postgres lo haga con un error crudo.
export function validarConfirmacion(input: EntradaConfirmarFuente): ValidacionConfirmarFuente {
  if (!input.sourceId) return { ok: false, error: "Falta la fuente a confirmar." };
  const fuente = input.fuente.trim();
  if (!fuente) {
    return { ok: false, error: "La fuente necesita un nombre legible antes de poder confirmarse." };
  }
  if (!esNivelValido(input.nivel)) {
    return { ok: false, error: `Nivel inválido: debe ser uno de ${NIVELES_FUENTE.join(", ")}.` };
  }
  const setterId = input.setterId?.trim() || null;
  return { ok: true, datos: { fuente, nivel: input.nivel, setterId } };
}

type Rest = (
  m: string,
  path: string,
  body?: unknown,
  prefer?: string,
) => Promise<{ status: number; json: unknown }>;

export type ResultadoConfirmarFuente =
  | { ok: true; setterNombre: string | null }
  | { ok: false; error: string };

// Confirma una fuente contra la base, con `rest` inyectado para poder
// probarlo sin red (mismo patrón que `guardarAtribucion` en
// guardar-atribucion.ts). NO lanza: cualquier fallo se traduce a
// `{ok:false, error}` en español para que la action lo devuelva tal cual.
//
// Coherencia setter_nombre/setter_id (0028: `setter_id` referencia
// `team_members`, `setter_nombre` es el texto legible): en vez de aceptar
// los dos valores del formulario y comprobar que "coinciden", se acepta
// SOLO `setterId` y `setter_nombre` se resuelve aquí contra `team_members`.
// Así es estructuralmente imposible que queden descoordinados — no hay
// ninguna combinación de inputs que produzca un nombre que no sea el de ese
// id, y "sin setter" es simplemente `setterId: null` → los dos campos null.
export async function confirmarFuenteConRest(
  input: EntradaConfirmarFuente,
  rest: Rest,
): Promise<ResultadoConfirmarFuente> {
  const v = validarConfirmacion(input);
  if (!v.ok) return v;
  const { fuente, nivel, setterId } = v.datos;

  let setterNombre: string | null = null;
  if (setterId) {
    let r: Awaited<ReturnType<Rest>>;
    try {
      r = await rest("GET", `team_members?id=eq.${setterId}&select=id,nombre&limit=1`);
    } catch (e) {
      console.error("[confirmarFuente] no se pudo resolver el setter elegido", e);
      return { ok: false, error: "No se pudo comprobar el setter elegido (error de conexión). Reintenta." };
    }
    const fila = Array.isArray(r.json) ? (r.json[0] as { nombre?: string } | undefined) : undefined;
    // Defensa de servidor, no solo del `<select>`: un id que ya no exista
    // (miembro dado de baja entre que se cargó la página y se envió el
    // formulario) no debe colar un `setter_id` huérfano.
    if (!fila) return { ok: false, error: "El setter elegido ya no existe en el equipo. Recarga la página." };
    setterNombre = fila.nombre ?? null;
  }

  let r: Awaited<ReturnType<Rest>>;
  try {
    r = await rest(
      "PATCH",
      `fuentes_atribucion?source_id=eq.${encodeURIComponent(input.sourceId)}`,
      { fuente, nivel, setter_id: setterId, setter_nombre: setterNombre, confirmado: true },
      // `return=representation`: sin esto, un PATCH cuyo filtro no casa con
      // ninguna fila (fuente ya confirmada por otra pestaña, o borrada)
      // responde 204 igual que un PATCH que sí tocó algo — el mismo fallo
      // silencioso que ya se corrigió en `atarPago` (guardar-atribucion.ts).
      "return=representation",
    );
  } catch (e) {
    console.error("[confirmarFuente] no se pudo guardar la confirmación", e);
    return { ok: false, error: "No se pudo guardar la confirmación (error de conexión). Reintenta." };
  }
  const filas = Array.isArray(r.json) ? r.json : [];
  if (r.status >= 300 || filas.length === 0) {
    return {
      ok: false,
      error: "No se encontró esa fuente para confirmar — puede que ya se haya confirmado. Recarga la página.",
    };
  }
  return { ok: true, setterNombre };
}
