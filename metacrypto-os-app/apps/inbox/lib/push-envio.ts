import "server-only";
import webpush from "web-push";
import { rest } from "@/lib/supabase";
import {
  destinatarios, contenidoAviso,
  destinatariosVenta, contenidoAvisoVenta, urlAvisoVenta,
  contenidoAvisoContratoFirmado,
  type MiembroPush, type MiembroVenta,
} from "@/lib/push";

// Las claves VAPID identifican a ESTE servidor ante el servicio de push del
// navegador.
//
// `setVapidDetails` las VALIDA y LANZA si están mal — y esto corre al importar
// el módulo. Como `wa-ingest` lo importa, una clave mal pegada en Vercel
// tumbaría la carga de la ruta del webhook entera: 500 en cada entrega, Kapso
// dejando de reintentar, y mensajes de clientes perdidos. Por una notificación.
//
// Nada de eso puede depender de una variable de entorno: si la configuración no
// vale, `listo` se queda en false y el módulo entero se vuelve un no-op
// silencioso. El inbox sigue igual que ayer, solo que sin avisos.
const PUBLICA = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const PRIVADA = process.env.VAPID_PRIVATE_KEY ?? "";
let listo = false;
try {
  if (PUBLICA && PRIVADA) {
    webpush.setVapidDetails("mailto:operador@ejemplo.com", PUBLICA, PRIVADA);
    listo = true;
  } else {
    console.warn("[push] sin claves VAPID: los avisos quedan desactivados");
  }
} catch (e) {
  console.error("[push] claves VAPID inválidas, avisos desactivados", e);
}

const MAX_FALLOS = 10;

type Suscripcion = { id: string; endpoint: string; p256dh: string; auth: string; fallos: number };

/**
 * Avisa a quien corresponda de un mensaje ENTRANTE.
 *
 * Pensada para llamarse desde `after()` en el webhook: nunca lanza. Si algo
 * falla aquí, el mensaje del cliente ya está guardado y lo único que se pierde
 * es la notificación. Al revés no: si esto tumbara el webhook, Kapso dejaría
 * de entregar y se perderían mensajes de clientes.
 */
export async function avisarMensajeEntrante(msgId: string, convId: string): Promise<void> {
  if (!listo) return;
  try {
    const [rConv, rEquipo] = await Promise.all([
      rest<{ telefono_e164: string; coach_asignado: string | null; persona: { nombre: string | null } | null }[]>(
        "GET",
        `wa_conversaciones?id=eq.${convId}&select=telefono_e164,coach_asignado,persona:personas(nombre)&limit=1`,
      ),
      rest<MiembroPush[]>(
        "GET",
        "team_members?select=id,activo,acceso_total,modulos,push_alcance&activo=eq.true",
      ),
    ]);

    const conv = rConv.json?.[0];
    const equipo = rEquipo.json ?? [];
    if (!conv || equipo.length === 0) return;

    const aAvisar = destinatarios(equipo, { coach_asignado: conv.coach_asignado });
    if (aAvisar.length === 0) return;

    const aviso = contenidoAviso(conv.persona?.nombre ?? null, conv.telefono_e164);
    const carga = JSON.stringify({
      ...aviso,
      url: `/inbox/c/${convId}`,
      // Agrupa por conversación en el teléfono: varios mensajes seguidos del
      // mismo cliente dejan una notificación, no una pila.
      tag: `conv-${convId}`,
    });

    // allSettled, no all: el fallo de red de UN miembro (avisarA puede
    // rechazar — su reserva y el GET de suscripciones van sin try) no debe
    // dejar huérfanos en after() los envíos al resto del equipo.
    const resultados = await Promise.allSettled(
      aAvisar.map((m) => avisarA(m.id, msgId, carga)),
    );
    resultados.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error("[push] sin aviso del mensaje para", aAvisar[i].id, r.reason);
      }
    });
  } catch (e) {
    console.error("[push] fallo avisando del mensaje", msgId, e);
  }
}

async function avisarA(teamMemberId: string, msgId: string, carga: string): Promise<void> {
  // RESERVAR ANTES DE ENVIAR. Un 409 aquí significa "ya se avisó de este
  // mensaje a esta persona" y se corta.
  //
  // El orden importa y tiene coste conocido: si el proceso muere entre el
  // insert y el envío se pierde UN aviso. Al revés —enviar y luego
  // registrar— un fallo de registro reenvía en cada reintento del webhook.
  // Eso ya pasó en agosto con el cron de sesiones: 12 reenvíos a la misma
  // persona. Perder un aviso se sobrevive; que el equipo silencie la app
  // porque vibra doce veces, no.
  const reserva = await rest(
    "POST",
    "push_enviados",
    { mensaje_id: msgId, team_member_id: teamMemberId },
    "return=minimal",
  );
  if (reserva.status === 409) return; // ya avisado
  if (reserva.status >= 300) {
    console.error("[push] no se pudo reservar", msgId, teamMemberId, reserva.status);
    return;
  }

  await enviarASuscripciones(teamMemberId, carga);
}

// Envía la carga a TODAS las suscripciones de un miembro (móvil, portátil…).
// Compartida entre el aviso de inbox (que reserva antes) y el de venta (que no
// necesita reservar — ver `avisarNuevaVenta`).
async function enviarASuscripciones(teamMemberId: string, carga: string): Promise<void> {
  const rSubs = await rest<Suscripcion[]>(
    "GET",
    `push_suscripciones?team_member_id=eq.${teamMemberId}&select=id,endpoint,p256dh,auth,fallos`,
  );
  // Un no-2xx trae el objeto de error de PostgREST, no un array: tratarlo
  // como datos reventaba en TypeError y, en el inbox, quemaba la reserva de
  // push_enviados — aviso perdido para siempre, porque el reintento del
  // webhook deduplica contra esa reserva.
  if (!Array.isArray(rSubs.json)) {
    console.error("[push] no se pudieron leer las suscripciones de", teamMemberId, rSubs.status);
    return;
  }
  const subs = rSubs.json;
  if (subs.length === 0) return; // no ha instalado la app todavía

  // allSettled: que el teléfono con el endpoint podrido de un miembro no
  // corte el envío a su portátil (ni burbujee a los Promise.all de arriba).
  // Los rechazos se loguean a mano — tirarlos sin mirar dejaría sin rastro
  // fallos que antes subían al catch del llamador y salían en los logs.
  const resultados = await Promise.allSettled(subs.map((s) => enviarA(s, carga)));
  for (const r of resultados) {
    if (r.status === "rejected") {
      console.error("[push] fallo enviando a un dispositivo de", teamMemberId, r.reason);
    }
  }
}

/**
 * Avisa a TODO el equipo de un nuevo cierre. Pensada para llamarse desde
 * `after()` en `crearVenta`: nunca lanza — la venta ya está cobrada y guardada,
 * y un aviso perdido no puede convertirla en un error a ojos del operador.
 *
 * A diferencia del aviso de inbox, aquí NO se reserva en `push_enviados`: ese
 * candado existe porque Kapso reintenta el webhook y sin él llegaban avisos
 * duplicados. `crearVenta` es una acción de usuario que corre una vez, y si un
 * día algo se duplicara, el `tag` por pago hace que el teléfono reemplace la
 * notificación en vez de apilarla.
 */
export async function avisarNuevaVenta(
  personaId: string,
  pagoId: string,
  venta: { tipo: string; autorId: string | null },
): Promise<void> {
  if (!listo) return;
  try {
    const [rPersona, rEquipo] = await Promise.all([
      // El nombre es decorativo: si ESTA consulta falla, el aviso sale igual
      // (como "Cliente"). Sin el catch, su fallo de red tumbaría el Promise.all
      // y dejaría a todo el equipo sin aviso por un dato de adorno.
      rest<{ nombre: string | null }[]>(
        "GET",
        `personas?id=eq.${personaId}&select=nombre&limit=1`,
      ).catch(() => ({ status: 0, json: null }) as { status: number; json: { nombre: string | null }[] | null }),
      // Sin filtrar por activo A PROPÓSITO: el nombre del autor tiene que
      // resolverse aunque estuviera dado de baja; quién recibe lo decide
      // `destinatariosVenta`, que sí filtra.
      rest<MiembroVenta[]>(
        "GET",
        "team_members?select=id,nombre,activo,acceso_total,modulos",
      ),
    ]);

    // Mismo motivo que en `enviarASuscripciones`: un no-2xx trae un objeto
    // de error, no un array, y aquí se llevaría por delante el aviso de TODO
    // el equipo con un TypeError disfrazado de "fallo avisando de la venta".
    if (!Array.isArray(rEquipo.json)) {
      console.error("[push] venta: no se pudo leer el equipo", rEquipo.status);
      return;
    }
    const equipo = rEquipo.json;
    const aAvisar = destinatariosVenta(equipo);
    if (aAvisar.length === 0) return;

    const autor = venta.autorId
      ? (equipo.find((m) => m.id === venta.autorId)?.nombre ?? null)
      : null;
    const aviso = contenidoAvisoVenta({
      nombre: rPersona.json?.[0]?.nombre ?? null,
      tipo: venta.tipo,
      autor,
    });

    // allSettled, no all: esto corre en after() y si un envío rechazara (un
    // 502 de Supabase en medio), `all` cortaría al primero, el catch de fuera
    // se lo tragaría y la lambda se congelaría con los push de los demás aún
    // en vuelo — medio equipo sin enterarse del cierre por el fallo de uno.
    const resultados = await Promise.allSettled(
      aAvisar.map((m) => {
        // La carga es POR MIEMBRO: el destino del clic depende de sus módulos
        // (y puede no haberlo — url null = el clic solo enfoca la app).
        const carga = JSON.stringify({
          ...aviso,
          url: urlAvisoVenta(m, personaId),
          tag: `venta-${pagoId}`,
        });
        return enviarASuscripciones(m.id, carga);
      }),
    );
    // Un rechazo aquí (el GET de suscripciones de UN miembro, p. ej.) dejaría
    // a esa persona sin aviso: que al menos quede en los logs con su nombre.
    resultados.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error("[push] venta: sin aviso para", aAvisar[i].id, r.reason);
      }
    });
  } catch (e) {
    console.error("[push] fallo avisando de la venta", pagoId, e);
  }
}

/**
 * Avisa a TODO el equipo de que un cliente firmó su contrato. Pensada para
 * llamarse desde `after()` en la ruta de firma: nunca lanza — la firma ya
 * está guardada (el PDF subido y la fila marcada) y un aviso perdido no
 * puede convertirla en un error a ojos del cliente ni del equipo.
 *
 * Mismo criterio de destinatarios que `avisarNuevaVenta` (Milo, 3-sep: la
 * llegada de un cliente la celebra el equipo entero) y mismo `tag` por
 * contrato para que reintentos o dobles llamadas reemplacen la notificación
 * en el teléfono en vez de apilarla.
 */
export async function avisarContratoFirmado(contratoId: string, personaId: string): Promise<void> {
  if (!listo) return;
  try {
    const [rPersona, rEquipo] = await Promise.all([
      rest<{ nombre: string | null }[]>("GET", `personas?id=eq.${personaId}&select=nombre&limit=1`)
        .catch(() => ({ status: 0, json: null }) as { status: number; json: { nombre: string | null }[] | null }),
      rest<MiembroVenta[]>("GET", "team_members?select=id,nombre,activo,acceso_total,modulos"),
    ]);
    if (!Array.isArray(rEquipo.json)) { console.error("[push] firma: no se pudo leer el equipo", rEquipo.status); return; }
    const aAvisar = destinatariosVenta(rEquipo.json);
    if (aAvisar.length === 0) return;
    const aviso = contenidoAvisoContratoFirmado({ nombre: rPersona.json?.[0]?.nombre ?? null });
    const resultados = await Promise.allSettled(
      aAvisar.map((m) => enviarASuscripciones(m.id, JSON.stringify({ ...aviso, url: urlAvisoVenta(m, personaId), tag: `contrato-${contratoId}` }))),
    );
    resultados.forEach((r, i) => { if (r.status === "rejected") console.error("[push] firma: sin aviso para", aAvisar[i].id, r.reason); });
  } catch (e) {
    console.error("[push] fallo avisando de la firma", contratoId, e);
  }
}

async function enviarA(s: Suscripcion, carga: string): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      carga,
    );
    await rest("PATCH", `push_suscripciones?id=eq.${s.id}`, { ultimo_ok_at: new Date().toISOString(), fallos: 0 }, "return=minimal");
  } catch (e: any) {
    // 404/410 = el navegador tiró la suscripción (app desinstalada, permiso
    // revocado, caducada). No se reintenta: se borra. Si no, la tabla acumula
    // endpoints muertos y cada mensaje entrante paga el intento fallido.
    const code = e?.statusCode;
    if (code === 404 || code === 410) {
      await rest("DELETE", `push_suscripciones?id=eq.${s.id}`, undefined, "return=minimal");
      return;
    }
    // Un fallo que no es 404/410 (corte de red, 5xx del servicio de push) no
    // prueba que la suscripción esté muerta, así que no se borra a la primera:
    // se cuenta. `fallos` viene en el select, así que incrementarlo no cuesta
    // ni una consulta extra.
    const fallos = (s.fallos ?? 0) + 1;
    console.error("[push] envío fallido", s.id, code ?? e, `(fallos: ${fallos})`);
    if (fallos >= MAX_FALLOS) {
      // Endpoint que nunca devuelve 410 pero tampoco entrega nunca. Sin este
      // corte se queda en la tabla para siempre y cada mensaje entrante paga
      // el intento fallido.
      await rest("DELETE", `push_suscripciones?id=eq.${s.id}`, undefined, "return=minimal");
      return;
    }
    await rest("PATCH", `push_suscripciones?id=eq.${s.id}`, { fallos }, "return=minimal");
  }
}
