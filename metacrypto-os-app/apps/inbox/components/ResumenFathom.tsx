import { parsearResumen, type TrozoResumen } from "@/lib/fathom";

/**
 * Pinta el resumen que escribe la IA de Fathom.
 *
 * 🔴 Sin `dangerouslySetInnerHTML`, y no es una preferencia de estilo: este
 * texto lo genera Fathom sobre lo que se dijo en una llamada con un cliente.
 * Es contenido de fuera. `parsearResumen` (lib/fathom.ts) lo convierte en
 * datos y aquí se pintan elementos, así que React escapa solo y no hay nada
 * que sanear.
 *
 * Los enlaces se conservan porque llevan al SEGUNDO exacto de la grabación:
 * es lo que convierte el resumen en algo con lo que trabajar en vez de un
 * texto para leer. `parsearResumen` ya descarta cualquier href que no sea
 * http(s).
 */
export default function ResumenFathom({ md }: { md: string | null }) {
  const bloques = parsearResumen(md);
  if (!bloques.length) {
    return <p className="hint">Esta llamada todavía no tiene resumen en Fathom.</p>;
  }
  return (
    <div className="fa-resumen">
      {bloques.map((b, i) => {
        const dentro = <Trozos t={b.texto} />;
        if (b.tipo === "titulo") return <h4 key={i}>{dentro}</h4>;
        if (b.tipo === "vineta") return <p key={i} className="fa-vineta">{dentro}</p>;
        return <p key={i}>{dentro}</p>;
      })}
    </div>
  );
}

function Trozos({ t }: { t: TrozoResumen[] }) {
  return (
    <>
      {t.map((x, i) => {
        const txt = x.negrita ? <strong>{x.texto}</strong> : x.texto;
        if (!x.enlace) return <span key={i}>{txt}</span>;
        return (
          // `noopener` además de `noreferrer`: se abre en Fathom, que es de
          // fiar, pero el enlace sale de un texto generado — no se le da a la
          // pestaña nueva acceso a `window.opener` por si acaso.
          <a key={i} href={x.enlace} target="_blank" rel="noopener noreferrer" className="fa-salto">
            {txt}
          </a>
        );
      })}
    </>
  );
}
