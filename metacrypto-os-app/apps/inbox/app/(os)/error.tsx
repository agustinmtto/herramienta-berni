"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Pantalla de error de TODAS las rutas del OS.
 *
 * Antes no existía: un parpadeo de Supabase, o cualquiera de las lecturas que
 * lanzan a propósito en `lib/data.ts` (:1165, :327, :245 — prefieren reventar
 * antes que devolver [] y fingir "todo al día"), dejaban a Berni en la
 * pantalla genérica de Next: *"Application error: a server-side exception has
 * occurred"*, en inglés, sin marca, sin explicación y sin forma de volver.
 *
 * Que las lecturas lancen es una decisión buena del sistema y no se toca. Lo
 * que faltaba era el otro lado: que al lanzar haya algo que recoger.
 *
 * Al vivir en `(os)/`, esto sale DENTRO del layout: el menú sigue ahí y se
 * puede ir a otro sitio sin tocar el botón atrás.
 */
export default function ErrorOs({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // El error real solo existe en el navegador de quien se lo comió. Sin esto
  // no queda rastro en ningún sitio: en producción Next reemplaza el mensaje
  // por un `digest` opaco, así que la consola es lo único que puede decir qué
  // pasó de verdad.
  useEffect(() => {
    console.error("[OS] error de pantalla:", error);
  }, [error]);

  return (
    <div className="estado-pantalla">
      <h1>No hemos podido cargar esta pantalla</h1>
      <p>
        Los datos no han llegado. Casi siempre es un corte de un segundo:
        reintentar suele bastar.
      </p>

      <div className="estado-acciones">
        {/* `reset()` reintenta la carga sin recargar la página entera: si fue
            un corte, vuelve en el sitio donde estabas. */}
        <button className="btn primary" onClick={() => reset()}>
          Reintentar
        </button>
        <Link className="btn" href="/">
          Ir a Inicio
        </Link>
      </div>

      {/* Plegado y al final: Berni no necesita ver esto para entender que hay
          que reintentar. Está para que, si el fallo se repite, pueda copiar la
          referencia por WhatsApp sin que nadie tenga que abrir Vercel. */}
      <details className="estado-tecnico">
        <summary>Detalle técnico</summary>
        <pre>{error.digest ? `Referencia: ${error.digest}` : error.message}</pre>
      </details>
    </div>
  );
}
