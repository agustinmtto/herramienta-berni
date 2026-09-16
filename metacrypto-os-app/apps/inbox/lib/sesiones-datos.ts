// ============================================================
// Lecturas del módulo de servicio (server-only). Todo sale de las vistas de la
// migración 0036 — aquí no se calcula nada, sólo se trae: el número de sesión,
// el cupo y el reparto por coach los deriva la base.
// ============================================================
import "server-only";
import { rest } from "@/lib/supabase";
import type { EstadoAsistencia } from "@/lib/servicio";
import type { ReglaRecurrente } from "@/lib/recurrentes";

export type SesionRow = {
  id: string;
  persona_id: string | null;
  cliente: string | null;
  coach_id: string | null;
  coach: string | null;
  fecha: string;
  dia: string;
  tipo: string;
  estado_asistencia: EstadoAsistencia;
  notas: string | null;
  url_grabacion: string | null;
  enlace: string | null;
  duracion_min: number | null;
  capital_total: number | null;
  exchange: string | null;
  proximo_paso: string | null;
  de_ghl: boolean;
  tier: string | null;
  numero: number | null;
};

export type OperacionRow = {
  id: string;
  sesion_id: string;
  orden: number;
  direccion: "short" | "long" | "spot" | "etfs" | "esperar";
  activo: string | null;
  capital: number | null;
  apalancamiento: string | null;
  zona_entrada: string | null;
  objetivo: string | null;
  estado: "ejecutada" | "ordenes_puestas" | "planificada" | null;
};

export type CupoRow = {
  persona_id: string;
  cliente: string | null;
  tier: string | null;
  incluidas_tier: number | null;
  incluidas: number | null;
  ajustado: boolean;
  hechas: number;
  sin_registrar: number;
  pendientes: number | null;
  ultima: string | null;
  // Columnas añadidas por la migración 0048 (van al final de la vista).
  bonos: string[] | null;
  extra_bonos: number;
  // Añadida por la 0066: por qué `ajustado` es true. Ver
  // `MOTIVO_CONGELADO_CATALOGO` en lib/servicio.ts. `null` cuando `ajustado`
  // es false. Opcional (no `null`) a propósito: hasta que la 0066 esté
  // aplicada, la vista real no trae esta clave y el JSON la omite —
  // `undefined`, no `null`. Tipar esto como obligatorio mentiría durante la
  // ventana entre desplegar este código y aplicar la migración.
  ajuste_motivo?: string | null;
};

export type RepartoRow = {
  persona_id: string;
  coach_id: string | null;
  coach: string | null;
  hechas: number;
};

const CAMPOS_SESION =
  "id,persona_id,cliente,coach_id,coach,fecha,dia,tipo,estado_asistencia,notas," +
  "url_grabacion,enlace,duracion_min,capital_total,exchange,proximo_paso,de_ghl,tier,numero";

// El histórico: sólo lo que ya pasó. Lo de más adelante va en `proximasSesiones`,
// que es otra pantalla y otra intención.
//
// Sin límite a propósito: son 109 filas y crecen a razón de ~15 al mes. Paginar
// esto hoy sería añadir un control que nadie necesita durante los próximos años,
// y el filtrado por cliente/coach se hace en el navegador sobre el conjunto ya
// cargado, que es instantáneo.
export async function historicoSesiones(): Promise<SesionRow[]> {
  const r = await rest(
    "GET",
    `v_sesiones_cliente?select=${CAMPOS_SESION}&fecha=lt.${new Date().toISOString()}&order=fecha.desc`,
  );
  return (r.json as SesionRow[]) ?? [];
}

export async function proximasSesiones(): Promise<SesionRow[]> {
  const r = await rest(
    "GET",
    `v_sesiones_cliente?select=${CAMPOS_SESION}&fecha=gte.${new Date().toISOString()}&order=fecha.asc`,
  );
  return (r.json as SesionRow[]) ?? [];
}

// La bandeja: citas de GoHighLevel cuyo contacto no cruzó con `personas`.
// `persona_id` es opcional desde la 0025 para no perderlas, pero sin esta
// consulta no aparecen en ninguna pantalla y se acumulan invisibles.
export async function sesionesSinCliente(): Promise<SesionRow[]> {
  const r = await rest(
    "GET",
    `v_sesiones_cliente?select=${CAMPOS_SESION}&persona_id=is.null&order=fecha.desc`,
  );
  return (r.json as SesionRow[]) ?? [];
}

export async function sesionesDeCliente(personaId: string): Promise<SesionRow[]> {
  const r = await rest(
    "GET",
    `v_sesiones_cliente?select=${CAMPOS_SESION}&persona_id=eq.${personaId}&order=fecha.asc`,
  );
  return (r.json as SesionRow[]) ?? [];
}

// El cupo de todos los clientes QUE TIENEN SESIONES. La vista incluye a las 180
// personas (para que la ficha de un cliente sin sesiones también pueda leer su
// cupo), pero la pestaña "Por cliente" enseña consumo: una lista con 105 filas
// a cero es ruido que esconde las que importan.
export async function cupoClientes(): Promise<CupoRow[]> {
  const r = await rest(
    "GET",
    "v_consultorias_cliente?select=*&or=(hechas.gt.0,sin_registrar.gt.0)&order=ultima.desc.nullslast",
  );
  return (r.json as CupoRow[]) ?? [];
}

export async function cupoDeCliente(personaId: string): Promise<CupoRow | null> {
  const r = await rest("GET", `v_consultorias_cliente?select=*&persona_id=eq.${personaId}`);
  return ((r.json as CupoRow[]) ?? [])[0] ?? null;
}

// El reparto Berni/Manuel de cada cliente. Sale agrupado por coach desde la
// base (v_sesiones_por_coach), sin nombres escritos en el SQL: un tercer coach
// aparece solo.
export async function repartoPorCoach(): Promise<RepartoRow[]> {
  const r = await rest("GET", "v_sesiones_por_coach?select=*");
  return (r.json as RepartoRow[]) ?? [];
}

export async function operacionesDeSesiones(sesionIds: string[]): Promise<OperacionRow[]> {
  if (sesionIds.length === 0) return [];
  const lista = sesionIds.join(",");
  const r = await rest(
    "GET",
    `sesion_operaciones?select=*&sesion_id=in.(${lista})&order=sesion_id,orden`,
  );
  return (r.json as OperacionRow[]) ?? [];
}

// Para el buscador del formulario y el de la bandeja. Sólo id y nombre: es un
// selector, no una ficha.
export async function clientesParaSelector(): Promise<{ id: string; nombre: string }[]> {
  const r = await rest("GET", "personas?select=id,nombre&order=nombre.asc");
  return (r.json as { id: string; nombre: string }[]) ?? [];
}

export async function coaches(): Promise<{ id: string; nombre: string }[]> {
  // Los coaches son quienes tienen sesiones asignadas hoy (Berni y Manuel).
  // Se leen de `team_members` para que dar de alta a un tercero no exija tocar
  // código, igual que hace v_sesiones_por_coach.
  const r = await rest("GET", "team_members?select=id,nombre&order=nombre.asc");
  return (r.json as { id: string; nombre: string }[]) ?? [];
}

// Las sesiones grupales fijas de la semana (0053) y su configuración de aviso.
// `import type` a propósito: la forma de la fila la define lib/recurrentes.ts,
// que es lógica pura con tests.
export async function reglasRecurrentes(): Promise<ReglaRecurrente[]> {
  const r = await rest(
    "GET",
    "sesiones_recurrentes?select=*&order=dia_semana.asc,creada_at.asc",
  );
  return (r.json as ReglaRecurrente[]) ?? [];
}

// A cuántos clientes saldría hoy el aviso con la audiencia "todos" (clientes
// activos con teléfono). Se enseña en el panel ANTES de activar nada: quien
// enciende el aviso tiene que saber que está apuntando a ~98 personas y que
// la cuenta de WhatsApp va en TIER_250.
export async function tamanoAudiencia(): Promise<number> {
  const r = await rest(
    "GET",
    "personas?estado=eq.cliente&telefono_e164=not.is.null&select=id",
  );
  return Array.isArray(r.json) ? r.json.length : 0;
}
