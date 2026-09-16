"use client";
import { useEffect, useState, useTransition } from "react";
import Modal from "@/components/Modal";
import { editarSesion, borrarSesion } from "@/app/actions";
import {
  etiquetaAsistencia, etiquetaOperacion, nombreEstadoOperacion, detectarFichaOperativa,
} from "@/lib/servicio";
import { colorSesion, colorPersona } from "@/lib/format";
import type { SesionRow, OperacionRow, CupoRow, RepartoRow } from "@/lib/sesiones-datos";
import OperacionesEditor, { desdeFilas, opsAJson, type OperacionEditable } from "@/components/OperacionesEditor";
import { IconoGrabacion, IconoVideoSala } from "@/components/Iconos";

export default function SesionDetalle({
  sesion, hermanas, operaciones, cupo, reparto, coaches, onCerrar, onIr, onRegistrarOtra,
}: {
  sesion: SesionRow;
  hermanas: SesionRow[];
  operaciones: OperacionRow[];
  cupo: CupoRow | null;
  reparto: RepartoRow[];
  coaches: { id: string; nombre: string }[];
  onCerrar: () => void;
  onIr: (id: string) => void;
  onRegistrarOtra: (personaId: string | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);
  const [ops, setOps] = useState<OperacionEditable[]>(desdeFilas(operaciones));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // El Escape que vivía aquí se ha ido a components/Modal.tsx, que es de
  // donde salió el patrón para los otros once. Tenerlo en los dos sitios
  // dejaría dos listeners haciendo lo mismo.

  const pos = hermanas.findIndex((s) => s.id === sesion.id);
  const anterior = pos > 0 ? hermanas[pos - 1] : null;
  const siguiente = pos >= 0 && pos < hermanas.length - 1 ? hermanas[pos + 1] : null;
  const pistas = detectarFichaOperativa(sesion.notas);

  return (
    <Modal
      titulo={sesion.cliente ?? "Sesión sin cliente asignado"}
      subtitulo={fechaLarga(sesion.dia)}
      ancho
      onCerrar={onCerrar}
    >

        <div className="det-chips">
          <span className={`pill ${sesion.coach_id ? colorPersona(sesion.coach_id) : ""}`}>{sesion.coach ?? "sin consultor"}</span>
          {sesion.numero && <span className={`pill ${colorSesion(sesion.numero)}`}>Sesión {sesion.numero}</span>}
          <span className={`pill ${estadoClase(sesion.estado_asistencia)}`}>
            {etiquetaAsistencia(sesion.estado_asistencia)}
          </span>
          {sesion.tier && (
            <span className="pill gold">
              {sesion.tier === "OG" ? "OG vitalicio" : `Tier €${sesion.tier}`}
            </span>
          )}
          <span className={`pill ${sesion.de_ghl ? "blue" : ""}`}>
            {sesion.de_ghl ? "Agendada en GoHighLevel" : "Histórico Airtable"}
          </span>
          {sesion.capital_total !== null && (
            <span className="pill gold">Capital {sesion.capital_total.toLocaleString("es-ES")} €</span>
          )}
          {sesion.exchange && <span className="pill blue">{sesion.exchange}</span>}
        </div>

        {!editando ? (
          <>
            <div className="det-bloque">
              <h4>Qué se habló</h4>
              {sesion.notas
                ? <div className="det-notas">{sesion.notas}</div>
                : <div className="det-vacio">
                    Esta sesión se registró <b>sin notas</b>. Nadie escribió qué se habló.
                  </div>}
            </div>

            <div className="det-bloque">
              <h4>Qué se le recomendó</h4>
              {operaciones.length > 0 ? (
                operaciones.map((o) => (
                  <div className="op-linea" key={o.id}>
                    <span className={`dir ${o.direccion}`}>
                      {etiquetaOperacion({
                        direccion: o.direccion, activo: o.activo, capital: o.capital,
                        apalancamiento: o.apalancamiento, zona_entrada: o.zona_entrada,
                        objetivo: o.objetivo, estado: o.estado,
                      })}
                    </span>
                    {o.estado && (
                      <span className={`pill ${o.estado === "ejecutada" ? "green" : o.estado === "ordenes_puestas" ? "orange" : ""}`}>
                        {nombreEstadoOperacion(o.estado)}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="det-vacio">
                  Sin operaciones registradas. <b>Las sesiones anteriores a este formulario
                  no las tienen</b> — a partir de ahora cada sesión guarda las suyas con
                  dirección, capital, apalancamiento, entrada, objetivo y estado.
                </div>
              )}

              {/* Lo detectado NO es dato: sale de leer la nota. Se marca como
                  tal para que nadie lo confunda con algo que alguien confirmó. */}
              {operaciones.length === 0 && pistas.length > 0 && (
                <div className="det-detectado">
                  <span className="lbl">Detectado en el texto de la nota</span>
                  <div className="chips">
                    {pistas.map((p, i) => (
                      <span className={`pill ${p.clase}`} key={i}>{p.texto}</span>
                    ))}
                  </div>
                  Esto <b>no es dato guardado</b>: sale de leer la nota. Sirve para rellenar
                  la ficha operativa de las sesiones viejas sin escribirla de cero.
                </div>
              )}
            </div>

            {sesion.proximo_paso && (
              <div className="det-bloque">
                <h4>Próximo paso del cliente</h4>
                <div className="det-notas">{sesion.proximo_paso}</div>
              </div>
            )}

            <div className="det-bloque">
              <h4>Enlaces</h4>
              {sesion.url_grabacion || sesion.enlace ? (
                <div className="det-enlaces">
                  {sesion.url_grabacion && (
                    <a className="det-enlace" href={sesion.url_grabacion} target="_blank" rel="noreferrer">
                      <IconoGrabacion /> Grabación
                    </a>
                  )}
                  {sesion.enlace && (
                    <a className="det-enlace" href={sesion.enlace} target="_blank" rel="noreferrer">
                      <IconoVideoSala /> Sala de la sesión
                    </a>
                  )}
                </div>
              ) : (
                <div className="det-vacio">Sin grabación ni enlace guardados.</div>
              )}
            </div>

            {cupo && (
              <div className="det-bloque">
                <h4>Este cliente</h4>
                <div className="det-notas det-cupo">
                  Lleva <b>{cupo.hechas}</b> {cupo.hechas === 1 ? "sesión" : "sesiones"}
                  {cupo.incluidas !== null && <> de <b>{cupo.incluidas}</b> incluidas</>}
                  {cupo.pendientes !== null && (
                    cupo.pendientes > 0
                      ? <> · le {cupo.pendientes === 1 ? "queda" : "quedan"} <b>{cupo.pendientes}</b></>
                      : <> · <b>no le quedan</b></>
                  )}
                  {reparto.length > 0 && (
                    <> · reparto: {reparto.map((r) => `${r.coach ?? "?"} ${r.hechas}`).join(" / ")}</>
                  )}
                </div>
              </div>
            )}

            {error && <p className="cuota-error">{error}</p>}

            {confirmaBorrar ? (
              <div className="det-borrar">
                <span>¿Seguro? La sesión desaparece, pero queda el rastro en la auditoría.</span>
                <form action={(fd) => {
                  setError(null);
                  start(async () => {
                    const r = await borrarSesion(fd);
                    if (!r.ok) setError(r.error); else onCerrar();
                  });
                }}>
                  <input type="hidden" name="sesion_id" value={sesion.id} />
                  <button className="btn warn" disabled={pending}>
                    {pending ? "Borrando…" : "Sí, borrar"}
                  </button>
                </form>
                <button className="btn" onClick={() => setConfirmaBorrar(false)}>No</button>
              </div>
            ) : (
              <div className="det-nav">
                <button className="btn" disabled={!anterior}
                        onClick={() => anterior && onIr(anterior.id)}>‹ Anterior</button>
                <button className="btn" disabled={!siguiente}
                        onClick={() => siguiente && onIr(siguiente.id)}>Siguiente ›</button>
                <button className="btn" onClick={() => setEditando(true)}>Editar</button>
                <button className="btn" onClick={() => setConfirmaBorrar(true)}>Borrar</button>
                <button className="btn primary"
                        onClick={() => onRegistrarOtra(sesion.persona_id)}>
                  Registrar nueva
                </button>
                {pos >= 0 && hermanas.length > 0 && (
                  <span className="pos">Sesión {pos + 1} de {hermanas.length} de este cliente</span>
                )}
              </div>
            )}
          </>
        ) : (
          <form action={(fd) => {
            setError(null);
            start(async () => {
              const r = await editarSesion(fd);
              if (!r.ok) setError(r.error); else { setEditando(false); onCerrar(); }
            });
          }}>
            <input type="hidden" name="sesion_id" value={sesion.id} />
            <input type="hidden" name="operaciones" value={opsAJson(ops)} />

            <fieldset className="fs">
              <legend>Corregir la sesión</legend>
              <div className="row tres">
                <label className="f"><span>Fecha</span>
                  <input type="date" name="fecha" defaultValue={sesion.dia ?? ""} />
                </label>
                <label className="f"><span>Consultor</span>
                  <select name="coach_id" defaultValue={sesion.coach_id ?? ""}>
                    {coaches.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </label>
                <label className="f"><span>¿Se hizo?</span>
                  <select name="estado_asistencia" defaultValue={sesion.estado_asistencia ?? ""}>
                    <option value="">Sin registrar</option>
                    <option value="asistio">Asistió</option>
                    <option value="no_asistio">No asistió</option>
                    <option value="reprogramada">Reprogramada</option>
                  </select>
                </label>
              </div>
              <label className="f"><span>Notas</span>
                <textarea name="notas" defaultValue={sesion.notas ?? ""} />
              </label>
              <div className="row tres">
                <label className="f"><span>Grabación</span>
                  <input name="url_grabacion" defaultValue={sesion.url_grabacion ?? ""} />
                </label>
                <label className="f"><span>Capital (€)</span>
                  <input name="capital_total" defaultValue={sesion.capital_total ?? ""} />
                </label>
                <label className="f"><span>Exchange</span>
                  <input name="exchange" defaultValue={sesion.exchange ?? ""} />
                </label>
              </div>
              <label className="f"><span>Próximo paso</span>
                <input name="proximo_paso" defaultValue={sesion.proximo_paso ?? ""} />
              </label>
            </fieldset>

            <fieldset className="fs">
              <legend>Operaciones recomendadas</legend>
              <OperacionesEditor ops={ops} setOps={setOps} />
            </fieldset>

            {error && <p className="cuota-error">{error}</p>}
            <div className="modal-actions">
              <button className="btn primary" disabled={pending}>
                {pending ? "Guardando…" : "Guardar cambios"}
              </button>
              <button type="button" className="btn" onClick={() => setEditando(false)}>
                Cancelar
              </button>
            </div>
          </form>
        )}
    </Modal>
  );
}

function estadoClase(e: SesionRow["estado_asistencia"]): string {
  return e === "asistio" ? "green" : e === "no_asistio" ? "red" : e === "reprogramada" ? "blue" : "orange";
}

// `dia` ya viene en Madrid desde la vista: se parte la cadena en vez de
// construir un Date, que volvería a aplicar la zona del navegador encima.
function fechaLarga(dia: string | null): string {
  if (!dia) return "—";
  const [a, m, d] = dia.split("-").map(Number);
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const dow = dias[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${dow}, ${d} de ${meses[m - 1]} de ${a}`;
}
