// ============================================================
// GET /api/sesiones/recurrentes — el aviso de WhatsApp de las sesiones
// grupales fijas (miércoles con Manuel, domingo con Berni), 1 hora antes.
// Invocado por Vercel Cron cada 5 minutos.
//
// A diferencia del sync de consultorías (1 cita = 1 contacto), aquí el
// destinatario es una AUDIENCIA: hoy "todos" = clientes activos con teléfono
// (~98). Eso cambia dos cosas de arriba abajo:
//
//   1. El antiduplicados es POR PERSONA, no por sesión: la clave es
//      (sesión, plantilla, teléfono), leída del registro de `wa_mensajes` —
//      el registro es la verdad, no una bandera aparte. El cron de sesiones
//      ya vivió el fallo contrario en agosto (envío OK + registro KO →
//      reenvío cada 5 min); aquí serían 98 × 12.
//   2. Hay TOPE duro de envíos por pasada: la cuenta está en TIER_250 (250
//      conversaciones nuevas por 24 h) y un fallo de lógica sin tope se las
//      comería todas en una pasada.
//
// Auth: Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
// ============================================================
import { rest } from "@/lib/supabase";
import {
  proximaOcurrencia,
  motivoNoProgramable,
  horaParaPlantilla,
  type ReglaRecurrente,
} from "@/lib/recurrentes";
import { tocaRecordatorio1h, nombreDeCoach, primerNombre } from "@/lib/sesiones";
import { soloDigitos } from "@/lib/telefono";
import { enviarPlantilla, registrarEnvioIncierto } from "@/lib/plantillas";
import { filtrarAudiencia } from "@/lib/recurrentes";
import { enviarYRegistrarEmail, yaSeEnvioEmail } from "@/lib/email-envio";
import { emailRecordatorio1h } from "@/lib/email-plantillas";
import { claveSesion } from "@/lib/canales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300 y no 60 como el sync: la pasada que cae dentro de la ventana manda ~98
// WhatsApps secuenciales (Kapso + resolución de conversación + registro por
// cada uno). Las demás pasadas terminan en segundos. Sigue por debajo del
// límite del plan y del intervalo del cron.
export const maxDuration = 300;

// El envío nace apagado: el cron puede correr, materializar la ocurrencia en
// `sesiones` y calcular la audiencia sin que salga un solo WhatsApp — así se
// verifica contra datos reales antes de exponer a 98 clientes. Se enciende
// con RECORDATORIO_GRUPAL_ACTIVO=1 en Vercel (mismo patrón que
// SESIONES_ENVIO_ACTIVO).
const ENVIO_ACTIVO = process.env.RECORDATORIO_GRUPAL_ACTIVO === "1";

// Llave propia, y nace apagada como la de WhatsApp. Aquí importa más que en
// ningún sitio: la audiencia son ~109 correos EN LA MISMA HORA, dos veces por
// semana, y el plan gratuito de Resend tope a 100/día. Encenderla sin plan de
// pago deja a una decena de clientes con un 429 y sin recordatorio.
const EMAIL_ACTIVO = process.env.RECORDATORIO_GRUPAL_EMAIL_ACTIVO === "1";

// Tope de envíos por pasada. 120 deja pasar la audiencia completa de hoy
// (~98) y corta ANTES de comerse las 250 conversaciones del día si un bug
// duplicara destinatarios. Si la audiencia crece, subirlo es una env var.
const TOPE = Number(process.env.RECORDATORIO_GRUPAL_TOPE ?? "") || 120;

// `sinDatos` cuenta reglas ACTIVAS a las que les falta algo (hora, enlace,
// coach…): activarlas sin datos es un error de configuración que merece verse
// en la respuesta, no un fallo técnico. `saltados` son clientes concretos a
// los que no se les pudo enviar (sin nombre utilizable, sin teléfono útil).
type Contadores = {
  reglas: number;
  sinDatos: number;
  ocurrencias: number;
  destinatarios: number;
  enviados: number;
  enviadosEmail: number;
  excluidos: number; // fuera por tier (OG)
  saltados: number;
  errores: number;
};

type PersonaAudiencia = { id: string; nombre: string | null; telefono_e164: string | null; email: string | null };

// La audiencia "todos": clientes activos (estado 'cliente'), MENOS el cohorte
// OG (decisión de Milo, 3-sep-2026 — ver `excluidoDeAvisos`).
//
// Ya no filtra por teléfono: con dos canales, no tenerlo apaga WhatsApp pero
// no el correo. El `order` fija el orden de envío para que dos pasadas
// recorran igual.
//
// El tier no está en `personas`: sale de `v_programa_activo`. Es una consulta
// más por pasada (no por destinatario), y si falla NO se excluye a nadie —
// callar avisos por un fallo de lectura sería peor que mandar de más.
async function audienciaTodos(c: Contadores): Promise<PersonaAudiencia[]> {
  const r = await rest<PersonaAudiencia[]>(
    "GET",
    "personas?estado=eq.cliente&select=id,nombre,telefono_e164,email&order=id.asc",
  );
  if (r.status >= 300 || !Array.isArray(r.json)) {
    console.error("[recurrentes] no se pudo leer la audiencia", r.status, r.json);
    c.errores++;
    return [];
  }

  const t = await rest<{ persona_id: string; tier: string }[]>(
    "GET",
    "v_programa_activo?select=persona_id,tier",
  );
  if (t.status >= 300 || !Array.isArray(t.json)) {
    console.error("[recurrentes] no se pudo leer el tier, no se excluye a nadie", t.status, t.json);
    c.errores++;
    return r.json;
  }
  const tierPorPersona = new Map(t.json.map((x) => [x.persona_id, x.tier]));

  const { enviar, excluidos } = filtrarAudiencia(r.json, tierPorPersona);
  if (excluidos.length) {
    // Se cuenta y se dice. Una exclusión que no se ve es otro silencio.
    console.log("[recurrentes] excluidos del aviso por tier", excluidos.length);
    c.excluidos += excluidos.length;
  }
  return enviar;
}

// Los teléfonos que YA recibieron (o pudieron recibir: los inciertos también
// cuentan) esta plantilla de esta sesión. Sale del registro de mensajes vía
// la conversación de cada uno — una sola consulta por sesión, no una por
// destinatario.
async function telefonosYaEnviados(
  sesionId: string,
  plantilla: string,
  c: Contadores,
): Promise<Set<string> | null> {
  const r = await rest<{ wa_conversaciones: { telefono_e164: string | null } | null }[]>(
    "GET",
    `wa_mensajes?sesion_id=eq.${sesionId}&plantilla_nombre=eq.${encodeURIComponent(plantilla)}&select=wa_conversaciones(telefono_e164)`,
  );
  if (r.status >= 300 || !Array.isArray(r.json)) {
    // Ante la duda, NO enviar: sin poder leer el registro, cualquier envío
    // puede ser un duplicado. Mismo criterio que `yaSeEnvio` en el sync.
    console.error("[recurrentes] no se pudo comprobar duplicados", sesionId, r.status, r.json);
    c.errores++;
    return null;
  }
  const set = new Set<string>();
  for (const fila of r.json) {
    const t = soloDigitos(fila.wa_conversaciones?.telefono_e164 ?? "");
    if (t) set.add(t);
  }
  return set;
}

// Envía a UNA persona y cubre los dos caminos por los que el WhatsApp puede
// salir sin quedar registrado (5xx de Kapso; 200 con registro fallido) —
// mismo contrato que `enviarYCubrirIncierto` del sync, con la clave del
// incierto POR TELÉFONO: en un envío grupal, dos inciertos de la misma sesión
// no pueden compartir fila o el segundo borra el registro del primero.
async function enviarACliente(
  args: {
    to: string;
    plantilla: string;
    sesionId: string;
    variables: Record<string, string>;
  },
  c: Contadores,
): Promise<boolean> {
  const env = await enviarPlantilla({
    to: args.to,
    name: args.plantilla,
    language: "es",
    autor: "equipo",
    sesionId: args.sesionId,
    variables: args.variables,
  });
  if (env.ok) {
    if (!env.registrado) {
      console.error(
        "[recurrentes] envío realizado pero NO registrado; se marca incierto para no reenviar",
        args.plantilla,
        args.sesionId,
      );
      c.errores++;
      await registrarEnvioIncierto({
        to: args.to,
        name: args.plantilla,
        sesionId: args.sesionId,
        porTelefono: true,
      });
    }
    return true;
  }
  c.errores++;
  if (env.incierto) {
    console.error(
      "[recurrentes] envío incierto (5xx de Kapso); puede haber salido igual. Registrado para no reintentar.",
      args.plantilla,
      args.sesionId,
      env.status,
      env.error,
    );
    await registrarEnvioIncierto({
      to: args.to,
      name: args.plantilla,
      sesionId: args.sesionId,
      porTelefono: true,
    });
  } else {
    console.error("[recurrentes] envío rechazado", args.plantilla, args.sesionId, env.status, env.error);
  }
  return false;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("no", { status: 401 });
  }

  const ahora = new Date();
  const c: Contadores = {
    reglas: 0, sinDatos: 0, ocurrencias: 0, destinatarios: 0,
    enviados: 0, enviadosEmail: 0, excluidos: 0, saltados: 0, errores: 0,
  };

  const reglas = await rest<ReglaRecurrente[]>(
    "GET",
    "sesiones_recurrentes?activa=eq.true&select=*&order=dia_semana.asc",
  );
  if (reglas.status >= 300 || !Array.isArray(reglas.json)) {
    console.error("[recurrentes] no se pudieron leer las reglas", reglas.status, reglas.json);
    return Response.json({ ...c, errores: c.errores + 1, ok: false, envio: ENVIO_ACTIVO });
  }

  for (const regla of reglas.json) {
    c.reglas++;
    // Aislado por regla: que la del domingo falle no debe robarle la pasada a
    // la del miércoles (`rest()` hace JSON.parse sin proteger y puede lanzar).
    try {
      const motivo = motivoNoProgramable(regla);
      if (motivo) {
        // Activa pero incompleta: configuración a revisar en /sesiones.
        console.error("[recurrentes] regla activa sin datos:", regla.id, motivo);
        c.sinDatos++;
        continue;
      }

      const ocurrencia = proximaOcurrencia(regla.dia_semana, regla.hora, regla.zona, ahora);
      if (!ocurrencia || !tocaRecordatorio1h(ocurrencia, ahora)) continue;

      // Materializa la ocurrencia de esta semana en `sesiones`: queda registro
      // de que la sesión existió (alimenta /sesiones) y su id es la clave de
      // deduplicación de los envíos. Idempotente por (recurrente_id, fecha).
      const up = await rest<{ id: string }[]>(
        "POST",
        "sesiones?on_conflict=recurrente_id,fecha",
        {
          recurrente_id: regla.id,
          fecha: ocurrencia,
          tipo: "grupal",
          coach_id: regla.coach_id,
          enlace: regla.enlace,
          estado: "confirmed",
          duracion_min: regla.duracion_min,
        },
        "resolution=merge-duplicates,return=representation",
      );
      const sesionId = up.status < 300 && Array.isArray(up.json) ? up.json[0]?.id : undefined;
      if (!sesionId) {
        // Sin fila no hay clave de deduplicación: enviar sin ella es
        // arriesgarse al reenvío en cada pasada. No se envía nada.
        console.error("[recurrentes] no se pudo materializar la ocurrencia", regla.id, up.status, up.json);
        c.errores++;
        continue;
      }
      c.ocurrencias++;

      const personas = await audienciaTodos(c);
      c.destinatarios += personas.length;
      if (!personas.length) continue;

      const yaEnviados = await telefonosYaEnviados(sesionId, regla.plantilla_nombre, c);
      if (yaEnviados === null) continue; // sin registro legible no se envía

      // Dry-run si los DOS canales están apagados: materializa y cuenta.
      if (!ENVIO_ACTIVO && !EMAIL_ACTIVO) continue;

      // `motivoNoProgramable` ya garantizó que el coach tiene nombre y que
      // hay enlace; el `??` es solo para que el tipo cierre.
      const coach = nombreDeCoach(regla.coach_id) ?? "";
      const hora = horaParaPlantilla(ocurrencia, regla.zona);
      const link = regla.enlace ?? "";

      for (const p of personas) {
        const tel = soloDigitos(p.telefono_e164 ?? "");
        // Sin teléfono ya NO se salta al cliente: apaga WhatsApp, no el
        // aviso. Mismo criterio que en sesiones/sync.
        if (!tel) c.saltados++;
        const puedeWa = !!tel && !yaEnviados.has(tel);
        // Sin nombre no hay WhatsApp: `{{nombre}}` es obligatorio y Meta
        // rechaza los parámetros vacíos. El correo sí puede — saluda "Hola,".
        const nombre = primerNombre(p.nombre);
        if (!nombre) {
          console.error("[recurrentes] cliente sin nombre utilizable, no sale WhatsApp", p.id);
        }
        if (c.enviados >= TOPE) {
          // Freno de emergencia, no un límite esperado: si salta con la
          // audiencia real es que algo duplica destinatarios.
          console.error("[recurrentes] TOPE de envíos alcanzado", TOPE, "quedaban", personas.length);
          c.errores++;
          break;
        }

        if (
          ENVIO_ACTIVO &&
          puedeWa &&
          nombre &&
          (await enviarACliente(
            {
              to: tel,
              plantilla: regla.plantilla_nombre,
              sesionId,
              variables: { nombre, hora, coach, link },
            },
            c,
          ))
        ) {
          c.enviados++;
        }

        // ── Email ─────────────────────────────────────────────────────────
        // La clave lleva el DESTINATARIO: aquí una sola fila de `sesiones`
        // sirve a toda la audiencia, así que sin él los 109 compartirían
        // clave y solo saldría un correo.
        if (EMAIL_ACTIVO && p.email) {
          const clave = claveSesion("recordatorio_1h", sesionId, ocurrencia, p.email);
          if (!(await yaSeEnvioEmail(clave))) {
            const correo = emailRecordatorio1h({
              nombre: p.nombre ?? "",
              coach,
              hora,
              enlace: link,
            });
            const env = await enviarYRegistrarEmail({
              to: p.email,
              asunto: correo.asunto,
              html: correo.html,
              texto: correo.texto,
              clave,
              tipo: "recordatorio_1h",
              personaId: p.id,
              sesionId,
            });
            if (env.ok) c.enviadosEmail++;
            else c.errores++;
          }
        }
      }
    } catch (err) {
      console.error("[recurrentes] regla falló", regla.id, err);
      c.errores++;
    }
  }

  // `ok` es el resultado de la pasada; `envio` dice si el interruptor global
  // está puesto — sin él, un humano que mira la respuesta no distingue "no
  // tocaba enviar" de "está apagado".
  return Response.json({ ...c, ok: c.errores === 0, envio: ENVIO_ACTIVO });
}
