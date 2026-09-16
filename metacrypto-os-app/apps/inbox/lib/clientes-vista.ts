// Lógica pura de la tabla de Clientes: ordenar y filtrar por columna
// (Berni, CL-9). Sin acceso a datos ni imports "@/" — vitest no resuelve el
// alias en los libs. Mismo patrón que lib/devoluciones-vista.ts.
import { dateEs } from "./format";

export type ClienteVista = {
  id: string;
  nombre: string | null;
  pais: string | null;
  tier: string | null;
  coach: { nombre: string } | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado: string;
};

export type ColumnaClientes = "nombre" | "pais" | "tier" | "coach" | "fecha_inicio" | "fecha_fin" | "estado";
export type Direccion = "asc" | "desc";
export type OrdenClientes = { col: ColumnaClientes; dir: Direccion };

export const ORDEN_INICIAL: OrdenClientes = { col: "nombre", dir: "asc" };

/** Al pulsar una cabecera: si ya se ordena por ella, invierte; si no, arranca
    en su dirección natural — fechas más recientes primero, texto A→Z. */
export function siguienteOrden(actual: OrdenClientes, col: ColumnaClientes): OrdenClientes {
  if (actual.col === col) return { col, dir: actual.dir === "asc" ? "desc" : "asc" };
  return { col, dir: col === "fecha_inicio" || col === "fecha_fin" ? "desc" : "asc" };
}

function valorTexto(c: ClienteVista, col: ColumnaClientes): string {
  switch (col) {
    case "nombre": return c.nombre ?? "";
    case "pais": return c.pais ?? "";
    case "tier": return c.tier ?? "";
    case "coach": return c.coach?.nombre ?? "";
    case "fecha_inicio": return c.fecha_inicio ?? "";
    case "fecha_fin": return c.fecha_fin ?? "";
    case "estado": return c.estado;
  }
}

/** Ordena sin mutar la entrada. Vacíos siempre al final, en las dos direcciones. */
export function ordenar<T extends ClienteVista>(cs: T[], { col, dir }: OrdenClientes): T[] {
  const signo = dir === "asc" ? 1 : -1;
  return [...cs].sort((a, b) => {
    const va = valorTexto(a, col);
    const vb = valorTexto(b, col);
    if (!va && !vb) return 0;
    if (!va) return 1;
    if (!vb) return -1;
    return signo * va.localeCompare(vb, "es");
  });
}

// Las fechas se filtran contra lo que la celda MUESTRA (`dateEs`, ej. "03 mar
// 28"), no contra el ISO crudo que usa `ordenar` — si no, lo que se ve y lo
// que hay que escribir para encontrarlo son dos formatos distintos.
function valorFiltro(c: ClienteVista, col: ColumnaClientes): string {
  if (col === "fecha_inicio") return dateEs(c.fecha_inicio);
  if (col === "fecha_fin") return dateEs(c.fecha_fin);
  return valorTexto(c, col);
}

/** Un filtro de texto por columna (vacío = sin filtrar), todas a la vez. */
export function filtrar<T extends ClienteVista>(
  cs: T[],
  filtros: Partial<Record<ColumnaClientes, string>>,
): T[] {
  const activos = (Object.entries(filtros) as [ColumnaClientes, string][])
    .filter(([, v]) => v.trim() !== "");
  if (activos.length === 0) return cs;
  return cs.filter((c) =>
    activos.every(([col, v]) => valorFiltro(c, col).toLowerCase().includes(v.trim().toLowerCase())));
}
