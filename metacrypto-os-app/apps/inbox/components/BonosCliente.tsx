"use client";
import { useState, useTransition } from "react";
import Modal from "@/components/Modal";
import { editarBonos } from "@/app/actions";
import {
  BONOS_EVENTO, bonosAplicables, aplicaBonoDuracion, mesesConBonoDuracion,
  normalizarBonos, resumenBonos, type ClaveBono,
} from "@/lib/bonos";
import type { PersonaResult } from "@/lib/types";
import { IconoCheck } from "@/components/Iconos";

/**
 * Los bonos de la venta activa, vistos y editables desde la ficha.
 *
 * Existe por un caso concreto: Alex cerró un cliente en el evento del 26/08 y
 * no le marcó los bonos. Sin esto la única salida era tocar la base a mano.
 * Por eso el bloque se ve SIEMPRE que haya programa activo, aunque no tenga
 * bonos — si solo apareciera cuando ya los tiene, el cliente al que se le
 * olvidaron sería justo el que no se puede arreglar.
 */
export default function BonosCliente({
  personaId, programaId, mesesTier, bonos,
}: {
  personaId: string;
  programaId: string | null;
  /** Duración de catálogo del tier, SIN bonos: la base del +50 %. */
  mesesTier: number | null;
  bonos: string[];
}) {
  const guardados = normalizarBonos(bonos);
  const [abierto, setAbierto] = useState(false);
  const [marcados, setMarcados] = useState<ClaveBono[]>(guardados);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Sin programa activo no hay venta a la que colgarle bonos.
  if (!programaId) return null;

  const aplicables = bonosAplicables(mesesTier);
  const resumen = resumenBonos(guardados);

  function alternar(clave: ClaveBono) {
    setMarcados((prev) =>
      prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]);
  }

  function abrir() {
    // Se reabre siempre desde lo GUARDADO, no desde lo que quedó marcado la
    // vez anterior: cancelar tiene que deshacer de verdad.
    setMarcados(guardados);
    setError(null); setAviso(null); setAbierto(true);
  }

  function enviar(fd: FormData) {
    setError(null);
    start(async () => {
      const r: PersonaResult = await editarBonos(fd);
      if (!r.ok) setError(r.error);
      else { setAviso(r.mensaje); setAbierto(false); }
    });
  }

  return (
    <div className="bonos-ficha">
      <div className="bonos-ficha-head">
        <span className="bonos-ficha-label">Bonos del evento</span>
        {guardados.length > 0
          ? <span className="pill gold">{resumen}</span>
          : <span className="muted">ninguno</span>}
        <button type="button" className="btn" onClick={abrir}>
          {guardados.length > 0 ? "Editar bonos" : "Añadir bonos"}
        </button>
      </div>

      {guardados.length > 0 && !abierto && (
        <ul className="bonos-lista">
          {guardados.map((c) => {
            const bono = BONOS_EVENTO.find((x) => x.clave === c);
            return <li key={c}>{bono?.etiqueta ?? c}</li>;
          })}
        </ul>
      )}

      {aviso && !abierto && <p className="hint"><IconoCheck /> {aviso}</p>}

      {abierto && (
        <Modal titulo="Bonos del evento 26/08" onCerrar={() => setAbierto(false)}>
            <form action={enviar}>
              <input type="hidden" name="persona_id" value={personaId} />
              <input type="hidden" name="programa_id" value={programaId} />
              <input type="hidden" name="bonos" value={JSON.stringify(marcados)} />

              <fieldset className="vf-bonos">
                {aplicables.map((clave) => {
                  const bono = BONOS_EVENTO.find((x) => x.clave === clave)!;
                  return (
                    <label key={clave} className="vf-bono">
                      <input type="checkbox" checked={marcados.includes(clave)}
                        onChange={() => alternar(clave)} />
                      <span>
                        {bono.etiqueta}
                        <span className="vf-ayuda">{bono.efecto}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              {aplicaBonoDuracion(mesesTier) ? (
                <p className="note">
                  Marcar el bono de duración pone el programa en{" "}
                  <strong>{mesesConBonoDuracion(mesesTier)} meses</strong>; quitarlo lo
                  devuelve a los {mesesTier} del tier. Las consultorías extra suman al
                  cupo que se ve en Sesiones.
                </p>
              ) : (
                <p className="note">
                  El bono de <strong>+50 % de duración</strong> no aparece: este
                  programa no tiene duración que alargar. Las consultorías extra sí
                  suman al cupo que se ve en Sesiones.
                </p>
              )}

              {error && <p className="error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setAbierto(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn primary" disabled={pending}>
                  {pending ? "Guardando…" : "Guardar bonos"}
                </button>
              </div>
            </form>
        </Modal>
      )}
    </div>
  );
}
