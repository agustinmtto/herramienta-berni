"use client";
import { useState, useTransition } from "react";
import { enviarContratoAlClienteAction } from "@/app/actions";
import { IconoAlerta, IconoCheck } from "@/components/Iconos";

// El botón que cierra el ciclo: manda al cliente el enlace por el que firma.
// Solo lo pinta /contratos, y solo sobre `venta_nueva_v2` — los contratos de
// las plantillas viejas no se firman en el OS y no tienen dónde llevar a nadie.
//
// `confirm()` nativo y no un modal propio: es el patrón que ya usa el repo
// para lo irreversible (ReenviarContrato, ModoContrato, GastosTable), y lo que
// hay que leer antes de pulsar cabe en dos líneas — a dónde va, y que reenviar
// mata el enlace anterior.
//
// 🔴 NO LLEVA UN PROP DE PERMISO, y la ausencia es la decisión.
//
// El criterio completo para que este botón exista es "contrato de la plantilla
// nueva Y todavía sin firmar", y la primera mitad depende del `tipo`, que este
// componente no recibe ni tiene por qué. Un `puede` aquí dentro sería MEDIO
// criterio con pinta de ser el criterio entero: quien montara el componente
// desde otra pantalla pasaría su `!firmado_at`, vería el botón aparecer y
// creería que está protegido. Lo decide quien lo monta — hoy `puedeTocar` en
// app/(os)/contratos/page.tsx, que es el único sitio y sabe las dos cosas.
//
// Que no se pinte (en vez de pintarse apagado) es la regla de esta pantalla:
// lo que apaga a este botón es una firma, y una firma no se deshace. Un enlace
// dorado al 50% de opacidad para siempre, en una fila que ya dice "Firmado" en
// dorado, no informa de nada — y el OS ya se quemó una vez apilando
// atenuaciones sobre `.linkbtn` (globals.css:540).
export default function EnviarAlCliente({
  id,
  email,
  yaEnviado,
}: {
  id: string;
  /** El de la ficha del cliente. Sin él no hay a dónde mandarlo. */
  email: string | null;
  yaEnviado: boolean;
}) {
  const [pending, start] = useTransition();
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  function enviar() {
    // El email se comprueba ANTES del confirm: preguntar "¿mandar a null?" y
    // fallar después es dos clics para llegar al mismo sitio. La action lo
    // valida igual — esto solo evita el viaje.
    if (!email) {
      setResultado({ ok: false, texto: "El cliente no tiene email en su ficha. Añádelo y vuelve." });
      return;
    }
    if (
      !confirm(
        `¿${yaEnviado ? "Reenviar" : "Enviar"} el enlace de firma a ${email}?${
          yaEnviado ? "\n\nEl enlace anterior dejará de valer." : ""
        }`,
      )
    ) {
      return;
    }
    setResultado(null);
    start(async () => {
      const fd = new FormData();
      fd.set("contrato_id", id);
      const r = await enviarContratoAlClienteAction(fd);
      setResultado(
        r.ok
          ? {
              ok: true,
              // El modo prueba desvía el correo a los buzones de Patricio: si
              // no se dijera aquí, el closer creería que el cliente ya lo tiene.
              texto: r.enPrueba ? `MODO PRUEBA: fue a ${r.destino}, no al cliente.` : `Enviado a ${r.destino}`,
            }
          : { ok: false, texto: r.error },
      );
    });
  }

  return (
    <>
      <button type="button" className="linkbtn" disabled={pending} onClick={enviar}>
        {pending ? "Enviando…" : yaEnviado ? "Reenviar enlace" : "Enviar al cliente"}
      </button>
      {resultado && (
        <div className="hint" style={{ color: resultado.ok ? "var(--green)" : "var(--red)" }}>
          {resultado.ok ? <IconoCheck /> : <IconoAlerta />} {resultado.texto}
        </div>
      )}
    </>
  );
}
