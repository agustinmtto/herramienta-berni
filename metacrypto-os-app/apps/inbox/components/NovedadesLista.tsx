"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Novedad } from "@/lib/novedades";
import { fullTime } from "@/lib/format";
import { refrescarCampana } from "@/components/CampanaNovedades";

type Cursor = { t: string; id: string } | null;

// Ícono y color por tipo de novedad (Berni, EX-3): para saber rápido si es
// una venta/cobro, una sesión o una devolución sin leer la frase entera.
const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mc-icono">
    {children}
  </svg>
);

const TIPO: Record<string, { icono: React.ReactNode; color: string }> = {
  venta: {
    icono: <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.7-1 1.3-2.5 1.8-2.5.8-2.5 1.8 1 1.7 2.5 1.7 2.5-.5 2.5-1.5" /></Svg>,
    color: "green",
  },
  // El documento del ciclo de la venta: `generado` y `firmado` comparten tipo
  // (= `auditoria.entidad`), así que el ícono tiene que valer para los dos —
  // una hoja con la rúbrica, no un sello de "firmado". La hoja con la esquina
  // doblada se distingue del recibo dentado de `gasto`, que es lo único
  // parecido de esta tabla.
  //
  // Amarillo por eliminación honesta: las seis tintas de la paleta (verde,
  // oro, rojo, azul, naranja, morado) ya están cogidas aquí arriba y abajo, y
  // `--yellow` es la única que quedaba definida en globals.css (`.pill.yellow`,
  // línea 379) sin uso en esta lista. De paso cae en la familia del oro que
  // `estadoContrato` reserva para la firma —"el final del ciclo"— sin chocar
  // con la píldora de `cuota`, que es el oro de verdad.
  contrato: {
    icono: (
      <Svg>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
        <path d="M14 3v5h5" />
        <path d="M8 16.5c1.5-2 2.5-2 3 0s1.5 2 3 0" />
      </Svg>
    ),
    color: "yellow",
  },
  cuota: {
    icono: <Svg><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></Svg>,
    color: "gold",
  },
  devolucion: {
    icono: <Svg><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 5 5v1" /></Svg>,
    color: "red",
  },
  sesion: {
    icono: <Svg><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>,
    color: "blue",
  },
  gasto: {
    icono: <Svg><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></Svg>,
    color: "orange",
  },
  estrategia: {
    icono: <Svg><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></Svg>,
    color: "purple",
  },
};
const TIPO_DEFECTO = { icono: <Svg><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></Svg>, color: "" };

// La tabla de /novedades. El servidor pinta la primera página; esto marca
// "visto" al montar (POST — nunca en el render del servidor: un GET no muta
// y un prefetch no debe poner tu contador a cero) y pagina con "cargar más".
export default function NovedadesLista({
  inicial,
  cursorInicial,
}: {
  inicial: Novedad[];
  cursorInicial: Cursor;
}) {
  const [items, setItems] = useState<Novedad[]>(inicial);
  const [cursor, setCursor] = useState<Cursor>(cursorInicial);
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const marcado = useRef(false);

  useEffect(() => {
    // Una sola vez por visita (el doble-mount de dev de React no debe marcar
    // dos veces — no es dañino, pero ensucia los logs del servidor).
    if (marcado.current) return;
    marcado.current = true;
    fetch("/api/novedades/visto", { method: "POST" })
      // Al marcar, el badge baja a cero YA — sin esto se quedaba con el
      // número viejo hasta un minuto dentro de la propia pantalla.
      .then(() => refrescarCampana())
      .catch(() => {
        /* sin red no se marca: la próxima visita lo hará */
      });
  }, []);

  const cargarMas = async () => {
    if (!cursor || cargando) return;
    setCargando(true);
    setErr(null);
    try {
      const r = await fetch(`/api/novedades?t=${encodeURIComponent(cursor.t)}&id=${cursor.id}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { items: Novedad[]; siguiente: Cursor };
      setItems((prev) => [...prev, ...j.items]);
      setCursor(j.siguiente);
    } catch {
      setErr("No se pudieron cargar más novedades. Prueba otra vez.");
    } finally {
      setCargando(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="card">
        <div className="card-body-pad">
          <p className="novedades-vacio">Nada nuevo por aquí todavía.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-body-pad novedades">
        <ul className="novedades-lista">
          {items.map((n) => {
            const t = TIPO[n.tipo] ?? TIPO_DEFECTO;
            return (
            <li key={n.id} className="novedades-fila">
              <div className="novedades-frase">
                <span className={`pill ${t.color}`} aria-hidden="true">{t.icono}</span>{" "}
                {n.url ? <Link href={n.url}>{n.frase}</Link> : <span>{n.frase}</span>}
              </div>
              <div className="novedades-meta">
                {n.autor && <span>{n.autor}</span>}
                <span>{fullTime(n.fecha)}</span>
              </div>
            </li>
            );
          })}
        </ul>
        {err && <p className="novedades-error">{err}</p>}
        {cursor && (
          <button type="button" className="btn" onClick={cargarMas} disabled={cargando}>
            {cargando ? "Cargando…" : "Cargar más"}
          </button>
        )}
      </div>
    </div>
  );
}
