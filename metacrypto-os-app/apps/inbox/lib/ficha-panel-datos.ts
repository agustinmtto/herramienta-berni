// Arma las props de <FichaPanel> a partir de un persona_id. La página
// /clientes/[id] y el panel lateral que se abre desde un pago (Semana,
// Ingresos) llaman a la misma función — la ficha es siempre la misma,
// cambia solo si se ve de página completa o flotando encima de otra.
import { getFichaCliente, getDatosFicha, getTimelineCliente, getConversacionDePersona, getContratosDeCliente } from "@/lib/data";
import { cupoDeCliente } from "@/lib/sesiones-datos";
import { getLlamadasDeCliente } from "@/lib/fathom-datos";
import { puedeVer, type UserPerms } from "@/lib/modulos";
import { etiquetaEstado } from "@/lib/persona";
import { puedeVerImportes } from "@/lib/timeline";

export async function obtenerDatosFichaPanel(personaId: string, user: UserPerms) {
  const ficha = await getFichaCliente(personaId);
  if (!ficha) return null;

  const verImportes = puedeVerImportes(user);
  const verInbox = puedeVer(user, "inbox");
  const verSesiones = puedeVer(user, "sesiones");
  const verVentas = puedeVer(user, "ventas");

  const [datos, cupoRow, timeline, conversacionId, contratos, llamadas] = await Promise.all([
    getDatosFicha(personaId),
    verSesiones ? cupoDeCliente(personaId) : Promise.resolve(null),
    getTimelineCliente(personaId),
    verInbox ? getConversacionDePersona(personaId) : Promise.resolve(null),
    verVentas ? getContratosDeCliente(personaId) : Promise.resolve([]),
    // Las llamadas de Fathom de este cliente — consultorías Y llamadas de
    // venta. Berni las pidió "asociadas a cada uno de los clientes", y aquí es
    // donde alguien las busca: mirando a la persona, no la bandeja.
    verSesiones ? getLlamadasDeCliente(personaId) : Promise.resolve([]),
  ]);
  if (!datos) return null;

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
  const actividad = timeline.eventos
    .filter((e) => e.tipo === "mensaje" || e.tipo === "freeze")
    .map((e) => ({ ref_id: e.ref_id, dia: e.dia ?? "", titulo: e.titulo, detalle: e.detalle }));

  return {
    ficha: {
      id: ficha.id, nombre: ficha.nombre, estado: ficha.estado,
      estadoEtiqueta: etiquetaEstado(ficha.estado),
      telefono_e164: ficha.telefono_e164, pais: ficha.pais, coach: ficha.coach,
    },
    datos,
    conversacionId,
    actividad,
    cupo: { incluidas: cupoRow?.incluidas ?? null, hechas: cupoRow?.hechas ?? 0, pendientes: cupoRow?.pendientes ?? null },
    hoy,
    contratos,
    llamadas,
    puede: {
      importes: verImportes, cuotas: puedeVer(user, "cuotas"), sesiones: verSesiones,
      inbox: verInbox, estrategias: puedeVer(user, "estrategias"), contratos: verVentas,
    },
    truncado: timeline.truncado,
  };
}

export type DatosFichaPanel = NonNullable<Awaited<ReturnType<typeof obtenerDatosFichaPanel>>>;
