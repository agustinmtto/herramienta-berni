"use client";
import { useState } from "react";
import type { OperacionRow } from "@/lib/sesiones-datos";

export type OperacionEditable = {
  direccion: string;
  activo: string;
  capital: string;
  apalancamiento: string;
  zona_entrada: string;
  objetivo: string;
  estado: string;
};

const DIRECCIONES = [
  ["short", "Short"], ["long", "Long"], ["spot", "Spot / compra"],
  ["etfs", "ETFs"], ["esperar", "Esperar — no entrar aún"],
] as const;

const ESTADOS = [
  ["ejecutada", "Ejecutada en la sesión"],
  ["ordenes_puestas", "Órdenes puestas — pendientes de entrar"],
  ["planificada", "Planificada — aún no ejecuta"],
] as const;

export function opVacia(): OperacionEditable {
  return {
    direccion: "short", activo: "", capital: "", apalancamiento: "2x",
    zona_entrada: "", objetivo: "", estado: "ejecutada",
  };
}

export function desdeFilas(filas: OperacionRow[]): OperacionEditable[] {
  return filas.map((o) => ({
    direccion: o.direccion,
    activo: o.activo ?? "",
    capital: o.capital === null ? "" : String(o.capital),
    apalancamiento: o.apalancamiento ?? "",
    zona_entrada: o.zona_entrada ?? "",
    objetivo: o.objetivo ?? "",
    estado: o.estado ?? "",
  }));
}

// Editor de la lista de operaciones recomendadas. Se comparte entre el
// formulario de alta y la edición desde el detalle para que las dos pantallas
// no diverjan en qué campos existen ni en cómo se llaman.
//
// Una sesión puede cerrar con una estrategia o con varias: por eso es una lista
// y no un bloque fijo de campos.
export default function OperacionesEditor({
  ops, setOps,
}: {
  ops: OperacionEditable[];
  setOps: (v: OperacionEditable[]) => void;
}) {
  const set = (i: number, k: keyof OperacionEditable, v: string) => {
    const copia = ops.slice();
    copia[i] = { ...copia[i], [k]: v };
    setOps(copia);
  };

  return (
    <>
      {ops.map((op, i) => (
        <div className="op" key={i}>
          <div className="op-cab">
            <span>Operación {i + 1}</span>
            <button type="button" className="quitar"
                    onClick={() => setOps(ops.filter((_, j) => j !== i))}>
              quitar
            </button>
          </div>
          <div className="row tres">
            <label className="f"><span>Dirección</span>
              <select value={op.direccion} onChange={(e) => set(i, "direccion", e.target.value)}>
                {DIRECCIONES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className="f"><span>Activo</span>
              <input value={op.activo} placeholder="BTC"
                     onChange={(e) => set(i, "activo", e.target.value)} />
            </label>
            <label className="f"><span>Capital (€)</span>
              <input value={op.capital} placeholder="5.000"
                     onChange={(e) => set(i, "capital", e.target.value)} />
            </label>
          </div>
          <div className="row tres">
            {/* El apalancamiento se oculta en una espera: no se apalanca algo
                en lo que no se entra, y dejar el 2x por defecto a la vista
                invita a guardarlo sin querer. */}
            {op.direccion !== "esperar" ? (
              <label className="f"><span>Apalancamiento</span>
                <select value={op.apalancamiento}
                        onChange={(e) => set(i, "apalancamiento", e.target.value)}>
                  <option value="">—</option>
                  <option>1x</option><option>2x</option><option>3x</option><option>5x</option>
                </select>
              </label>
            ) : <div />}
            <label className="f"><span>Zona de entrada</span>
              <input value={op.zona_entrada} placeholder="64–65,5K"
                     onChange={(e) => set(i, "zona_entrada", e.target.value)} />
            </label>
            <label className="f"><span>Objetivo (PL)</span>
              <input value={op.objetivo} placeholder="96K"
                     onChange={(e) => set(i, "objetivo", e.target.value)} />
            </label>
          </div>
          <label className="f"><span>Estado</span>
            <select value={op.estado} onChange={(e) => set(i, "estado", e.target.value)}>
              <option value="">—</option>
              {ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
        </div>
      ))}
      <button type="button" className="btn añadir-op" onClick={() => setOps([...ops, opVacia()])}>
        + Añadir otra operación
      </button>
    </>
  );
}

// Las operaciones viajan como JSON en un solo campo del formulario: son una
// lista de longitud variable y "operaciones[2][capital]" sería reinventar mal
// un formato que ya existe. La función de la base ignora las filas sin
// dirección, así que la fila vacía inicial no estorba.
export function opsAJson(ops: OperacionEditable[]): string {
  const utiles = ops.filter(
    (o) => o.direccion && (o.activo || o.capital || o.zona_entrada || o.objetivo),
  );
  // El apalancamiento de una espera no se guarda ni aunque quedara en el estado
  // del componente: sería escribir algo que el coach no dijo.
  return JSON.stringify(
    utiles.map((o) => ({
      ...o,
      apalancamiento: o.direccion === "esperar" ? "" : o.apalancamiento,
    })),
  );
}
