export type ModuloKey =
  | "inicio" | "ingresos" | "cuotas" | "pnl" | "gastos" | "clientes" | "inbox"
  | "ventas"
  // Módulo propio y NO implicado por `clientes`: quien registra sesiones son
  // los coaches, y anotar una consultoría no debería exigir acceso a la ficha
  // financiera del cliente.
  | "sesiones"
  // Módulo propio, NO implicado por `clientes`: la ficha del cliente no se
  // toca y quien publica estrategias (Berni, Manuel) no tiene por qué ver la
  // ficha financiera de nadie. Decisión de Milo el 20-ago.
  | "estrategias"
  // Módulo propio: una devolución resta dinero y descuenta comisión, así
  // que no se hereda de `ingresos` ni de `ventas`. Hoy lo tienen Berni,
  // Alex y Milo por `acceso_total`; Manuel (Clientes + Inbox + Sesiones) no.
  | "devoluciones"
  // Módulo propio del Quiz Funnel (docs/11 D13): los leads capturados por
  // /quiz. NO se hereda de `clientes` a propósito — ver quién puede hacer
  // triaje comercial es decisión del negocio, no un accidente de herencia.
  | "leads";
export type UserPerms = { acceso_total: boolean; modulos: string[] | null };

// Orden de preferencia para la landing de un usuario limitado.
const HOME_ORDER: { key: ModuloKey; ruta: string }[] = [
  { key: "inbox", ruta: "/inbox" }, { key: "clientes", ruta: "/clientes" },
  // Antes que `ventas`: un coach con sólo `sesiones` debe aterrizar en su
  // pantalla de trabajo, no en la de registrar una venta.
  { key: "sesiones", ruta: "/sesiones" },
  // Antes que `ventas` por el mismo motivo que `sesiones`: es una pantalla de
  // trabajo del coach. Conviene que no falte de esta lista: si un usuario sólo
  // tiene `estrategias` y no está aquí, `homePath` lo manda al último recurso
  // (/novedades) en vez de a su pantalla de trabajo.
  { key: "estrategias", ruta: "/estrategias" },
  { key: "ventas", ruta: "/nueva-venta" },
  // Nunca puede faltar de esta lista, por el mismo motivo que `estrategias`.
  { key: "devoluciones", ruta: "/devoluciones" },
  // El funnel es captación comercial de primer nivel: quien lo trabaja debe
  // aterrizar acá, no en novedades.
  { key: "leads", ruta: "/leads" },
  { key: "inicio", ruta: "/" }, { key: "ingresos", ruta: "/ingresos" },
  { key: "cuotas", ruta: "/cuotas" }, { key: "pnl", ruta: "/pnl" }, { key: "gastos", ruta: "/gastos" },
];

export function puedeVer(u: UserPerms, k: ModuloKey): boolean {
  return u.acceso_total || (u.modulos ?? []).includes(k);
}
export function homePath(u: UserPerms): string {
  if (u.acceso_total) return "/";
  for (const { key, ruta } of HOME_ORDER) if ((u.modulos ?? []).includes(key)) return ruta;
  // Último recurso: /novedades no exige módulos (solo sesión activa y la
  // tabla se autofiltra), así que un miembro sin módulos tiene pantalla, ve
  // el menú y el botón "Activar avisos del OS". Antes esto devolvía /login,
  // que con sesión válida era un callejón sin salida documentado.
  return "/novedades";
}
