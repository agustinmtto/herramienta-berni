"use client";
import { useState, useTransition } from "react";
import { reenviarContratoAction } from "@/app/actions";
import { IconoAlerta, IconoCheck } from "@/components/Iconos";

// Antes: el padre (page.tsx) solo montaba este componente para
// "error_envio"/"pendiente" — para "enviado" no existía en el DOM. Ahora se
// monta SIEMPRE y es el propio botón el que se deshabilita (no desaparece), y
// la razón de fondo sigue siendo la misma — reenviar uno que sí salió le manda
// un duplicado a Berni, Alex y Paula.
//
// Éste es el ÚNICO que se queda apagado en vez de esconderse, y es a propósito:
// lo que lo apaga es el `estado` del envío, que se mueve solo —`pendiente` pasa
// a `enviado` en cuanto Resend acepta—, así que el atenuado informa de algo que
// va a cambiar. RecorregirContrato dejó de seguir este patrón el 16-sep porque
// a él lo apagan cosas que no cambian nunca (la plantilla del documento, una
// firma); el porqué está escrito allí. No regenera el PDF, reusa el que ya está en Storage con una clave
// de idempotencia nueva (lib/contrato-envio.ts).
export default function ReenviarContrato({
  id,
  puedeReenviar,
  destinos,
}: {
  id: string;
  puedeReenviar: boolean;
  /** A quién va a parar, en texto. Ver `destinosVisibles` en page.tsx. */
  destinos: string;
}) {
  const [pending, start] = useTransition();
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  function reenviar() {
    // Hallazgo 3 de la revisión de Milo del PR #3: el botón no decía a dónde
    // iba el correo. El indicador de modo está arriba de la página y este
    // botón al final de la tabla, así que se puede mandar a producción
    // creyendo que se manda a prueba, o al revés.
    //
    // `confirm()` nativo y no un modal propio: es el patrón que ya usa el repo
    // para lo irreversible (ModoContrato.tsx, GastosTable.tsx,
    // EstrategiasPanel.tsx). RecorregirContrato sí tiene modal porque además
    // necesita el selector de bonos; aquí no hay nada que rellenar.
    if (!confirm(`¿Reenviar este contrato a ${destinos}?\n\nSe manda el PDF que ya está guardado, sin regenerarlo.`)) return;
    setResultado(null);
    start(async () => {
      const fd = new FormData();
      fd.set("contrato_id", id);
      const r = await reenviarContratoAction(fd);
      setResultado(
        r.ok
          ? { ok: true, texto: `Enviado a ${r.destinos?.join(", ") || "el equipo"}` }
          : { ok: false, texto: r.error ?? "No se pudo reenviar." },
      );
    });
  }

  return (
    <>
      {/* "al equipo", y no "Reenviar" a secas como hasta el 16-sep: desde hoy
          la fila de al lado puede tener un "Reenviar enlace" que va al CLIENTE
          (EnviarAlCliente.tsx), y dos botones que empiezan igual y mandan el
          contrato a destinatarios distintos es una confusión con consecuencias.
          El `confirm()` ya nombraba los destinos, pero eso se lee DESPUÉS de
          pulsar. Solo cambia la etiqueta: el destino y el comportamiento son
          los mismos de siempre. */}
      <button type="button" className="linkbtn" disabled={pending || !puedeReenviar} onClick={reenviar}>
        {pending ? "Enviando…" : "Reenviar al equipo"}
      </button>
      {resultado && (
        <div className="hint" style={{ color: resultado.ok ? "var(--green)" : "var(--red)" }}>
          {resultado.ok ? <IconoCheck /> : <IconoAlerta />} {resultado.texto}
        </div>
      )}
    </>
  );
}
