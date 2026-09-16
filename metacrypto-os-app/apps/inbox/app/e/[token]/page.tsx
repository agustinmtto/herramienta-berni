import type { Metadata } from "next";
import {
  accesoPorToken, estrategiasVisiblesDeCliente, marcarAcceso,
} from "@/lib/estrategias-datos";
import { estrategiasParaCliente, fechaLarga, resumenCliente } from "@/lib/estrategias";
import PortalEstrategias from "@/components/PortalEstrategias";

// Nunca cacheado ni prerenderizado: cada token es una persona distinta y una
// respuesta compartida serviría el patrimonio de un cliente a otro.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Tus estrategias · MetaCrypto Club",
  // El token va en la URL, así que la URL ES la credencial. `noindex` para que
  // no acabe en un buscador, y `no-referrer` para que al abrir la estrategia
  // en GoHighLevel el token no viaje en la cabecera Referer a un tercero.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const acceso = await accesoPorToken(token);

  // MISMA pantalla para token inexistente, mal formado y revocado. Distinguirlos
  // le confirmaría a quien pruebe enlaces cuáles existen.
  if (!acceso) return <PortalEstrategias tipo="sin-acceso" />;

  const [filas] = await Promise.all([
    estrategiasVisiblesDeCliente(acceso.persona_id),
    marcarAcceso(acceso.persona_id),
  ]);

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
  const suyas = estrategiasParaCliente(filas, hoy);

  return (
    <PortalEstrategias
      tipo="ok"
      nombre={(acceso.nombre ?? "").trim().split(/\s+/)[0] || null}
      resumen={resumenCliente(suyas.map((e) => e.fecha_lanzamiento))}
      estrategias={suyas.map((e) => ({
        id: e.id,
        titulo: e.titulo,
        url: e.url,
        password: e.password,
        resumen: e.resumen,
        fecha: fechaLarga(e.fecha_lanzamiento),
      }))}
    />
  );
}
