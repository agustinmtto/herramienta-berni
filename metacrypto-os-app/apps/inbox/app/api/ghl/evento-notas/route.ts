// ============================================================
// GET /api/ghl/evento-notas — para cada cita del calendario del evento 26/08,
// escribe en el contacto una nota con sus respuestas del formulario de
// admisión, y el mismo resumen en la DESCRIPCIÓN de la cita (visible al
// abrirla en el calendario). Invocado por Vercel Cron cada 5 minutos. Pedido
// por Berni el 25-ago: "que los datos del formulario aparezcan en notas".
//
// Idempotente por marca dentro de la nota (`[auto:evento-2608 cita:<id>]`):
// el antiduplicados pregunta a las notas ya escritas del contacto, así que
// una pasada repetida no duplica y un fallo a mitad se recupera en la
// siguiente. El correo al equipo NO sale de aquí: es una notificación nativa
// del calendario en GHL (channel email, notificationType booked).
//
// Auth: Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
// ============================================================
import {
  traerCitas,
  traerContactoBruto,
  traerNotas,
  crearNota,
  ponerDescripcionCita,
} from "@/lib/ghl";
import { estadoDeCita, citaViva } from "@/lib/sesiones";
import { CALENDARIO_EVENTO, construirNota, notaYaExiste } from "@/lib/evento-notas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Mismo contrato que sesiones/sync: pasada secuencial y acotada muy por
// debajo del intervalo del cron; si GHL se degrada, esta pasada se pierde y
// la siguiente recupera.
export const maxDuration = 60;

const DIA = 24 * 3600 * 1000;

// Las notas se firman con el usuario "Milo AI" para que en la ficha se vea
// quién las escribió (y que nadie las confunda con una nota manual de Alex).
const USUARIO_MILO_AI = "K39bh0fAUlLzomjVOOYM";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("no", { status: 401 });
  }

  const ahora = new Date();
  // 7 días hacia atrás: si el cron estuvo caído, al volver repesca lo que se
  // agendó mientras tanto. 45 hacia delante cubre reservas lejanas.
  const desde = new Date(ahora.getTime() - 7 * DIA);
  const hasta = new Date(ahora.getTime() + 45 * DIA);

  const c = { citas: 0, notas: 0, descripciones: 0, yaTenian: 0, canceladas: 0, errores: 0 };

  try {
    for (const cita of await traerCitas(CALENDARIO_EVENTO, desde, hasta)) {
      if (!cita.id || !cita.startTime || !cita.contactId) {
        console.error("[evento-notas] cita descartada: sin id, hora o contacto", cita.id);
        c.errores++;
        continue;
      }
      // Una cita cancelada no necesita nota: nadie va a preparar esa llamada.
      // Si se canceló DESPUÉS de tener nota, la nota se queda — es historia.
      if (!citaViva(estadoDeCita(cita.appointmentStatus))) {
        c.canceladas++;
        continue;
      }
      c.citas++;

      // Aislado por cita: una que reviente (contacto borrado, JSON raro) no
      // debe matar a las que van detrás, en esta pasada ni en las siguientes.
      try {
        if (notaYaExiste(await traerNotas(cita.contactId), cita.id)) {
          c.yaTenian++;
          continue;
        }
        const contacto = await traerContactoBruto(cita.contactId);
        // `name` viene null en contactos creados por API (verificado 25-ago
        // con el contacto de prueba): se compone de firstName + lastName.
        const nombreCompleto =
          (contacto?.name as string | undefined) ??
          ([contacto?.firstName, contacto?.lastName].filter(Boolean).join(" ") || undefined);
        const nota = construirNota({
          appointmentId: cita.id,
          startTime: cita.startTime,
          nombre: nombreCompleto ?? null,
          email: (contacto?.email as string | undefined) ?? null,
          telefono: (contacto?.phone as string | undefined) ?? null,
          customFields: Array.isArray(contacto?.customFields)
            ? (contacto?.customFields as { id?: string; value?: unknown }[])
            : [],
        });
        await crearNota(cita.contactId, nota, USUARIO_MILO_AI);
        c.notas++;

        // El mismo resumen, en la DESCRIPCIÓN de la propia cita: es lo que se
        // ve al abrirla en el calendario de GHL, sin pasar por el contacto
        // (petición de Milo del 25-ago). Solo si la cita no trae descripción
        // — nunca se pisa un texto que haya escrito una persona. Va acoplado
        // a la creación de la nota (misma pasada): si esta escritura falla,
        // se cuenta y se sigue — la nota es la fuente de verdad y la
        // descripción es comodidad, no vale abortar la cita por ella.
        if (!(cita.description ?? cita.notes ?? "").trim()) {
          try {
            await ponerDescripcionCita(cita.id, nota);
            c.descripciones++;
          } catch (err) {
            console.error("[evento-notas] no se pudo escribir la descripción de la cita", cita.id, err);
            c.errores++;
          }
        }
      } catch (err) {
        console.error("[evento-notas] cita falló", cita.id, err);
        c.errores++;
      }
    }
  } catch (err) {
    // `traerCitas` LANZA con GHL caído o token sin permisos, para que un 403
    // no se disfrace de "no hay citas" — la lección de sesiones/sync.
    console.error("[evento-notas] calendario falló", err);
    c.errores++;
  }

  return Response.json({ ...c, ok: c.errores === 0 });
}
