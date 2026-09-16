import { after } from "next/server";
import { contratoPorToken, marcarVisto } from "@/lib/contrato-firma-datos";
import { debeMarcarVisto, estadoDelEnlace, hashPdf, nombreArchivoContrato } from "@/lib/contrato-firma";
import { getStorageBytes } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================
// El PDF del cliente. Clon de `app/api/contratos/[contratoId]/route.ts` con
// OTRA credencial: el token de la URL en vez de la cookie de equipo. El
// cliente no puede usar la ruta interna (exige sesión y módulo "ventas"), y
// esta no sirve un solo byte sin un token vivo.
//
// 🔴 SE SIRVE EL ARCHIVO GUARDADO, NUNCA UNO REGENERADO AL VUELO. El que está
// en Storage es el documento cuyo SHA-256 se guardó en `hash_enviado` al
// mandar el enlace, y es contra ese hash contra el que `firmarContrato`
// compara antes de firmar. Si esta ruta rearmara el PDF desde la plantilla, un
// cambio en el texto entre medias haría que el cliente leyera un documento y
// firmara otro —y que la comprobación de hash rechazara su firma sin que él
// entienda por qué—. Leer los bytes de Storage es lo que hace que «lo que vio»
// y «lo que firmó» sean la misma cosa, demostrable.
//
// 404 en todo lo demás: token inexistente, mal formado, caducado, sin enviar
// o sin archivo. Misma respuesta para todos, como la página.
// ============================================================
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await contratoPorToken(token);
  if (!c) return new Response("not found", { status: 404 });

  const estado = estadoDelEnlace(c, new Date());
  if (estado === "no_activo") return new Response("not found", { status: 404 });

  // Firmado: el firmado. Vivo: el que se le mandó, el del hash. La URL es la
  // misma y el documento cambia con el estado, que es justo lo que quiere el
  // cliente que vuelve a su enlace después de firmar.
  const firmado = estado === "firmado";
  const path = firmado ? c.pdf_firmado_path : c.pdf_path;
  if (!path) return new Response("not found", { status: 404 });
  const file = await getStorageBytes(path, "contratos");
  if (!file) return new Response("not found", { status: 404 });

  // ── 🔴 ¿Sigue siendo ESTE el documento que se mandó? ────────────────────
  // `recorregirContrato` sobrescribe el mismo `${programa_id}.pdf`
  // (contrato-envio.ts:655-657) y NO toca `token`, `hash_enviado`,
  // `enviado_cliente_at` ni `token_expira_at`. O sea: después de recorregir un
  // contrato ya enviado, el enlace del cliente sigue vivo, este fichero es
  // OTRO, y `estadoDelEnlace` sigue diciendo "listo" tan tranquilo.
  //
  // Sin esta comprobación, el cliente se lee entero un documento muerto, marca
  // la casilla, escribe su nombre, y solo entonces `firmarContrato` compara el
  // hash y le devuelve "pide a tu consultor que te lo reenvíe". La cadena de
  // custodia aguanta —no puede firmar lo que no leyó—, pero le hemos hecho
  // perder el tiempo leyendo un contrato que ya no existe.
  //
  // Comparando aquí, ese cliente se encuentra el enlace muerto ANTES de leer,
  // que es la misma respuesta que un token caducado y el mismo consejo. El
  // arreglo de fondo —que recorregir rote el token o se niegue mientras haya
  // un enlace vivo— es de la Task 19.
  //
  // Solo para el sin firmar: el firmado no se vuelve a tocar nunca, y su
  // hash (`hash_firmado`) ni siquiera se lee en esta consulta.
  if (!firmado && (!c.hash_enviado || hashPdf(file.bytes) !== c.hash_enviado)) {
    console.error(
      "[firma] enlace vivo sobre un PDF que ya no es el que se mandó — ¿recorregido sin rotar el token?",
      c.id, path,
    );
    return new Response("not found", { status: 404 });
  }

  // ── La apertura, y por qué se anota AQUÍ y no en la página ──────────────
  // `visto_at` es lo que la pestaña de contratos le dirá a Alex ("el cliente
  // ya lo vio") y los eventos `abierto` son la evidencia de que el documento
  // estuvo delante de alguien antes de firmarse. Las dos cosas mienten si lo
  // primero que consta es el escáner de enlaces del correo de su empresa.
  //
  // El filtro necesita el MÉTODO (los escáneres piden HEAD antes que GET) y
  // eso solo se ve desde un route handler: medido el 16-sep en local, una
  // página RSC se renderiza igual en un HEAD, su `after()` corre igual, y el
  // método no llega ni por `headers()`. De ahí que la marca viva en esta ruta
  // —donde `req.method` sí dice "HEAD"— y no en `page.tsx`.
  //
  // De propina, lo que se anota es MEJOR: desde aquí hay `Request`, así que
  // el evento se lleva la IP, el agente y el país de quien abrió. Desde la
  // página no había ninguno de los tres.
  //
  // Solo con el enlace vivo: quien vuelve a descargar su contrato ya firmado
  // no está "viéndolo antes de firmar", que es lo único que esto afirma.
  if (!firmado && debeMarcarVisto({ metodo: req.method, userAgent: req.headers.get("user-agent") })) {
    // Copia de la petición para el `after`: solo se leen cabeceras y ya están
    // en memoria, pero el original pertenece a una respuesta que a estas
    // alturas ya se ha ido. `after` para no hacer esperar a nadie delante de
    // su contrato porque la traza tarde.
    const evidencia = new Request(req.url, { headers: new Headers(req.headers) });
    after(() => marcarVisto(c, evidencia));
  }

  // `?descargar=1` guarda el archivo en vez de abrirlo, igual que el botón de
  // la pestaña del equipo (`api/contratos/[contratoId]:44`). Lo usa el enlace
  // «Descargar el contrato firmado»: por defecto se sirve `inline` para que el
  // visor de la página lo pinte, pero al cliente que ya ha firmado hay que
  // dejarle quedarse con su copia, y un enlace que dice «descargar» tiene que
  // descargar.
  const descargar = new URL(req.url).searchParams.get("descargar") === "1";
  return new Response(file.bytes, {
    headers: {
      "Content-Type": "application/pdf",
      // Servimos `inline`, así que el navegador va a interpretar el cuerpo:
      // esta cabecera le prohíbe adivinar otro tipo y tratarlo como HTML.
      "X-Content-Type-Options": "nosniff",
      // Sin caché, y aquí importa más que en la ruta interna: el sin firmar se
      // PISA si el equipo recorrige y reenvía (mismo `${programa_id}.pdf`), y
      // la misma URL sirve además un documento distinto en cuanto el contrato
      // pasa a firmado. Un PDF viejo guardado en el móvil del cliente sería un
      // contrato que ya no existe. `private` porque esto no lo cachea nadie
      // por el camino: es de una persona.
      "Cache-Control": "private, no-store",
      // Con el nombre del cliente, igual que el adjunto que le manda el
      // equipo: "contrato.pdf" en la carpeta de descargas de alguien no dice
      // de qué contrato se trata.
      "Content-Disposition":
        `${descargar ? "attachment" : "inline"}; ` +
        `filename="${nombreArchivoContrato(c.personas?.nombre, firmado)}"`,
      // El token está en la URL de este recurso. Sin esto viajaría en el
      // `Referer` de cualquier cosa que el visor de PDF cargue.
      "Referrer-Policy": "no-referrer",
    },
  });
}
