"use client";
import { Fragment, useState } from "react";
import type { DevolucionFila } from "@/lib/types";
import FichaEnPanel from "@/components/FichaEnPanel";
import { money, dateEs } from "@/lib/format";
import {
  ordenar, siguienteOrden, resumenMotivo, ORDEN_INICIAL,
  type ColumnaOrden,
} from "@/lib/devoluciones-vista";
import ClasificarDevolucion from "@/components/ClasificarDevolucion";
import DevolucionRecibo from "@/components/DevolucionRecibo";

const TITULO_ALCANCE: Record<string, string> = {
  total: "Programa entero",
  parcial: "Un cobro",
  sin_clasificar: "Sin clasificar",
};

export default function DevolucionesTabla({
  filas,
  nombres,
}: {
  filas: DevolucionFila[];
  nombres: Record<string, string>;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const [motivoAbierto, setMotivoAbierto] = useState<string | null>(null);
  // Ordenar por cualquier columna. El criterio inicial sigue siendo el de
  // antes —lo más reciente arriba— y las sin clasificar mantienen su
  // prioridad al ordenar por alcance: son trabajo pendiente, no una categoría
  // más del alfabeto. Ver lib/devoluciones-vista.ts.
  const [criterio, setCriterio] = useState(ORDEN_INICIAL);
  const orden = ordenar(filas, criterio);

  /** Cabecera pulsable. La flecha dice por dónde se ordena y hacia dónde. */
  const Th = ({ col, children, clase }: {
    col: ColumnaOrden; children: React.ReactNode; clase?: string;
  }) => (
    <th className={clase} aria-sort={
      criterio.col !== col ? "none" : criterio.dir === "asc" ? "ascending" : "descending"
    }>
      <button type="button" className="th-orden"
              onClick={() => setCriterio((c) => siguienteOrden(c, col))}>
        {children}
        <span className="th-flecha" aria-hidden="true">
          {criterio.col !== col ? "↕" : criterio.dir === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="card bloque">
      <div className="card-head">
        <h2>Movimientos</h2>
        <span className="hint">pulsa una cabecera para reordenar</span>
      </div>
      <div className="card-body">
        <div className="tabla-scroll">
          <table className="t">
            <thead>
              <tr>
                <Th col="fecha">Fecha</Th>
                <Th col="cliente">Cliente</Th>
                <Th col="alcance">Alcance</Th>
                <Th col="importe" clase="r">Devuelto</Th>
                <th>Por qué</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {orden.map((d) => {
                const pendiente = d.alcance === "sin_clasificar";
                const heredada = d.n_efectos === 0;
                return (
                  <Fragment key={d.devolucion_id}>
                    <tr>
                      <td className="mono">{dateEs(d.fecha)}</td>
                      {/* Una devolución cierra al cliente y le anula las cuotas:
                          desde aquí hay que poder ir a ver en qué quedó su
                          ficha. `persona_id` ya viajaba en la fila. */}
                      <td>
                        <FichaEnPanel personaId={d.persona_id} pagoId={d.devolucion_id} as="div">
                          {d.persona_nombre}
                        </FichaEnPanel>
                      </td>
                      <td>
                        <span className={`pill ${pendiente ? "red" : "gris"}`}>
                          {TITULO_ALCANCE[d.alcance] ?? d.alcance}
                        </span>
                      </td>
                      <td className="r mono">
                        {d.usd_recibido != null ? money(d.usd_recibido, "USD") : "—"}
                      </td>
                      {/* El "por qué" de la devolución. En los datos reales
                          conviven motivos de catálogo y un mensaje de WhatsApp
                          entero pegado en el campo: se recorta por palabra y se
                          ofrece el resto, en vez de cortarlo con puntos
                          suspensivos y perder justo lo que se viene a leer. */}
                      <td className="dev-motivo">
                        {(() => {
                          const bruto = d.motivo ?? (heredada ? "Heredada de Airtable" : null);
                          if (!bruto) return <span className="muted">sin motivo anotado</span>;
                          const abierto = motivoAbierto === d.devolucion_id;
                          const { texto, recortado } = resumenMotivo(bruto);
                          return (
                            <>
                              <span>{abierto ? bruto : texto}</span>
                              {recortado && (
                                <>
                                  {!abierto && "… "}
                                  <button type="button" className="linkbtn"
                                          onClick={() => setMotivoAbierto(abierto ? null : d.devolucion_id)}>
                                    {abierto ? "ver menos" : "ver entero"}
                                  </button>
                                </>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td>
                        <div className="fila-acciones">
                          {!heredada && (
                            <button
                              type="button"
                              className="linkbtn"
                              aria-expanded={abierta === d.devolucion_id}
                              onClick={() =>
                                setAbierta(abierta === d.devolucion_id ? null : d.devolucion_id)
                              }
                            >
                              {d.n_efectos} efectos
                            </button>
                          )}
                          <ClasificarDevolucion
                            devolucionId={d.devolucion_id}
                            personaId={d.persona_id}
                            pendiente={pendiente}
                          />
                        </div>
                      </td>
                    </tr>
                    {abierta === d.devolucion_id && (
                      <tr>
                        <td colSpan={6}>
                          <DevolucionRecibo id={d.devolucion_id} nombres={nombres} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {orden.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Ninguna devolución este año.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
