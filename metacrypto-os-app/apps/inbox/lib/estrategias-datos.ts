import "server-only";
import { rest } from "@/lib/supabase";

// Acceso a datos del módulo de Estrategias. Todo lo que hable con PostgREST
// vive aquí; la lógica que se puede probar sin red vive en `lib/estrategias.ts`.

export type EstrategiaRow = {
  id: string;
  persona_id: string;
  titulo: string;
  url: string;
  resumen: string | null;
  fecha_lanzamiento: string;
  visible: boolean;
  created_at: string;
  // Sólo si la hay: el equipo ve que existe, no cuál es.
  tiene_password?: boolean;
  persona?: { nombre: string | null; estado: string | null } | null;
};

/** Lo que sí lleva contraseña, para el portal del cliente. */
export type EstrategiaPortal = EstrategiaRow & { password: string | null };

export type ClienteOpcion = { id: string; nombre: string; tiene: number };

// DOS listas de campos, y la diferencia es la contraseña.
//
// El módulo del equipo NO la recibe: un Client Component serializa TODAS sus
// props en el payload del RSC, así que mandarla y "enmascararla" en la interfaz
// la deja en claro en el código fuente de la página. Un enmascarado que no
// enmascara es peor que ninguno, porque nadie vuelve a mirar. El equipo la pide
// una a una con la server action `verPassword`.
//
// El portal del cliente SÍ la recibe: es literalmente lo que ha venido a ver, y
// su página está detrás de su propio token.
const CAMPOS =
  "id,persona_id,titulo,url,resumen,fecha_lanzamiento,visible,created_at";
const CAMPOS_PORTAL = CAMPOS + ",password";

/** Todas, para el módulo del equipo. Con el nombre del cliente ya resuelto. */
export async function estrategiasTodas(): Promise<EstrategiaRow[]> {
  const r = await rest<EstrategiaRow[]>(
    "GET",
    `estrategias?select=${CAMPOS},password,persona:personas(nombre,estado)` +
      `&order=fecha_lanzamiento.desc,created_at.desc`,
  );
  // La contraseña se lee para saber SI existe y se tira aquí mismo, antes de
  // que pueda llegar a ningún componente.
  return (Array.isArray(r.json) ? r.json : []).map((e: any) => {
    const { password, ...resto } = e;
    return { ...resto, tiene_password: Boolean(password) } as EstrategiaRow;
  });
}

/** La contraseña de UNA estrategia. Sólo la llama la action, tras el guard. */
export async function passwordDeEstrategia(id: string): Promise<string | null> {
  const r = await rest<{ password: string | null }[]>(
    "GET",
    `estrategias?id=eq.${encodeURIComponent(id)}&select=password&limit=1`,
  );
  const fila = Array.isArray(r.json) ? r.json[0] : undefined;
  return fila?.password ?? null;
}

/**
 * Resuelve un token del portal.
 *
 * Devuelve null para token inexistente, revocado o de una persona borrada — el
 * portal enseña la MISMA pantalla en los tres casos, para no confirmarle a
 * nadie si un token existe.
 *
 * `token` viene de la URL, o sea de fuera: va por `eq.` con encodeURIComponent,
 * que es la convención del repo para entrada no confiable (86 usos de `eq.`
 * frente a un solo `ilike` documentado como excepción).
 */
export async function accesoPorToken(
  token: string,
): Promise<{ persona_id: string; nombre: string | null } | null> {
  const t = (token ?? "").trim();
  // Los tokens son base64url de 24 bytes: 32 caracteres del alfabeto [A-Za-z0-9_-].
  // Descartar aquí lo que no encaje ahorra una consulta por cada escaneo de bots.
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(t)) return null;

  const r = await rest<
    { persona_id: string; revocado_at: string | null; persona: { nombre: string | null } | null }[]
  >(
    "GET",
    `portal_accesos?token=eq.${encodeURIComponent(t)}` +
      `&select=persona_id,revocado_at,persona:personas(nombre)&limit=1`,
  );
  const fila = Array.isArray(r.json) ? r.json[0] : undefined;
  if (!fila || fila.revocado_at) return null;
  return { persona_id: fila.persona_id, nombre: fila.persona?.nombre ?? null };
}

/**
 * Lo que el portal enseña.
 *
 * Filtra `visible` en SQL; lo de la fecha futura lo hace `estrategiasParaCliente`
 * en el lib puro, que es donde se puede probar.
 */
export async function estrategiasVisiblesDeCliente(personaId: string): Promise<EstrategiaPortal[]> {
  const r = await rest<EstrategiaPortal[]>(
    "GET",
    `estrategias?persona_id=eq.${encodeURIComponent(personaId)}&visible=is.true` +
      `&select=${CAMPOS_PORTAL}&order=fecha_lanzamiento.desc`,
  );
  return Array.isArray(r.json) ? r.json : [];
}

/**
 * Deja constancia de que el cliente entró.
 *
 * Es lo único que hoy no se sabe de ninguna estrategia: si llegó a abrirla. Se
 * hace sin `await` bloqueante desde la página y se ignora el fallo a
 * propósito — que no se pueda escribir la marca no es motivo para dejar al
 * cliente sin ver su estrategia.
 */
export async function marcarAcceso(personaId: string): Promise<void> {
  try {
    await rest(
      "PATCH",
      `portal_accesos?persona_id=eq.${encodeURIComponent(personaId)}`,
      { ultimo_acceso_at: new Date().toISOString() },
      "return=minimal",
    );
  } catch {
    /* la marca es telemetría, no parte del servicio */
  }
}

/** Los clientes del selector: activos, y cuántas estrategias llevan. */
export async function clientesParaSelector(): Promise<ClienteOpcion[]> {
  const [personas, estrategias] = await Promise.all([
    rest<{ id: string; nombre: string | null }[]>(
      "GET",
      "personas?estado=eq.cliente&select=id,nombre&order=nombre.asc&limit=500",
    ),
    rest<{ persona_id: string }[]>("GET", "estrategias?select=persona_id&limit=2000"),
  ]);
  const cuenta = new Map<string, number>();
  for (const e of Array.isArray(estrategias.json) ? estrategias.json : []) {
    cuenta.set(e.persona_id, (cuenta.get(e.persona_id) ?? 0) + 1);
  }
  return (Array.isArray(personas.json) ? personas.json : [])
    .filter((p) => (p.nombre ?? "").trim())
    .map((p) => ({ id: p.id, nombre: (p.nombre ?? "").trim(), tiene: cuenta.get(p.id) ?? 0 }));
}

/**
 * El KPI naranja: clientes activos CON programa vigente y SIN ninguna estrategia.
 *
 * Es la razón de que esto sea un módulo propio y no una sección de la ficha —
 * dentro de la ficha este número no existe, porque sólo miras un cliente cada
 * vez. `v_programa_activo` es la misma vista que usa /clientes.
 */
// `mes` llega de fuera ("2026-08") y no se calcula aquí a propósito: esto corre
// en Vercel, que va en UTC, y `toISOString()` a las 00:30 de Madrid devuelve el
// día —y a veces el mes— anterior. La página calcula la fecha en Europe/Madrid
// una sola vez y la baja, igual que hace /sesiones y /cuotas.
export async function kpis(mes: string): Promise<{
  publicadas: number;
  esteMes: number;
  sinEstrategia: number;
  conPrograma: number;
}> {
  const [todas, activos, programas] = await Promise.all([
    rest<{ persona_id: string; fecha_lanzamiento: string; visible: boolean }[]>(
      "GET",
      "estrategias?select=persona_id,fecha_lanzamiento,visible&limit=2000",
    ),
    rest<{ id: string }[]>("GET", "personas?estado=eq.cliente&select=id&limit=500"),
    rest<{ persona_id: string }[]>("GET", "v_programa_activo?select=persona_id&limit=500"),
  ]);

  const filas = Array.isArray(todas.json) ? todas.json : [];
  const conEstrategia = new Set(filas.map((e) => e.persona_id));
  const idsActivos = new Set((Array.isArray(activos.json) ? activos.json : []).map((p) => p.id));
  const conPrograma = (Array.isArray(programas.json) ? programas.json : [])
    .map((p) => p.persona_id)
    .filter((id) => idsActivos.has(id));

  return {
    publicadas: filas.filter((e) => e.visible).length,
    esteMes: filas.filter((e) => (e.fecha_lanzamiento ?? "").startsWith(mes)).length,
    sinEstrategia: conPrograma.filter((id) => !conEstrategia.has(id)).length,
    conPrograma: conPrograma.length,
  };
}
