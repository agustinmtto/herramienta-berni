"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconoCampana } from "@/components/Iconos";

// La campana del OS: contador de novedades no vistas y puerta a /novedades.
//
// Hay DOS campanas montadas a la vez (topbar de móvil y nav de escritorio:
// el CSS esconde una por breakpoint, pero ambas viven en el DOM). Por eso el
// poll es COMPARTIDO a nivel de módulo: un solo GET cada 60 s por pestaña,
// lo pinten cuantas campanas haya — sin esto, cada instancia duplicaba todo
// el tráfico del contador. Un fallo de red deja el badge como estaba: la
// campana JAMÁS rompe el nav.
const CADA_MS = 60_000;
const MIN_ENTRE_PEDIDAS_MS = 5_000;

const oyentes = new Set<(n: number) => void>();
let ultimoN = 0;
let ultimaPedidaAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

async function pedir(forzar = false): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  const ahora = Date.now();
  if (!forzar && ahora - ultimaPedidaAt < MIN_ENTRE_PEDIDAS_MS) return;
  ultimaPedidaAt = ahora;
  try {
    const r = await fetch("/api/novedades/contador");
    if (!r.ok) return;
    const j = (await r.json()) as { n?: number };
    if (typeof j.n === "number") {
      ultimoN = j.n;
      oyentes.forEach((f) => f(ultimoN));
    }
  } catch {
    /* red caída: el badge se queda como estaba */
  }
}

function suscribir(f: (n: number) => void): () => void {
  oyentes.add(f);
  f(ultimoN);
  if (oyentes.size === 1 && !timer) {
    pedir();
    timer = setInterval(() => pedir(), CADA_MS);
  }
  return () => {
    oyentes.delete(f);
    if (oyentes.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Refresco inmediato del contador, para quien acaba de cambiarlo — lo llama
 * NovedadesLista tras marcar visto: sin esto, el badge se quedaba con el
 * número viejo hasta un minuto DENTRO de la propia pantalla de novedades.
 */
export function refrescarCampana(): void {
  void pedir(true);
}

export default function CampanaNovedades() {
  const [n, setN] = useState(ultimoN);
  const path = usePathname();

  useEffect(() => suscribir(setN), []);

  useEffect(() => {
    // Al navegar (p. ej. saliendo de /novedades) el contador se refresca sin
    // esperar al minuto. El poller comparte la pedida entre las campanas.
    void pedir();
  }, [path]);

  return (
    <Link
      href="/novedades"
      className="campana"
      aria-label={n > 0 ? `Novedades: ${n >= 10 ? "9 o más" : n} sin ver` : "Novedades"}
    >
      <IconoCampana size={20} />
      {n > 0 && (
        <span className="campana-badge" aria-hidden="true">
          {n >= 10 ? "9+" : n}
        </span>
      )}
    </Link>
  );
}
