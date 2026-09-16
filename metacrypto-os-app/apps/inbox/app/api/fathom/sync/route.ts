// ============================================================
// GET /api/fathom/sync — trae las llamadas grabadas en Fathom y las deja en
// `fathom_llamadas`. Lo invoca Vercel Cron cada 15 minutos.
//
// Idempotente por `recording_id`: una pasada repetida refresca, no duplica. Si
// Fathom no responde, la pasada acaba sin tocar nada y la siguiente recupera.
//
// NO escribe en `sesiones`. Ver la cabecera de la migración 0062: `sesiones`
// mueve cupo de consultorías y comisiones, así que convertir una llamada en
// sesión es un paso con una persona delante.
//
// Auth: Vercel Cron manda `Authorization: Bearer <CRON_SECRET>`.
// ============================================================
import { ingerirFathom } from "@/lib/fathom-ingesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Una pasada son N páginas de 50 reuniones con su resumen (la cuenta tiene 17
// hoy) más tres lecturas y un upsert. 60s sobra y corta sola si Fathom se
// degrada, mucho antes de pisar la pasada siguiente.
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("no", { status: 401 });
  }

  const r = await ingerirFathom();
  if (!r.ok) {
    // 200 y no 500 a propósito: que Vercel no lo marque como caída ni lo
    // reintente. Esta pasada se pierde, la de dentro de 15 minutos recupera —
    // mismo contrato que el sync de sesiones. El motivo queda en los logs.
    console.error("[fathom] la pasada no entró:", r.error);
    return Response.json({ ok: false, error: r.error }, { status: 200 });
  }
  return Response.json(r);
}
