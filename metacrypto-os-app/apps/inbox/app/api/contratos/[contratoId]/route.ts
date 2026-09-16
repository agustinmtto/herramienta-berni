import { rest } from "@/lib/supabase";
import { getStorageBytes } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clon de `app/api/comprobantes/[pagoId]/route.ts` con UN cambio deliberado,
// explicado abajo en el Content-Disposition.

export async function GET(req: Request, { params }: { params: Promise<{ contratoId: string }> }) {
  // Mismo gate que comprobantes: el contrato lleva el importe de la venta, así
  // que es dato financiero del módulo "ventas". No se crea un módulo nuevo —
  // quien registra la venta es quien tiene que ver su contrato.
  const u = await getCurrentUser();
  if (!u) return new Response("no auth", { status: 401 });
  if (!(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return new Response("sin permiso", { status: 403 });
  }
  const { contratoId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(contratoId)) return new Response("bad id", { status: 400 });

  // `?firmado=1` sirve el PDF CON la firma del cliente (`pdf_firmado_path`,
  // 0065), que es otro fichero: el sin firmar sigue en `pdf_path` y no se
  // pisa. Los dos viven en el mismo bucket privado y pasan por el mismo gate
  // de arriba — el parámetro elige cuál, no quién puede verlo.
  //
  // Se piden las dos columnas en una sola consulta, y no la que toque, para
  // que el 404 de abajo signifique siempre lo mismo: "ese fichero no existe
  // todavía". Con `?firmado=1` sobre un contrato sin firmar es exactamente
  // eso — la pestaña no pinta ese enlace hasta que `pdf_firmado_path` está.
  const firmado = new URL(req.url).searchParams.get("firmado") === "1";
  const r = await rest<{ pdf_path: string | null; pdf_firmado_path: string | null }[]>(
    "GET",
    `contratos?id=eq.${contratoId}&select=pdf_path,pdf_firmado_path`,
  );
  const path = firmado ? r.json?.[0]?.pdf_firmado_path : r.json?.[0]?.pdf_path;
  if (!path) return new Response("not found", { status: 404 });
  const file = await getStorageBytes(path, "contratos");
  if (!file) return new Response("not found", { status: 404 });

  // 🔴 Aquí se separa del molde. `comprobantes:27` fuerza `attachment` para
  // todo lo que no sea imagen, y con esa regla la "vista previa" que pidió
  // Berni descargaría el archivo en vez de enseñarlo.
  //
  // El criterio anti-XSS que motivó aquella línea sigue valiendo donde vale: un
  // comprobante lo SUBE un tercero, y servirlo inline deja que ejecute lo que
  // traiga dentro. Un contrato lo GENERA el propio OS con pdfkit, desde una
  // plantilla nuestra, y vive en un bucket privado donde nadie más escribe.
  // Por eso se relaja aquí y solo aquí.
  //
  // Descargar sigue siendo posible con `?descargar=1`, que es lo que apunta el
  // botón de la pestaña.
  const descargar = new URL(req.url).searchParams.get("descargar") === "1";
  return new Response(file.bytes, {
    headers: {
      "Content-Type": "application/pdf",
      // Servimos inline (a diferencia de comprobantes, que fuerza attachment),
      // así que el `attachment` deja de cubrirnos y la cabecera sí hace falta.
      "X-Content-Type-Options": "nosniff",
      // 🔴 NO se puede cachear como `immutable`, a diferencia de comprobantes y
      // media. Aquellos objetos se escriben una vez; este se PISA: `recorregir`
      // sube de nuevo el mismo `${programa_id}.pdf` (`contrato-envio.ts:551`) y el
      // visor apunta siempre a la misma URL, sin parámetro de versión. Con
      // `immutable` el navegador no revalida ni con un refresco, así que quien
      // recorrige un contrato y pulsa "Ver" recibe el PDF viejo hasta 24 h,
      // concluye que la recorrección falló y la repite — un segundo correo al
      // equipo. Lo levantó la revisión de Milo del 9-sep.
      "Cache-Control": "private, no-cache, must-revalidate",
      // El nombre del fichero dice cuál de los dos es: quien se baja los dos
      // acaba con "contrato.pdf" y "contrato-firmado.pdf" en su carpeta de
      // descargas, y no con dos ficheros del mismo nombre y un (1) al final.
      "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="contrato${firmado ? "-firmado" : ""}.pdf"`,
    },
  });
}
