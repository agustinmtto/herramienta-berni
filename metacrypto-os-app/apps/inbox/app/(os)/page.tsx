import { getInicioDatos } from "@/lib/data";
import { hoyMadrid } from "@/lib/timeline";
import { requireModulo } from "@/lib/guard";
import InicioPanel from "@/components/InicioPanel";

export const dynamic = "force-dynamic";

/**
 * Inicio: el estado del negocio de un vistazo, para Berni y Alex.
 *
 * El servidor solo hace tres cosas — comprobar el permiso, leer las filas y
 * decidir qué día es hoy. Todo lo demás (filtrar por rango, comparar dos
 * meses, agregar) ocurre en el navegador, porque son gestos que se repiten
 * muchas veces seguidas y una ida y vuelta por cada uno se nota.
 *
 * `hoyMadrid()` y no `new Date()` en el cliente: qué día es "hoy" para el
 * negocio lo decide Madrid, no el reloj del portátil de quien mira. Si no,
 * alguien en otra zona vería un pacing sobre un día distinto.
 */
export default async function Inicio() {
  await requireModulo("inicio");
  const datos = await getInicioDatos();
  return <InicioPanel datos={datos} hoy={hoyMadrid()} />;
}
