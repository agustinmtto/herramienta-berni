"use client";
import { useState, useTransition } from "react";
import { editarBonos, recorregirContratoAction } from "@/app/actions";
import Modal from "@/components/Modal";
import {
  BONOS_EVENTO, bonosAplicables, aplicaBonoDuracion, mesesConBonoDuracion,
  normalizarBonos, type ClaveBono,
} from "@/lib/bonos";
import type { PersonaResult } from "@/lib/types";
import { IconoAlerta, IconoCheck } from "@/components/Iconos";

// Reusa el mismo picker de bonos que BonosCliente.tsx (la ficha del cliente),
// no uno nuevo: nació para eso — el hallazgo #2 de Milo es "el contrato no se
// entera si los bonos cambian después", y la forma de corregirlos siempre fue
// esta pantalla. Antes tenía un confirm() del navegador sin dejar tocar nada;
// ahora abre el mismo formulario de bonos y, al confirmar, primero los guarda
// (editarBonos, la action que ya existía) y recién después regenera y
// reenvía el contrato con esos bonos ya guardados.
export default function RecorregirContrato({
  id, puedeRecorregir, personaId, programaId, mesesTier, bonos, destinos,
}: {
  id: string;
  puedeRecorregir: boolean;
  personaId: string;
  programaId: string | null;
  /** Duración de catálogo del tier, SIN bonos — igual que en BonosCliente. */
  mesesTier: number | null;
  bonos: string[] | null;
  /** A quién va el correo con el modo de envío que esté activo ahora. */
  destinos: string;
}) {
  const guardados = normalizarBonos(bonos);
  const [abierto, setAbierto] = useState(false);
  const [marcados, setMarcados] = useState<ClaveBono[]>(guardados);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();

  const aplicables = bonosAplicables(mesesTier);

  function alternar(clave: ClaveBono) {
    setMarcados((prev) => (prev.includes(clave) ? prev.filter((c) => c !== clave) : [...prev, clave]));
  }

  function abrir() {
    // Igual que BonosCliente: reabrir siempre parte de lo GUARDADO, no de lo
    // que quedó marcado la vez anterior — cancelar tiene que deshacer de verdad.
    setMarcados(guardados);
    setError(null);
    setResultado(null);
    setAbierto(true);
  }

  function confirmar(fd: FormData) {
    if (!programaId) return;
    setError(null);
    setResultado(null);
    start(async () => {
      // Paso 1: guardar los bonos corregidos — misma action que usa la ficha.
      const rBonos: PersonaResult = await editarBonos(fd);
      if (!rBonos.ok) {
        setError(rBonos.error);
        return;
      }
      // Paso 2: recién ahora regenerar el PDF con esos bonos y reenviarlo.
      const fdContrato = new FormData();
      fdContrato.set("contrato_id", id);
      const r = await recorregirContratoAction(fdContrato);
      if (r.ok) setAbierto(false);
      setResultado(
        r.ok
          ? { ok: true, texto: `Recorregido y enviado a ${r.destinos?.join(", ") || "el equipo"}` }
          : { ok: false, texto: r.error ?? "No se pudo recorregir." },
      );
    });
  }

  // 🔴 No se pinta apagado: no se pinta. Hasta el 16-sep esto era un
  // `disabled`, y el argumento para dejarlo visible —"un botón atenuado dice
  // más que uno que no está, porque se volverá a encender"— era falso justo
  // para la mitad de los motivos que lo apagan. `plantillaRegenerable` mira de
  // qué PLANTILLA salió el documento, y eso no cambia nunca; `firmado_at`
  // tampoco se deshace. O sea: un enlace dorado al 50% de opacidad en cada
  // fila, para siempre, en el 100% de las filas que genere el camino nuevo. Y
  // esta pantalla ya tiene un historial de contraste escrito en globals.css:540
  // —dos hojas atenuando el mismo `.linkbtn` lo dejaron en 2,08:1— que empezó
  // exactamente así.
  //
  // Lo que se resigna: quien no tenga `acceso_total` deja de ver que este botón
  // existe. Es la misma regla que ya siguen "Editar" y "Enviar al cliente".
  if (!puedeRecorregir) return null;

  return (
    <>
      <button type="button" className="linkbtn" onClick={abrir}>
        Recorregir
      </button>

      {resultado && !abierto && (
        <div className="hint" style={{ color: resultado.ok ? "var(--green)" : "var(--red)" }}>
          {resultado.ok ? <IconoCheck /> : <IconoAlerta />} {resultado.texto}
        </div>
      )}

      {abierto && (
        <Modal titulo="Recorregir bonos" onCerrar={() => setAbierto(false)}>
          <form action={confirmar}>
            <input type="hidden" name="persona_id" value={personaId} />
            <input type="hidden" name="programa_id" value={programaId ?? ""} />
            <input type="hidden" name="bonos" value={JSON.stringify(marcados)} />

            <fieldset className="vf-bonos">
              {aplicables.map((clave) => {
                const bono = BONOS_EVENTO.find((x) => x.clave === clave)!;
                return (
                  <label key={clave} className="vf-bono">
                    <input type="checkbox" checked={marcados.includes(clave)} onChange={() => alternar(clave)} />
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
                Marcar este bono alarga el programa a <strong>{mesesConBonoDuracion(mesesTier)} meses</strong>.
                Desmarcarlo lo deja en <strong>{mesesTier}</strong>.
              </p>
            ) : (
              <p className="note">
                El bono de <strong>+50 % de duración</strong> no aparece: este programa no tiene duración que
                alargar.
              </p>
            )}

            {/* La advertencia que reemplazó al confirm(). Nombra el destino
                real —lo calcula page.tsx con el modo de envío activo— en vez
                de describir el mecanismo: es UN correo con los tres en el
                "para", no tres correos sueltos. */}
            <p className="aviso">
              Al recorregir se vuelve a enviar el contrato a <strong>{destinos}</strong>.
            </p>

            {error && <p className="error">{error}</p>}
            {/* Si falla recorregirContratoAction (Resend, red…) el modal se
                queda abierto para reintentar — y por eso el resultado tiene
                que verse ACÁ ADENTRO. El de afuera (más abajo) es solo para
                el resultado que sobrevive al cierre del modal. */}
            {resultado && !resultado.ok && <p className="error">{resultado.texto}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setAbierto(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn primary" disabled={pending || !programaId}>
                {pending ? "Recorrigiendo…" : "Recorregir"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
