"use client";
import { useState } from "react";
import { enviarBienvenida } from "@/app/actions";
import { IconoCheck } from "@/components/Iconos";

export default function BotonBienvenida({
  personaId,
  etiqueta = "Enviar bienvenida",
  clase = "linkbtn",
  onEnviada,
}: {
  personaId: string;
  etiqueta?: string;
  clase?: string;
  // Quien monte el botón dentro de algo que desaparece al enviar (el modal de
  // la venta) necesita enterarse: el estado interno se va con el componente.
  onEnviada?: () => void;
}) {
  const [estado, setEstado] = useState<"idle" | "enviando" | "enviada" | "ya_estaba">("idle");
  const [error, setError] = useState("");

  if (estado === "enviada") return <span className="hint"><IconoCheck /> Bienvenida enviada</span>;
  if (estado === "ya_estaba") return <span className="hint"><IconoCheck /> Este cliente ya la había recibido</span>;

  return (
    <>
      <button
        className={clase}
        disabled={estado === "enviando"}
        onClick={async () => {
          setEstado("enviando"); setError("");
          const r = await enviarBienvenida(personaId);
          if (r.ok) { setEstado(r.yaEstaba ? "ya_estaba" : "enviada"); onEnviada?.(); }
          else { setEstado("idle"); setError(r.error); }
        }}
      >
        {estado === "enviando" ? "Enviando…" : etiqueta}
      </button>
      {error && <span className="error"> {error}</span>}
    </>
  );
}
