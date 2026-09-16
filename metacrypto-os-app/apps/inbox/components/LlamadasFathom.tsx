"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import ResumenFathom from "@/components/ResumenFathom";
import { IconoAlerta, IconoCheck } from "@/components/Iconos";
import { dateEs } from "@/lib/format";
import {
  emparejarLlamada, descartarLlamada, crearSesionDesdeLlamada, sincronizarFathom,
} from "@/app/actions";
import type { LlamadaFathom } from "@/lib/fathom-datos";

/**
 * La bandeja de llamadas de Fathom.
 *
 * Berni pidió que las sesiones se registren solas y que el consultor solo
 * tenga que "revisar, añadir la landing y validar". Esta pantalla es ese
 * revisar: la ingesta ya trajo la llamada, la emparejó y le puso el resumen;
 * aquí una persona confirma, corrige o descarta.
 *
 * Lo que NO hace: convertir sola. Crear una sesión mueve el cupo de
 * consultorías del cliente y la comisión del consultor, así que hay un botón
 * y no un cron. El porqué largo está en la migración 0062.
 */
export default function LlamadasFathom({
  llamadas, clientes,
}: {
  llamadas: LlamadaFathom[];
  clientes: { id: string; nombre: string | null }[];
}) {
  const [filtro, setFiltro] = useState<"todas" | "servicio" | "venta" | "sin-cliente">("todas");
  const [abierta, setAbierta] = useState<LlamadaFathom | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pending, start] = useTransition();

  const visibles = llamadas.filter((l) => {
    if (l.descartada_at) return false;
    if (filtro === "sin-cliente") return !l.persona_id;
    if (filtro === "todas") return true;
    return l.tipo === filtro;
  });

  const cuenta = (f: typeof filtro) =>
    llamadas.filter((l) => {
      if (l.descartada_at) return false;
      if (f === "sin-cliente") return !l.persona_id;
      if (f === "todas") return true;
      return l.tipo === f;
    }).length;

  function accion(fn: () => Promise<{ ok: boolean; error?: string; mensaje?: string }>) {
    setAviso(null);
    start(async () => {
      const r = await fn();
      setAviso({ ok: r.ok, texto: r.ok ? (r.mensaje ?? "Hecho.") : (r.error ?? "No se pudo.") });
      if (r.ok) setAbierta(null);
    });
  }

  return (
    <>
      <div className="fa-barra">
        <div className="tabs">
          {([
            ["todas", "Todas"], ["servicio", "Consultorías"],
            ["venta", "Llamadas de venta"], ["sin-cliente", "Sin cliente"],
          ] as const).map(([k, t]) => (
            <button
              key={k} type="button"
              className={`tab${filtro === k ? " on" : ""}`}
              aria-pressed={filtro === k}
              onClick={() => setFiltro(k)}
            >
              {t} <span className="tab-n">{cuenta(k)}</span>
            </button>
          ))}
        </div>
        <button
          type="button" className="btn" disabled={pending}
          onClick={() => accion(() => sincronizarFathom())}
        >
          {pending ? "Trayendo…" : "Traer de Fathom"}
        </button>
      </div>

      {aviso && (
        <p className={aviso.ok ? "ok-linea" : "error"}>
          {aviso.ok ? <IconoCheck /> : <IconoAlerta />} {aviso.texto}
        </p>
      )}

      {visibles.length === 0 ? (
        <p className="hint" style={{ padding: "24px 0" }}>
          No hay llamadas aquí. Las weeklies y los debriefs internos no salen a propósito: solo
          aparecen las llamadas que tuvieron a alguien de fuera.
        </p>
      ) : (
        <div className="tabla-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Fecha</th><th>Llamada</th><th>Cliente</th><th>Quién</th>
                <th className="r">Min</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{dateEs(l.inicio)}</td>
                  <td>
                    <span className={`badge ${l.tipo === "venta" ? "tipo-ampliacion" : "tipo-nueva"}`}>
                      {l.tipo === "venta" ? "Venta" : "Consultoría"}
                    </span>{" "}
                    {l.titulo ?? "—"}
                  </td>
                  <td>
                    {l.persona_id ? (
                      <>
                        <Link href={`/clientes/${l.persona_id}`} className="linkbtn">
                          {l.personas?.nombre ?? "cliente"}
                        </Link>
                        {/* Un emparejamiento por TÍTULO es una sugerencia, no un
                            hecho, y tiene que verse distinto: es el único que
                            puede estar equivocado sin que nada falle. */}
                        {l.emparejado_por === "titulo" && (
                          <span className="fa-duda" title="Emparejado por el título de la llamada, no por el correo. Conviene confirmarlo.">
                            por título
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="hint">sin emparejar</span>
                    )}
                  </td>
                  <td>{l.grabado_por_nombre ?? "—"}</td>
                  <td className="r mono">{l.duracion_min ?? "—"}</td>
                  <td>
                    {l.sesion_id ? (
                      <span className="pill green">Ya es sesión</span>
                    ) : l.tipo === "venta" ? (
                      <span className="hint">—</span>
                    ) : (
                      <span className="pill orange">Por registrar</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="linkbtn" onClick={() => { setAviso(null); setAbierta(l); }}>
                      Ver resumen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierta && (
        <Modal titulo={abierta.titulo ?? "Llamada"} onCerrar={() => setAbierta(null)}>
          <p className="hint">
            {dateEs(abierta.inicio)} · {abierta.grabado_por_nombre ?? "?"}
            {abierta.duracion_min ? ` · ${abierta.duracion_min} min` : ""}
          </p>

          <div className="fa-acciones">
            <label className="fa-campo">
              <span>Cliente</span>
              <select
                className="sel" defaultValue={abierta.persona_id ?? ""} disabled={pending}
                onChange={(ev) => {
                  const fd = new FormData();
                  fd.set("llamada_id", abierta.id);
                  fd.set("persona_id", ev.target.value);
                  accion(() => emparejarLlamada(fd));
                }}
              >
                <option value="">— sin emparejar —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre ?? c.id}</option>
                ))}
              </select>
            </label>

            {abierta.share_url && (
              <a href={abierta.share_url} target="_blank" rel="noopener noreferrer" className="btn">
                Abrir en Fathom
              </a>
            )}
          </div>

          {/* Solo para consultorías: una llamada de venta no es una sesión del
              servicio y crearla inflaría el cupo del cliente. */}
          {abierta.tipo === "servicio" && !abierta.sesion_id && (
            <div className="fa-convertir">
              <p className="note">
                Crea la sesión con la fecha, la duración, el consultor y el resumen de esta llamada.
                La <strong>landing</strong> y el <strong>capital</strong> se quedan vacíos a propósito: son
                lo que añade el consultor al revisar.
              </p>
              <button
                type="button" className="btn primary" disabled={pending || !abierta.persona_id}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("llamada_id", abierta.id);
                  accion(() => crearSesionDesdeLlamada(fd));
                }}
              >
                {pending ? "Creando…" : "Registrar como sesión"}
              </button>
              {!abierta.persona_id && (
                <p className="hint">Primero hay que decir de qué cliente es.</p>
              )}
            </div>
          )}

          <ResumenFathom md={abierta.resumen_md} />

          <div className="modal-actions">
            <button
              type="button" className="btn" disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("llamada_id", abierta.id);
                accion(() => descartarLlamada(fd));
              }}
            >
              Quitar de la bandeja
            </button>
            <button type="button" className="btn" onClick={() => setAbierta(null)}>Cerrar</button>
          </div>
        </Modal>
      )}
    </>
  );
}
