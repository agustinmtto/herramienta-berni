"use client";
import { useMemo, useState } from "react";
import { etiquetaAsistencia, MOTIVO_CONGELADO_CATALOGO } from "@/lib/servicio";
import { colorSesion, colorPersona, money } from "@/lib/format";
import type { SesionRow, OperacionRow, CupoRow, RepartoRow } from "@/lib/sesiones-datos";
import SesionDetalle from "@/components/SesionDetalle";
import SesionForm from "@/components/SesionForm";

type Pestana = "historico" | "cliente" | "proximas";

export default function SesionesPanel({
  historico, proximas, cupo, reparto, operaciones, clientes, coaches, hoy,
}: {
  historico: SesionRow[];
  proximas: SesionRow[];
  cupo: CupoRow[];
  reparto: RepartoRow[];
  operaciones: OperacionRow[];
  clientes: { id: string; nombre: string }[];
  coaches: { id: string; nombre: string }[];
  hoy: string;
}) {
  const [pestana, setPestana] = useState<Pestana>("historico");
  const [q, setQ] = useState("");
  const [fCoach, setFCoach] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [formPara, setFormPara] = useState<string | null | undefined>(undefined);
  const [expandido, setExpandido] = useState<string | null>(null);

  // El filtrado vive en el navegador sobre las 109 filas ya cargadas: es
  // instantáneo y evita un round-trip por cada tecla del buscador.
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    return historico.filter((s) => {
      if (t && !(s.cliente ?? "").toLowerCase().includes(t)) return false;
      if (fCoach && s.coach !== fCoach) return false;
      if (fEstado === "si" && s.estado_asistencia !== "asistio") return false;
      if (fEstado === "pend" && s.estado_asistencia !== null) return false;
      return true;
    });
  }, [historico, q, fCoach, fEstado]);

  const opsPorSesion = useMemo(() => {
    const m = new Map<string, OperacionRow[]>();
    for (const o of operaciones) {
      const l = m.get(o.sesion_id) ?? [];
      l.push(o);
      m.set(o.sesion_id, l);
    }
    return m;
  }, [operaciones]);

  const repartoPorPersona = useMemo(() => {
    const m = new Map<string, RepartoRow[]>();
    for (const r of reparto) {
      if (r.hechas === 0) continue;
      const l = m.get(r.persona_id) ?? [];
      l.push(r);
      m.set(r.persona_id, l);
    }
    return m;
  }, [reparto]);

  const sesionesPorPersona = useMemo(() => {
    const m = new Map<string, SesionRow[]>();
    for (const s of historico) {
      if (!s.persona_id) continue;
      const l = m.get(s.persona_id) ?? [];
      l.push(s);
      m.set(s.persona_id, l);
    }
    // El histórico llega descendente; dentro de una ficha se lee al revés.
    for (const l of m.values()) l.reverse();
    return m;
  }, [historico]);

  const cupoFiltrado = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cupo;
    return cupo.filter((c) => (c.cliente ?? "").toLowerCase().includes(t));
  }, [cupo, q]);

  const sesionAbierta = abierta
    ? [...historico, ...proximas].find((s) => s.id === abierta) ?? null
    : null;

  return (
    <>
      <div className="sesiones-acciones">
        <div className="tabs">
          <button className={`tab ${pestana === "historico" ? "active" : ""}`}
                  onClick={() => setPestana("historico")}>
            Histórico
          </button>
          <button className={`tab ${pestana === "cliente" ? "active" : ""}`}
                  onClick={() => setPestana("cliente")}>
            Por cliente
          </button>
          <button className={`tab ${pestana === "proximas" ? "active" : ""}`}
                  onClick={() => setPestana("proximas")}>
            Próximas
          </button>
        </div>
        <button className="btn primary" onClick={() => setFormPara(null)}>
          + Registrar sesión
        </button>
      </div>

      {pestana !== "proximas" && (
        <div className="filtros">
          <input type="search" placeholder="Buscar cliente…" value={q}
                 onChange={(e) => setQ(e.target.value)} />
          {pestana === "historico" && (
            <>
              <select className="sel" value={fCoach} onChange={(e) => setFCoach(e.target.value)}>
                <option value="">Todos los consultores</option>
                {coaches.map((c) => <option key={c.id}>{c.nombre}</option>)}
              </select>
              <select className="sel" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                <option value="">Cualquier estado</option>
                <option value="si">Asistió</option>
                <option value="pend">Sin registrar</option>
              </select>
              <span className="res">{filtradas.length} de {historico.length} sesiones</span>
            </>
          )}
          {pestana === "cliente" && (
            <span className="res">{cupoFiltrado.length} clientes</span>
          )}
        </div>
      )}

      {/* ---------------- Histórico ---------------- */}
      {pestana === "historico" && (
        <div className="card">
          <div className="card-head">
            <h2>Todas las sesiones</h2>
            <span className="hint">Click en cualquier sesión para ver su detalle</span>
          </div>
          <div className="tabla-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 96 }}>Fecha</th>
                  <th>Cliente</th>
                  <th style={{ width: 92 }}>Consultor</th>
                  <th style={{ width: 82 }}>Sesión</th>
                  {/* Berni, CAMBIOS OS: "cantidad de capital invertido como
                      columna". El dato ya viajaba en la fila desde siempre —
                      solo estaba escondido dentro del detalle. */}
                  <th className="r" style={{ width: 96 }}>Capital</th>
                  <th style={{ width: 122 }}>Estado</th>
                  <th>Notas</th>
                  {/* "botón que redirija a la repetición de fathom, botón que
                      redirija a la landing". Van juntos en una columna y no
                      sueltos: son los dos sitios a los que se salta desde una
                      sesión, y separados robaban dos columnas a una tabla que
                      en móvil ya va justa. */}
                  <th style={{ width: 74 }}>Enlaces</th>
                  <th className="r" style={{ width: 92 }}>Origen</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((s) => {
                  const cColor = s.coach_id ? colorPersona(s.coach_id) : "";
                  // La franja de fila solo es para la paleta fija de consultores
                  // (prefijo "c-"): el resto cae al hash genérico, que reutiliza
                  // verde/rojo/azul — esos ya significan otra cosa en la fila.
                  const franja = cColor.startsWith("c-") ? `r-${cColor.slice(2)}` : "";
                  return (
                  <tr key={s.id} className={`clickable ${franja}`} onClick={() => setAbierta(s.id)}>
                    <td className="mono muted">{fechaCorta(s.dia)}</td>
                    <td className="nom">{s.cliente ?? "(sin cliente)"}</td>
                    <td><span className={`pill ${cColor}`}>{s.coach ?? "—"}</span></td>
                    <td>{s.numero ? <span className={`pill ${colorSesion(s.numero)}`}>Sesión {s.numero}</span> : <span className="muted">—</span>}</td>
                    <td className="r mono">
                      {s.capital_total != null ? money(s.capital_total) : <span className="muted">—</span>}
                    </td>
                    <td><PillEstado e={s.estado_asistencia} /></td>
                    <td>
                      {s.notas
                        ? (
                          /* Berni: "que la parte de notas sea desplegable y que
                             abra todas las notas". <details> nativo: se abre con
                             teclado sin escribir nada, y recuerda su estado al
                             re-renderizar la tabla.
                             `stopPropagation` es obligatorio — la fila entera
                             abre el detalle de la sesión, así que sin esto
                             desplegar una nota te sacaba a otra pantalla. */
                          <details className="nota-desp" onClick={(e) => e.stopPropagation()}>
                            <summary><span className="nota-prev">{s.notas}</span></summary>
                            <div className="nota-todo">{s.notas}</div>
                          </details>
                        )
                        : <span className="sin-nota">sin notas</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="ses-enlaces">
                        {s.url_grabacion
                          ? <a href={s.url_grabacion} target="_blank" rel="noopener noreferrer" title="Ver la grabación">Grabación</a>
                          : <span className="muted" title="Esta sesión no tiene grabación enlazada">—</span>}
                        {s.enlace
                          ? <a href={s.enlace} target="_blank" rel="noopener noreferrer" title="Abrir la landing del cliente">Landing</a>
                          : null}
                      </span>
                    </td>
                    <td className="r">
                      {s.de_ghl
                        ? <span className="pill blue">GHL</span>
                        : <span className="muted">Airtable</span>}
                    </td>
                  </tr>
                  );
                })}
                {filtradas.length === 0 && (
                  <tr><td colSpan={9}><div className="empty-box">Nada que coincida con ese filtro.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- Por cliente ---------------- */}
      {pestana === "cliente" && (
        <div className="card">
          <div className="card-head">
            <h2>Consumo de consultorías</h2>
            <span className="hint">Click en una fila para ver todo su historial</span>
          </div>
          <div className="tabla-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th style={{ width: 106 }}>Tier</th>
                  <th className="r" style={{ width: 84 }}>Incluidas</th>
                  <th className="r" style={{ width: 74 }}>Hechas</th>
                  <th className="r" style={{ width: 92 }}>Pendientes</th>
                  <th style={{ width: 126 }}>Avance</th>
                  <th style={{ width: 150 }}>Reparto</th>
                  <th className="r" style={{ width: 100 }}>Última</th>
                </tr>
              </thead>
              <tbody>
                {cupoFiltrado.map((c) => {
                  const abierto = expandido === c.persona_id;
                  const suyas = sesionesPorPersona.get(c.persona_id) ?? [];
                  const pct = c.incluidas ? Math.min(100, Math.round((c.hechas / c.incluidas) * 100)) : 0;
                  return [
                    <tr key={c.persona_id} className="clickable"
                        onClick={() => setExpandido(abierto ? null : c.persona_id)}>
                      <td className="nom">{c.cliente ?? "—"}</td>
                      <td>{c.tier
                        ? <span className="pill gold">{c.tier === "OG" ? "OG" : `€${c.tier}`}</span>
                        : <span className="muted">sin programa</span>}</td>
                      <td className="r">
                        {c.incluidas ?? "—"}
                        {/* 🔴 Los dos chips explican POR QUÉ el número es el que
                            es. Sin número no hay nada que explicar, así que
                            cuando `incluidas` es null no se pinta ninguno.
                            Es la misma regla que `resumenCupo` (`servicio.ts:100`)
                            ya aplica en el formulario: devuelve "sin programa
                            activo, no se sabe cuántas incluye" y se calla los
                            motivos. La tabla era la que estaba fuera de sitio.

                            Cuándo pasa, y por qué importa: a un congelado por el
                            catálogo 2026 le caduca el programa y `incluidas`
                            vuelve a `—` (la 0066 lo garantiza), pero
                            `consultorias_ajuste` sigue escrito en la persona y
                            `ajustado` sigue siendo true — el chip "congelado"
                            saldría junto al guion, con un tooltip ("mantiene el
                            cupo que contrató") que ya no significa nada: en
                            cuanto compre algo, el disparador se lo borra.
                            Y el de bonos es peor: su título calcula la base con
                            `(incluidas ?? 0) - extra_bonos`, así que sin número
                            base diría "Base -1". Ese `?? 0` es el mismo cero
                            inventado que esta pantalla existe para no decir.

                            NO afecta a los 59 del día de la aplicación: los
                            congela un UPDATE que va unido a `v_programa_activo`,
                            así que todos tienen programa vigente e `incluidas`
                            con número — su chip sigue saliendo. */}
                        {c.incluidas !== null && (
                          <>
                            {/* El aviso va aquí y no en un tooltip: un número distinto
                                del que dice el tier parece un error del sistema si no
                                se explica en el mismo sitio.
                                Dos motivos posibles para el mismo `ajustado`, y hay que
                                distinguirlos: congelado por el catálogo 2026 (su cupo
                                es el que contrató, no se toca — la migración 0066 lo
                                escribe así para 59 clientes) o un ajuste manual real
                                (alguien cambió el número; hoy no hay ninguno, pero el
                                caso sigue existiendo). Decir "ajustado" del primero
                                invitaría a "arreglarlo" borrando el ajuste — que es
                                justo como se regalarían las consultorías que la 0066
                                existe para evitar. Por eso el tooltip del congelado no
                                suelta el número nuevo del tier sin aclarar que es para
                                las altas nuevas, no para este cliente. */}
                            {c.ajustado && (
                              c.ajuste_motivo === MOTIVO_CONGELADO_CATALOGO ? (
                                <span className="ajustado" title={`Congelado al cambiar el catálogo — mantiene el cupo que contrató; ${c.incluidas_tier ?? "—"} es lo que incluye el tier para las altas nuevas.`}>
                                  congelado
                                </span>
                              ) : (
                                <span className="ajustado" title={`Su tier incluye ${c.incluidas_tier ?? "—"}`}>
                                  ajustado
                                </span>
                              )
                            )}
                            {/* Los bonos son un motivo DISTINTO del ajuste y se
                                etiquetan aparte. La base ya no puede tomarse de
                                `incluidas_tier` (el número DEL CATÁLOGO ACTUAL): para
                                un cliente congelado eso ahora es el número nuevo, no
                                el suyo, y el desglose mentiría. `incluidas` menos los
                                propios bonos es la base real de este cliente,
                                congelado o no. */}
                            {c.extra_bonos > 0 && (
                              <span className="ajustado" title={`Base ${c.incluidas - c.extra_bonos} · +${c.extra_bonos} por ${c.extra_bonos === 1 ? "bono" : "bonos"} del evento`}>
                                +{c.extra_bonos} bonos
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="r nom">{c.hechas}</td>
                      <td className="r">
                        {c.pendientes === null
                          ? <span className="muted">—</span>
                          : c.pendientes > 0
                            ? <span className="pill orange">{c.pendientes}</span>
                            : <span className="pill green">0</span>}
                      </td>
                      <td>
                        {c.incluidas
                          ? <span className={`prog ${pct >= 100 ? "full" : ""}`}><i style={{ width: `${pct}%` }} /></span>
                          : <span className="muted">—</span>}
                      </td>
                      <td className="muted reparto">
                        {(repartoPorPersona.get(c.persona_id) ?? [])
                          .map((r) => `${r.coach ?? "?"} ${r.hechas}`).join(" · ") || "—"}
                      </td>
                      <td className="r mono muted">{fechaCorta(c.ultima?.slice(0, 10) ?? null)}</td>
                    </tr>,
                    abierto && (
                      <tr key={`${c.persona_id}-det`} className="cli-detalle">
                        <td colSpan={8}>
                          {suyas.length === 0 && <div className="empty-box">Sin sesiones registradas.</div>}
                          {suyas.map((s) => (
                            <div key={s.id} className="hist-item clickable"
                                 onClick={(e) => { e.stopPropagation(); setAbierta(s.id); }}>
                              <div className="hist-cab">
                                <span className="f mono">{fechaCorta(s.dia)}</span>
                                <span className={`pill ${s.coach_id ? colorPersona(s.coach_id) : ""}`}>{s.coach ?? "—"}</span>
                                {s.numero && <span className={`pill ${colorSesion(s.numero)}`}>Sesión {s.numero}</span>}
                                <PillEstado e={s.estado_asistencia} />
                                {(opsPorSesion.get(s.id)?.length ?? 0) > 0 && (
                                  <span className="pill gold">
                                    {opsPorSesion.get(s.id)!.length} operaciones
                                  </span>
                                )}
                              </div>
                              {s.notas
                                ? <div className="hist-txt">{s.notas}</div>
                                : <div className="hist-txt sin-nota">sin notas</div>}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ),
                  ];
                })}
                {cupoFiltrado.length === 0 && (
                  <tr><td colSpan={8}><div className="empty-box">Ningún cliente coincide.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- Próximas ---------------- */}
      {pestana === "proximas" && (
        <div className="card">
          <div className="card-head">
            <h2>Agendadas en GoHighLevel</h2>
            <span className="hint">Llegan solas por el sync · el recordatorio de WhatsApp sale de aquí</span>
          </div>
          <div className="tabla-scroll">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>Cuándo</th>
                  <th>Cliente</th>
                  <th style={{ width: 100 }}>Consultor</th>
                  <th>Enlace</th>
                  <th className="r" style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {proximas.map((s) => (
                  <tr key={s.id}>
                    {/* Aquí SÍ se muestra la hora: estas vienen de GHL y es real.
                        En el histórico no, porque 103 de 111 filas llevan la hora
                        placeholder 12:00 que puso el backfill de Airtable. */}
                    <td className="mono gold">{fechaHora(s.fecha)}</td>
                    <td className="nom">{s.cliente ?? "(sin cliente)"}</td>
                    <td><span className={`pill ${s.coach_id ? colorPersona(s.coach_id) : ""}`}>{s.coach ?? "—"}</span></td>
                    <td>
                      {s.enlace
                        ? <a className="linkbtn mono" href={s.enlace} target="_blank" rel="noreferrer">
                            {s.enlace.replace("https://", "")}
                          </a>
                        : <span className="muted">sin enlace</span>}
                    </td>
                    <td className="r">
                      <button className="btn" onClick={() => setFormPara(s.persona_id)}>
                        Registrar
                      </button>
                    </td>
                  </tr>
                ))}
                {proximas.length === 0 && (
                  <tr><td colSpan={5}><div className="empty-box">No hay consultorías agendadas.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sesionAbierta && (
        <SesionDetalle
          sesion={sesionAbierta}
          hermanas={sesionAbierta.persona_id
            ? (sesionesPorPersona.get(sesionAbierta.persona_id) ?? [])
            : []}
          operaciones={opsPorSesion.get(sesionAbierta.id) ?? []}
          cupo={cupo.find((c) => c.persona_id === sesionAbierta.persona_id) ?? null}
          reparto={sesionAbierta.persona_id
            ? (repartoPorPersona.get(sesionAbierta.persona_id) ?? [])
            : []}
          coaches={coaches}
          onCerrar={() => setAbierta(null)}
          onIr={(id) => setAbierta(id)}
          onRegistrarOtra={(personaId) => { setAbierta(null); setFormPara(personaId); }}
        />
      )}

      {formPara !== undefined && (
        <SesionForm
          clientes={clientes}
          coaches={coaches}
          cupo={cupo}
          sesionesPorPersona={sesionesPorPersona}
          personaInicial={formPara}
          hoy={hoy}
          onCerrar={() => setFormPara(undefined)}
        />
      )}
    </>
  );
}

function PillEstado({ e }: { e: SesionRow["estado_asistencia"] }) {
  const clase =
    e === "asistio" ? "green" : e === "no_asistio" ? "red" : e === "reprogramada" ? "blue" : "orange";
  return <span className={`pill ${clase}`}>{etiquetaAsistencia(e)}</span>;
}

// `dia` ya viene calculado en Madrid por la vista: se parte la cadena en vez de
// construir un Date, que volvería a aplicar la zona del proceso encima.
function fechaCorta(dia: string | null): string {
  if (!dia) return "—";
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}
