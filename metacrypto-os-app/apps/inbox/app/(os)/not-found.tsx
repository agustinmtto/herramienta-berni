import Link from "next/link";

/**
 * Pantalla de "no existe" de las rutas del OS.
 *
 * Los dos `notFound()` que ya había —`clientes/[id]/page.tsx:68` y
 * `inbox/c/[id]/page.tsx:21`— caían en el 404 genérico de Next: fuera del
 * layout del OS, en inglés y sin menú. Se llega ahí con un enlace viejo, con
 * un cliente que se fusionó con otro, o pegando una URL de una conversación
 * que ya no está.
 *
 * Al vivir en `(os)/` sale dentro del layout, así que la navegación sigue
 * puesta: se puede saltar a otra pantalla sin usar el botón atrás.
 *
 * El texto es común a las dos rutas a propósito. Para decir "ese CLIENTE no
 * existe" haría falta un `not-found.tsx` por carpeta, y prometer más
 * precisión de la que hay aquí es peor que ser claro y genérico.
 */
export default function NoEncontradoOs() {
  return (
    <div className="estado-pantalla">
      <h1>Eso ya no está aquí</h1>
      <p>
        La ficha o la conversación que buscas no existe. Puede que se haya
        unido a otra, o que el enlace sea viejo.
      </p>

      <div className="estado-acciones">
        <Link className="btn primary" href="/clientes">
          Ver clientes
        </Link>
        <Link className="btn" href="/">
          Ir a Inicio
        </Link>
      </div>
    </div>
  );
}
