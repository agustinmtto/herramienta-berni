import { getGastos } from "@/lib/data";
import GastosPanel from "@/components/GastosPanel";
import { requireModulo } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function GastosPage() {
  await requireModulo("gastos");
  const gastos = await getGastos();

  // Zona horaria de Madrid, NO UTC. Este componente corre en el servidor
  // (Vercel = UTC) y `toISOString()` a las 00:30 en Madrid devuelve el día
  // anterior — el 1 de septiembre a las 00:30 la pantalla arrancaría en
  // agosto y el mes en curso no saldría en la lista. Es la misma trampa
  // documentada en cuotas/page.tsx.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

  // Toda la pantalla vive en el cliente: el servidor manda las filas una vez y
  // cambiar de mes es instantáneo, sin ida y vuelta. Mismo patrón que Inicio.
  return <GastosPanel gastos={gastos} hoy={hoy} />;
}
