import Link from "next/link";
import { getCuotasDetalle, getCashToBe, getFlujoFuturo } from "@/lib/data";
import { money, num, monthLabel, dateEs } from "@/lib/format";
import { requireModulo } from "@/lib/guard";
import { clasificarCuota, diasRetraso, money2, type GrupoCuota } from "@/lib/cuotas";
import CuotaAcciones from "@/components/CuotaAcciones";
import NuevaCuota from "@/components/NuevaCuota";
import type { CuotaDetalle } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CuotasPage() {
  await requireModulo("cuotas");
  const [todas, toBe, flujo] = await Promise.all([
    getCuotasDetalle(), getCashToBe(), getFlujoFuturo(),
  ]);
  // Una sola fecha de corte para toda la página: evita que dos filas se
  // clasifiquen con relojes distintos si la petición cruza la medianoche.
  //
  // Zona horaria de Madrid, NO UTC: este componente corre en el servidor
  // (Vercel = UTC), y `new Date().toISOString()` ya causó exactamente este
  // bug una vez — ver el comentario en VentaForm.tsx:23-27 (allí en cliente,
  // corregido con la fecha local del navegador). A las 00:30 en Madrid,
  // toISOString() da el día anterior: la cuota se clasifica/premarca con la
  // fecha equivocada y el dinero cruza de mes en el KPI norte del negocio.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

  const pendientes = todas.filter((c) => c.estado === "pendiente");
  const grupos: Record<GrupoCuota, CuotaDetalle[]> = { vencida: [], mes: [], futura: [] };
  for (const c of pendientes) grupos[clasificarCuota(c.fecha_vencimiento, hoy)].push(c);

  // Cobradas: es donde vive el botón Deshacer. Sin este bloque no habría forma
  // de revertir un pago desde la interfaz. Las más recientes primero.
  // Anuladas: el cliente al que se dio de baja. No cuentan en ningún KPI
  // (las vistas filtran `pendiente`), pero se enseñan para que la decisión
  // quede a la vista y se pueda revertir — no para que estorben.
  const anuladas = todas
    .filter((c) => c.estado === "anulada")
    .sort((a, b) => b.fecha_vencimiento.localeCompare(a.fecha_vencimiento));

  const cobradas = todas
    .filter((c) => c.estado === "pagada")
    .sort((a, b) => (b.abonos.at(-1)?.fecha ?? "").localeCompare(a.abonos.at(-1)?.fecha ?? ""))
    .slice(0, 30);

  // `monto` es el pendiente mientras la cuota está viva, pero en una cuota YA
  // CERRADA queda congelado en lo último que faltaba — no en lo cobrado. Una
  // cuota de 1.500 pagada en 1.000 + 500 tiene monto=500 (el último abono),
  // no 1.500. Para el bloque de cobradas hay que sumar los abonos reales.
  const cobrado = (c: CuotaDetalle) => c.abonos.reduce((s, a) => s + a.monto, 0);
  const suma = (cs: CuotaDetalle[], porCobrado = false) =>
    cs.reduce((s, c) => s + (porCobrado ? cobrado(c) : c.monto), 0);
  const toBeEur = toBe.find((t) => t.divisa === "EUR");
  const proximo = flujo[0];

  // Programas con cuotas ya conocidas, para el selector de "+ Añadir cuota".
  const programas = [...new Map(
    todas.filter((c) => c.persona_nombre)
         .map((c) => [c.programa_id, { id: c.programa_id, etiqueta: c.persona_nombre! }]),
  ).values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));

  const Bloque = ({ titulo, cuotas, tono, porCobrado }: {
    titulo: string; cuotas: CuotaDetalle[]; tono?: string;
    // true SOLO para "Cobradas recientemente": ahí el importe a mostrar (fila
    // y subtotal) es lo efectivamente cobrado, no `monto` (ver comentario de
    // `cobrado()` más arriba). Los tres bloques de pendientes siguen usando
    // `monto`, que es lo correcto para ellos (por cobrar/outstanding).
    porCobrado?: boolean;
  }) => (
    <div className="card bloque">
      <div className="card-head">
        <h2>{titulo}</h2>
        <span className={`hint ${tono ?? ""}`}>{cuotas.length} · {money(suma(cuotas, porCobrado))}</span>
      </div>
      <div className="card-body">
        <div className="tabla-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Vencimiento</th><th>Cliente</th><th className="r">Cuota nº</th>
                <th className="r">Importe</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cuotas.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    {/* Antes decía "Ninguna." y ya está. Un bloque de cuotas
                        vacío casi siempre es una buena noticia —no hay nada
                        vencido— y merece decirse así, no como un hueco. */}
                    <div className="empty-box">Ninguna cuota en este bloque.</div>
                  </td>
                </tr>
              )}
              {cuotas.map((c) => {
                const retraso = diasRetraso(c.fecha_vencimiento, hoy);
                return (
                  <tr key={c.id}>
                    <td className="mono">
                      {dateEs(c.fecha_vencimiento)}
                      {c.estado === "pendiente" && retraso > 0 && <span className="pill red"> {retraso} d</span>}
                    </td>
                    {/* `persona_id` viajaba en la fila (lib/types.ts:91) y
                        tenía cero usos en toda la pantalla. Desde una cuota
                        vencida hay que poder abrir la ficha de quien la debe.
                        Puede ser null en una cuota huérfana: entonces se pinta
                        el nombre sin enlace, no un enlace roto. */}
                    <td>
                      {c.persona_id && c.persona_nombre
                        ? <Link href={`/clientes/${c.persona_id}`} className="linkbtn">{c.persona_nombre}</Link>
                        : (c.persona_nombre ?? "—")}
                    </td>
                    <td className="r">{c.numero_cuota ?? "—"}</td>
                    <td className="r mono gold">
                      {money2(porCobrado ? cobrado(c) : c.monto, c.divisa)}
                      {c.abonos.length > 0 && (
                        <div className="nota-celda">
                          abonado: {c.abonos.map((a) => money2(a.monto, c.divisa)).join(" + ")}
                        </div>
                      )}
                    </td>
                    <td>
                      {c.estado === "pagada"
                        ? <span className="pill green">pagada</span>
                        : c.estado === "anulada"
                          ? <span className="pill red">anulada</span>
                          : c.fecha_inferida
                            ? <span className="pill">inferida</span>
                            : <span className="pill green">exacta</span>}
                      {c.estado === "anulada" && c.ultimo_cambio?.motivo && (
                        <div className="nota-celda">
                          {c.ultimo_cambio.motivo}
                        </div>
                      )}
                      {c.ultimo_cambio && (
                        <div className="nota-celda">
                          {c.ultimo_cambio.autor ?? "—"} · {dateEs(c.ultimo_cambio.created_at.slice(0, 10))}
                        </div>
                      )}
                    </td>
                    <td><CuotaAcciones cuota={c} hoy={hoy} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Cuotas</h1>
        <p>Cobra, corrige y programa las cuotas de los planes de pago</p>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Vencido</div>
          <div className="value neg">{money(suma(grupos.vencida))}</div>
          <div className="sub">{grupos.vencida.length} cuotas sin cobrar</div>
        </div>
        <div className="kpi">
          <div className="label">Por cobrar total</div>
          <div className="value gold">{money(toBeEur?.cash_to_be_collected)}</div>
          <div className="sub">{toBeEur?.n_cuotas ?? 0} cuotas · incluye lo vencido</div>
        </div>
        <div className="kpi">
          <div className="label">Próximo mes</div>
          <div className="value">{proximo ? money(proximo.por_cobrar) : "—"}</div>
          <div className="sub">{proximo ? `${monthLabel(proximo.mes)} · ${proximo.n_cuotas} cuotas` : "—"}</div>
        </div>
        <div className="kpi">
          <div className="label">Este mes</div>
          <div className="value">{num(grupos.mes.length)}</div>
          <div className="sub">{money(suma(grupos.mes))}</div>
        </div>
      </div>

      <div className="note note-con-accion">
        <span>
          Las fechas <span className="pill">inferida</span> se reprogramaron al importar de Airtable.
          Corrígelas con “Editar” cuando confirmes el calendario real.
        </span>
        <NuevaCuota programas={programas} />
      </div>

      <Bloque titulo="Vencidas" cuotas={grupos.vencida} tono="neg" />
      <Bloque titulo="Vence este mes" cuotas={grupos.mes} />
      <Bloque titulo="Futuras" cuotas={grupos.futura} />
      <Bloque titulo="Cobradas recientemente" cuotas={cobradas} porCobrado />
      {/* Solo si hay alguna: un bloque vacío permanente es ruido. */}
      {anuladas.length > 0 && <Bloque titulo="Anuladas" cuotas={anuladas} tono="muted" />}
    </div>
  );
}
