// ============================================================
// POST /api/inbox/send-template — envía una plantilla de WhatsApp aprobada
// desde el PlantillaPicker del inbox. Toda la lógica de envío (Kapso,
// creación de conversación, registro del mensaje) vive en
// `enviarPlantilla` (lib/plantillas.ts), compartida con la server action
// `enviarBienvenida` — ver ese archivo para el detalle.
// ============================================================
import { getCurrentUser } from "@/lib/auth";
import { enviarPlantilla } from "@/lib/plantillas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { to, name, language, variables, bodyResuelto } = (await request.json().catch(() => ({}) as any)) as {
    to?: string;
    name?: string;
    language?: string;
    variables?: Record<string, string>;
    bodyResuelto?: string;
  };

  // Resolver el autor no puede tumbar el envío: en el original esta lectura
  // ocurría DESPUÉS de que Kapso confirmara el envío, dentro de un try/catch
  // que se tragaba los fallos — un problema transitorio de Supabase solo
  // dejaba el mensaje sin registrar, el WhatsApp salía igual. Al mover la
  // resolución del autor antes del envío (para poder pasarlo a
  // `enviarPlantilla`), un `getCurrentUser()` que lance por un fallo de red
  // pasaría de "no se registró el mensaje" a "no se envió la plantilla" si no
  // se capturara aquí. Mejor un mensaje con autor genérico que un envío
  // perdido por un problema ajeno a Kapso.
  let autor = "equipo";
  try {
    const user = await getCurrentUser();
    autor = user?.id ?? "equipo";
  } catch (e) {
    console.error("[send-template] no se pudo resolver el autor, se usa 'equipo'", e);
  }
  const envio = await enviarPlantilla({
    to: to ?? "",
    name: name ?? "",
    language: language ?? "",
    variables,
    bodyResuelto,
    autor,
  });
  if (!envio.ok) {
    return Response.json({ ok: false, error: envio.error }, { status: envio.status });
  }
  return Response.json({ ok: true });
}
