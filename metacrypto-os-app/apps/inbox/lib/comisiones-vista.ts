// Lógica pura de la tabla "Desglose" de Comisiones: ordenar y filtrar por
// columna (Berni, CO-3). Sin acceso a datos ni imports "@/" — vitest no
// resuelve el alias en los libs. Mismo patrón que lib/devoluciones-vista.ts.

export type FilaDesglose = {
  clave: string;
  fecha: string | null;
  cliente: string;
  fuente: string | null;
  rol: string;
  rolEtiqueta: string;
  team_member_id: string;
  quien: string;
  base: number;
  tasa: number;
  importe: number;
};

export type ColumnaDesglose = "fecha" | "cliente" | "fuente" | "rol" | "quien" | "base" | "tasa" | "importe";
export type Direccion = "asc" | "desc";
export type OrdenDesglose = { col: ColumnaDesglose; dir: Direccion };

// Berni: "orden predefinido de más reciente a más antiguo dentro del mes".
export const ORDEN_INICIAL: OrdenDesglose = { col: "fecha", dir: "desc" };

export function siguienteOrden(actual: OrdenDesglose, col: ColumnaDesglose): OrdenDesglose {
  if (actual.col === col) return { col, dir: actual.dir === "asc" ? "desc" : "asc" };
  return { col, dir: col === "cliente" || col === "fuente" || col === "rol" || col === "quien" ? "asc" : "desc" };
}

export function ordenar(filas: FilaDesglose[], { col, dir }: OrdenDesglose): FilaDesglose[] {
  const signo = dir === "asc" ? 1 : -1;
  return [...filas].sort((a, b) => {
    if (col === "base" || col === "tasa" || col === "importe") return signo * (a[col] - b[col]);
    if (col === "fecha") {
      if (!a.fecha && !b.fecha) return 0;
      if (!a.fecha) return 1;
      if (!b.fecha) return -1;
      return signo * a.fecha.localeCompare(b.fecha);
    }
    const va = col === "rol" ? a.rolEtiqueta : a[col] ?? "";
    const vb = col === "rol" ? b.rolEtiqueta : b[col] ?? "";
    return signo * String(va).localeCompare(String(vb), "es");
  });
}

export function filtrar(
  filas: FilaDesglose[],
  filtros: Partial<Record<ColumnaDesglose, string>>,
): FilaDesglose[] {
  const activos = (Object.entries(filtros) as [ColumnaDesglose, string][])
    .filter(([, v]) => v.trim() !== "");
  if (activos.length === 0) return filas;
  return filas.filter((f) =>
    activos.every(([col, v]) => {
      const valor = col === "rol" ? f.rolEtiqueta
        : col === "base" || col === "tasa" || col === "importe" ? String(f[col])
        : (f[col] ?? "");
      return String(valor).toLowerCase().includes(v.trim().toLowerCase());
    }));
}
