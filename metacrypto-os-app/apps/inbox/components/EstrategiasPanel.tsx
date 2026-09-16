"use client";
import { useMemo, useState, useTransition } from "react";
import { crearEstrategia, editarEstrategia, visibilidadEstrategia, verPassword, enlaceDeCliente, rotarEnlace } from "@/app/actions";
import {
  estadoEstrategia, etiquetaEstado, fechaCorta, normalizarUrl,
} from "@/lib/estrategias";
import type { EstrategiaRow, ClienteOpcion } from "@/lib/estrategias-datos";

export default function EstrategiasPanel({
  lista, clientes, hoy,
}: {
  lista: EstrategiaRow[];
  clientes: ClienteOpcion[];
  hoy: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<EstrategiaRow | null>(null);
  const [busca, setBusca] = useState("");
  const [verOcultas, setVerOcultas] = useState(false);
  // Las contraseñas NO vienen con el listado (irían en claro en el código
  // fuente de la página): se piden una a una al pulsar Mostrar y se guardan
  // sólo en memoria, hasta recargar.
  const [claves, setClaves] = useState<Record<string, string | null>>({});
  // El enlace del portal es POR CLIENTE, no por estrategia: se pide al abrir
  // el panel y se comparte entre todas las filas de esa persona.
  const [enlaces, setEnlaces] = useState<Record<string, string | null>>({});
  const [abiertoEnlace, setAbiertoEnlace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const filas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista
      .filter((e) => (verOcultas ? true : e.visible))
      .filter((e) =>
        !q ||
        (e.persona?.nombre ?? "").toLowerCase().includes(q) ||
        e.titulo.toLowerCase().includes(q),
      );
  }, [lista, busca, verOcultas]);

  const nOcultas = lista.filter((e) => !e.visible).length;

  function lanzar(fn: (fd: FormData) => Promise<any>, fd: FormData, alTerminar?: () => void) {
    setError(null);
    setOk(null);
    start(async () => {
      const r = await fn(fd);
      if (r?.ok) {
        setOk(r.mensaje ?? "Hecho.");
        alTerminar?.();
      } else {
        setError(r?.error ?? "No se pudo completar.");
      }
    });
  }

  return (
    <div className="panel-estrategias">
      <div className="barra">
        <input
          className="buscador"
          placeholder="Buscar por cliente o título…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar estrategias"
        />
        {nOcultas > 0 && (
          <label className="chk">
            <input
              type="checkbox"
              checked={verOcultas}
              onChange={(e) => setVerOcultas(e.target.checked)}
            />
            Ver las ocultas ({nOcultas})
          </label>
        )}
        <button
          className="btn-oro"
          onClick={() => { setEditando(null); setAbierto((v) => !v); }}
        >
          {abierto && !editando ? "Cancelar" : "+ Añadir estrategia"}
        </button>
      </div>

      {error && <div className="aviso err">{error}</div>}
      {ok && <div className="aviso ok">{ok}</div>}

      {(abierto || editando) && (
        <form
          className="form-estrategia"
          action={(fd) => {
            if (editando) {
              fd.set("id", editando.id);
              lanzar(editarEstrategia, fd, () => setEditando(null));
            } else {
              lanzar(crearEstrategia, fd, () => setAbierto(false));
            }
          }}
        >
          <h4>{editando ? `Editar · ${editando.titulo}` : "Nueva estrategia"}</h4>
          <div className="rejilla">
            {!editando && (
              <label className="campo">
                <span>Cliente</span>
                <select name="persona_id" required defaultValue="">
                  <option value="" disabled>Elige el cliente…</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}{c.tiene > 0 ? ` · ya tiene ${c.tiene}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="campo">
              <span>Título</span>
              <input
                name="titulo"
                required={!editando}
                defaultValue={editando?.titulo ?? ""}
                placeholder="Short Escalonado BTC"
              />
            </label>
            <label className="campo">
              <span>Fecha de lanzamiento</span>
              <input type="date" name="fecha_lanzamiento" defaultValue={editando?.fecha_lanzamiento ?? hoy} />
            </label>
            <label className="campo ancho">
              <span>Enlace</span>
              <input
                name="url"
                required={!editando}
                defaultValue={editando?.url ?? ""}
                placeholder="https://invierteconberni.com/cliente-000"
              />
            </label>
            <label className="campo">
              <span>Contraseña de la página</span>
              <input name="password" placeholder="La que tiene la landing" />
            </label>
            <label className="campo">
              <span>Resumen para el cliente</span>
              <input name="resumen" defaultValue={editando?.resumen ?? ""} placeholder="Una línea: qué es esta estrategia" />
            </label>
          </div>

          {!editando && (
            <label className="chk avisar">
              <input type="checkbox" name="avisar" defaultChecked />
              Avisar al cliente al guardar (WhatsApp y email)
            </label>
          )}

          <div className="acciones">
            <button className="btn-oro" type="submit" disabled={pending}>
              {pending ? "Guardando…" : editando ? "Guardar cambios" : "Guardar y publicar"}
            </button>
            <button
              type="button"
              className="btn-plano"
              onClick={() => { setAbierto(false); setEditando(null); }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {filas.length === 0 ? (
        <div className="vacio">
          {lista.length === 0
            ? "Todavía no hay ninguna estrategia. Pega la primera con “Añadir estrategia”."
            : "Ninguna estrategia coincide con esa búsqueda."}
        </div>
      ) : (
        <div className="tabla-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Cliente</th><th>Estrategia</th><th>Lanzada</th>
                <th>Contraseña</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((e) => {
                const est = estadoEstrategia(e, hoy);
                const destapada = e.id in claves;
                return (
                  <tr key={e.id}>
                    <td className="nm">{e.persona?.nombre ?? "—"}</td>
                    <td>
                      {e.titulo}
                      <br />
                      <a className="u" href={normalizarUrl(e.url) ?? "#"} target="_blank" rel="noreferrer noopener">
                        {e.url.replace(/^https?:\/\//, "")}
                      </a>
                    </td>
                    <td className="d">{fechaCorta(e.fecha_lanzamiento)}</td>
                    <td className="pwc">
                      {e.tiene_password ? (
                        <button
                          type="button"
                          className="pw-toggle"
                          title={destapada ? "Ocultar" : "Mostrar la contraseña"}
                          onClick={async () => {
                            if (destapada) { setClaves((c) => { const n = { ...c }; delete n[e.id]; return n; }); return; }
                            const r = await verPassword(e.id);
                            if (r.ok) setClaves((c) => ({ ...c, [e.id]: r.password }));
                            else setError(r.error);
                          }}
                        >
                          {destapada ? (claves[e.id] || "—") : "••••••••"}
                        </button>
                      ) : (
                        <span className="sin">sin contraseña</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${est === "visible" ? "green" : est === "programada" ? "" : "gris"}`}>
                        {etiquetaEstado(est)}
                      </span>
                    </td>
                    <td>
                      <div className="acc">
                        <button type="button" onClick={() => { setEditando(e); setAbierto(false); }}>
                          Editar
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", e.id);
                            fd.set("visible", e.visible ? "false" : "true");
                            lanzar(visibilidadEstrategia, fd);
                          }}
                        >
                          {e.visible ? "Quitar" : "Mostrar"}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (abiertoEnlace === e.persona_id) { setAbiertoEnlace(null); return; }
                            setAbiertoEnlace(e.persona_id);
                            if (!(e.persona_id in enlaces)) {
                              const r = await enlaceDeCliente(e.persona_id);
                              if (r.ok) setEnlaces((v) => ({ ...v, [e.persona_id]: r.enlace }));
                              else setError(r.error);
                            }
                          }}
                        >
                          Enlace
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* El panel del enlace va como fila propia bajo la del cliente
                  abierto: es información de la PERSONA, no de la estrategia. */}
              {filas.map((e) => (
                abiertoEnlace === e.persona_id && filas.findIndex((x) => x.persona_id === e.persona_id) === filas.indexOf(e) ? (
                  <tr key={`enlace-${e.persona_id}`} className="fila-enlace">
                    <td colSpan={6}>
                      <div className="enlace-panel">
                        <span className="k">Enlace de {e.persona?.nombre ?? "este cliente"}</span>
                        <code>{enlaces[e.persona_id] ?? (e.persona_id in enlaces ? "sin enlace todavía" : "cargando…")}</code>
                        <div className="enlace-acc">
                          {enlaces[e.persona_id] && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(enlaces[e.persona_id] as string);
                                setOk("Enlace copiado.");
                              }}
                            >
                              Copiar
                            </button>
                          )}
                          <button
                            type="button"
                            className="rotar"
                            disabled={pending}
                            onClick={() => {
                              if (!confirm(`¿Rotar el enlace de ${e.persona?.nombre ?? "este cliente"}?\n\nEl que ya tiene dejará de funcionar al instante y habrá que mandarle el nuevo.`)) return;
                              setError(null); setOk(null);
                              start(async () => {
                                const r = await rotarEnlace(e.persona_id);
                                if (r.ok) { setEnlaces((v) => ({ ...v, [e.persona_id]: r.enlace })); setOk(r.mensaje); }
                                else setError(r.error);
                              });
                            }}
                          >
                            {pending ? "Rotando…" : "Rotar"}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
