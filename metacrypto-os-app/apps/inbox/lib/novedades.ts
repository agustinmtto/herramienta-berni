// Decisión pura del centro de novedades: QUÉ eventos de la auditoría son
// noticia, QUIÉN ve cada uno y CÓMO se cuenta — con el dinero recortado para
// quien no tiene el módulo de dinero. Sin red y sin base, para poder probarlo
// entero (el patrón de lib/push.ts). El pegamento vive en novedades-datos.ts.
//
// Los imports son RELATIVOS a propósito: un lib con tests no puede resolver
// el alias `@/` en runtime bajo vitest (solo vale para `import type`).
import { puedeVer, type ModuloKey, type UserPerms } from "./modulos";
import { money } from "./format";

export type EventoAuditoria = {
  id: string;
  entidad: string;
  entidad_id: string;
  accion: string;
  autor_id: string | null;
  // jsonb histórico y heterogéneo: NUNCA confiar en su forma. Los helpers
  // de abajo degradan ante basura; jamás revientan.
  datos: unknown;
  created_at: string;
};

export type Nombres = {
  miembroPorId: Map<string, string>; // team_members.id → nombre
  personaPorId: Map<string, string>; // personas.id → nombre
  personaPorCuotaId: Map<string, string>; // cuotas_programadas.id → nombre del cliente
};

export type Novedad = {
  id: string;
  frase: string;
  autor: string | null; // quién lo hizo (humano), null si no se sabe
  url: string | null; // null = fila sin link para este miembro
  fecha: string; // created_at tal cual; la UI formatea
  // = EventoAuditoria.entidad ("venta", "cuota", "devolucion", "sesion",
  // "gasto", "estrategia") — para el ícono/color por tipo (Berni, EX-3).
  tipo: string;
};

/* ---------------- Helpers defensivos sobre datos ---------------- */

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ---------------- La lista blanca ---------------- */

// Cada entrada separa la frase BASE (sin dinero) de las partes CON dinero:
// la rama sin dinero no accede a los campos monetarios por construcción —
// la misma disciplina de firma que impidió que el push filtrara el precio
// vía tier. El tier no aparece aquí NI PUEDE aparecer: en este catálogo los
// ids de tier SON el precio en euros.
type Entrada = {
  entidad: string;
  accion: string;
  // "todos" = cualquier miembro activo, sin pedir módulo. Está reservado a lo
  // que celebra el equipo entero, que hoy son DOS cosas: la venta (la llegada
  // de un cliente — decisión de Milo, 3-sep) y el contrato firmado, que es el
  // final de ese mismo ciclo. Todo lo demás va detrás de su módulo.
  ver: ModuloKey | "todos";
  dinero: ModuloKey | null;
  base: (e: EventoAuditoria, n: Nombres) => string;
  conDinero: (e: EventoAuditoria, n: Nombres) => string[];
  // El link solo se emite si el miembro puede abrir esa pantalla.
  urlModulo: ModuloKey;
  url: (e: EventoAuditoria, n: Nombres) => string | null;
};

// Sin emoji: el ícono de la fila (NovedadesLista, TIPO.venta) ya dice "venta".
const TITULO_VENTA: Record<string, string> = {
  nueva: "Nueva venta",
  ascension: "Ascensión",
  extension: "Extensión",
};

function clienteDeVenta(e: EventoAuditoria, n: Nombres): string {
  const d = obj(e.datos);
  const pid = str(d.persona_id);
  return str(d.nombre) ?? (pid ? (n.personaPorId.get(pid) ?? null) : null) ?? "un cliente";
}

const LISTA_BLANCA: Entrada[] = [
  {
    entidad: "venta",
    accion: "alta",
    ver: "todos",
    dinero: "ingresos",
    base: (e, n) => {
      const d = obj(e.datos);
      const titulo = TITULO_VENTA[str(d.tipo) ?? ""] ?? TITULO_VENTA.nueva;
      return `${titulo} — ${clienteDeVenta(e, n)}`;
    },
    conDinero: (e, n) => {
      const d = obj(e.datos);
      const partes: string[] = [];
      const monto = num(d.pago_monto);
      if (monto !== null) partes.push(money(monto, str(d.divisa) ?? "EUR"));
      const autorId = str(d.autor_venta_id);
      const autor = autorId ? n.miembroPorId.get(autorId) : null;
      // En "nueva" el autor es el closer; en ascensión/extensión es quien
      // hizo la venta (regla de comisiones, Berni 12-ago) y llamarle closer
      // sería mentir.
      if (autor) partes.push(str(obj(e.datos).tipo) === "nueva" ? `closer: ${autor}` : `por ${autor}`);
      return partes;
    },
    urlModulo: "clientes",
    url: (e) => {
      const pid = str(obj(e.datos).persona_id);
      return pid ? `/clientes/${pid}` : null;
    },
  },
  {
    // 🔴 LA CAMPANA ES LO QUE SUSTITUYÓ AL CORREO INTERNO. Cuando el contrato
    // dejó de salir solo al equipo por correo (spec 2026-09-15, decisión 3),
    // lo que se puso en su lugar fue esta fila: `generarContrato` la escribe
    // en `auditoria` y tres comentarios del repo la citan para justificar que
    // el correo ya no haga falta (`components/VentaForm.tsx`, el bloque 🔴 de
    // `app/actions.ts`, y el Step 6 del brief de la Task 22, que es el texto
    // que acaba en CLAUDE.md). Sin esta entrada, la fila se escribía y el
    // centro de novedades la descartaba en silencio: se había quitado un
    // correo prometiendo una campana que no sonaba.
    entidad: "contrato",
    accion: "generado",
    // `ventas` y no "todos", a diferencia de la firma de aquí abajo: que un
    // contrato quede generado no es una celebración, es trabajo esperando
    // —hay que leerlo, corregirlo y mandarlo— y quien lo hace es quien tiene
    // la pestaña /contratos, que va bajo este mismo módulo.
    ver: "ventas",
    // Sin dinero, por la regla del 3-sep: ni monto ni tier. Y sin `tipo`
    // tampoco, que sí viaja en `datos`: "venta_nueva_v2" contra "ampliacion"
    // es de qué plantilla salió el documento, o sea la cocina — la fila ya lo
    // dice en /contratos, donde además significa algo.
    dinero: null,
    base: (e, n) => `Contrato generado — ${clienteDeVenta(e, n)}`,
    conDinero: () => [],
    // A /contratos y no a la ficha: el link lleva a donde se actúa sobre lo
    // que la frase anuncia. Mismo módulo que `ver`, así que quien ve la fila
    // ve siempre el enlace.
    urlModulo: "ventas",
    url: () => "/contratos",
  },
  {
    entidad: "contrato",
    accion: "firmado",
    // "todos": la firma de un cliente la celebra el equipo entero, igual que
    // la venta (Milo, 3-sep) — y por la misma razón no puede ir detrás de un
    // módulo: quien no ve `clientes` igual quiere saber que se cerró el papel.
    ver: "todos",
    // Sin dinero, y sin excepción: la regla del 3-sep que impide que el push
    // de cierres enseñe monto o tier aplica aquí exactamente igual.
    dinero: null,
    base: (e, n) => `Contrato firmado — ${clienteDeVenta(e, n)}`,
    conDinero: () => [],
    urlModulo: "clientes",
    url: (e) => {
      const pid = str(obj(e.datos).persona_id);
      return pid ? `/clientes/${pid}` : null;
    },
  },
  ...(["pago", "pago_parcial"] as const).map((accion): Entrada => ({
    entidad: "cuota",
    accion,
    ver: "cuotas",
    dinero: "cuotas",
    // entidad_id ES el id de la cuota (0016/0017): el nombre del cliente
    // llega resuelto en el lote personaPorCuotaId — datos no lo trae.
    base: (e, n) =>
      `Cuota cobrada${accion === "pago_parcial" ? " (parcial)" : ""} — ${n.personaPorCuotaId.get(e.entidad_id) ?? "un cliente"}`,
    conDinero: (e) => {
      const importe = num(obj(e.datos).importe);
      return importe !== null ? [money(importe, "EUR")] : [];
    },
    urlModulo: "cuotas",
    url: () => "/cuotas",
  })),
  {
    entidad: "devolucion",
    accion: "devolucion_registrada",
    ver: "devoluciones",
    dinero: "devoluciones",
    base: (e, n) => {
      const pid = str(obj(e.datos).persona_id);
      return `Devolución — ${(pid ? n.personaPorId.get(pid) : null) ?? "un cliente"}`;
    },
    conDinero: (e) => {
      const eur = num(obj(e.datos).eur);
      // La base guarda el eur en negativo (dinero que sale). "Devolución"
      // ya dice el sentido: el signo delante sería doble negación.
      return eur !== null ? [money(Math.abs(eur), "EUR")] : [];
    },
    urlModulo: "devoluciones",
    url: () => "/devoluciones",
  },
  {
    entidad: "gasto",
    accion: "alta",
    ver: "gastos",
    dinero: "gastos",
    base: (e) => `Gasto — ${str(obj(e.datos).concepto) ?? "sin concepto"}`,
    conDinero: (e) => {
      const d = obj(e.datos);
      const monto = num(d.monto);
      // La divisa viaja en datos SIEMPRE (los gastos son USD y money() por
      // defecto pinta EUR — sin ella el feed mentiría el símbolo).
      return monto !== null ? [money(monto, str(d.divisa) ?? "USD")] : [];
    },
    urlModulo: "gastos",
    url: () => "/gastos",
  },
  {
    entidad: "sesion",
    accion: "alta",
    ver: "sesiones",
    dinero: null,
    // La forma real de 0037: persona_id vive bajo `despues`.
    base: (e, n) => {
      const pid = str(obj(obj(e.datos).despues).persona_id);
      return `Sesión registrada — ${(pid ? n.personaPorId.get(pid) : null) ?? "un cliente"}`;
    },
    conDinero: () => [],
    urlModulo: "sesiones",
    url: () => "/sesiones",
  },
  {
    entidad: "estrategia",
    accion: "crear",
    ver: "estrategias",
    dinero: null,
    base: (e) => `Estrategia publicada — ${str(obj(e.datos).titulo) ?? "sin título"}`,
    conDinero: () => [],
    urlModulo: "estrategias",
    url: () => "/estrategias",
  },
];

/* ---------------- API pública ---------------- */

/**
 * Pares (entidad, accion) que ESTE miembro puede ver — para armar el or=()
 * de PostgREST ya filtrado. Filtrar en la consulta (y no después) es lo que
 * hace honesto al contador: N filas de SQL = N filas visibles.
 */
export function paresVisibles(perms: UserPerms): { entidad: string; accion: string }[] {
  return LISTA_BLANCA.filter((en) => en.ver === "todos" || puedeVer(perms, en.ver)).map(
    (en) => ({ entidad: en.entidad, accion: en.accion }),
  );
}

/**
 * Evento crudo → novedad para ESTE miembro, o null si no la ve o no es
 * lista blanca. `nombres` lo construye el pegamento con lotes por id.
 */
export function traducirNovedad(
  e: EventoAuditoria,
  perms: UserPerms,
  nombres: Nombres,
): Novedad | null {
  const entrada = LISTA_BLANCA.find((en) => en.entidad === e.entidad && en.accion === e.accion);
  if (!entrada) return null;
  if (entrada.ver !== "todos" && !puedeVer(perms, entrada.ver)) return null;

  const conDinero = entrada.dinero !== null && puedeVer(perms, entrada.dinero);
  const partes = [entrada.base(e, nombres), ...(conDinero ? entrada.conDinero(e, nombres) : [])];

  return {
    id: e.id,
    frase: partes.join(" · "),
    autor: (e.autor_id ? nombres.miembroPorId.get(e.autor_id) : null) ?? null,
    url: puedeVer(perms, entrada.urlModulo) ? entrada.url(e, nombres) : null,
    fecha: e.created_at,
    tipo: e.entidad,
  };
}
