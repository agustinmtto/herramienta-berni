"use client";
import { useState } from "react";
import Modal from "@/components/Modal";
import ResumenFathom from "@/components/ResumenFathom";
import { dateEs } from "@/lib/format";
import type { LlamadaFathom } from "@/lib/fathom-datos";

/**
 * Las llamadas grabadas de UN cliente, en su ficha.
 *
 * Solo lectura a propósito: aquí se viene a saber qué se habló con esta
 * persona, no a administrar la bandeja. Emparejar, descartar y convertir en
 * sesión viven en /llamadas, que es donde se hace ese trabajo — repartir las
 * mismas acciones por dos pantallas obliga a recordar en cuál estabas.
 */
export default function LlamadasDeCliente({ llamadas }: { llamadas: LlamadaFathom[] }) {
  const [abierta, setAbierta] = useState<LlamadaFathom | null>(null);

  return (
    <>
      <div className="tabla-scroll">
        <table className="t tabla-compacta">
          <thead>
            <tr><th>Fecha</th><th>Tipo</th><th>Quién</th><th className="r">Min</th><th></th></tr>
          </thead>
          <tbody>
            {llamadas.map((l) => (
              <tr key={l.id}>
                <td className="mono">{dateEs(l.inicio)}</td>
                <td>
                  <span className={`badge ${l.tipo === "venta" ? "tipo-ampliacion" : "tipo-nueva"}`}>
                    {l.tipo === "venta" ? "Venta" : "Consultoría"}
                  </span>
                </td>
                <td>{l.grabado_por_nombre ?? "—"}</td>
                <td className="r mono">{l.duracion_min ?? "—"}</td>
                <td>
                  <button type="button" className="linkbtn" onClick={() => setAbierta(l)}>
                    Ver resumen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {abierta && (
        <Modal titulo={abierta.titulo ?? "Llamada"} onCerrar={() => setAbierta(null)}>
          <p className="hint">
            {dateEs(abierta.inicio)} · {abierta.grabado_por_nombre ?? "?"}
            {abierta.duracion_min ? ` · ${abierta.duracion_min} min` : ""}
          </p>
          {abierta.share_url && (
            <p style={{ margin: "12px 0" }}>
              <a href={abierta.share_url} target="_blank" rel="noopener noreferrer" className="btn">
                Abrir en Fathom
              </a>
            </p>
          )}
          <ResumenFathom md={abierta.resumen_md} />
        </Modal>
      )}
    </>
  );
}
