"use client";
import { useState, useTransition } from "react";
import { cambiarModoContrato } from "@/app/actions";
import { IconoAlerta } from "@/components/Iconos";

// El interruptor prueba/producción de /contratos. Manda SIEMPRE el modo
// destino explícito (nunca "el contrario del que veo"): con dos pestañas
// abiertas en modos distintos, alternar a ciegas dejaría el modo contrario
// al que muestra cada pantalla — la propia action ya rechaza cualquier valor
// que no sea "on" u "off".
export default function ModoContrato({
  modo,
  emailPrueba,
}: {
  modo: "on" | "off";
  emailPrueba: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function cambiar() {
    const destino = modo === "on" ? "off" : "on";
    // Solo se confirma al ENTRAR a producción: desde ese clic, la próxima
    // venta manda un contrato de verdad a Berni, Alex y Paula. Volver a
    // prueba no tiene ese costo y no lo merece.
    if (
      destino === "off" &&
      !confirm(
        "¿Pasar el envío de contratos a Producción?\n\n" +
          "Desde este clic, la próxima venta manda el contrato real a Berni, Alex y Paula.",
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("modo", destino);
      const r = await cambiarModoContrato(fd);
      if (!r.ok) setError(r.error ?? "No se pudo cambiar el modo.");
    });
  }

  return (
    <div className="modo-contrato">
      <span className={`pill ${modo === "on" ? "orange" : "green"}`}>
        {modo === "on" ? "Modo prueba" : "Producción"}
      </span>
      {modo === "on" && (
        <span className="hint">va a {emailPrueba || "sin direcciones configuradas"}</span>
      )}
      <button type="button" className="btn" disabled={pending} onClick={cambiar}>
        {pending ? "Cambiando…" : modo === "on" ? "Pasar a Producción" : "Pasar a Prueba"}
      </button>
      {error && (
        <span className="hint" style={{ color: "var(--red)" }}>
          <IconoAlerta /> {error}
        </span>
      )}
    </div>
  );
}
