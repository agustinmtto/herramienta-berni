// Reglas de la bienvenida al cliente nuevo. Lógica pura, sin acceso a datos.
import type { UserPerms } from "@/lib/modulos";

export const BIENVENIDA_PLANTILLA = "bienvenida_club_es";
export const BIENVENIDA_IDIOMA = "es";

// Corte del histórico: los 175 clientes anteriores quedan fuera. El texto de
// la plantilla felicita por entrar al club y no encaja con quien lleva meses
// dentro; sembrar el canal con el histórico sería otra campaña, con otra
// plantilla y otro coste. Ver decisión 3 del spec.
export const BIENVENIDA_DESDE = "2026-08-06";

export type MotivoBienvenida =
  | "pendiente" | "enviada" | "historico" | "sin_compra_nueva" | "sin_telefono";
export type EstadoBienvenida = { pendiente: boolean; motivo: MotivoBienvenida };

// Extrae el día (YYYY-MM-DD) de un ISO 8601 string, ajustando a la zona horaria
// de Madrid. No vale cortar los diez primeros caracteres porque created_at es
// timestamptz en UTC, y Madrid va por delante de UTC (+1/-2 según la época): una
// compra a las 22:30 UTC ya es medianoche en Madrid. Sin conversión, esos
// clientes quedarían marcados como históricos aunque deberían ser pendientes.
//
// Ante una fecha inválida o no parseable, devuelve un valor muy antiguo (antes
// del corte). Esto marca al cliente como histórico, que es el lado seguro:
// marcar de menos (dejar un hueco que alguien reparará) es mejor que marcar de
// más (enviar a un cliente que no toca). Una fecha corrupta en la base indica
// un problema que debe repararse, pero mientras tanto no derriba la página.
function diaMadrid(isoString: string): string {
  try {
    const date = new Date(isoString);
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" });
    return formatter.format(date);
  } catch {
    // Fecha no válida: devuelve un día muy antiguo para que salga como histórico
    return "1970-01-01";
  }
}

// El motivo se devuelve además del booleano para que la interfaz pueda
// explicar por qué alguien NO sale marcado, en vez de dejar un hueco mudo.
// El orden de las comprobaciones importa: "ya enviada" gana sobre todo lo
// demás, porque si el mensaje llegó ya no hay nada que hacer.
export function evaluarBienvenida(c: {
  created_at: string;
  telefono_e164: string | null;
  tiene_compra_nueva: boolean;
  bienvenida_enviada: boolean;
}): EstadoBienvenida {
  if (c.bienvenida_enviada) return { pendiente: false, motivo: "enviada" };
  if (diaMadrid(c.created_at) < BIENVENIDA_DESDE) return { pendiente: false, motivo: "historico" };
  if (!c.tiene_compra_nueva) return { pendiente: false, motivo: "sin_compra_nueva" };
  if (!c.telefono_e164) return { pendiente: false, motivo: "sin_telefono" };
  return { pendiente: true, motivo: "pendiente" };
}

// Quien ve al cliente puede darle la bienvenida: es un mensaje de servicio
// con texto fijo aprobado por Meta, sin importes y sin margen para improvisar
// contenido. Ver decisión 7 del spec.
export function puedeEnviarBienvenida(u: UserPerms): boolean {
  const m = u.modulos ?? [];
  return u.acceso_total || m.includes("clientes") || m.includes("ventas");
}
