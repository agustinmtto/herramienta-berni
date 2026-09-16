"use client";
import { useMemo, useState, useTransition } from "react";
import Modal from "@/components/Modal";
import { crearSesion } from "@/app/actions";
import { resumenCupo, siguienteNumero, etiquetaOperacion } from "@/lib/servicio";
import type { Operacion } from "@/lib/servicio";
import type { SesionRow, CupoRow } from "@/lib/sesiones-datos";
import OperacionesEditor, { opVacia, opsAJson, type OperacionEditable } from "@/components/OperacionesEditor";

export default function SesionForm({
  clientes, coaches, cupo, sesionesPorPersona, personaInicial, hoy, onCerrar,
}: {
  clientes: { id: string; nombre: string }[];
  coaches: { id: string; nombre: string }[];
  cupo: CupoRow[];
  sesionesPorPersona: Map<string, SesionRow[]>;
  personaInicial: string | null;
  hoy: string;
  onCerrar: () => void;
}) {
  const [persona, setPersona] = useState(personaInicial ?? "");
  const [busca, setBusca] = useState("");
  const [estado, setEstado] = useState("asistio");
  const [notas, setNotas] = useState("");
  const [ops, setOps] = useState<OperacionEditable[]>([opVacia()]);
  const [capital, setCapital] = useState("");
  const [exchange, setExchange] = useState("");
  const [paso, setPaso] = useState("");
  const [coach, setCoach] = useState(coaches[0]?.id ?? "");
  const [fecha, setFecha] = useState(hoy);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const sugerencias = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (t.length < 2) return [];
    return clientes.filter((c) => c.nombre.toLowerCase().includes(t)).slice(0, 6);
  }, [clientes, busca]);

  const elegido = clientes.find((c) => c.id === persona) ?? null;
  const suCupo = cupo.find((c) => c.persona_id === persona) ?? null;
  const suyas = sesionesPorPersona.get(persona) ?? [];

  // El número NO se pregunta: se calcula y se enseña. Es la diferencia entre
  // que el coach recuerde por cuál va y que el OS se lo diga.
  const numero = siguienteNumero(suyas.map((s) => ({ estado_asistencia: s.estado_asistencia })));

  const previa: Operacion[] = ops
    .filter((o) => o.direccion && (o.activo || o.capital || o.zona_entrada || o.objetivo))
    .map((o) => ({
      direccion: o.direccion as Operacion["direccion"],
      activo: o.activo || null,
      capital: o.capital || null,
      apalancamiento: o.direccion === "esperar" ? null : (o.apalancamiento || null),
      zona_entrada: o.zona_entrada || null,
      objetivo: o.objetivo || null,
      estado: null,
    }));

  if (ok) {
    return (
      <Modal titulo="Sesión registrada" onCerrar={onCerrar}>
          <div className="ok-box">
            {/* ✓ en vez de ✅: formas geométricas monocromas, no emoji — que
                además se dibuja distinto en cada sistema. El h4 que había
                aquí repetía el título del diálogo. */}
            <div className="big ok">✓</div>
            <p>{ok}</p>
            <div className="modal-actions" style={{ justifyContent: "center" }}>
              <button className="btn primary" onClick={onCerrar}>Listo</button>
            </div>
          </div>
      </Modal>
    );
  }

  return (
    <Modal
      titulo="Registrar sesión"
      subtitulo="Tuve una sesión — cuéntale al OS qué pasó."
      ancho
      onCerrar={onCerrar}
    >

        <form
          action={(fd) => {
            setError(null);
            start(async () => {
              const r = await crearSesion(fd);
              if (!r.ok) setError(r.error);
              else setOk(`${elegido?.nombre ?? "El cliente"} — ha quedado como su Sesión ${numero}.`);
            });
          }}
        >
          <input type="hidden" name="persona_id" value={persona} />
          <input type="hidden" name="operaciones" value={opsAJson(ops)} />
          <input type="hidden" name="estado_asistencia" value={estado} />

          <fieldset className="fs">
            <legend>Qué sesión fue</legend>
            <label className="f"><span>Cliente *</span>
              <input autoComplete="off" placeholder="Escribe el nombre…"
                     value={elegido ? elegido.nombre : busca}
                     onChange={(e) => { setBusca(e.target.value); setPersona(""); }} />
            </label>
            {!elegido && sugerencias.length > 0 && (
              <ul className="sug">
                {sugerencias.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => { setPersona(c.id); setBusca(""); }}>
                      {c.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {elegido && (
              <div className="auto">
                Esta será su <b>Sesión {numero}</b> — el número lo pone el OS solo.
                <br />
                {suCupo
                  ? resumenCupo({ incluidas: suCupo.incluidas, ajustado: suCupo.ajustado, hechas: suCupo.hechas,
                              ajusteMotivo: suCupo.ajuste_motivo, extraBonos: suCupo.extra_bonos })
                  : "Sin sesiones previas."}
              </div>
            )}

            <div className="row">
              <label className="f"><span>Fecha *</span>
                <input type="date" name="fecha" value={fecha} required
                       onChange={(e) => setFecha(e.target.value)} />
              </label>
              <label className="f"><span>Consultor *</span>
                <select name="coach_id" value={coach} onChange={(e) => setCoach(e.target.value)}>
                  {coaches.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
            </div>

            <label className="f"><span>¿Se hizo?</span>
              <div className="seg">
                {[["asistio", "Sí, se hizo"], ["no_asistio", "No asistió"], ["reprogramada", "Se reprogramó"]]
                  .map(([v, t]) => (
                    <button type="button" key={v} className={estado === v ? "on" : ""}
                            onClick={() => setEstado(v)}>
                      {t}
                    </button>
                  ))}
              </div>
            </label>
          </fieldset>

          <fieldset className="fs">
            <legend>Qué se habló</legend>
            <label className="f"><span>Notas de la sesión</span>
              <textarea name="notas" value={notas} onChange={(e) => setNotas(e.target.value)}
                        placeholder="Qué se revisó, qué se decidió, en qué quedaron…" />
            </label>
            <div className="row">
              <label className="f"><span>URL de la grabación</span>
                <input name="url_grabacion" placeholder="https://…" />
              </label>
              <label className="f"><span>Duración (min)</span>
                <input name="duracion_min" placeholder="60" inputMode="numeric" />
              </label>
            </div>
          </fieldset>

          <fieldset className="fs">
            <legend>Ficha operativa</legend>
            <div className="row">
              <label className="f"><span>Capital total del cliente (€)</span>
                <input name="capital_total" value={capital} placeholder="15.000"
                       onChange={(e) => setCapital(e.target.value)} />
              </label>
              <label className="f"><span>Exchange</span>
                <select name="exchange" value={exchange} onChange={(e) => setExchange(e.target.value)}>
                  <option value="">—</option>
                  <option>OKX</option><option>Binance</option><option>Bitso</option>
                  <option>Bybit</option><option>Kraken</option><option>Otro</option>
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="fs">
            <legend>Qué se le recomendó en esta sesión</legend>
            <p className="aviso-fs">
              Una sesión puede cerrar con una sola estrategia o con varias.
              Añade una por cada operación que se le planteó al cliente.
            </p>
            <OperacionesEditor ops={ops} setOps={setOps} />
            <label className="f" style={{ marginTop: 14 }}><span>Próximo paso del cliente</span>
              <input name="proximo_paso" value={paso} placeholder="Crear cuenta OKX y ver el tutorial de futuros"
                     onChange={(e) => setPaso(e.target.value)} />
            </label>
          </fieldset>

          {(notas || previa.length > 0) && (
            <div className="prev-wrap">
              <div className="prev-label">Así se verá en la ficha del cliente</div>
              <div className="prev-card">
                <div className="prev-cab">
                  <span className="f mono">{fecha.split("-").reverse().join("/")}</span>
                  <span className="pill purple">
                    {coaches.find((c) => c.id === coach)?.nombre ?? "—"}
                  </span>
                  {elegido && <span className="pill">Sesión {numero}</span>}
                  {capital && <span className="pill gold">Capital {capital} €</span>}
                  {exchange && <span className="pill blue">{exchange}</span>}
                </div>
                {notas && <div className="prev-notas">{notas}</div>}
                {previa.map((o, i) => (
                  <div className="op-linea" key={i}>
                    <span className={`dir ${o.direccion}`}>{etiquetaOperacion(o)}</span>
                  </div>
                ))}
                {paso && <div className="prev-paso">→ {paso}</div>}
              </div>
            </div>
          )}

          {error && <p className="cuota-error">{error}</p>}

          <div className="modal-actions">
            <button className="btn primary" disabled={pending || !persona}>
              {pending ? "Guardando…" : "Guardar sesión"}
            </button>
            <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
            <span className="hint">Aparece al instante en la ficha del cliente</span>
          </div>
        </form>
    </Modal>
  );
}
