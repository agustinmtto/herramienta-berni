// ============================================================
// Lecturas del MetaCrypto OS (server-only). PostgREST + embeds por FK.
// Fuente de verdad = backend Supabase (L1 poblada), NO el prototipo.
// ============================================================
import "server-only";
import { rest } from "@/lib/supabase";
import { resolveAutorNombre } from "@/lib/format";
import { soloDigitos } from "@/lib/telefono";
import { BIENVENIDA_PLANTILLA } from "@/lib/bienvenida";
import { entraEnCierre, ajusteDeDevolucion, type PagoAtribuido } from "@/lib/comisiones";
import { ordenarTiersPorPrecio } from "@/lib/venta-form";
import type {
  EstadoAtencion,
  ConversationRow,
  MessageRow,
  TeamMember,
  GastoRow,
  Contacto,
  AbonoRow,
  CuotaDetalle,
  DevolucionFila,
  EfectoDevolucion,
  AjusteMes,
  CobroElegible,
  ProgramaElegible,
} from "@/lib/types";
import type { EventoTimeline } from "@/lib/timeline";
import type {
  ProgramaFicha, PagoFicha, CuotaFicha, SesionFicha,
} from "@/lib/ficha-cliente";
import type { Semana, PagoSemana, VentaSemana } from "@/lib/semana";
import type { DatosInicio as InicioDatos } from "@/lib/inicio";

// Reexport para consumidores de servidor que importan tipos desde "@/lib/data".
export type {
  EstadoAtencion,
  ConversationRow,
  MessageRow,
  TeamMember,
  GastoRow,
  Contacto,
  AbonoRow,
  CuotaDetalle,
  DevolucionFila,
  EfectoDevolucion,
  AjusteMes,
  CobroElegible,
  ProgramaElegible,
} from "@/lib/types";
export type { Semana, PagoSemana, VentaSemana } from "@/lib/semana";
export type { DatosInicio } from "@/lib/inicio";

const CONV_SELECT =
  "id,telefono_e164,estado,estado_atencion,tier,coach_asignado,ultimo_mensaje_at,persona:personas(nombre,estado),coach:team_members(nombre)";

export async function getConversations(filter?: EstadoAtencion): Promise<ConversationRow[]> {
  const f = filter ? `&estado_atencion=eq.${filter}` : "";
  const r = await rest<ConversationRow[]>(
    "GET",
    `wa_conversaciones?select=${CONV_SELECT}${f}&order=ultimo_mensaje_at.desc.nullslast&limit=200`,
  );
  const convs = r.json ?? [];
  const [team, autoresPorConv] = await Promise.all([
    getTeamMembers(),
    getUltimosAutoresSalientes(convs.map((c) => c.id)),
  ]);
  return convs.map((c) => ({
    ...c,
    ultimo_autor: autoresPorConv.has(c.id)
      ? resolveAutorNombre(autoresPorConv.get(c.id) ?? null, team)
      : null,
  }));
}

// Autor (id de team_member, sin resolver) del último mensaje saliente de cada conversación
// del set dado. Una sola consulta acotada a esos ids (en chunks si son muchos), agrupada en
// JS: se pide ordenado por conversacion_id asc + sent_at desc, así el primer registro de cada
// grupo es el más reciente → evita N+1 sin depender de una vista nueva en Supabase.
// Conversaciones sin ningún saliente simplemente no aparecen en el Map (autor "sin resolver").
async function getUltimosAutoresSalientes(convIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (convIds.length === 0) return map;
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < convIds.length; i += CHUNK) chunks.push(convIds.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map((ids) =>
      rest<{ conversacion_id: string; autor: string | null }[]>(
        "GET",
        `wa_mensajes?conversacion_id=in.(${ids.join(",")})&direction=eq.out&select=conversacion_id,autor&order=conversacion_id.asc,sent_at.desc&limit=5000`,
      ),
    ),
  );
  for (const r of results) {
    for (const row of r.json ?? []) {
      if (!map.has(row.conversacion_id)) map.set(row.conversacion_id, row.autor);
    }
  }
  return map;
}
export async function getConversation(id: string): Promise<ConversationRow | null> {
  const r = await rest<ConversationRow[]>(
    "GET",
    `wa_conversaciones?id=eq.${id}&select=${CONV_SELECT}&limit=1`,
  );
  return r.json?.[0] ?? null;
}
export async function getMessages(convId: string): Promise<MessageRow[]> {
  const r = await rest<MessageRow[]>(
    "GET",
    `wa_mensajes?conversacion_id=eq.${convId}&select=id,direction,body,tipo,autor,status,sent_at,media_path,media_mime,media_filename,caption,transcript,reaccion_emoji&order=sent_at.asc&limit=500`,
  );
  return r.json ?? [];
}
// Último mensaje ENTRANTE de la conversación (para calcular la ventana de 24h de Meta).
export async function getUltimoEntranteAt(convId: string): Promise<string | null> {
  const r = await rest<{ sent_at: string }[]>(
    "GET",
    `wa_mensajes?conversacion_id=eq.${convId}&direction=eq.in&select=sent_at&order=sent_at.desc&limit=1`,
  );
  return r.json?.[0]?.sent_at ?? null;
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const r = await rest<TeamMember[]>(
    "GET",
    "team_members?activo=eq.true&select=id,nombre,rol,cobra_comision&order=nombre.asc",
  );
  return r.json ?? [];
}

/* ---------------- Conteos (para nav + KPIs) ---------------- */
// PostgREST devuelve el total en el header Content-Range con Prefer: count=exact.
async function countOf(path: string): Promise<number> {
  const r = await rest("GET", `${path}&limit=1`, undefined, "count=exact");
  // rest() no expone headers; fallback: pedimos solo ids y contamos si el total es pequeño.
  return r.json?.length ?? 0;
}

export type OsCounts = {
  clientes: number;
  cuotasPendientes: number;
  inboxPendientes: number;
  sesionesSinRegistrar: number;
};
export async function getCounts(): Promise<OsCounts> {
  const [cli, cuo, inbox, ses] = await Promise.all([
    rest<{ id: string }[]>("GET", "personas?select=id&estado=eq.cliente"),
    rest<{ id: string }[]>("GET", "cuotas_programadas?select=id&estado=eq.pendiente"),
    rest<{ id: string }[]>("GET", "wa_conversaciones?select=id&estado_atencion=eq.pendiente"),
    // Sesiones que YA PASARON y nadie cerró. Es el número que el módulo de
    // servicio existe para llevar a cero, así que va en el menú: escondido en
    // la página sólo lo vería quien ya entró a mirar.
    rest<{ id: string }[]>(
      "GET",
      `sesiones?select=id&estado_asistencia=is.null&fecha=lt.${new Date().toISOString()}`,
    ),
  ]);
  return {
    clientes: cli.json?.length ?? 0,
    cuotasPendientes: cuo.json?.length ?? 0,
    inboxPendientes: inbox.json?.length ?? 0,
    sesionesSinRegistrar: ses.json?.length ?? 0,
  };
}

/* ---------------- Finanzas ---------------- */
export type PnlRow = { mes: string; ingresos: number; gastos: number; profit: number };
// `cash_collected` son EUROS (lo firmado) y `cash_usd` DÓLARES (lo que entró
// de verdad). Desde la migración 0040 las pantallas enseñan el dólar — es lo
// que pidió Berni — pero el euro se conserva para cuadrar contra Airtable.
// `n_sin_usd` > 0 significa que el total en dólares está INCOMPLETO.
export type CashRow = {
  mes: string;
  divisa: string;
  cash_collected: number;
  cash_usd: number | null;
  n_pagos: number;
  n_sin_usd: number;
};
export type CashToBe = { divisa: string; cash_to_be_collected: number; n_cuotas: number };
export type FlujoRow = { mes: string; divisa: string; por_cobrar: number; n_cuotas: number };

export async function getPnl(): Promise<PnlRow[]> {
  const r = await rest<PnlRow[]>("GET", "v_pnl_mensual?order=mes.desc&limit=18");
  return r.json ?? [];
}
export async function getCashCollected(): Promise<CashRow[]> {
  const r = await rest<CashRow[]>("GET", "v_cash_collected?order=mes.desc&limit=18");
  return r.json ?? [];
}
export async function getCashToBe(): Promise<CashToBe[]> {
  const r = await rest<CashToBe[]>("GET", "v_cash_to_be_collected");
  return r.json ?? [];
}
export async function getFlujoFuturo(): Promise<FlujoRow[]> {
  const r = await rest<FlujoRow[]>("GET", "v_flujo_caja_futuro?order=mes.asc");
  return r.json ?? [];
}

export type PagoRow = {
  id: string;
  fecha: string;
  tipo: string | null;
  tipo_detalle: string | null;
  monto: number;
  divisa: string;
  usd_recibido: number | null;
  comprobante_path: string | null;
  // `id` se embebe para poder enlazar cada pago con la ficha del cliente
  // desde Inicio y desde /ingresos.
  persona: { id: string; nombre: string | null } | null;
};
export async function getPagos(limit = 60): Promise<PagoRow[]> {
  const r = await rest<PagoRow[]>(
    "GET",
    `pagos?select=id,fecha,tipo,tipo_detalle,monto,divisa,usd_recibido,comprobante_path,persona:personas(id,nombre)&order=fecha.desc&limit=${limit}`,
  );
  return r.json ?? [];
}

// Filas crudas de una semana: pagos por fecha de cobro y programas por fecha
// de inicio. La agregación no ocurre aquí — vive en lib/semana.ts, que es
// puro y testeable.
//
// Igual que getCuotasDetalle(), ninguna de las dos lecturas degrada a `[]`:
// son la fuente de la verdad de un reporte de ventas y un cero silencioso es
// una mentira que alguien podría terminar mandando a Berni.
export async function getSemana(
  s: Semana,
): Promise<{ pagos: PagoSemana[]; ventas: VentaSemana[] }> {
  const [pagosR, ventasR] = await Promise.all([
    rest<any[]>(
      "GET",
      `pagos?fecha=gte.${s.desde}&fecha=lte.${s.hasta}` +
        "&select=id,fecha,tipo,tipo_detalle,monto,usd_recibido,persona:personas(id,nombre)" +
        "&order=fecha.asc&limit=500",
    ),
    rest<any[]>(
      "GET",
      `programas?fecha_inicio=gte.${s.desde}&fecha_inicio=lte.${s.hasta}` +
        "&select=id,fecha_inicio,motivo,tier,monto,persona:personas(id,nombre)" +
        "&order=fecha_inicio.asc&limit=500",
    ),
  ]);

  const exigirArray = (r: { json: unknown }, qué: string): any[] => {
    if (!Array.isArray(r.json)) {
      throw new Error(
        `No se pudieron leer ${qué} de la semana: ` +
          `${(r.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
      );
    }
    return r.json;
  };

  // PostgREST puede devolver `numeric` como cadena; Number() lo normaliza
  // igual que el resto de lecturas de este archivo. `programas.monto` es
  // nullable en el esquema, así que un programa sin precio cuenta como 0
  // en facturación en vez de envenenar la suma con NaN.
  return {
    // `usd_recibido` conserva el null (no pasa por Number(), que lo haría 0):
    // un cero silencioso bajaría el cash del reporte sin decir que falta el
    // dato. resumenSemana lo cuenta aparte en `nSinUsd`.
    pagos: exigirArray(pagosR, "los pagos").map((p) => ({
      ...p,
      monto: Number(p.monto),
      usd_recibido: p.usd_recibido == null ? null : Number(p.usd_recibido),
    })),
    ventas: exigirArray(ventasR, "las ventas").map((v) => ({ ...v, monto: Number(v.monto ?? 0) })),
  };
}

export type CuotaRow = {
  fecha_vencimiento: string;
  numero_cuota: number | null;
  monto: number;
  divisa: string;
  fecha_inferida: boolean;
  programa: { persona: { nombre: string | null; telefono_e164: string | null } | null } | null;
};
export async function getCuotasPendientes(): Promise<CuotaRow[]> {
  const r = await rest<CuotaRow[]>(
    "GET",
    "cuotas_programadas?estado=eq.pendiente&select=fecha_vencimiento,numero_cuota,monto,divisa,fecha_inferida,programa:programas(persona:personas(nombre,telefono_e164))&order=fecha_vencimiento.asc&limit=200",
  );
  return r.json ?? [];
}

// Cuotas (pendientes y pagadas recientes) con sus abonos ya recibidos.
// Dos consultas y un join en JS: PostgREST no embebe pagos por cuota_id sin
// una FK inversa declarada, y el volumen es pequeño (decenas de filas).
//
// rest() no distingue éxito de error por status: si una consulta falla, el
// body de error de PostgREST es un objeto (no un array) pero tampoco es
// null/undefined, así que un `?? []` lo deja pasar tal cual y el for/map de
// abajo revienta con un TypeError. Por eso cada resultado se valida con
// Array.isArray() — pero deliberadamente NO igual para los tres:
// cuotasR es la fuente de la verdad del dinero (ver el throw más abajo),
// pagosR/audR son enriquecimiento y degradan a `[]` vía orEmpty().
export async function getCuotasDetalle(): Promise<CuotaDetalle[]> {
  // Enriquecimiento (abonos, autor del último cambio): si la consulta falló,
  // seguir con "sin datos" en vez de reventar toda la función. cuotasR NO usa
  // este helper — ver el comentario junto a su throw, más abajo.
  const orEmpty = (json: unknown): any[] => (Array.isArray(json) ? json : []);

  const [cuotasR, pagosR, audR] = await Promise.all([
    rest<any[]>(
      "GET",
      "cuotas_programadas?select=id,programa_id,numero_cuota,fecha_vencimiento,monto,divisa,estado,fecha_inferida,programa:programas(persona_id,persona:personas(nombre))&order=fecha_vencimiento.asc&limit=500",
    ),
    rest<any[]>(
      "GET",
      "pagos?tipo=eq.cuota&cuota_id=not.is.null&select=id,cuota_id,monto,fecha,comprobante_path&order=fecha.asc&limit=1000",
    ),
    // Ordenado por entidad_id + created_at desc: el primero de cada grupo es
    // el cambio más reciente, así que basta con quedarse con ese (mismo truco
    // que getUltimosAutoresSalientes, sin N+1 ni vista nueva).
    rest<any[]>(
      "GET",
      "auditoria?entidad=eq.cuota&select=entidad_id,accion,created_at,datos,autor:team_members(nombre)&order=entidad_id.asc,created_at.desc&limit=2000",
    ),
  ]);
  if (!Array.isArray(cuotasR.json)) {
    // A diferencia de pagosR/audR, cuotasR NO degrada a `[]`: esta es la
    // fuente de la verdad del dinero. Devolver `[]` aquí mostraría "no hay
    // cuotas pendientes" cuando en realidad la lectura falló — en un
    // dashboard financiero esa es una mentira que alguien podría terminar
    // accionando. Preferimos un error visible (con el mensaje de PostgREST,
    // para que quede en logs) a un silencio que parece "todo al día".
    throw new Error(
      `No se pudieron leer las cuotas: ${(cuotasR.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  const porCuota = new Map<string, AbonoRow[]>();
  for (const p of orEmpty(pagosR.json)) {
    const arr = porCuota.get(p.cuota_id) ?? [];
    arr.push({ id: p.id, monto: Number(p.monto), fecha: p.fecha, comprobante_path: p.comprobante_path });
    porCuota.set(p.cuota_id, arr);
  }
  const ultimo = new Map<
    string,
    { autor: string | null; accion: string; created_at: string; motivo: string | null }
  >();
  for (const a of orEmpty(audR.json)) {
    if (!ultimo.has(a.entidad_id)) {
      ultimo.set(a.entidad_id, {
        autor: a.autor?.nombre ?? null, accion: a.accion, created_at: a.created_at,
        // Solo lo escriben las anulaciones; en el resto de acciones es null.
        motivo: typeof a.datos?.motivo === "string" ? a.datos.motivo : null,
      });
    }
  }
  return cuotasR.json.map((c) => ({
    id: c.id,
    programa_id: c.programa_id,
    numero_cuota: c.numero_cuota,
    fecha_vencimiento: c.fecha_vencimiento,
    monto: Number(c.monto),
    divisa: c.divisa,
    estado: c.estado,
    fecha_inferida: !!c.fecha_inferida,
    persona_id: c.programa?.persona_id ?? null,
    persona_nombre: c.programa?.persona?.nombre ?? null,
    abonos: porCuota.get(c.id) ?? [],
    ultimo_cambio: ultimo.get(c.id) ?? null,
  }));
}

export async function getGastos(): Promise<GastoRow[]> {
  const r = await rest<GastoRow[]>(
    "GET",
    "gastos?select=id,concepto,categoria,monto,divisa,fecha,tipo_gasto,metodo_pago,notas&order=fecha.desc&limit=500",
  );
  return r.json ?? [];
}

// Clientes contactables (con teléfono) para el picker de "Nuevo mensaje".
export async function getContactables(): Promise<Contacto[]> {
  const r = await rest<Contacto[]>(
    "GET",
    "personas?telefono_e164=not.is.null&select=id,nombre,telefono_e164,estado&order=nombre.asc&limit=1000",
  );
  return r.json ?? [];
}

// P&L nativo en USD: ingresos = usd_recibido de pagos; gastos = gastos.monto
// (los gastos de Berni están en USD). Evita mezclar EUR/USD.
export type PnlUsdRow = { mes: string; ingresos: number; gastos: number; profit: number };
export async function getPnlUsd(): Promise<PnlUsdRow[]> {
  const [pagosR, gastosR] = await Promise.all([
    rest<{ usd_recibido: number | null; fecha: string }[]>("GET", "pagos?select=usd_recibido,fecha&limit=2000"),
    rest<{ monto: number; fecha: string }[]>("GET", "gastos?select=monto,fecha&limit=2000"),
  ]);
  const ing: Record<string, number> = {};
  const gas: Record<string, number> = {};
  for (const p of pagosR.json ?? []) {
    if (p.usd_recibido != null) {
      const m = p.fecha.slice(0, 7);
      ing[m] = (ing[m] ?? 0) + Number(p.usd_recibido);
    }
  }
  for (const g of gastosR.json ?? []) {
    const m = g.fecha.slice(0, 7);
    gas[m] = (gas[m] ?? 0) + Number(g.monto);
  }
  const meses = Array.from(new Set([...Object.keys(ing), ...Object.keys(gas)])).sort().reverse();
  return meses.map((m) => ({
    mes: `${m}-01`,
    ingresos: ing[m] ?? 0,
    gastos: gas[m] ?? 0,
    profit: (ing[m] ?? 0) - (gas[m] ?? 0),
  }));
}

/* ---------------- Clientes ---------------- */
export type ClienteRow = {
  id: string;
  nombre: string | null;
  pais: string | null;
  estado: string;
  telefono_e164: string | null;
  divisa_preferida: string;
  coach: { nombre: string } | null;
  tier: string | null;
  fecha_inicio: string | null;
  // Fin efectivo del programa activo (inicio + duración + días de freeze,
  // ya calculado por la vista) — CL-3, columna "Fin de programa". Null en un
  // programa sin duración de catálogo (p.ej. un vitalicio OG).
  fecha_fin: string | null;
  created_at: string;
  // true = tiene al menos una compra nueva (la bienvenida no aplica a
  // ascensiones ni extensiones, ver programas.motivo).
  tiene_compra_nueva: boolean;
  // true = ya se le mandó la plantilla bienvenida_club_es, cruzado por
  // teléfono del hilo de WhatsApp.
  bienvenida_enviada: boolean;
  // Landing más reciente publicada (CL-1). Null si no tiene ninguna visible
  // — un cliente puede tener varias; se linkea siempre a la última.
  landing_url: string | null;
};
export async function getClientes(): Promise<ClienteRow[]> {
  const [personasR, activosR, compraR, bienvR, landingR] = await Promise.all([
    rest<any[]>(
      "GET",
      "personas?select=id,nombre,pais,estado,telefono_e164,divisa_preferida,coach:team_members(nombre),created_at&order=created_at.desc&limit=500",
    ),
    rest<{ persona_id: string; tier: string; fecha_inicio: string; fin_efectiva: string | null }[]>(
      "GET",
      "v_programa_activo?select=persona_id,tier,fecha_inicio,fin_efectiva",
    ),
    // Personas con al menos una compra nueva (la bienvenida no aplica a
    // ascensiones ni extensiones).
    rest<{ persona_id: string }[]>(
      "GET",
      "programas?motivo=eq.nueva_venta&select=persona_id&limit=2000",
    ),
    // Bienvenidas ya enviadas, por teléfono del hilo (clave canónica desde 0020).
    // Constante importada, no el literal a mano: si `BIENVENIDA_PLANTILLA`
    // cambiara (p. ej. una v2 de la plantilla) y aquí quedara el string
    // suelto, el envío escribiría un nombre y esta consulta buscaría otro —
    // todos los clientes quedarían marcados como pendientes para siempre.
    // `order` estable porque, a diferencia de `programas` (truncar de menos
    // es inocuo), truncar esta consulta de más provoca reenvíos reales.
    rest<{ conversacion: { telefono_e164: string } | null }[]>(
      "GET",
      `wa_mensajes?plantilla_nombre=eq.${BIENVENIDA_PLANTILLA}` +
        "&select=conversacion:wa_conversaciones!inner(telefono_e164)" +
        "&order=sent_at.desc&limit=2000",
    ),
    // Un cliente puede tener varias estrategias/landings: se linkea siempre
    // a la más reciente que esté visible. Ordenada desc, así que el primer
    // `persona_id` que aparece en el Map ya es la que corresponde.
    rest<{ persona_id: string; url: string }[]>(
      "GET",
      "estrategias?visible=is.true&select=persona_id,url" +
        "&order=fecha_lanzamiento.desc,created_at.desc&limit=2000",
    ),
  ]);
  const activo = new Map((activosR.json ?? []).map((a) => [a.persona_id, a]));
  const conCompraNueva = new Set((compraR.json ?? []).map((p) => p.persona_id));
  const bienvenidos = new Set(
    (bienvR.json ?? []).map((m) => m.conversacion?.telefono_e164).filter(Boolean) as string[],
  );
  const landing = new Map<string, string>();
  for (const e of landingR.json ?? []) if (!landing.has(e.persona_id)) landing.set(e.persona_id, e.url);
  return (personasR.json ?? []).map((p) => ({
    ...p,
    tier: activo.get(p.id)?.tier ?? null,
    fecha_inicio: activo.get(p.id)?.fecha_inicio ?? null,
    fecha_fin: activo.get(p.id)?.fin_efectiva ?? null,
    created_at: p.created_at,
    tiene_compra_nueva: conCompraNueva.has(p.id),
    bienvenida_enviada: bienvenidos.has(soloDigitos(p.telefono_e164)),
    landing_url: landing.get(p.id) ?? null,
  }));
}

// ---- Formulario Nueva venta ----
export type ClienteOption = {
  id: string; nombre: string | null; estado: string; email: string | null;
  // Se expone para que el form avise de duplicados por teléfono antes de enviar
  // (el RPC deduplica igualmente, pero el aviso evita la sorpresa).
  telefono_e164: string | null;
};
export async function getClientesParaVenta(): Promise<ClienteOption[]> {
  const r = await rest<ClienteOption[]>(
    "GET",
    "personas?select=id,nombre,estado,email,telefono_e164&order=nombre.asc&limit=2000",
  );
  return r.json ?? [];
}

export type TierOption = { id: string; nombre: string; meses_default: number | null };
export async function getTiersVendibles(): Promise<TierOption[]> {
  const r = await rest<TierOption[]>(
    "GET",
    "tiers?activo=is.true&id=neq.OG&select=id,nombre,meses_default&order=id.asc",
  );
  // `order=id.asc` ordena TEXTO (la columna es `text`), y PostgREST no admite
  // expresiones ni casts en `order=`: solo nombres de columna. Con el catálogo
  // 2026 eso dejaba el 10.000 € en el segundo puesto del desplegable, pegado
  // al de 1.000 €. Se ordena por precio aquí, ya con las filas en memoria.
  // El `order=id.asc` se queda para que el resultado sea estable (misma
  // entrada, misma salida) pase lo que pase con el orden físico de la tabla.
  return ordenarTiersPorPrecio(r.json ?? []);
}

// ---- Bandeja de atribución pendiente (Task 7) ----
export type VentaSinAtribuir = {
  id: string;
  persona_id: string;
  persona_nombre: string;
  // CRÍTICO: sin esto, la bandeja solo puede resolver por `personaId` — y
  // solo 5 de 179 personas tienen `ghl_contact_id`. `/api/ghl/citas` sabe
  // encadenar al fallback de email/teléfono (igual que hace VentaForm para
  // una compra nueva), pero necesita que ALGUIEN se lo pase. Sin estos dos
  // campos, 16 de las 21 ventas relevantes del cierre no tienen forma de
  // cruzar con GHL y la única opción visible es "no vino de agenda" — que
  // sella `atribucion_at` con todo null, de forma IRREVERSIBLE (nada lee
  // `atribucion_at is not null`, ver `getVentasAtribuidas`).
  persona_email: string | null;
  persona_telefono: string | null;
  tier: string;
  motivo: string;
  monto: number;
  divisa: string;
  fecha_inicio: string;
  // Por qué una venta de antes del corte sigue entrando en `relevantes`: la
  // interfaz lo usa para explicar el caso raro (venta vieja, pero con un
  // cobro futuro que sí necesita atribución) en vez de dejarlo mudo.
  tiene_cuota_pendiente: boolean;
};

// Nombrado distinto del componente `BandejaAtribucion.tsx` a propósito — son
// cosas distintas (este es el resultado de la lectura, no la UI).
export type VentasSinAtribuirBandeja = {
  // Entran en el cierre de comisiones (ver `entraEnCierre` en lib/comisiones.ts):
  // esto es lo único que debe alimentar el contador y el KPI de la página.
  relevantes: VentaSinAtribuir[];
  // Anteriores al corte y sin cuota pendiente — comisiones ya pagadas, por
  // decisión de Milo NO se recalculan. Se siguen mostrando (aparte, y
  // rotulados) para no esconder 167 ventas sin decirlo.
  historico: VentaSinAtribuir[];
};

// Ventas cuya atribución nadie ha decidido todavía (`atribucion_at is null`),
// separadas en lo que sí importa para el cierre y el histórico ya liquidado.
// Es la garantía de que el informe de comisiones del mes está completo: si
// `relevantes` está vacío, ninguna venta que todavía pueda devengar comisión
// se quedó sin decisión. Por eso, a diferencia de la mayoría de lecturas de
// este fichero, NINGUNA de las dos consultas degrada a `[]` si PostgREST
// falla — un cero silencioso aquí diría "todo atribuido" (o "todo es
// histórico") cuando en realidad no se pudo comprobar (mismo criterio que
// getCuotasDetalle/getSemana). Si no se puede saber qué cuotas están
// pendientes, tampoco se puede saber qué venta vieja es en verdad relevante.
//
// `limit` alto a propósito: el backlog histórico (188 programas verificado
// el 11-ago, ver docs/comisiones.md) es mayor que "lo de este mes" — un
// límite bajo lo truncaría en apariencia sin que de verdad estuviera resuelto.
export async function getVentasSinAtribuir(): Promise<VentasSinAtribuirBandeja> {
  const [programasR, cuotasR] = await Promise.all([
    rest<Array<Record<string, unknown>>>(
      "GET",
      "programas?atribucion_at=is.null&select=id,persona_id,tier,motivo,monto,divisa,fecha_inicio," +
        "persona:personas(nombre,email,telefono_e164)&order=fecha_inicio.desc&limit=2000",
    ),
    rest<{ programa_id: string }[]>(
      "GET",
      "cuotas_programadas?estado=eq.pendiente&select=programa_id&limit=5000",
    ),
  ]);
  if (!Array.isArray(programasR.json)) {
    throw new Error(
      `No se pudieron leer las ventas sin atribuir: ${(programasR.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  if (!Array.isArray(cuotasR.json)) {
    throw new Error(
      `No se pudieron leer las cuotas pendientes (hacen falta para saber qué ventas viejas siguen siendo relevantes): ${(cuotasR.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  const conCuotaPendiente = new Set(cuotasR.json.map((c) => c.programa_id));

  const ventas: VentaSinAtribuir[] = programasR.json.map((p) => {
    const persona = p.persona as { nombre?: string; email?: string; telefono_e164?: string } | null;
    return {
      id: String(p.id),
      persona_id: String(p.persona_id),
      persona_nombre: String(persona?.nombre ?? "—"),
      persona_email: persona?.email ?? null,
      persona_telefono: persona?.telefono_e164 ?? null,
      tier: String(p.tier),
      motivo: String(p.motivo),
      // `programas.monto` es nullable en el esquema; sin precio cuenta como 0
      // en vez de envenenar la suma del contador con NaN (mismo criterio que getSemana).
      monto: Number(p.monto ?? 0),
      divisa: String(p.divisa ?? "EUR"),
      fecha_inicio: String(p.fecha_inicio),
      tiene_cuota_pendiente: conCuotaPendiente.has(String(p.id)),
    };
  });

  const relevantes: VentaSinAtribuir[] = [];
  const historico: VentaSinAtribuir[] = [];
  for (const v of ventas) {
    const entra = entraEnCierre({ fecha_inicio: v.fecha_inicio, tieneCuotaPendiente: v.tiene_cuota_pendiente });
    (entra ? relevantes : historico).push(v);
  }
  return { relevantes, historico };
}

// ---- Fuentes por confirmar (agujero del cierre de comisiones) ----
export type FuentePorConfirmar = {
  source_id: string;
  fuente: string;
  nivel: string;
  setter_id: string | null;
  setter_nombre: string | null;
  notas: string | null;
  created_at: string;
  // "Cuánto está en juego": ventas (programas) que YA usan esta fuente, sin
  // filtrar por ATRIBUCION_CORTE — confirmar tarde no perdona la comisión de
  // una venta vieja que la esté usando. Sin este número nadie puede saber si
  // confirmar una fuente es urgente o da igual.
  ventas_n: number;
  ventas_por_divisa: { divisa: string; monto: number }[];
};

// Fuentes que `/api/ghl/citas` insertó SOLA cuando vio un Source_ID nuevo de
// GHL (confirmado=false por defecto, ver ese archivo y la migración 0028) y
// que nadie ha validado todavía. Mientras sigan así, `comisionesDePago`
// (lib/comisiones.ts) las trata como incidencia `fuente_sin_confirmar` y no
// paga ninguna comisión sobre los pagos que las usen — esta lectura es la
// que hace ese agujero visible en vez de solo detectable con una query SQL.
//
// La lectura del catálogo NO degrada a `[]` si falla (mismo criterio que
// getVentasSinAtribuir/getCuotasDetalle): un `[]` por error se vería IGUAL
// que "no hay nada pendiente", que es exactamente el cero silencioso que
// esta pantalla existe para evitar. El impacto en ventas sí degrada —es
// enriquecimiento, no la fuente de la verdad de esta lista— porque esconder
// la fuente entera por un fallo en un dato secundario sería peor.
export async function getFuentesPorConfirmar(): Promise<FuentePorConfirmar[]> {
  const r = await rest<Array<Record<string, unknown>>>(
    "GET",
    "fuentes_atribucion?confirmado=eq.false&select=source_id,fuente,nivel,setter_id,setter_nombre,notas,created_at&order=created_at.asc",
  );
  if (!Array.isArray(r.json)) {
    throw new Error(
      `No se pudieron leer las fuentes por confirmar: ${(r.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  if (r.json.length === 0) return [];

  const ids = r.json.map((f) => String(f.source_id));
  const ventasR = await rest<{ source_id: string; monto: number | null; divisa: string | null }[]>(
    "GET",
    `programas?source_id=in.(${ids.map((id) => encodeURIComponent(id)).join(",")})` +
      "&select=source_id,monto,divisa&limit=5000",
  );
  const porFuente = new Map<string, { n: number; divisas: Map<string, number> }>();
  if (Array.isArray(ventasR.json)) {
    for (const v of ventasR.json) {
      const sid = String(v.source_id);
      const acc = porFuente.get(sid) ?? { n: 0, divisas: new Map<string, number>() };
      acc.n += 1;
      const divisa = v.divisa ?? "EUR";
      acc.divisas.set(divisa, (acc.divisas.get(divisa) ?? 0) + Number(v.monto ?? 0));
      porFuente.set(sid, acc);
    }
  } else {
    console.error("[getFuentesPorConfirmar] no se pudo leer el impacto en ventas", ventasR.status, ventasR.json);
  }

  return r.json
    .map((f) => {
      const sid = String(f.source_id);
      const acc = porFuente.get(sid);
      return {
        source_id: sid,
        fuente: String(f.fuente),
        nivel: String(f.nivel),
        setter_id: f.setter_id ? String(f.setter_id) : null,
        setter_nombre: f.setter_nombre ? String(f.setter_nombre) : null,
        notas: f.notas ? String(f.notas) : null,
        created_at: String(f.created_at),
        ventas_n: acc?.n ?? 0,
        ventas_por_divisa: acc ? [...acc.divisas.entries()].map(([divisa, monto]) => ({ divisa, monto })) : [],
      };
    })
    // Más ventas en juego primero: es exactamente la señal de urgencia que
    // pide el encargo — una fuente con 0 ventas puede esperar, una con
    // varias no.
    .sort((a, b) => b.ventas_n - a.ventas_n);
}

// ---- Corrección de ventas ya atribuidas (diseño § 4.2, no construido) ----
// Sin esta lectura, `atribucion_at` es una escritura de un solo sentido:
// nada en el OS vuelve a mirar las ventas ya atribuidas, así que una cita
// equivocada (o un "no vino de agenda" pulsado por error) queda mal para
// siempre. Se acota al mismo universo que `relevantes` en
// `getVentasSinAtribuir` (`entraEnCierre`): corregir una venta de antes del
// corte y sin cuota pendiente no cambia ninguna comisión que vaya a
// pagarse — sería tocar histórico que Milo decidió no recalcular.
export type VentaAtribuida = VentaSinAtribuir & {
  source_id: string | null;
  fuente: string | null;
  setter_id: string | null;
  closer_id: string | null;
  upsell_por_id: string | null;
  ghl_appointment_id: string | null;
};

export async function getVentasAtribuidas(): Promise<VentaAtribuida[]> {
  const [programasR, cuotasR] = await Promise.all([
    rest<Array<Record<string, unknown>>>(
      "GET",
      "programas?atribucion_at=not.is.null&select=id,persona_id,tier,motivo,monto,divisa,fecha_inicio," +
        "source_id,setter_id,closer_id,upsell_por_id,ghl_appointment_id," +
        "persona:personas(nombre,email,telefono_e164),fuente_cat:fuentes_atribucion(fuente)" +
        "&order=fecha_inicio.desc&limit=2000",
    ),
    rest<{ programa_id: string }[]>(
      "GET",
      "cuotas_programadas?estado=eq.pendiente&select=programa_id&limit=5000",
    ),
  ]);
  if (!Array.isArray(programasR.json)) {
    throw new Error(
      `No se pudieron leer las ventas ya atribuidas: ${(programasR.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  if (!Array.isArray(cuotasR.json)) {
    throw new Error(
      `No se pudieron leer las cuotas pendientes: ${(cuotasR.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  const conCuotaPendiente = new Set(cuotasR.json.map((c) => c.programa_id));

  const todas: VentaAtribuida[] = programasR.json.map((p) => {
    const persona = p.persona as { nombre?: string; email?: string; telefono_e164?: string } | null;
    const fuenteCat = p.fuente_cat as { fuente?: string } | null;
    return {
      id: String(p.id),
      persona_id: String(p.persona_id),
      persona_nombre: String(persona?.nombre ?? "—"),
      persona_email: persona?.email ?? null,
      persona_telefono: persona?.telefono_e164 ?? null,
      tier: String(p.tier),
      motivo: String(p.motivo),
      monto: Number(p.monto ?? 0),
      divisa: String(p.divisa ?? "EUR"),
      fecha_inicio: String(p.fecha_inicio),
      tiene_cuota_pendiente: conCuotaPendiente.has(String(p.id)),
      source_id: p.source_id ? String(p.source_id) : null,
      fuente: fuenteCat?.fuente ?? null,
      setter_id: p.setter_id ? String(p.setter_id) : null,
      closer_id: p.closer_id ? String(p.closer_id) : null,
      upsell_por_id: p.upsell_por_id ? String(p.upsell_por_id) : null,
      ghl_appointment_id: p.ghl_appointment_id ? String(p.ghl_appointment_id) : null,
    };
  });

  // Mismo filtro que la bandeja de pendientes: solo lo que todavía puede
  // devengar comisión en el cierre actual.
  return todas.filter((v) =>
    entraEnCierre({ fecha_inicio: v.fecha_inicio, tieneCuotaPendiente: v.tiene_cuota_pendiente }),
  );
}

// ---- Informe de comisiones (Task 8) ----
export type PagoAtribuidoFila = PagoAtribuido & {
  fecha: string;
  persona_nombre: string;
  fuente: string | null;
};

// Pagos atribuidos del mes para el informe de /comisiones — el rango es
// [desde, hasta). Igual que getCuotasDetalle/getSemana/getVentasSinAtribuir:
// esta lectura es la fuente de la verdad del dinero que Berni va a pagar, así
// que NO degrada a `[]` si PostgREST falla. Un array vacío por error se vería
// idéntico a "sin pagos este mes" y el informe mostraría comisiones en cero
// en vez de un fallo — exactamente el cero silencioso que este informe existe
// para evitar.
// `programas.motivo` admite valores que la app no produce hoy
// ('downsell','reactivacion','cross_sell' — ver 0002_servicio.sql), y
// `comisionesDePago` los rechaza a propósito en compilación (motivo sin
// regla de comisión). Se normalizan aquí en vez de mentir con un `as`: un
// valor fuera de los tres que `crear_venta` sabe generar se trata como
// "sin reconocer" (null), que `comisionesDePago` ya sabe marcar como
// incidencia, en vez de reventar el informe del mes entero.
export function motivoDePago(v: unknown): PagoAtribuido["motivo"] {
  return v === "nueva_venta" || v === "upsell" || v === "renovacion" ? v : null;
}

export async function getPagosAtribuidos(
  desde: string,
  hasta: string,
): Promise<PagoAtribuidoFila[]> {
  const r = await rest<Array<Record<string, unknown>>>(
    "GET",
    `v_pagos_atribuidos?fecha=gte.${desde}&fecha=lt.${hasta}` +
      // Berni (CO-3): más reciente arriba dentro del mes.
      "&select=*&order=fecha.desc&limit=1000",
  );
  if (!Array.isArray(r.json)) {
    throw new Error(
      `No se pudieron leer los pagos atribuidos del mes: ${(r.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  return r.json.map((p) => ({
    pago_id: String(p.pago_id),
    monto: Number(p.monto),
    // `Number(null)` es 0, no NaN — y un 0 aquí sería una comisión de cero
    // calculada en silencio en vez de la incidencia `sin_usd`. El null tiene
    // que sobrevivir hasta comisionesDePago.
    usd_recibido: p.usd_recibido == null ? null : Number(p.usd_recibido),
    motivo: motivoDePago(p.motivo),
    programa_id: p.programa_id ? String(p.programa_id) : null,
    setter_id: p.setter_id ? String(p.setter_id) : null,
    closer_id: p.closer_id ? String(p.closer_id) : null,
    upsell_por_id: p.upsell_por_id ? String(p.upsell_por_id) : null,
    atribuido: Boolean(p.atribuido),
    // Un pago sin source_id (venta "sin agenda") no tiene fila en el catálogo
    // de fuentes, y eso NO es "sin confirmar": es legítimamente sin fuente
    // que confirmar.
    fuente_confirmada: p.source_id ? Boolean(p.fuente_confirmada) : true,
    fecha: String(p.fecha),
    persona_nombre: String(p.persona_nombre ?? "—"),
    fuente: p.fuente ? String(p.fuente) : null,
  }));
}

// ---- Ficha del cliente + línea temporal ----
export type FichaCliente = {
  id: string;
  nombre: string | null;
  estado: string;
  telefono_e164: string | null;
  pais: string | null;
  tier: string | null;
  coach: string | null;
  // `email` y `coach_id` no se pintan en la cabecera: existen porque el modal
  // de edición (0039) necesita saber el valor ACTUAL de cada campo para
  // mandar solo lo que cambia. Ver prepararEdicion() en lib/persona.ts.
  email: string | null;
  coach_id: string | null;
  // El programa activo y sus bonos: los necesita el bloque de "Bonos del
  // evento" de la ficha, que es por donde se corrige una venta ya registrada.
  programa_id: string | null;
  bonos: string[];
  // La duración de catálogo del tier, SIN bonos. Es la base del +50 % y lo que
  // el bloque de bonos necesita para decir "pasa de 12 a 18" en vez de una
  // cifra fija. Null en un vitalicio (OG), donde el bono no se ofrece.
  meses_tier: number | null;
};

export async function getFichaCliente(personaId: string): Promise<FichaCliente | null> {
  // Validar que personaId sea un UUID válido para evitar anomalías en la ruta PostgREST.
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) return null;

  const [personaR, activoR] = await Promise.all([
    rest<any[]>(
      "GET",
      `personas?id=eq.${personaId}&select=id,nombre,estado,telefono_e164,email,pais,coach_id,coach:team_members(nombre)&limit=1`,
    ),
    rest<{ tier: string; programa_id: string }[]>(
      "GET", `v_programa_activo?persona_id=eq.${personaId}&select=tier,programa_id`),
  ]);

  // Validar que la respuesta sea un array (si PostgREST rechaza, devuelve un objeto de error).
  if (!Array.isArray(personaR.json)) return null;

  const p = personaR.json[0];
  if (!p) return null;

  const activoArray = Array.isArray(activoR.json) ? activoR.json : [];
  const programaId = activoArray[0]?.programa_id ?? null;

  // Consulta aparte y no un embed: `v_programa_activo` es una vista y
  // PostgREST no sabe encadenar a `programas` sin clave foránea.
  let bonos: string[] = [];
  if (programaId) {
    const bonosR = await rest<{ bonos: string[] | null }[]>(
      "GET", `programas?id=eq.${programaId}&select=bonos`);
    if (Array.isArray(bonosR.json)) bonos = bonosR.json[0]?.bonos ?? [];
  }

  // La duración de catálogo del tier. Lectura aparte y no un embed porque
  // `v_programa_activo` es una vista: PostgREST no sabe encadenar de ahí a
  // `tiers`. Si falla, se queda en null y el bloque de bonos no ofrece el de
  // duración — prefiere no ofrecerlo a ofrecerlo con una cifra inventada.
  const tierId = activoArray[0]?.tier ?? null;
  let mesesTier: number | null = null;
  if (tierId) {
    const tierR = await rest<{ meses_default: number | null }[]>(
      "GET", `tiers?id=eq.${encodeURIComponent(tierId)}&select=meses_default`);
    if (Array.isArray(tierR.json)) mesesTier = tierR.json[0]?.meses_default ?? null;
  }

  return {
    id: p.id,
    nombre: p.nombre,
    estado: p.estado,
    telefono_e164: p.telefono_e164,
    pais: p.pais,
    tier: tierId,
    coach: p.coach?.nombre ?? null,
    email: p.email ?? null,
    coach_id: p.coach_id ?? null,
    programa_id: programaId,
    bonos,
    meses_tier: mesesTier,
  };
}

// Cobrado y pendiente de un cliente. Devuelve null si el id no es válido o si
// alguna lectura falla: la ficha entonces NO pinta el bloque. Es deliberado —
// ante un fallo, no enseñar cifra es honesto; enseñar un 0 sería afirmar que
// el cliente no ha pagado nada.
//
// No se suma `programas.monto` para sacar un "acordado": los upsells con
// modo_transicion = 'reemplaza' sustituyen al programa anterior en vez de
// sumarse, así que sumarlos a ciegas infla a cualquier cliente con historia
// de ascensiones. Cobrado y pendiente son datos duros; el total sale de los dos.
export async function getResumenDineroCliente(
  personaId: string,
): Promise<{ cobrado: number; pendiente: number } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) return null;

  const [pagosR, cuotasR] = await Promise.all([
    rest<{ monto: number }[]>("GET", `pagos?persona_id=eq.${personaId}&select=monto&limit=1000`),
    rest<{ monto: number }[]>(
      "GET",
      "cuotas_programadas?estado=eq.pendiente&select=monto,programa:programas!inner(persona_id)" +
        `&programa.persona_id=eq.${personaId}&limit=500`,
    ),
  ]);

  if (!Array.isArray(pagosR.json) || !Array.isArray(cuotasR.json)) return null;

  return {
    cobrado: pagosR.json.reduce((s, p) => s + Number(p.monto), 0),
    pendiente: cuotasR.json.reduce((s, c) => s + Number(c.monto), 0),
  };
}

/**
 * El id del hilo de WhatsApp de una persona, si lo tiene.
 *
 * Existe para que desde la ficha del cliente se le pueda escribir. Hasta
 * ahora el teléfono se pintaba como texto plano y había que ir a /inbox y
 * buscar a la misma persona otra vez — con lo que, en la práctica, no se
 * escribía desde la ficha.
 *
 * Devuelve `null` en vez de lanzar: no tener conversación es normal (un
 * cliente al que nunca se le ha escrito por aquí) y no es motivo para tumbar
 * la ficha entera. Quien llama pinta el botón solo si hay hilo, en vez de
 * ofrecer una acción que lleva a un 404.
 *
 * `wa_conversaciones.persona_id` existe desde la migración 0009 y tiene
 * índice, así que esto no añade un escaneo.
 */
export async function getConversacionDePersona(
  personaId: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) return null;

  // Ordenado por último mensaje y limitado a 1: tras la migración 0020 el
  // hilo es permanente por teléfono, pero un cliente que cambió de número
  // puede tener más de una fila. Se abre el que tiene actividad más reciente,
  // que es el que la lista del inbox pone arriba — si se abriera otro, el
  // botón llevaría a un hilo muerto mientras el vivo está en /inbox.
  const r = await rest<{ id: string }[]>(
    "GET",
    `wa_conversaciones?persona_id=eq.${personaId}&select=id` +
      "&order=ultimo_mensaje_at.desc.nullslast&limit=1",
  );

  if (!Array.isArray(r.json)) return null;
  return r.json[0]?.id ?? null;
}

/* ---------------- La ficha del cliente, entera ---------------- */

export type DatosFicha = {
  programas: ProgramaFicha[];
  pagos: PagoFicha[];
  cuotas: CuotaFicha[];
  sesiones: SesionFicha[];
  estrategias: { id: string; titulo: string; url: string; fecha_lanzamiento: string | null; visible: boolean }[];
  mesesTier: number | null;
};

/**
 * Todo lo que la ficha del cliente necesita, en una sola tanda.
 *
 * Las seis lecturas van en paralelo: encadenarlas multiplicaría por seis la
 * latencia de la pantalla que más se abre del OS. Ninguna degrada a `[]` en
 * silencio salvo las estrategias — un fallo leyendo pagos o cuotas tiene que
 * verse, porque la alternativa es pintar "0 €" sobre un cliente que ha pagado
 * 7.000 y eso es peor que un error.
 *
 * Sustituye a `getTimelineCliente` en la ficha: ese devolvía todo revuelto en
 * una sola lista cronológica —compras, pagos, sesiones y plantillas—, y en el
 * cliente con más historia del negocio 10 de sus 18 eventos son "Plantilla
 * enviada", que entierran la compra y las tres sesiones.
 */
export async function getDatosFicha(personaId: string): Promise<DatosFicha | null> {
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) return null;

  const [progR, pagosR, sesionesR, estrategiasR] = await Promise.all([
    rest<any[]>(
      "GET",
      `programas?persona_id=eq.${personaId}` +
        "&select=id,tier,motivo,fecha_inicio,meses_duracion,monto,divisa,programa_previo_id" +
        "&order=fecha_inicio.desc&limit=50",
    ),
    rest<any[]>(
      "GET",
      `pagos?persona_id=eq.${personaId}` +
        "&select=id,programa_id,cuota_id,tipo,tipo_detalle,monto,divisa,usd_recibido,fecha," +
        "metodo_pago,comprobante_path,devolucion_motivo&order=fecha.asc&limit=200",
    ),
    rest<any[]>(
      "GET",
      `sesiones?persona_id=eq.${personaId}` +
        "&select=id,fecha,duracion_min,estado_asistencia,notas,tipo,coach:team_members(nombre)" +
        "&order=fecha.desc&limit=100",
    ),
    rest<any[]>(
      "GET",
      `estrategias?persona_id=eq.${personaId}` +
        "&select=id,titulo,url,fecha_lanzamiento,visible&order=created_at.desc&limit=50",
    ),
  ]);

  if (!Array.isArray(progR.json) || !Array.isArray(pagosR.json)) {
    throw new Error(
      "No se han podido leer las compras de este cliente: " +
        `${(progR.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }

  const programas: ProgramaFicha[] = progR.json.map((p) => ({
    id: String(p.id),
    tier: String(p.tier ?? "—"),
    motivo: p.motivo ?? null,
    fecha_inicio: String(p.fecha_inicio ?? ""),
    meses_duracion: p.meses_duracion == null ? null : Number(p.meses_duracion),
    monto: p.monto == null ? null : Number(p.monto),
    divisa: p.divisa ?? null,
    programa_previo_id: p.programa_previo_id ?? null,
  }));

  // Las cuotas cuelgan del programa, no de la persona: se piden por los
  // programas que acabamos de leer. Sin programas no hay cuotas que pedir, y
  // un `in.()` vacío es un 400 de PostgREST.
  let cuotas: CuotaFicha[] = [];
  if (programas.length > 0) {
    const ids = programas.map((p) => p.id).join(",");
    const cuotasR = await rest<any[]>(
      "GET",
      `cuotas_programadas?programa_id=in.(${ids})` +
        "&select=id,programa_id,numero_cuota,fecha_vencimiento,monto,divisa,estado" +
        "&order=fecha_vencimiento.asc&limit=200",
    );
    if (!Array.isArray(cuotasR.json)) {
      throw new Error("No se han podido leer las cuotas de este cliente.");
    }
    cuotas = cuotasR.json.map((c) => ({
      id: String(c.id),
      programa_id: String(c.programa_id),
      numero_cuota: c.numero_cuota == null ? null : Number(c.numero_cuota),
      fecha_vencimiento: String(c.fecha_vencimiento ?? ""),
      monto: Number(c.monto ?? 0),
      divisa: c.divisa ?? null,
      estado: String(c.estado ?? "pendiente"),
    }));
  }

  // Numeradas de la más antigua a la más nueva, que es como las cuenta el
  // coach ("su sesión 3"), aunque se pinten al revés.
  const orden = (Array.isArray(sesionesR.json) ? sesionesR.json : [])
    .slice()
    .sort((a, b) => String(a.fecha ?? "").localeCompare(String(b.fecha ?? "")));
  const numeroDe = new Map(orden.map((s, i) => [String(s.id), i + 1]));

  const sesiones: SesionFicha[] = (Array.isArray(sesionesR.json) ? sesionesR.json : []).map((s) => ({
    id: String(s.id),
    fecha: s.fecha ? String(s.fecha).slice(0, 10) : null,
    coach: s.coach?.nombre ?? null,
    duracion_min: s.duracion_min == null ? null : Number(s.duracion_min),
    estado_asistencia: s.estado_asistencia ?? null,
    notas: s.notas ?? null,
    numero: numeroDe.get(String(s.id)) ?? null,
  }));

  // La duración de catálogo del tier vigente, para saber cuándo se acaba el
  // programa. Si falla se queda en null y el aviso de renovación no se ofrece,
  // en vez de ofrecerse con una fecha inventada.
  let mesesTier: number | null = programas[0]?.meses_duracion ?? null;
  if (mesesTier == null && programas[0]?.tier) {
    const tierR = await rest<{ meses_default: number | null }[]>(
      "GET", `tiers?id=eq.${encodeURIComponent(programas[0].tier)}&select=meses_default`);
    if (Array.isArray(tierR.json)) mesesTier = tierR.json[0]?.meses_default ?? null;
  }

  // Un pago de cuota se guarda con `programa_id` NULL a propósito: el vínculo
  // real cuelga de `cuota_id` (ver `cuotas_programadas` y `v_pagos_atribuidos`
  // en 0032_atribucion_ventas.sql). Sin este coalesce, esos pagos nunca
  // matchean ningún programa en `agruparCompras` y desaparecen de "Compras".
  const programaDeCuota = new Map(cuotas.map((c) => [c.id, c.programa_id]));

  return {
    programas,
    pagos: (pagosR.json ?? []).map((p) => ({
      id: String(p.id),
      programa_id: p.programa_id ?? (p.cuota_id ? programaDeCuota.get(p.cuota_id) ?? null : null),
      cuota_id: p.cuota_id ?? null,
      tipo: p.tipo ?? null,
      tipo_detalle: p.tipo_detalle ?? null,
      monto: Number(p.monto ?? 0),
      divisa: p.divisa ?? null,
      usd_recibido: p.usd_recibido == null ? null : Number(p.usd_recibido),
      fecha: String(p.fecha ?? "").slice(0, 10),
      metodo_pago: p.metodo_pago ?? null,
      comprobante_path: p.comprobante_path ?? null,
      devolucion_motivo: p.devolucion_motivo ?? null,
    })),
    cuotas,
    sesiones,
    // Las estrategias sí degradan a []: que fallen no puede tumbar la ficha,
    // y su ausencia solo apaga un aviso, no falsea una cifra de dinero.
    estrategias: (Array.isArray(estrategiasR.json) ? estrategiasR.json : []).map((e) => ({
      id: String(e.id),
      titulo: String(e.titulo ?? "Sin título"),
      url: String(e.url ?? ""),
      fecha_lanzamiento: e.fecha_lanzamiento ?? null,
      visible: e.visible !== false,
    })),
    mesesTier,
  };
}

// Se piden 501 a propósito: si vuelven 501 sabemos que hay más de 500 y la
// página lo dice, en vez de mostrar una historia recortada que parece entera.
const TIMELINE_LIMITE = 500;

export async function getTimelineCliente(
  personaId: string,
): Promise<{ eventos: EventoTimeline[]; truncado: boolean }> {
  // Validar que personaId sea un UUID válido para evitar anomalías en la ruta PostgREST.
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) return { eventos: [], truncado: false };

  const r = await rest<EventoTimeline[]>(
    "GET",
    `v_timeline_cliente?persona_id=eq.${personaId}` +
      `&select=persona_id,fecha,dia,tipo,titulo,detalle,importe,ref_id` +
      `&order=fecha.desc.nullslast&limit=${TIMELINE_LIMITE + 1}`,
  );

  // Validar que la respuesta sea un array (si PostgREST rechaza, devuelve un objeto de error).
  if (!Array.isArray(r.json)) return { eventos: [], truncado: false };

  // Normaliza `importe` con Number() (respetando null), igual que las otras
  // lecturas de este fichero: PostgREST puede devolver `numeric` como string
  // y el tipo de EventoTimeline promete `number | null`.
  const filas = r.json.map((e) => ({ ...e, importe: e.importe == null ? null : Number(e.importe) }));
  return { eventos: filas.slice(0, TIMELINE_LIMITE), truncado: filas.length > TIMELINE_LIMITE };
}

// ---- Devoluciones (spec 2026-08-21) ----

export async function getDevoluciones(anio: number): Promise<DevolucionFila[]> {
  const r = await rest<DevolucionFila[]>(
    "GET",
    `v_devoluciones?fecha=gte.${anio}-01-01&fecha=lt.${anio + 1}-01-01` +
      "&select=*&order=fecha.desc&limit=500",
  );
  if (!Array.isArray(r.json)) {
    throw new Error(
      `No se pudieron leer las devoluciones: ${(r.json as { message?: string } | null)?.message ?? "respuesta inesperada"}`,
    );
  }
  return r.json.map((d) => ({
    ...d,
    monto: Number(d.monto),
    usd_recibido: d.usd_recibido == null ? null : Number(d.usd_recibido),
    n_efectos: Number(d.n_efectos),
  }));
}

// El recibo: los efectos en el orden en que ocurrieron.
export async function getReciboDevolucion(id: string): Promise<EfectoDevolucion[]> {
  const r = await rest<EfectoDevolucion[]>(
    "GET",
    `auditoria?entidad=eq.devolucion&entidad_id=eq.${id}` +
      "&select=accion,datos,created_at,autor_id&order=created_at.asc",
  );
  return Array.isArray(r.json) ? r.json : [];
}

// Denominador de la tasa de devolución: el cash cobrado del año SIN contar
// devoluciones. Restarlas del denominador las contaría dos veces y haría que
// la tasa subiera sola cuanto más se devuelve.
export async function getCashCobradoAnio(anio: number): Promise<number> {
  const r = await rest<Array<{ usd_recibido: number | null }>>(
    "GET",
    `pagos?fecha=gte.${anio}-01-01&fecha=lt.${anio + 1}-01-01&tipo=neq.refund` +
      "&select=usd_recibido&limit=5000",
  );
  return (r.json ?? []).reduce((s, p) => s + Number(p.usd_recibido ?? 0), 0);
}

// Los cobros que se pueden devolver de un cliente, con cuánto se devolvió ya
// de cada uno. Es lo que evita que nadie teclee un importe a mano: se elige de
// esta lista, con el USD real que se cobró — la base sobre la que se revierte.
export async function getCobrosDeCliente(personaId: string): Promise<CobroElegible[]> {
  const r = await rest<Array<Record<string, unknown>>>(
    "GET",
    `pagos?persona_id=eq.${personaId}&tipo=neq.refund` +
      "&select=id,fecha,monto,usd_recibido,tipo,programa_id,cuota_id&order=fecha.desc&limit=100",
  );
  const cobros = Array.isArray(r.json) ? r.json : [];
  if (cobros.length === 0) return [];

  const ids = cobros.map((c) => String(c.id));
  const dev = await rest<Array<{ revierte_pago_id: string; usd_recibido: number | null }>>(
    "GET",
    `pagos?tipo=eq.refund&revierte_pago_id=in.(${ids.join(",")})&select=revierte_pago_id,usd_recibido`,
  );
  const yaDevuelto = new Map<string, number>();
  for (const d of dev.json ?? []) {
    yaDevuelto.set(
      d.revierte_pago_id,
      (yaDevuelto.get(d.revierte_pago_id) ?? 0) + Math.abs(Number(d.usd_recibido ?? 0)),
    );
  }

  return cobros.map((c) => ({
    pago_id: String(c.id),
    fecha: String(c.fecha),
    monto: Number(c.monto),
    usd_recibido: c.usd_recibido == null ? null : Number(c.usd_recibido),
    tipo: String(c.tipo),
    programa_id: c.programa_id ? String(c.programa_id) : null,
    ya_devuelto_usd: yaDevuelto.get(String(c.id)) ?? 0,
  }));
}

// Los ajustes de comisión de un mes. Se RECALCULAN (no se leen de la
// auditoría) por la misma razón por la que el informe de comisiones se
// recalcula: un ajuste guardado se desincronizaría el día que cambie una
// atribución o una tasa. Lo guardado es solo el recibo de lo que se comunicó.
export async function getAjustesDevolucion(desde: string, hasta: string): Promise<AjusteMes[]> {
  const r = await rest<DevolucionFila[]>(
    "GET",
    `v_devoluciones?fecha=gte.${desde}&fecha=lt.${hasta}` +
      "&alcance=neq.sin_clasificar&select=*&order=fecha.asc",
  );
  const devs = Array.isArray(r.json) ? r.json : [];
  if (devs.length === 0) return [];

  const equipo = await getTeamMembers();
  const quienCobra = {
    noCobran: new Set(equipo.filter((t) => !t.cobra_comision).map((t) => t.id)),
  };

  const out: AjusteMes[] = [];
  for (const d of devs) {
    if (!d.programa_id) continue;
    // Total → se revierten TODOS los cobros del programa. Parcial → solo el
    // que señala `revierte_pago_id`. Ver §4.2 del spec.
    const filtro =
      d.alcance === "parcial" && d.revierte_pago_id
        ? `pago_id=eq.${d.revierte_pago_id}`
        : `programa_id=eq.${d.programa_id}`;
    const [orig, prog] = await Promise.all([
      rest<Array<Record<string, unknown>>>("GET", `v_pagos_atribuidos?${filtro}&select=*`),
      rest<Array<{ fecha_inicio: string }>>(
        "GET", `programas?id=eq.${d.programa_id}&select=fecha_inicio`,
      ),
    ]);
    const pagos = Array.isArray(orig.json) ? orig.json : [];
    const fechaVenta = prog.json?.[0]?.fecha_inicio ?? null;

    for (const p of pagos) {
      const pa: PagoAtribuido = {
        pago_id: String(p.pago_id),
        monto: Number(p.monto),
        usd_recibido: p.usd_recibido == null ? null : Number(p.usd_recibido),
        motivo: motivoDePago(p.motivo),
        programa_id: p.programa_id ? String(p.programa_id) : null,
        setter_id: p.setter_id ? String(p.setter_id) : null,
        closer_id: p.closer_id ? String(p.closer_id) : null,
        upsell_por_id: p.upsell_por_id ? String(p.upsell_por_id) : null,
        atribuido: Boolean(p.atribuido),
        fuente_confirmada: Boolean(p.fuente_confirmada),
      };
      // En una total se revierte el 100 % de cada cobro; en una parcial, lo
      // devuelto sobre ese cobro concreto.
      const usdDev = d.alcance === "total" ? -(pa.usd_recibido ?? 0) : (d.usd_recibido ?? 0);
      const { lineas } = ajusteDeDevolucion(pa, usdDev, quienCobra, fechaVenta ?? undefined);
      for (const l of lineas) {
        if (l.importe === 0) continue;
        out.push({
          devolucion_id: d.devolucion_id,
          team_member_id: l.team_member_id,
          rol: l.rol,
          importe: l.importe,
          persona_nombre: d.persona_nombre,
          fecha_devolucion: d.fecha,
          fecha_venta: fechaVenta,
        });
      }
    }
  }
  return out;
}

// Los programas de un cliente, para elegir cuál se devuelve. Se listan TODOS
// (no solo el activo) porque una devolución puede ser de un programa anterior
// del que se arrepintió, no necesariamente del que tiene vivo hoy.
export async function getProgramasDeCliente(personaId: string): Promise<ProgramaElegible[]> {
  const r = await rest<Array<Record<string, unknown>>>(
    "GET",
    `programas?persona_id=eq.${personaId}` +
      "&select=id,tier,monto,motivo,fecha_inicio&order=fecha_inicio.desc&limit=50",
  );
  const filas = Array.isArray(r.json) ? r.json : [];
  return filas.map((g) => ({
    programa_id: String(g.id),
    tier: g.tier == null ? null : String(g.tier),
    monto: g.monto == null ? null : Number(g.monto),
    motivo: g.motivo == null ? null : String(g.motivo),
    fecha_inicio: String(g.fecha_inicio),
  }));
}

/* ---------------- Inicio ---------------- */

// La pantalla de Inicio filtra y compara en el navegador: los rangos de fecha
// y los dos meses de la curva de ritmo recalculan al instante sin ida y vuelta
// al servidor. Por eso esta lectura devuelve FILAS, no agregados — la
// agregación vive en lib/inicio.ts, que es puro y testeable.
//
// Volumen a 26-ago-2026: 159 pagos, 200 programas, 24 cuotas, 189 personas.
// Unos 35 KB. Crece a ~30 pagos/mes, así que aguanta años; si algún día
// molesta, el corte natural es limitar `pagos` a los últimos 24 meses y quitar
// el preset «Todo».
export async function getInicioDatos(): Promise<InicioDatos> {
  const [pagosR, progsR, cuotasR, personasR, gastosR, fuentesR] = await Promise.all([
    rest<any[]>(
      "GET",
      // `metodo_pago` y `programa_id` los pide el reparto "Ventas por método de
      // pago" de Inicio (Berni, CAMBIOS OS): el método vive en el PAGO y la
      // venta es el PROGRAMA, así que hace falta la pareja para cruzarlos.
      "pagos?select=fecha,tipo,monto,usd_recibido,metodo_pago,programa_id,persona:personas(nombre)&order=fecha.desc",
    ),
    rest<any[]>(
      "GET",
      "programas?select=id,fecha_inicio,tier,motivo,monto,meses_duracion,source_id,programa_previo_id," +
        "persona:personas(id,nombre)" +
        "&order=fecha_inicio.desc",
    ),
    rest<any[]>("GET", "cuotas_programadas?select=fecha_vencimiento,monto,estado"),
    rest<any[]>("GET", "personas?select=id,nombre,estado,pais,created_at&order=created_at.desc"),
    rest<any[]>("GET", "gastos?select=fecha"),
    // La fuente de cada venta. Vive en `fuentes_atribucion` y se cruza por
    // `source_id`, no está en `programas`. Medido el 11-sep: solo el 44 % de
    // las ventas desde agosto la tiene — por eso el reparto enseña el hueco.
    rest<any[]>("GET", "fuentes_atribucion?select=source_id,fuente"),
  ]);

  // Ninguna degrada a []: Inicio es la pantalla desde la que se lee el estado
  // del negocio, y un cero silencioso ahí es una mentira que alguien puede
  // terminar repitiendo en una reunión.
  const exigir = <T,>(r: { json: T[] | null }, que: string): T[] => {
    if (!r.json) throw new Error(`Inicio: no se pudieron leer ${que}`);
    return r.json;
  };
  const nom = (p: { nombre: string | null } | null) => p?.nombre?.trim() || "—";

  // source_id -> fuente. Si la lectura falla NO se aborta: la fuente es un
  // extra del reparto, y quedarse sin Inicio entero por eso sería peor. Sin
  // mapa, todas las ventas salen como "sin atribuir", que es la verdad.
  const fuentePorSource = new Map<string, string>();
  for (const f of fuentesR.json ?? []) {
    if (f?.source_id && f?.fuente) fuentePorSource.set(String(f.source_id), String(f.fuente));
  }
  // programa_id -> método de pago. El método vive en el PAGO; la venta es el
  // PROGRAMA. Se recorre de más antiguo a más nuevo para que gane el PRIMER
  // pago de la venta, que es con el que se cerró — un recobro posterior por
  // otra vía no cambia cómo se vendió.
  const metodoPorPrograma = new Map<string, string>();
  for (const p of [...(pagosR.json ?? [])].reverse()) {
    if (p?.programa_id && p?.metodo_pago) metodoPorPrograma.set(String(p.programa_id), String(p.metodo_pago));
  }

  return {
    pagos: exigir<any>(pagosR, "los pagos")
      .filter((p) => p.fecha)
      .map((p) => ({
        fecha: p.fecha as string,
        tipo: (p.tipo ?? null) as string | null,
        eur: Number(p.monto ?? 0),
        usd: Number(p.usd_recibido ?? 0),
        nombre: nom(p.persona),
      })),
    programas: exigir<any>(progsR, "los programas")
      .filter((p) => p.fecha_inicio)
      .map((p) => ({
        id: p.id as string,
        fecha: p.fecha_inicio as string,
        tier: String(p.tier ?? "—"),
        motivo: (p.motivo ?? "") as string,
        // `?? 0` NO: en esta tabla el importe ausente es NULL y significa «no
        // se sabe», no «cero». Colapsarlo escondía 3 ventas reales.
        eur: p.monto == null ? null : Number(p.monto),
        meses: p.meses_duracion == null ? null : Number(p.meses_duracion),
        nombre: nom(p.persona),
        personaId: (p.persona?.id ?? null) as string | null,
        programaPrevioId: (p.programa_previo_id ?? null) as string | null,
        conFuente: Boolean(p.source_id),
        fuente: p.source_id ? (fuentePorSource.get(String(p.source_id)) ?? null) : null,
        metodoPago: metodoPorPrograma.get(String(p.id)) ?? null,
      })),
    cuotas: exigir<any>(cuotasR, "las cuotas")
      .filter((c) => c.fecha_vencimiento)
      .map((c) => ({
        fecha: c.fecha_vencimiento as string,
        eur: Number(c.monto ?? 0),
        estado: (c.estado ?? "") as string,
      })),
    personas: exigir<any>(personasR, "las personas").map((p) => ({
      id: p.id as string,
      nombre: nom(p),
      estado: (p.estado ?? "") as string,
      alta: p.created_at ? String(p.created_at).slice(0, 10) : null,
      pais: (p.pais ?? "") as string,
    })),
    // Solo los meses: sirven para declarar el hueco de gastos, no para calcular
    // márgenes. A 26-ago-2026 únicamente hay may, jun y jul cargados.
    mesesConGasto: [
      ...new Set(exigir<any>(gastosR, "los gastos").filter((g) => g.fecha).map((g) => String(g.fecha).slice(0, 7))),
    ].sort(),
  };
}

// ── Contratos ────────────────────────────────────────────────────────────────

export type ContratoRow = {
  id: string;
  // Se agrupa por esto en /contratos, no por `personas.nombre`: dos clientes
  // distintos pueden llamarse igual, y el id es lo único que no colisiona.
  persona_id: string;
  // Para "Recorregir bonos": es lo que necesita editarBonos() y
  // recorregirContrato(), ninguno de los dos se puede llamar solo con el id
  // del contrato.
  programa_id: string | null;
  tipo: string | null;
  estado: string;
  fecha_firma: string | null;
  created_at: string;
  pdf_path: string | null;
  // Las tres marcas de las que decide `cintaContrato()` (lib/contrato-datos.ts)
  // por PRECEDENCIA (0061 + 0065): si hay `desactualizado_at` pinta la roja;
  // si no, y hay `texto_editado_at`, pinta "editado a mano"; si no, mira
  // `recorregido_at` para la dorada. NO compara las fechas entre sí — pedir
  // solo alguna dejaría la pantalla decidiendo con parte del dato.
  recorregido_at: string | null;
  desactualizado_at: string | null;
  texto_editado_at: string | null;
  // 0065: el resto del ciclo con el cliente. `firmado_at`/`firma_nombre` son
  // la píldora dorada, que por fin escribe alguien.
  enviado_cliente_at: string | null;
  visto_at: string | null;
  firmado_at: string | null;
  firma_nombre: string | null;
  pdf_firmado_path: string | null;
  token_expira_at: string | null;
  personas: { nombre: string | null; email: string | null } | null;
  programas: {
    monto: string | null;
    // meses_duracion NO se usa acá — ya viene con el bono aplicado (ver el
    // hallazgo #1 de Milo). `tiers.meses_default` es la base SIN bono, la
    // misma que usa BonosCliente.tsx en la ficha para decidir qué casillas
    // mostrar y armar la nota "6 → 9 meses".
    bonos: string[] | null;
    tiers: { meses_default: number | null } | null;
  } | null;
};

// Un solo viaje: PostgREST resuelve las relaciones por foreign key —
// `programas.tier` referencia `tiers.id` desde 0002_servicio.sql:12, así que
// el embed anidado programas(tiers(...)) no hace falta una consulta aparte.
//
// `programas.monto` y NO `programas.tier`: el tier es el id del catálogo y el
// monto es el valor_total que tipeó el closer (0052_bono_duracion_50.sql:182).
// Medido el 8-sep contra producción: de los 138 programas con `monto`, 10 lo
// tienen distinto del tier (descuentos: 5000→4000, 3500→2500, 1000→897), y ahí
// el tier mentiría. Los otros 79 de los 217 tienen `monto` NULL —todos
// `origen = import_airtable`, ninguno nacido en el OS— y por eso la pestaña
// cae a "—" en vez de dejar la celda de dinero en blanco.
export async function getContratos(): Promise<ContratoRow[]> {
  const r = await rest<ContratoRow[]>(
    "GET",
    // 🔴 ANTES DEL DEPLOY, como ya pasó con la 0061 (precedente ya resuelto:
    // aplicada en producción desde el 9-sep, y de ahí salen
    // `recorregido_at`/`desactualizado_at`, que ya existen). Lo que falta hoy
    // (16-sep-2026) es la 0065: `enviado_cliente_at, visto_at, firmado_at,
    // firma_nombre, pdf_firmado_path, texto_editado_at, token_expira_at` no
    // existen hasta que esa migración esté aplicada. PostgREST responde 400 a
    // la petición ENTERA cuando pide una sola columna que no existe, y
    // `rest()` no lanza nunca (lib/supabase.ts): ese 400 hace que `r.json` no
    // sea un array, y con el `Array.isArray(...) ? ... : []` de abajo esta
    // función devuelve `[]` en vez de un error — la pestaña /contratos entera
    // diría "todavía no hay ninguno" con contratos reales en la base.
    // Comprobar que entró:
    //   contratos?select=id,texto_editado_at&limit=1  → 42703 = todavía no.
    // `0065_contratos_firma.sql` tiene que estar aplicada ANTES de que este
    // código llegue a producción.
    "contratos?select=id,persona_id,programa_id,tipo,estado,fecha_firma,created_at,pdf_path," +
      "recorregido_at,desactualizado_at,enviado_cliente_at,visto_at,firmado_at,firma_nombre," +
      "pdf_firmado_path,texto_editado_at,token_expira_at," +
      "personas(nombre,email),programas(monto,bonos,tiers(meses_default))&order=created_at.desc",
  );
  return Array.isArray(r.json) ? r.json : [];
}

export type ContratoDeCliente = {
  id: string;
  tipo: string | null;
  estado: string;
  fecha_firma: string | null;
  created_at: string;
  pdf_path: string | null;
  // Las mismas marcas de la 0061 + 0065 que pide `getContratos()`, y por el
  // mismo motivo: la ficha también dibuja la cinta. Aquí importan MÁS que en
  // la pestaña — la ficha es la pantalla donde alguien está justo cuando
  // edita los bonos, o sea en el momento exacto en que un contrato se queda
  // viejo.
  recorregido_at: string | null;
  desactualizado_at: string | null;
  enviado_cliente_at: string | null;
  visto_at: string | null;
  firmado_at: string | null;
  firma_nombre: string | null;
  pdf_firmado_path: string | null;
  texto_editado_at: string | null;
  token_expira_at: string | null;
  programas: { monto: string | null } | null;
};

// Mismo patrón que getContratos, filtrado a un solo cliente para el bloque
// "Contratos" de la ficha.
export async function getContratosDeCliente(personaId: string): Promise<ContratoDeCliente[]> {
  const r = await rest<ContratoDeCliente[]>(
    "GET",
    // 🔴 ANTES DEL DEPLOY, misma trampa que `getContratos()` — y que ya pasó
    // con la 0061: aplicada en producción desde el 9-sep, precedente ya
    // resuelto, de ahí salen `recorregido_at`/`desactualizado_at`, que ya
    // existen. Lo que falta hoy es la 0065: `enviado_cliente_at, visto_at,
    // firmado_at, firma_nombre, pdf_firmado_path, texto_editado_at,
    // token_expira_at` no existen hasta que esa migración esté aplicada. Sin
    // ella, PostgREST responde 400 a la petición ENTERA, `rest()` no lanza
    // nunca (lib/supabase.ts), y esto devuelve `[]` — la ficha diría "este
    // cliente no tiene ningún contrato" con contratos delante. Ahora son DOS
    // pantallas (esta y `getContratos()`) las que dependen de la 0065.
    // `0065_contratos_firma.sql` tiene que estar aplicada ANTES de que este
    // código llegue a producción.
    `contratos?persona_id=eq.${personaId}&select=id,tipo,estado,fecha_firma,created_at,pdf_path,` +
      `recorregido_at,desactualizado_at,enviado_cliente_at,visto_at,firmado_at,firma_nombre,` +
      `pdf_firmado_path,texto_editado_at,token_expira_at,programas(monto)&order=created_at.desc`,
  );
  return Array.isArray(r.json) ? r.json : [];
}
