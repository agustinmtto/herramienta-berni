"use client";
// El "Desglose" de Comisiones: ordenable y filtrable por columna (Berni,
// CO-3). Mismo patrón que components/DevolucionesTabla.tsx (Th con aria-sort).
import { useMemo, useState } from "react";
import { moneyExacta, dateEs, colorPersona } from "@/lib/format";
import {
  ordenar, filtrar, siguienteOrden, ORDEN_INICIAL,
  type ColumnaDesglose, type FilaDesglose,
} from "@/lib/comisiones-vista";

const COLUMNAS: { col: ColumnaDesglose; titulo: string; clase?: string }[] = [
  { col: "fecha", titulo: "Fecha" },
  { col: "cliente", titulo: "Cliente" },
  { col: "fuente", titulo: "Fuente" },
  { col: "rol", titulo: "Rol" },
  { col: "quien", titulo: "Quién" },
  { col: "base", titulo: "Base", clase: "r" },
  { col: "tasa", titulo: "%", clase: "r" },
  { col: "importe", titulo: "Importe", clase: "r" },
];

export default function DesgloseComisiones({ filas, colorRolDe }: {
  filas: FilaDesglose[];
  colorRolDe: Record<string, string>;
}) {
  const [criterio, setCriterio] = useState(ORDEN_INICIAL);
  const [filtros, setFiltros] = useState<Partial<Record<ColumnaDesglose, string>>>({});

  const vistas = useMemo(
    () => ordenar(filtrar(filas, filtros), criterio),
    [filas, filtros, criterio],
  );

  const Th = ({ col, titulo, clase }: { col: ColumnaDesglose; titulo: string; clase?: string }) => (
    <th className={clase} aria-sort={
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

  if (filas.length === 0) {
    return <div className="empty-box">Sin líneas calculadas este mes.</div>;
  }

  return (
    <table className="t">
      <thead>
        <tr>{COLUMNAS.map((c) => <Th key={c.col} col={c.col} titulo={c.titulo} clase={c.clase} />)}</tr>
        <tr>
          {COLUMNAS.map((c) => (
            <th key={c.col} className={c.clase}>
              <input
                type="text"
                className="th-filtro"
                placeholder="filtrar…"
                value={filtros[c.col] ?? ""}
                onChange={(e) => setFiltros((f) => ({ ...f, [c.col]: e.target.value }))}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {vistas.length === 0 ? (
          <tr><td colSpan={COLUMNAS.length} className="muted">Ninguna línea coincide con el filtro.</td></tr>
        ) : (
          vistas.map((f) => {
            const cColor = colorPersona(f.team_member_id);
            // Misma franja que en Sesiones: solo la paleta fija de consultores
            // (prefijo "c-"), nunca el hash genérico que reutiliza verde/rojo/
            // azul — esos ya significan otra cosa (tasa 0%, importe, etc.).
            const franja = cColor.startsWith("c-") ? `r-${cColor.slice(2)}` : "";
            return (
            <tr key={f.clave} className={franja}>
              <td className="mono">{f.fecha ? dateEs(f.fecha) : "—"}</td>
              <td>{f.cliente}</td>
              <td className="muted">{f.fuente ?? "—"}</td>
              <td><span className={`pill ${colorRolDe[f.rol] ?? ""}`}>{f.rolEtiqueta}</span></td>
              <td><span className={`pill ${cColor}`}>{f.quien}</span></td>
              <td className="r mono">{moneyExacta(f.base, "USD")}</td>
              <td className="r mono muted">{Math.round(f.tasa * 100)}%</td>
              <td className={`r mono ${f.tasa === 0 ? "muted" : "gold"}`}>{moneyExacta(f.importe, "USD")}</td>
            </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
