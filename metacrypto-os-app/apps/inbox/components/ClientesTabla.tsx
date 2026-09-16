"use client";
// La tabla de Clientes: ordenable y filtrable por columna (Berni, CL-9).
// Mismo patrón que components/DevolucionesTabla.tsx (Th con aria-sort).
import { useMemo, useState } from "react";
import type { ClienteRow } from "@/lib/data";
import { num, dateEs } from "@/lib/format";
import { evaluarBienvenida } from "@/lib/bienvenida";
import { etiquetaEstado } from "@/lib/persona";
import {
  ordenar, filtrar, siguienteOrden, ORDEN_INICIAL,
  type ColumnaClientes,
} from "@/lib/clientes-vista";
import BotonBienvenida from "@/components/BotonBienvenida";
import FichaEnPanel from "@/components/FichaEnPanel";
import { IconoLink } from "@/components/Iconos";

const COLUMNAS: { col: ColumnaClientes; titulo: string; placeholder: string }[] = [
  { col: "nombre", titulo: "Nombre", placeholder: "buscar…" },
  { col: "pais", titulo: "País", placeholder: "país" },
  { col: "tier", titulo: "Tier activo", placeholder: "tier" },
  { col: "coach", titulo: "Consultor", placeholder: "consultor" },
  { col: "fecha_inicio", titulo: "Inicio", placeholder: "03 mar 28" },
  { col: "fecha_fin", titulo: "Fin de programa", placeholder: "03 mar 28" },
  // Berni, CAMBIOS OS: «la columna de Estado (cliente o ex-cliente) no es
  // necesaria». Y tiene razón: desde el 10-sep la lista trae SOLO clientes
  // vivos, así que la columna decía "cliente" en todas las filas — un dato que
  // no distingue nada ocupando una columna en una tabla que ya va justa en
  // móvil. Los ex-clientes y los OG's viven en su propia vista.
];

export default function ClientesTabla({
  clientes,
  puedeBienvenida,
}: {
  clientes: ClienteRow[];
  puedeBienvenida: boolean;
}) {
  const [criterio, setCriterio] = useState(ORDEN_INICIAL);
  const [filtros, setFiltros] = useState<Partial<Record<ColumnaClientes, string>>>({});

  const vistos = useMemo(
    () => ordenar(filtrar(clientes, filtros), criterio),
    [clientes, filtros, criterio],
  );

  const Th = ({ col, titulo }: { col: ColumnaClientes; titulo: string }) => (
    <th aria-sort={
      criterio.col !== col ? "none" : criterio.dir === "asc" ? "ascending" : "descending"
    }>
      <button type="button" className="th-orden" onClick={() => setCriterio((c) => siguienteOrden(c, col))}>
        {titulo}
        <span className="th-flecha" aria-hidden="true">
          {criterio.col !== col ? "↕" : criterio.dir === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="tabla-scroll">
      <table className="t">
        <thead>
          <tr>
            {COLUMNAS.map((c) => <Th key={c.col} col={c.col} titulo={c.titulo} />)}
            {puedeBienvenida && <th>Bienvenida</th>}
          </tr>
          <tr>
            {COLUMNAS.map((c) => (
              <th key={c.col}>
                <input
                  type="text"
                  className="th-filtro"
                  placeholder={c.placeholder}
                  value={filtros[c.col] ?? ""}
                  onChange={(e) => setFiltros((f) => ({ ...f, [c.col]: e.target.value }))}
                />
              </th>
            ))}
            {puedeBienvenida && <th></th>}
          </tr>
        </thead>
        <tbody>
          {vistos.length === 0 ? (
            <tr>
              <td colSpan={COLUMNAS.length + (puedeBienvenida ? 1 : 0)} className="muted">
                Ningún cliente coincide con el filtro.
              </td>
            </tr>
          ) : (
            vistos.map((c) => {
              const bienvenida = evaluarBienvenida(c);
              return (
                <FichaEnPanel key={c.id} personaId={c.id}>
                  <td className="nom">
                    <div>
                      {c.nombre || "—"}
                      {c.landing_url && (
                        <a href={c.landing_url} target="_blank" rel="noreferrer"
                           className="linkbtn" title="Ver su landing">
                          {" "}<IconoLink />
                        </a>
                      )}
                      {/* Solo en los vivos: en un archivado que no se va a
                          contactar nunca, el aviso sería ruido permanente. */}
                      {c.estado === "cliente" && !c.telefono_e164 && (
                        <span className="pill red" title="Añade el teléfono desde su ficha"> sin tel.</span>
                      )}
                    </div>
                    <button type="button" className="btn btn-ver-sesiones" data-abrir-panel
                            data-seccion="sesiones-detalle" title="Ver sus sesiones">
                      ver sesiones
                    </button>
                  </td>
                  <td>{c.pais || "—"}</td>
                  <td>{c.tier ? <span className="pill gold">{c.tier}</span> : <span className="muted">—</span>}</td>
                  <td>{c.coach?.nombre || <span className="muted">—</span>}</td>
                  <td className="mono">{dateEs(c.fecha_inicio)}</td>
                  <td className="mono">{dateEs(c.fecha_fin)}</td>
                  {puedeBienvenida && (
                    <td>
                      {bienvenida.pendiente && (
                        <div>
                          {/* Apilado y no en línea: mismo patrón que la celda
                              "Nombre" (texto arriba, botón debajo) — con los
                              dos en línea, "Pendiente" quedaba a una altura
                              distinta que el resto de la fila. Por ahora el
                              botón va debajo; si hace falta un lugar fijo
                              para acciones de fila, se revisa aparte. */}
                          <span className="pill blue">Pendiente</span>
                          <br />
                          <BotonBienvenida personaId={c.id} etiqueta="Enviar" />
                        </div>
                      )}
                      {bienvenida.motivo === "sin_telefono" && (
                        <span className="muted">falta teléfono</span>
                      )}
                    </td>
                  )}
                </FichaEnPanel>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
