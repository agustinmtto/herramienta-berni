import { rest } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alta y baja de un DISPOSITIVO para las notificaciones del inbox.
// La suscripción la genera el navegador; aquí solo se guarda contra la
// persona de la sesión.

type Entrada = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sin sesión." }, { status: 401 });

  // Desde el 3-sep el alta está abierta a CUALQUIER miembro con sesión: el
  // push ya no avisa solo del inbox — los nuevos cierres van a todo el equipo
  // (setters incluidos, que no tienen ese módulo). La privacidad del inbox no
  // se pierde: `destinatarios` (lib/push.ts) filtra por módulo AL ENVIAR cada
  // aviso de mensaje, que siempre fue el guard de verdad — este 403 solo
  // impedía que la fila existiera.

  const sub = (await request.json().catch(() => null)) as Entrada | null;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return Response.json({ ok: false, error: "Suscripción incompleta." }, { status: 400 });
  }

  // `endpoint` es único: volver a suscribir el mismo aparato ACTUALIZA la fila
  // en vez de añadir otra. Sin esto, reinstalar la app duplicaría los avisos
  // de esa persona para siempre.
  //
  // Se reasigna también `team_member_id` a propósito: si Manuel y Berni
  // comparten un teléfono, el último que entra se queda la suscripción — lo
  // contrario mandaría los avisos de uno al otro.
  const r = await rest(
    "POST",
    "push_suscripciones",
    {
      team_member_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      fallos: 0,
    },
    "resolution=merge-duplicates,return=minimal",
  );
  if (r.status >= 300) {
    console.error("[push] alta fallida", r.status, r.json);
    return Response.json({ ok: false, error: "No se pudo guardar la suscripción." }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sin sesión." }, { status: 401 });

  const sub = (await request.json().catch(() => null)) as Entrada | null;
  if (!sub?.endpoint) {
    return Response.json({ ok: false, error: "Falta el endpoint." }, { status: 400 });
  }
  // Acotado a la persona de la sesión: nadie puede dar de baja el teléfono de
  // otro conociendo su endpoint.
  await rest(
    "DELETE",
    `push_suscripciones?endpoint=eq.${encodeURIComponent(sub.endpoint)}&team_member_id=eq.${user.id}`,
    undefined,
    "return=minimal",
  );
  return Response.json({ ok: true });
}
