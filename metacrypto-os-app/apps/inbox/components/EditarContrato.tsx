"use client";
import { useState, useTransition } from "react";
import { textoContratoAction } from "@/app/actions";
import EditorContrato from "@/components/EditorContrato";

// Abre el contrato "como un Word" (spec, decisión 4) desde la pestaña, sin
// pasar por el modal de la venta. Es el mismo editor: este componente solo va
// a buscar el texto y lo monta.
//
// El texto NO viaja en el HTML de /contratos: son 6 KB por contrato y la
// pestaña los pinta todos. Se pide al pulsar, que además es cuando hace falta
// que esté fresco — si alguien lo editó desde otra pantalla hace un minuto,
// el que se abre es el suyo y no una copia vieja del render.
//
// Solo lo monta /contratos sobre `venta_nueva_v2`: `textoDeContrato` devuelve
// null cuando no hay `texto_final`, que es exactamente el caso de los
// contratos de las plantillas viejas, y el botón contestaría "Ese contrato no
// tiene texto editable" a todo el que lo pulsara. Un botón que solo sabe
// fallar no se pinta.
// Sin prop de permiso, por lo mismo que EnviarAlCliente: el criterio incluye el
// TIPO del contrato, que aquí no se conoce. Lo decide quien lo monta.
export default function EditarContrato({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<{
    texto: string;
    textoGenerado: string;
    email: string | null;
    enviado: boolean;
  } | null>(null);

  function abrir() {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("contrato_id", id);
      const r = await textoContratoAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // ESTA es la comprobación de verdad, y por eso está aquí y no en un prop:
      // el dato se lee en el momento de abrir, no cuando se pintó la pantalla.
      // La pestaña puede llevar horas abierta y la firma haber pasado entre
      // medias; abrir el editor ahí dejaría a alguien escribiendo en un
      // documento cerrado para que `guardarTextoYRegenerar` lo rechazara al
      // guardar, con el texto ya escrito.
      if (r.firmado) {
        setError("Ya está firmado: recarga la pantalla.");
        return;
      }
      setDatos({ texto: r.texto, textoGenerado: r.textoGenerado, email: r.email, enviado: r.enviado });
    });
  }

  return (
    <>
      <button type="button" className="linkbtn" disabled={pending} onClick={abrir}>
        {pending ? "Abriendo…" : "Editar"}
      </button>
      {error && (
        <span className="hint" style={{ color: "var(--red)" }}>
          {" "}
          {error}
        </span>
      )}
      {datos && (
        <EditorContrato
          contratoId={id}
          textoInicial={datos.texto}
          textoGenerado={datos.textoGenerado}
          emailCliente={datos.email}
          yaEnviado={datos.enviado}
          onCerrar={() => setDatos(null)}
        />
      )}
    </>
  );
}
