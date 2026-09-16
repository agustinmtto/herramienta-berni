import type { Metadata } from "next";
import { contratoPorToken } from "@/lib/contrato-firma-datos";
import { estadoDelEnlace, hashPdf } from "@/lib/contrato-firma";
import { getStorageBytes } from "@/lib/storage";
import PortalFirma from "@/components/PortalFirma";

// Nunca cacheado ni prerenderizado: cada token es un cliente distinto y una
// respuesta compartida serviría el contrato de uno a otro. Mismo par de
// líneas que `app/e/[token]/page.tsx`.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Tu contrato · MetaCrypto Club",
  // El token va en la URL, así que la URL ES la credencial. `noindex` para que
  // el contrato de nadie acabe en un buscador, y `no-referrer` porque sin él
  // el token viajaría en la cabecera `Referer` a cualquier dominio al que esta
  // página enlace.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function FirmaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { token } = await params;
  const { e } = await searchParams;

  // `null` = inexistente o mal formado. La MISMA pantalla que caducado,
  // revocado o sin enviar: quien prueba enlaces no puede aprender nada de la
  // diferencia (misma decisión que el portal de estrategias).
  const c = await contratoPorToken(token);
  if (!c) return <PortalFirma tipo="no_activo" />;

  // La decisión entera —firmado gana a todo, caducado cierra, fecha corrupta
  // cierra— vive en `estadoDelEnlace`, que es total y tiene tests. Aquí no se
  // vuelve a decidir nada: solo se pinta.
  const estado = estadoDelEnlace(c, new Date());
  if (estado === "no_activo") return <PortalFirma tipo="no_activo" />;
  if (estado === "firmado") {
    return <PortalFirma tipo="firmado" token={token} firmadoPor={c.firma_nombre} />;
  }

  // 🔴 EL SEGUNDO CERROJO: ¿el PDF guardado sigue siendo el que se mandó?
  //
  // `recorregirContrato` sobrescribe el mismo `${programa_id}.pdf`
  // (contrato-envio.ts:655-657) y no toca ni el token ni `hash_enviado` ni las
  // fechas del enlace. Un contrato recorregido DESPUÉS de enviarse deja, por
  // tanto, un enlace vivo apuntando a otro documento.
  //
  // `/c/<token>/pdf` ya lo comprueba y responde 404, pero eso mata el
  // documento, no la pantalla: sin esta comprobación el cliente se queda
  // mirando su formulario de firma con el visor en blanco — un formulario que
  // no puede enviar, sobre un documento que no está. Aquí el enlace se apaga
  // entero y lee lo mismo que uno caducado: escríbenos y te mandamos el tuyo.
  //
  // Y no sobra con lo que hará la Task 19, que impedirá que la aplicación cree
  // este estado: las dos protegen cosas distintas. Aquélla impide que el
  // estado se genere; ésta impide que el cliente lea el documento equivocado
  // si el estado existe de todas formas — una edición a mano en la base, una
  // carrera, un camino que todavía no existe. En la única pantalla donde el
  // fallo es «el cliente lee lo que no es», dos cerrojos valen lo que cuestan.
  //
  // El coste es una lectura de Storage por carga, y aquí no es nada: esta
  // página la abre su dueño dos o tres veces en toda la vida del contrato. No
  // es una ruta de tráfico.
  //
  // Falla cerrado, con una consecuencia que conviene tener presente: si
  // Storage no responde, `getStorageBytes` devuelve `null` igual que si el
  // fichero no existiera, y el cliente ve «este enlace ya no está activo»
  // teniendo un contrato perfectamente bueno. Es lo correcto de todas formas:
  // con Storage caído `firmarContrato` tampoco podría comprobar el hash, así
  // que el formulario que le enseñáramos sería un formulario que no puede
  // firmar. Entre las dos malas, la que no le hace perder el tiempo.
  const enviado = c.pdf_path ? await getStorageBytes(c.pdf_path, "contratos") : null;
  if (!enviado || !c.hash_enviado || hashPdf(enviado.bytes) !== c.hash_enviado) {
    console.error(
      "[firma] enlace vivo sobre un PDF que ya no es el que se mandó (o ilegible) — ¿recorregido sin rotar el token?",
      c.id, c.pdf_path,
    );
    return <PortalFirma tipo="no_activo" />;
  }

  // 🔴 AQUÍ NO SE MARCA LA APERTURA, y es deliberado. Esta página la puede
  // pedir cualquiera: el escáner de enlaces del correo corporativo del
  // cliente, o la previsualización de una mensajería. Marcarla desde aquí
  // pondría `visto_at` —lo que la pestaña de contratos le dirá a Alex— antes
  // de que el cliente haya abierto nada.
  //
  // Y desde una página no se puede filtrar: medido el 16-sep en local, una
  // página RSC se renderiza igual ante un HEAD (que es lo primero que pide un
  // escáner), su `after()` corre igual, y el método no llega ni por
  // `headers()`. Así que la marca vive en `/c/<token>/pdf`, que es un route
  // handler, ve `req.method` y filtra con `debeMarcarVisto`. Además es una
  // afirmación más fuerte: allí consta que se sirvieron los BYTES del
  // documento, no que algo pidió esta página.

  return (
    <PortalFirma
      tipo="listo"
      token={token}
      nombre={c.personas?.nombre}
      // `e` es lo que devuelve el POST al fallar; un valor que no esté en el
      // mapa de errores se pinta como nada, no como un mensaje inventado.
      error={e ?? null}
    />
  );
}
