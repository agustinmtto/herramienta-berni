import { after } from "next/server";
import { firmarContrato } from "@/lib/contrato-firma-datos";
import { validarFormularioFirma, RE_TOKEN } from "@/lib/contrato-firma";
import { avisarContratoFirmado } from "@/lib/push-envio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// pdfkit + Storage + dos escrituras: mismo techo que nueva-venta.
export const maxDuration = 60;

// ============================================================
// El POST que firma. Lo dispara un formulario de dos campos que funciona SIN
// JavaScript (`<form method="post" action="/api/contratos/firmar">` en
// PortalFirma), así que aquí no hay JSON, ni server action, ni respuesta que
// nadie vaya a leer con `fetch`: solo `formData` y un redirect.
//
// 🔴 POST → 303 → GET, y el 303 es el detalle que importa. Un 302 dejaría que
// el navegador repitiera el método en el destino; el 303 obliga a un GET. Así
// el cliente acaba SIEMPRE en `/c/<token>` pedida con GET, y recargar esa
// página —o darle a "atrás"— vuelve a pedir la página, nunca a reenviar el
// formulario: no hay segunda firma, ni el aviso de "¿reenviar datos?" delante
// de alguien que acaba de firmar un contrato. (La idempotencia real la
// garantiza `firmarContrato` con su PATCH condicionado; esto es la capa del
// navegador, que es la que el cliente ve.)
//
// Siempre se vuelve a /c/<token>: es la página la que decide qué enseñar
// (firmado, enlace muerto, o el formulario con el error). Esta ruta NUNCA
// revela por qué un token no vale — mismo criterio que la página y el visor.
//
// Es una ruta ESTÁTICA (`/api/contratos/firmar`, sin segmento dinámico) a
// propósito: renderiza un PDF, y las fuentes de pdfkit solo viajan al lambda
// por una clave de `outputFileTracingIncludes`, donde todas las claves que hay
// son literales. El token viaja en el cuerpo del formulario, no en la ruta.
// ============================================================
export async function POST(req: Request) {
  // `formData()` LANZA si el cuerpo no es un formulario, y esto es una ruta
  // pública: cualquiera puede mandarle un JSON y convertir el fallo en un 500.
  // Un 400 mudo es la respuesta honesta — no viene de un navegador nuestro.
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const token = String(fd.get("token") ?? "").trim();
  // Sin token válido no se toca la base: el 404 se decide aquí, con un regex,
  // y no hay adónde redirigir porque `/c/<basura>` no es una URL nuestra.
  if (!RE_TOKEN.test(token)) return new Response("not found", { status: 404 });

  // El token ya pasó `RE_TOKEN` (letras, dígitos, `-` y `_`), así que se puede
  // interpolar tal cual: no hay nada que escapar. Los `e` son un juego cerrado
  // de literales nuestros, los cuatro que `PortalFirma` sabe pintar.
  //
  // 🔴 CON `?e=` VA SIEMPRE `#firma`, Y NO ES COSMÉTICO. `.firma-error` vive
  // DENTRO del formulario, o sea debajo de un visor de PDF de 70vh. Sin ancla,
  // el 303 deja al cliente al principio de la página y en un móvil un envío
  // fallido parece que no hizo NADA: el mismo visor otra vez y ningún mensaje
  // a la vista. Vuelve a pulsar, vuelve a fallar, y acaba escribiéndole a Alex.
  //
  // Es media solución a propósito, y la otra media la pone la página: además
  // del ancla, el mensaje de error se pinta ENCIMA del visor. Las dos, porque
  // el ancla sola no basta si el navegador la ignora y el mensaje arriba solo
  // no basta si el visor es largo.
  //
  // SIN `?e=` NO hay ancla, y también a propósito: ese es el camino de "ya está
  // firmado", donde la pantalla es otra —la de "Perfecto, contrato firmado"— y
  // el cliente tiene que verla desde arriba, no a media altura.
  //
  // `no_activo` se lleva el ancla aunque su pantalla no tenga `id="firma"`: un
  // fragmento que no existe deja al navegador donde ya estaba, arriba, que es
  // justo lo que esa pantalla quiere. Exceptuarlo sería una regla más que
  // recordar a cambio de nada.
  const volver = (e?: string) =>
    Response.redirect(new URL(`/c/${token}${e ? `?e=${e}#firma` : ""}`, req.url), 303);

  const v = validarFormularioFirma({ nombre: fd.get("nombre"), acepto: fd.get("acepto") });
  if (!v.ok) return volver(v.error);

  const r = await firmarContrato(token, v.nombre, req);
  if (r.ok) {
    // El aviso al equipo (campana + push, como el de cierres): DENTRO de
    // `after()` para que nadie delante de su contrato espere a que salga un
    // push, y solo en esta rama — es una firma que ocurrió de verdad, no un
    // `motivo: "firmado"` (doble envío). Sin monto ni tier, misma regla que
    // el aviso de cierres.
    after(() => avisarContratoFirmado(r.contratoId, r.personaId));
    return volver();
  }

  // "firmado" vuelve LIMPIO, sin `?e=`: no es un error del cliente sino un
  // doble envío o un enlace que ya se usó, y la página le va a enseñar su
  // contrato firmado, que es el final bueno. Enseñarle un mensaje rojo encima
  // sería mentirle. "no_activo" tampoco tiene mensaje en el mapa de errores:
  // la página ya pinta la pantalla de enlace muerto por su cuenta.
  return volver(r.motivo === "firmado" ? undefined : r.motivo);
}
