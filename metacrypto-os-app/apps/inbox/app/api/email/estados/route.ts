// ============================================================
// GET /api/email/estados — le pregunta a Resend si los correos llegaron.
//
// Existe por el incidente del 2-sep: `wa_mensajes.status` se queda en "sent"
// para siempre porque nadie le pregunta a Kapso, y por eso el OS dio por
// enviados durante tres horas mensajes que Meta estaba tirando. Un canal
// nuevo sin visibilidad de entrega repetiría el fallo con otro logo.
//
// Se PREGUNTA en vez de esperar un webhook porque los webhooks de Resend son
// de plan de pago. La información es la misma (`last_event`) y además el
// estado acaba en nuestra base, sin depender de que un empujón llegue.
//
// Auth: Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`, igual que
// los otros cuatro crons.
//
// ⚠️ Esta ruta está dada de alta en la lista blanca de `middleware.ts`, en
// este mismo commit. Sin esa línea, Vercel Cron recibe el HTML de /login con
// un 200 y el cron "corre" sin actualizar una sola fila. El comentario del
// middleware dice que es la quinta vez que ese regex se come una ruta nueva.
// ============================================================
import { rest } from "@/lib/supabase";
import { estadoDesdeEvento, caducado } from "@/lib/email-estado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tope por pasada. Con el volumen real (unos 940 correos al mes en el peor
// caso) una pasada cada 10 minutos vacía la cola de sobra, y el tope protege
// de gastar la cuota de API si algo deja de resolver.
const TOPE = Number(process.env.EMAIL_ESTADOS_TOPE ?? "") || 50;

type Fila = { id: string; resend_id: string | null; created_at: string; destinatario: string };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("no", { status: 401 });
  }
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    return Response.json({ ok: false, error: "Falta RESEND_API_KEY." }, { status: 501 });
  }

  const ahora = new Date();
  const c = { mirados: 0, resueltos: 0, caducados: 0, errores: 0 };

  // Las más antiguas primero: son las que más cerca están de caducar.
  const pend = await rest<Fila[]>(
    "GET",
    `emails_enviados?estado=eq.enviado&select=id,resend_id,created_at,destinatario&order=created_at.asc&limit=${TOPE}`,
  );
  if (pend.status >= 300 || !Array.isArray(pend.json)) {
    console.error("[email-estados] no se pudieron leer las filas pendientes", pend.status, pend.json);
    return Response.json({ ok: false, ...c, errores: 1 }, { status: 200 });
  }

  for (const fila of pend.json) {
    // Sin `resend_id` no hay a quién preguntar. No debería pasar —solo se
    // registra `enviado` cuando Resend devolvió id— pero si pasa, dejarla
    // pendiente para siempre sería otro silencio.
    if (!fila.resend_id || caducado(fila.created_at, ahora)) {
      await marcar(fila.id, "sin_confirmar", c);
      c.caducados++;
      continue;
    }

    c.mirados++;
    let evento: string | null = null;
    try {
      const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(fila.resend_id)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      });
      if (!res.ok) {
        // Un 404 en Resend significa que el correo ya no existe para ellos
        // (retención de 30 días en el plan gratuito). No se puede saber más:
        // se cierra como sin confirmar en vez de preguntarlo eternamente.
        if (res.status === 404) {
          await marcar(fila.id, "sin_confirmar", c);
          c.caducados++;
          continue;
        }
        console.error("[email-estados] Resend no respondió bien", res.status, fila.resend_id);
        c.errores++;
        continue;
      }
      const data: any = await res.json().catch(() => null);
      evento = typeof data?.last_event === "string" ? data.last_event : null;
    } catch (e) {
      // Un fallo de red no cambia nada: la fila sigue pendiente y la pasada
      // siguiente la vuelve a mirar.
      console.error("[email-estados] fallo de red consultando Resend", fila.resend_id, e);
      c.errores++;
      continue;
    }

    const estado = estadoDesdeEvento(evento);
    if (!estado) continue; // sigue en vuelo (sent, delivery_delayed, scheduled)

    if (estado === "rebotado" || estado === "quejado") {
      // Estas dos hay que poder verlas sin bucear en la base: un rebote es un
      // cliente incomunicado, y una queja de spam envenena el dominio entero.
      console.error("[email-estados] correo problemático", estado, fila.destinatario, fila.resend_id);
    }
    await marcar(fila.id, estado, c);
    c.resueltos++;
  }

  // `ok` es el resultado de la pasada, no el de la petición HTTP: mismo
  // criterio que los otros crons del OS.
  return Response.json({ ok: c.errores === 0, ...c });
}

async function marcar(id: string, estado: string, c: { errores: number }): Promise<void> {
  const r = await rest(
    "PATCH",
    `emails_enviados?id=eq.${encodeURIComponent(id)}`,
    { estado, actualizado_at: new Date().toISOString() },
    "return=minimal",
  );
  if (r.status >= 300) {
    console.error("[email-estados] no se pudo actualizar la fila", id, estado, r.status, r.json);
    c.errores++;
  }
}
