"use client";
import { useState, useTransition } from "react";
import { editarPersona } from "@/app/actions";
import Modal from "@/components/Modal";
import { PAISES, etiquetaDe } from "@/lib/paises";
// ETIQUETA_ESTADO vivía aquí y solo se usaba en el desplegable de abajo,
// mientras las dos pantallas que enseñan el estado imprimían el enum crudo.
// Ahora vive en lib/persona.ts, con el resto de la lógica de estado.
import { ESTADOS_PERSONA, ETIQUETA_ESTADO } from "@/lib/persona";
import type { PersonaResult } from "@/lib/types";

export type FichaEditable = {
  id: string;
  nombre: string | null;
  telefono_e164: string | null;
  email: string | null;
  pais: string | null;
  coach_id: string | null;
  estado: string;
};

export default function EditarCliente({
  ficha,
  coaches,
  puedeCambiarEstado,
}: {
  ficha: FichaEditable;
  coaches: { id: string; nombre: string }[];
  puedeCambiarEstado: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function enviar(fd: FormData) {
    setError(null);
    start(async () => {
      const r: PersonaResult = await editarPersona(fd);
      if (!r.ok) setError(r.error);
      else {
        // El mensaje de éxito importa: cuando el guardado adopta un hilo de
        // WhatsApp suelto, decirlo evita que alguien vaya al inbox a buscar
        // por qué la conversación "no aparece" en la ficha.
        setAviso(r.mensaje);
        setAbierto(false);
      }
    });
  }

  function cerrar() { setError(null); setAbierto(false); }

  return (
    <>
      <button className="btn" onClick={() => { setError(null); setAviso(null); setAbierto(true); }}>
        Editar ficha
      </button>
      {/* `.ok` es la clase de confirmación del sistema (verde); `.hint` es
          gris de ayuda. Y ✓ en vez de ✅: el spec pide formas geométricas
          monocromas, no emoji, que además cambia de dibujo en cada sistema. */}
      {aviso && !abierto && <p className="ok">✓ {aviso}</p>}

      {abierto && (
        <Modal titulo="Editar ficha" onCerrar={cerrar}>
            <form action={enviar}>
              <input type="hidden" name="persona_id" value={ficha.id} />
              {/* Los valores ACTUALES viajan con el formulario para que el
                  servidor mande al RPC solo lo que de verdad cambió, en vez de
                  reescribir los seis campos y dejar una fila de auditoría
                  inútil en cada guardado. */}
              <input type="hidden" name="actual_nombre" value={ficha.nombre ?? ""} />
              <input type="hidden" name="actual_telefono" value={ficha.telefono_e164 ?? ""} />
              <input type="hidden" name="actual_email" value={ficha.email ?? ""} />
              <input type="hidden" name="actual_pais" value={ficha.pais ?? ""} />
              <input type="hidden" name="actual_coach_id" value={ficha.coach_id ?? ""} />
              <input type="hidden" name="actual_estado" value={ficha.estado} />

              <label>Nombre
                <input name="nombre" type="text" defaultValue={ficha.nombre ?? ""} />
              </label>

              <label>Teléfono (WhatsApp)
                <input name="telefono" type="tel" defaultValue={ficha.telefono_e164 ?? ""}
                       placeholder="+54 9 11 2345 6789" />
              </label>
              {!ficha.telefono_e164 && (
                <p className="note">
                  Sin teléfono no se le puede escribir por WhatsApp. Al guardarlo, si ya
                  existe una conversación suelta con ese número, se vincula a esta ficha.
                </p>
              )}

              <label>Email
                <input name="email" type="email" defaultValue={ficha.email ?? ""} />
              </label>

              {/* El value es el NOMBRE del país, no el ISO: es lo que guarda
                  `personas.pais` (canonizado en la migración 0027) y lo que se
                  compara para detectar el cambio. */}
              <label>País
                <select name="pais" defaultValue={ficha.pais ?? ""}>
                  <option value="">— sin país —</option>
                  {PAISES.map((p) => (
                    <option key={p.iso} value={p.nombre}>{etiquetaDe(p)}</option>
                  ))}
                </select>
              </label>

              <label>Consultor
                <select name="coach_id" defaultValue={ficha.coach_id ?? ""}>
                  <option value="">— sin consultor —</option>
                  {coaches.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </label>

              <label>Estado
                <select name="estado" defaultValue={ficha.estado} disabled={!puedeCambiarEstado}>
                  {ESTADOS_PERSONA.map((e) => (
                    <option key={e} value={e}>{ETIQUETA_ESTADO[e] ?? e}</option>
                  ))}
                </select>
              </label>
              {!puedeCambiarEstado && (
                <p className="hint">Solo un administrador puede cambiar el estado.</p>
              )}

              {error && <p className="cuota-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={cerrar}>Cancelar</button>
                <button className="btn primary" disabled={pending}>
                  {pending ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
        </Modal>
      )}
    </>
  );
}
