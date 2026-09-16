import { getClientesParaVenta, getTiersVendibles, getTeamMembers } from "@/lib/data";
import { requireModulo } from "@/lib/guard";
import VentaForm from "@/components/VentaForm";

export const dynamic = "force-dynamic";

// Este segmento hospeda las server actions que se llaman desde el formulario:
// `crearVenta` (de la que cuelgan dos `after()`, los dos avisos del cierre) y
// `generarContratoAction`, que es la cara.
//
// Desde el 16-sep el contrato ya no corre en un `after()` sino DENTRO de la
// petición del closer: cinco lecturas, pdfkit, subida a Storage e insert, con
// él mirando la pantalla. O sea que este techo importa más que antes, no
// menos — antes un corte dejaba el contrato sin mandar y nadie se enteraba;
// ahora deja al closer con "Generando el contrato…" hasta que la petición
// muere. En local no hay techo; en Vercel se hereda el `maxDuration` por
// defecto. Se declara explícito en vez de confiar en él.
export const maxDuration = 60;

export default async function NuevaVentaPage() {
  await requireModulo("ventas");
  const [clientes, tiers, team] = await Promise.all([
    getClientesParaVenta(),
    getTiersVendibles(),
    getTeamMembers(),
  ]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Nueva venta</h1>
        <p>Compra nueva, ascensión o extensión — crea cliente, programa, pago y cuotas en el OS</p>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Registrar venta</h2>
          <span className="hint">se guarda todo junto: si algo falla, no se guarda nada</span>
        </div>
        <div className="card-body-pad">
          {/* La env var se lee AQUÍ, en el servidor: `process.env` no existe
              en el navegador y `VentaForm` es un componente cliente. Desde el
              16-sep esta bandera ya no gatea un `after()` — gatea si al
              registrar una venta con contrato (compra nueva o ascensión) se
              abre el modal con él. */}
          <VentaForm
            clientes={clientes}
            tiers={tiers}
            team={team}
            contratoActivo={process.env.CONTRATO_ACTIVO === "true"}
          />
        </div>
      </div>
    </div>
  );
}
