"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import PanelLateral from "@/components/PanelLateral";
import { Compras, Sesiones, Contratos, scrollSuaveHasta } from "@/components/FichaBloques";
import { money, dateEs, shortTime } from "@/lib/format";
import {
  resumenDinero, agruparCompras, avisosDe,
  type ProgramaFicha, type PagoFicha, type CuotaFicha, type SesionFicha, type Cupo,
} from "@/lib/ficha-cliente";
import type { MessageRow } from "@/lib/types";
import type { ContratoDeCliente } from "@/lib/data";
import type { LlamadaFathom } from "@/lib/fathom-datos";
import LlamadasDeCliente from "@/components/LlamadasDeCliente";

type Estrategia = {
  id: string; titulo: string; url: string;
  fecha_lanzamiento: string | null; visible: boolean;
};

type EventoActividad = { ref_id: string; dia: string; titulo: string; detalle: string | null };

/**
 * La ficha del cliente.
 *
 * Sustituye a la lista cronológica única que había, donde compras, pagos,
 * sesiones y plantillas automáticas iban revueltas: en el cliente con más
 * historia del negocio, 10 de sus 18 eventos son "Plantilla enviada" y
 * entierran la compra y las tres sesiones.
 *
 * Estructura, de arriba abajo: quién es y qué se puede hacer con él, cuánto
 * dinero hay de por medio, qué hay que hacer hoy, y luego el detalle plegado.
 * WhatsApp y Actividad viven en paneles laterales porque acompañan al trabajo
 * en vez de interrumpirlo.
 */
export default function FichaPanel({
  ficha,
  datos,
  conversacionId,
  actividad,
  cupo,
  hoy,
  puede,
  contratos,
  llamadas,
  resaltarPago,
  saltarA,
}: {
  ficha: {
    id: string; nombre: string | null; estadoEtiqueta: string; estado: string;
    telefono_e164: string | null; pais: string | null; coach: string | null;
  };
  datos: {
    programas: ProgramaFicha[]; pagos: PagoFicha[]; cuotas: CuotaFicha[];
    sesiones: SesionFicha[]; estrategias: Estrategia[]; mesesTier: number | null;
  };
  conversacionId: string | null;
  actividad: EventoActividad[];
  /** Calculado por la base (v_consultorias_cliente), que ya aplica los bonos
      que amplían el cupo. No se deriva aquí: el catálogo de tiers ya demostró
      poder ir desfasado, y esa vista es la que usa el módulo de sesiones. */
  cupo: Cupo;
  hoy: string;
  puede: { importes: boolean; cuotas: boolean; sesiones: boolean; inbox: boolean; estrategias: boolean; contratos: boolean };
  contratos: ContratoDeCliente[];
  llamadas: LlamadaFathom[];
  /** id de un `pago` (no `cuota`) al que hay que llegar y resaltar dentro de
      Compras — viene de haber clickeado ese pago desde fuera de la ficha. */
  resaltarPago?: string;
  /** id de una sección de esta ficha (p.ej. "sesiones-detalle") a la que
      saltar al abrir — el botón "Sesiones hechas" de Clientes usa esto. */
  saltarA?: string;
}) {
  const [panel, setPanel] = useState<null | "chat" | "actividad">(null);

  useEffect(() => {
    if (!saltarA) return;
    let vivo = true;
    let raf = 0;
    const inicio = performance.now();
    // Misma espera por sondeo que Compras (components/FichaBloques.tsx): la
    // sección puede tardar un render en existir, sin depender de contar frames.
    function esperar() {
      if (!vivo) return;
      const el = document.getElementById(saltarA as string);
      if (!el) {
        if (performance.now() - inicio > 1000) return;
        raf = requestAnimationFrame(esperar);
        return;
      }
      setTimeout(() => { if (vivo) scrollSuaveHasta(el, 900); }, 400);
    }
    raf = requestAnimationFrame(esperar);
    return () => { vivo = false; cancelAnimationFrame(raf); };
  }, [saltarA]);

  const dinero = resumenDinero(datos.pagos, datos.cuotas);
  const bloques = agruparCompras(datos.programas, datos.pagos, datos.cuotas, hoy);
  const vigente = datos.programas.find((p) => p.fecha_inicio <= hoy) ?? datos.programas[0] ?? null;
  const avisos = avisosDe(
    {
      cuotas: datos.cuotas, sesiones: datos.sesiones, cupo,
      programa: vigente ? { ...vigente, meses_duracion: vigente.meses_duracion ?? datos.mesesTier } : null,
      estrategias: datos.estrategias.length,
      telefono: ficha.telefono_e164,
    },
    hoy,
  );

  const nombre = ficha.nombre ?? "Sin nombre";

  return (
    <div className="page ficha">
      {/* 1 · Identidad. Sin cifras: las cifras van justo debajo y con su
             etiqueta, no mezcladas en la línea de datos personales. */}
      <div className="ficha-cabecera">
        <Link href="/clientes" className="muted">← Clientes</Link>
        <h1>{nombre}</h1>
        <p className="ficha-meta">
          <span className={`pill ${ficha.estado === "cliente" ? "green" : ""}`}>
            {ficha.estadoEtiqueta}
          </span>
          {vigente && <span className="pill gold">Tier {vigente.tier}</span>}
          {ficha.coach && <span>consultor {ficha.coach}</span>}
          {ficha.pais && <span>{ficha.pais}</span>}
          {ficha.telefono_e164
            ? <span className="mono">{ficha.telefono_e164}</span>
            : <span className="pill red">sin teléfono</span>}
        </p>

        <div className="ficha-acciones">
          {puede.inbox && conversacionId && (
            <button type="button" className="btn primary" onClick={() => setPanel("chat")}>
              Escribir por WhatsApp
            </button>
          )}
          {puede.cuotas && dinero.nCuotasPendientes > 0 && (
            <Link className="btn" href="/cuotas">Cobrar cuota</Link>
          )}
          {puede.sesiones && <Link className="btn" href="/sesiones">Registrar sesión</Link>}
          <button type="button" className="btn" onClick={() => setPanel("actividad")}>
            Actividad
            {actividad.length > 0 && <span className="btn-cuenta">{actividad.length}</span>}
          </button>
        </div>
      </div>

      {/* 2 · Dinero. Cuatro cifras y ni una más; "Total" ya no existe. */}
      {puede.importes && (
        <>
          <div className="ficha-dinero">
            <div className="d-item">
              <div className="d-label">Cobrado bruto</div>
              <div className="d-value gold mono">{money(dinero.cobradoBruto)}</div>
              <div className="d-sub">{dinero.nCobros} {dinero.nCobros === 1 ? "cobro" : "cobros"}</div>
            </div>
            <div className="d-item">
              <div className="d-label">Devuelto</div>
              <div className={`d-value mono ${dinero.devuelto > 0 ? "neg" : "muted"}`}>
                {dinero.devuelto > 0 ? `− ${money(dinero.devuelto)}` : money(0)}
              </div>
              <div className="d-sub">
                {dinero.nDevoluciones === 0
                  ? "ninguna devolución"
                  : `${dinero.nDevoluciones} ${dinero.nDevoluciones === 1 ? "devolución" : "devoluciones"}`}
              </div>
            </div>
            <div className="d-item">
              <div className="d-label">Neto</div>
              <div className="d-value mono">{money(dinero.neto)}</div>
              <div className="d-sub">lo que entró de verdad</div>
            </div>
            <div className="d-item">
              <div className="d-label">Pendiente</div>
              <div className={`d-value mono ${dinero.pendiente > 0 ? "warn" : "muted"}`}>
                {money(dinero.pendiente)}
              </div>
              <div className="d-sub">
                {dinero.nCuotasPendientes === 0
                  ? "sin cuotas por cobrar"
                  : `${dinero.nCuotasPendientes} ${dinero.nCuotasPendientes === 1 ? "cuota" : "cuotas"}`}
              </div>
            </div>
          </div>
          <p className="acotacion">
            Dinero que entró en la cuenta. No es lo firmado.
          </p>
        </>
      )}

      {/* 3 · Hoy. Si no hay nada, el bloque no se pinta — un "nada pendiente"
             en gris enseña al ojo a saltarse la zona. */}
      {avisos.length > 0 && (
        <section className="ficha-hoy">
          <h2>Lo que hay que hacer hoy</h2>
          <div className="avisos">
            {avisos.map((a) => (
              <div className="aviso" key={a.clave}>
                <span className={`aviso-marca ${a.tono}`} aria-hidden="true">
                  {a.tono === "atencion" ? "▲" : "◆"}
                </span>
                <span className="aviso-texto">{a.texto}</span>
                {a.href
                  ? <Link className="btn" href={a.href}>{a.accion}</Link>
                  : <span className="hint">{a.accion}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4 · Compras */}
      {puede.importes && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Compras</h2>
              <span className="hint">
                {bloques.length === 0
                  ? "ninguna"
                  : `${bloques.length} ${bloques.length === 1 ? "programa" : "programas"}`}
              </span>
            </div>
          </div>
          <Compras bloques={bloques} resaltar={resaltarPago ? `pago-${resaltarPago}` : undefined} />
        </div>
      )}

      {/* 5 · Sesiones */}
      {puede.sesiones && (
        <div className="card" id="sesiones-detalle">
          <div className="card-head">
            <div>
              <h2>Sesiones</h2>
              <span className="hint">
                {cupo.incluidas == null
                  ? `${cupo.hechas} hechas`
                  : `${cupo.hechas} de ${cupo.incluidas} usadas`}
              </span>
            </div>
          </div>
          <Sesiones sesiones={datos.sesiones} cupo={cupo} />
        </div>
      )}

      {/* 6 · Estrategias */}
      {puede.estrategias && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Estrategias</h2>
              <span className="hint">
                {datos.estrategias.length === 0
                  ? "ninguna publicada"
                  : `${datos.estrategias.length} publicadas`}
              </span>
            </div>
            <Link className="hint gold" href="/estrategias">Gestionar →</Link>
          </div>
          {datos.estrategias.length === 0 ? (
            <div className="card-body-pad">
              <p className="hint" style={{ marginBottom: 12 }}>
                El cliente entra por su propio enlace y las ve todas. Sin ninguna
                publicada, ese enlace le abre una página vacía.
              </p>
              <Link className="btn primary" href="/estrategias">Publicar una estrategia</Link>
            </div>
          ) : (
            <div className="tabla-scroll">
              <table className="t">
                <thead>
                  <tr><th>Título</th><th>Publicada</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {datos.estrategias.map((e) => (
                    <tr key={e.id}>
                      <td className="nom">{e.titulo}</td>
                      <td className="mono">{dateEs(e.fecha_lanzamiento)}</td>
                      <td>
                        {e.visible
                          ? <span className="pill green">visible</span>
                          : <span className="pill">oculta</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 7 · Contratos */}
      {puede.contratos && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Contratos</h2>
              <span className="hint">
                {contratos.length === 0 ? "ninguno" : `${contratos.length} ${contratos.length === 1 ? "contrato" : "contratos"}`}
              </span>
            </div>
          </div>
          <Contratos contratos={contratos} />
        </div>
      )}

      {/* 8 · Llamadas grabadas (Fathom)
          Va DESPUÉS de Contratos y dentro del mismo permiso que Sesiones: son
          las consultorías y las llamadas de venta de este cliente, con su
          resumen. Berni las pidió "asociadas a cada uno de los clientes", y
          este es el sitio donde alguien las busca. */}
      {puede.sesiones && llamadas.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Llamadas grabadas</h2>
              <span className="hint">
                {llamadas.length === 1 ? "1 llamada" : `${llamadas.length} llamadas`}
              </span>
            </div>
          </div>
          <LlamadasDeCliente llamadas={llamadas} />
        </div>
      )}

      <footer className="ficha-traza">
        {vigente && <span>Cliente desde {dateEs(datos.programas.at(-1)?.fecha_inicio ?? null)}</span>}
        <span className="mono">id {ficha.id.slice(0, 8)}</span>
      </footer>

      {panel === "chat" && conversacionId && (
        <PanelChat
          convId={conversacionId}
          nombre={nombre}
          telefono={ficha.telefono_e164}
          onCerrar={() => setPanel(null)}
        />
      )}

      {panel === "actividad" && (
        <PanelLateral
          titulo="Actividad"
          subtitulo="plantillas automáticas y cambios de ficha"
          onCerrar={() => setPanel(null)}
        >
          {actividad.length === 0 ? (
            <div className="empty-box">Sin actividad registrada.</div>
          ) : (
            <ul className="act-lista">
              {actividad.map((e) => (
                <li className="act-item" key={e.ref_id}>
                  <span className="act-marca" aria-hidden="true">◇</span>
                  <div className="act-cuerpo">
                    <div className="act-titulo">{e.titulo}</div>
                    {e.detalle && <div className="act-detalle">{e.detalle}</div>}
                  </div>
                  <span className="act-fecha mono">{dateEs(e.dia)}</span>
                </li>
              ))}
            </ul>
          )}
        </PanelLateral>
      )}
    </div>
  );
}

/**
 * El hilo de WhatsApp, en el panel.
 *
 * Los mensajes se piden al abrir y no con la página: son hasta 500 filas que
 * la mayoría de las visitas a una ficha no llegan a mirar, y cargarlos siempre
 * pagaría esa cuenta en cada apertura.
 */
function PanelChat({
  convId, nombre, telefono, onCerrar,
}: {
  convId: string; nombre: string; telefono: string | null; onCerrar: () => void;
}) {
  const [mensajes, setMensajes] = useState<MessageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/inbox/messages?convId=${convId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivo) setMensajes(d.messages ?? []); })
      .catch(() => { if (vivo) setError("No hemos podido cargar la conversación."); });
    return () => { vivo = false; };
  }, [convId]);

  return (
    <PanelLateral
      titulo="WhatsApp"
      subtitulo={telefono ? <span className="mono">{telefono}</span> : nombre}
      onCerrar={onCerrar}
      pie={
        // Escribir se hace en el inbox, que es donde vive el compositor con
        // el manejo de la ventana de 24 h y las plantillas. Duplicarlo aquí
        // sería duplicar la regla que decide si se puede escribir o no — y esa
        // regla es la que evita que un mensaje se pierda sin decirlo.
        <Link className="btn primary panel-btn-ancho" href={`/inbox/c/${convId}`}>
          Abrir en el inbox para responder
        </Link>
      }
    >
      {error && <p className="cuota-error" style={{ padding: "14px 16px" }}>{error}</p>}
      {!error && mensajes === null && (
        <div className="chat-hilo">
          <div className="sk sk-linea" style={{ width: "62%", height: 34 }} />
          <div className="sk sk-linea" style={{ width: "48%", height: 34, marginLeft: "auto" }} />
          <div className="sk sk-linea" style={{ width: "70%", height: 34 }} />
        </div>
      )}
      {mensajes !== null && mensajes.length === 0 && (
        <div className="empty-box">Todavía no hay mensajes con este cliente.</div>
      )}
      {mensajes !== null && mensajes.length > 0 && (
        <div className="chat-hilo">
          {mensajes.slice(-60).map((m) => (
            <div className={`chat-msg ${m.direction === "out" ? "out" : "in"}`} key={m.id}>
              {m.body ? m.body : <span className="muted">[{m.tipo ?? "adjunto"}]</span>}
              <span className="chat-hora">{shortTime(m.sent_at)}</span>
            </div>
          ))}
        </div>
      )}
    </PanelLateral>
  );
}
