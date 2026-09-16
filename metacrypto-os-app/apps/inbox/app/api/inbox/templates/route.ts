// ============================================================
// GET /api/inbox/templates — lista las plantillas de WhatsApp APROBADAS
// en Meta (vía proxy Kapso), con sus variables ({{n}}) parseadas.
// ============================================================
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_KEY = process.env.KAPSO_API_KEY ?? "";
const WABA_ID = process.env.KAPSO_WABA_ID ?? "";
const VERSION = process.env.META_GRAPH_VERSION ?? "v24.0";
const META_BASE = process.env.KAPSO_META_BASE ?? "https://api.kapso.ai/meta/whatsapp";

type Template = { name: string; language: string; body: string; variables: string[] };

export async function GET() {
  if (!WABA_ID) {
    console.warn("[templates] falta KAPSO_WABA_ID en las env vars — devolviendo lista vacía.");
    return Response.json({ ok: true, templates: [] as Template[] });
  }

  const url = `${META_BASE}/${VERSION}/${WABA_ID}/message_templates`;

  let res: Response;
  let data: any;
  try {
    res = await fetch(url, { headers: { "X-API-Key": API_KEY } });
    data = await res.json().catch(() => null);
  } catch (e) {
    console.error("[templates] fetch a Meta falló", e);
    return Response.json(
      { ok: false, templates: [] as Template[], error: String(e) },
      { status: 502 },
    );
  }

  if (!res.ok) {
    console.error("[templates] Meta respondió error", res.status, data);
    return Response.json(
      { ok: false, templates: [] as Template[], error: data?.error?.message ?? `HTTP ${res.status}` },
      { status: 502 },
    );
  }

  const templates: Template[] = (data?.data ?? [])
    .filter((t: any) => t.status === "APPROVED")
    .map((t: any) => {
      const body: string = (t.components ?? []).find((c: any) => c.type === "BODY")?.text ?? "";
      const variables = [...new Set([...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m: any) => m[1]))] as string[];
      return { name: t.name, language: t.language, body, variables };
    });

  return Response.json({ ok: true, templates });
}
