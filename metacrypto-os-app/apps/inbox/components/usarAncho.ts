"use client";
import { useEffect, useState } from "react";

/**
 * Ancho real del contenedor, en píxeles.
 *
 * Los gráficos de Inicio se dibujan midiendo, no escalando: un viewBox
 * estirado deforma el texto de los ejes. Devuelve 0 mientras no hay elemento
 * medido, y quien lo use debe no pintar en ese caso.
 *
 * `ref` es una CALLBACK ref a propósito, no un objeto de useRef. Con un ref
 * normal y un efecto de dependencias vacías, el observador se queda mirando
 * el primer nodo para siempre: al alternar a la vista de tabla y volver, el
 * <div> se desmonta y se monta otro, el efecto no se vuelve a ejecutar y el
 * gráfico reaparecía vacío. Guardar el nodo en estado hace que el efecto
 * dependa de él y se reenganche solo.
 */
export function usarAncho<T extends HTMLElement>() {
  const [nodo, setNodo] = useState<T | null>(null);
  const [ancho, setAncho] = useState(0);

  useEffect(() => {
    if (!nodo) {
      setAncho(0);
      return;
    }
    setAncho(nodo.clientWidth);
    const ro = new ResizeObserver((entradas) => {
      for (const e of entradas) setAncho(e.contentRect.width);
    });
    ro.observe(nodo);
    return () => ro.disconnect();
  }, [nodo]);

  return { ref: setNodo, ancho };
}
