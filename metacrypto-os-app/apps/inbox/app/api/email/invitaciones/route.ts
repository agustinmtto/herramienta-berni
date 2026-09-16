// ============================================================
// GET /api/email/invitaciones — mete las sesiones grupales en el calendario
// de cada cliente.
//
// Sustituye al recordatorio de las sesiones fijas. En vez de avisar dos veces
// por semana para siempre (~940 correos al mes), la sesión entra UNA vez en su
// calendario y a partir de ahí le avisa su propia agenda.
//
// No es un cron de eventos: es un cron de CONVERGENCIA. Cada pasada mira quién
// debería tener las invitaciones y no las tiene, y le manda las que le faltan.
// De ahí salen tres propiedades sin escribir código extra:
//
//  · un cliente NUEVO recibe las suyas en la pasada siguiente a su alta;
//  · si Berni cambia la hora, la huella del horario cambia, la clave es otra y
//    sale una invitación nueva con el MISMO UID y SEQUENCE+1 — los calendarios
//    la actualizan en vez de duplicarla;
//  · con el TOPE, los 109 primeros envíos se reparten solos en dos días, que
//    es lo que exige el límite de 100/día del plan gratuito de Resend.
//
// ⚠️ Dado de alta en la lista blanca de `middleware.ts` en este mismo commit.
// Auth: `Authorization: Bearer <CRON_SECRET>`.
// ============================================================
import { rest } from "@/lib/supabase";
import { enviarEmail, decidirRegistro } from "@/lib/email";
import { yaSeEnvioEmail } from "@/lib/email-envio";
import { emailInvitacionCalendario } from "@/lib/email-plantillas";
import { icsSesionRecurrente, inicioLocalDeRegla } from "@/lib/ics";
import { claveInvitacion, huellaHorario } from "@/lib/canales";
import {
  proximaOcurrencia,
  motivoNoProgramable,
  filtrarAudiencia,
  type ReglaRecurrente,
} from "@/lib/recurrentes";
import { nombreDeCoach } from "@/lib/sesiones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTIVO = process.env.INVITACIONES_CALENDARIO_ACTIVO === "1";

// Por debajo del límite diario del plan gratuito (100), con margen para los
// avisos de sesiones que salen el mismo día. La audiencia entera se cubre en
// dos pasadas; subirlo es una env var, no un despliegue.
const TOPE = Number(process.env.INVITACIONES_TOPE ?? "") || 60;

const DIAS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

type Persona = { id: string; nombre: string | null; email: string | null };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("no", { status: 401 });
  }

  const ahora = new Date();
  const c = { reglas: 0, candidatos: 0, enviados: 0, sinEmail: 0, excluidos: 0, errores: 0, tope: false };

  // ── Las reglas, y su forma para el calendario ───────────────────────────
  const rr = await rest<ReglaRecurrente[]>(
    "GET",
    "sesiones_recurrentes?activa=eq.true&select=*&order=dia_semana.asc",
  );
  if (rr.status >= 300 || !Array.isArray(rr.json)) {
    console.error("[invitaciones] no se pudieron leer las reglas", rr.status, rr.json);
    return Response.json({ ok: false, ...c, errores: 1 });
  }

  const series = [];
  for (const regla of rr.json) {
    // Mismo criterio que el cron de avisos: una regla incompleta no genera
    // nada y se dice por qué, en vez de mandar un evento a medias.
    const motivo = motivoNoProgramable(regla);
    if (motivo) {
      console.error("[invitaciones] regla no programable", regla.id, motivo);
      continue;
    }
    const instante = proximaOcurrencia(regla.dia_semana, regla.hora, regla.zona, ahora);
    const inicio = instante ? inicioLocalDeRegla(instante, regla.hora, regla.zona) : null;
    if (!inicio) continue;

    const coach = nombreDeCoach(regla.coach_id) ?? "el equipo";
    series.push({
      regla,
      inicio,
      huella: huellaHorario(regla),
      // El UID es la IDENTIDAD de la serie en el calendario del cliente y NO
      // puede depender del horario: si cambiara al mover la hora, en vez de
      // actualizar el evento aparecería uno nuevo y el viejo se quedaría ahí
      // para siempre. Por eso lleva el id de la regla y nada más.
      uid: `mcc-grupal-${regla.id}@invierteconberni.com`,
      titulo: `Sesión en directo con ${coach}`,
      cuando: `${DIAS[regla.dia_semana]} a las ${(regla.hora ?? "").slice(0, 5)} (Madrid)`,
    });
  }
  c.reglas = series.length;
  if (!series.length) return Response.json({ ok: true, ...c });

  // ── La audiencia: clientes con email, sin los OG ────────────────────────
  const pp = await rest<Persona[]>(
    "GET",
    "personas?estado=eq.cliente&email=not.is.null&select=id,nombre,email&order=id.asc",
  );
  if (pp.status >= 300 || !Array.isArray(pp.json)) {
    console.error("[invitaciones] no se pudo leer la audiencia", pp.status, pp.json);
    return Response.json({ ok: false, ...c, errores: 1 });
  }

  const tt = await rest<{ persona_id: string; tier: string }[]>(
    "GET",
    "v_programa_activo?select=persona_id,tier",
  );
  if (tt.status >= 300 || !Array.isArray(tt.json)) {
    // Igual que en el cron de avisos: si no se puede leer el tier NO se
    // excluye a nadie. Callar por un fallo de lectura es peor que mandar de
    // más — y aquí "de más" es una invitación que el OG puede ignorar.
    console.error("[invitaciones] sin tier, no se excluye a nadie", tt.status, tt.json);
    c.errores++;
  }
  const tierPorPersona = new Map((tt.json ?? []).map((x) => [x.persona_id, x.tier]));
  const { enviar, excluidos } = filtrarAudiencia(pp.json, tierPorPersona);
  c.excluidos = excluidos.length;
  c.candidatos = enviar.length;

  if (!ACTIVO) {
    // Ensayo: calcula todo y no manda nada. Mismo patrón que los otros crons.
    return Response.json({ ok: true, ...c, ensayo: true });
  }

  const dtstamp = ahora.toISOString();

  for (const p of enviar) {
    if (!p.email) {
      c.sinEmail++;
      continue;
    }
    if (c.enviados >= TOPE) {
      // No es un error: es el reparto en varios días que exige el límite
      // diario. Se dice en la respuesta para que no parezca que terminó.
      c.tope = true;
      break;
    }

    // Qué series le faltan a ESTA persona.
    const pendientes = [];
    for (const s of series) {
      const clave = claveInvitacion(s.regla.id, s.huella, p.email);
      if (await yaSeEnvioEmail(clave)) continue;
      pendientes.push({ ...s, clave });
    }
    if (!pendientes.length) continue;

    const adjuntos = [];
    for (const s of pendientes) {
      // SEQUENCE = cuántas versiones de esta serie se le mandaron ya. Un
      // reenvío por cambio de horario tiene que llevar un número MAYOR o los
      // calendarios lo descartan como revisión vieja.
      const secuencia = await versionesPrevias(s.regla.id, p.email, c);
      adjuntos.push({
        filename: `sesion-${DIAS[s.regla.dia_semana]}.ics`,
        content: Buffer.from(
          icsSesionRecurrente({
            uid: s.uid,
            resumen: s.titulo,
            descripcion: "Sesión semanal del programa de MetaCrypto Club.",
            inicio: s.inicio,
            duracionMin: s.regla.duracion_min ?? 60,
            zona: s.regla.zona,
            diaSemana: s.regla.dia_semana,
            organizador: (process.env.EMAIL_FROM ?? "").replace(/^.*<|>.*$/g, "") || "hola@invierteconberni.com",
            asistente: p.email,
            enlace: s.regla.enlace ?? undefined,
            secuencia,
            dtstamp,
          }),
          "utf8",
        ).toString("base64"),
        // Sin `method=REQUEST` muchos clientes lo tratan como fichero
        // descargable en vez de como invitación.
        content_type: "text/calendar; charset=utf-8; method=REQUEST",
      });
    }

    const correo = emailInvitacionCalendario({
      nombre: p.nombre ?? "",
      sesiones: pendientes.map((s) => ({ titulo: s.titulo, cuando: s.cuando })),
    });

    // Un solo correo por persona con todos sus adjuntos, pero la clave de
    // idempotencia es POR SERIE: por eso se manda con la primera y se
    // registran todas. Así, si mañana se añade una tercera sesión, solo se le
    // manda esa.
    const envio = await enviarEmail({
      to: p.email,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      idempotencyKey: pendientes[0].clave,
      adjuntos,
    });

    const { registrar, estado } = decidirRegistro(envio);
    if (!registrar) {
      if (!envio.ok) console.error("[invitaciones] no registrado, se reintentará", p.id, envio.error);
      continue;
    }
    for (const s of pendientes) {
      const ins = await rest(
        "POST",
        "emails_enviados",
        {
          persona_id: p.id,
          tipo: "invitacion_calendario",
          destinatario: p.email,
          idempotency_key: s.clave,
          resend_id: envio.ok ? envio.resendId : null,
          estado,
          error: envio.ok ? null : envio.error,
        },
        "return=minimal",
      );
      if (ins.status >= 300 && ins.status !== 409) {
        console.error("[invitaciones] EL CORREO SALIÓ PERO NO QUEDÓ REGISTRADO", s.clave, ins.status);
        c.errores++;
      }
    }
    if (envio.ok) c.enviados++;
    else c.errores++;
  }

  return Response.json({ ok: c.errores === 0, ...c });
}

// Cuántas invitaciones de esta serie recibió ya esta persona. Sale del propio
// registro, así que no hace falta ninguna columna nueva ni acordarse de subir
// un contador a mano.
async function versionesPrevias(
  reglaId: string,
  email: string,
  c: { errores: number },
): Promise<number> {
  const r = await rest<{ id: string }[]>(
    "GET",
    `emails_enviados?tipo=eq.invitacion_calendario&destinatario=eq.${encodeURIComponent(email)}` +
      `&idempotency_key=like.*${encodeURIComponent(reglaId)}*&select=id`,
  );
  if (r.status >= 300 || !Array.isArray(r.json)) {
    console.error("[invitaciones] no se pudo contar el SEQUENCE", reglaId, email, r.status);
    c.errores++;
    // Ante la duda, 0: un SEQUENCE demasiado BAJO hace que el calendario
    // ignore la revisión (molesto pero visible). Uno inventado demasiado alto
    // dejaría el evento clavado ante futuras correcciones, que es peor.
    return 0;
  }
  return r.json.length;
}
