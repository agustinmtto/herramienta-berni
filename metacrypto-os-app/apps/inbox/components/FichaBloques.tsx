"use client";
import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { money, dateEs, colorSesion } from "@/lib/format";
import type { BloquePrograma, SesionFicha, Cupo } from "@/lib/ficha-cliente";
import type { ContratoDeCliente } from "@/lib/data";
import ContratoPreview from "@/components/ContratoPreview";
import { cintaDeFila } from "@/lib/contrato-datos";
import { estadoContrato, CLASE_PILL } from "@/lib/contrato-estado";
import CintaContrato from "@/components/CintaContrato";

/**
 * Una fila plegable.
 *
 * La cabecera dice lo suficiente CERRADA para decidir si hace falta abrirla —
 * "Tier 5000 · vigente · 5.000 € · 27 jun 26"—, que es lo que separa una lista
 * plegable útil de una que obliga a abrirlo todo para encontrar algo.
 *
 * Es un <button> con aria-expanded y no un <details>: el <details> nativo no
 * deja poner la marca de estado ni el resumen a la derecha sin pelearse con el
 * marcador del navegador, y aquí la cabecera lleva cuatro datos.
 */
export function Plegable({
  titulo,
  sellos,
  resumen,
  abiertoPorDefecto = false,
  forzarAbierto = false,
  children,
}: {
  titulo: string;
  sellos?: ReactNode;
  resumen?: ReactNode;
  abiertoPorDefecto?: boolean;
  /** Se abre cuando esto pasa a true (p.ej. trae dentro la línea que hay que
      resaltar) — no la vuelve a cerrar sola, sigue siendo un toggle normal. */
  forzarAbierto?: boolean;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(abiertoPorDefecto);
  useEffect(() => { if (forzarAbierto) setAbierto(true); }, [forzarAbierto]);
  return (
    <div className="tog">
      <button
        type="button"
        className="tog-head"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <span className="tog-flecha" aria-hidden="true">▶</span>
        <span className="tog-titulo">{titulo}</span>
        {sellos}
        {resumen && <span className="tog-resumen">{resumen}</span>}
      </button>
      {abierto && <div className="tog-cuerpo">{children}</div>}
    </div>
  );
}

/**
 * Centra `el` en su contenedor con scroll (el panel lateral), animando
 * `scrollTop` a mano — el `scrollIntoView({behavior:"smooth"})` nativo no
 * deja elegir la duración, y salía demasiado brusco.
 */
export function scrollSuaveHasta(el: HTMLElement, duracionMs: number): Promise<void> {
  const contenedor = (el.closest(".panel-cuerpo") as HTMLElement | null) ?? document.documentElement;
  const rectEl = el.getBoundingClientRect();
  const rectCont = contenedor.getBoundingClientRect();
  const desde = contenedor.scrollTop;
  const destino = desde + (rectEl.top - rectCont.top) - rectCont.height / 2 + rectEl.height / 2;
  const distancia = destino - desde;
  if (Math.abs(distancia) < 2) return Promise.resolve();
  return new Promise((resolve) => {
    const inicio = performance.now();
    function paso(ahora: number) {
      const t = Math.min(1, (ahora - inicio) / duracionMs);
      // ease-in-out-quad: arranca y termina despacio, en el medio acelera.
      const s = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      contenedor.scrollTop = desde + distancia * s;
      if (t < 1) requestAnimationFrame(paso);
      else resolve();
    }
    requestAnimationFrame(paso);
  });
}

const SELLO: Record<string, string> = {
  cobrado: "green", cobrada: "green", pendiente: "orange",
  anulada: "", devuelto: "red",
};

const ETIQUETA: Record<string, string> = {
  cobrado: "cobrado", cobrada: "cobrada", pendiente: "por cobrar",
  anulada: "anulada", devuelto: "devuelto",
};

/** Las compras: una fila plegable por programa, con sus cobros y sus cuotas. */
export function Compras({
  bloques,
  onCobrar,
  resaltar,
}: {
  bloques: BloquePrograma[];
  onCobrar?: () => void;
  /** `clave` de una línea (p.ej. "pago-<id>") a la que hay que llegar y
      resaltar al abrir — viene de haber clickeado ese pago desde afuera. */
  resaltar?: string;
}) {
  useEffect(() => {
    if (!resaltar) return;
    let vivo = true;
    let raf = 0;
    let idPausa: ReturnType<typeof setTimeout> | null = null;
    const inicio = performance.now();
    // La fila puede no existir todavía en el primer render: si su programa no
    // es el vigente, el Plegable la abre recién en un segundo render (el que
    // dispara forzarAbierto). En vez de adivinar cuántos frames hacen falta,
    // se sondea hasta que la fila esté — sea cual sea el programa.
    function esperarFila() {
      if (!vivo) return;
      const fila = document.getElementById(resaltar as string);
      if (!fila) {
        if (performance.now() - inicio > 1000) return; // no está: se abandona
        raf = requestAnimationFrame(esperarFila);
        return;
      }
      // Pausa antes de moverse: primero se ve el panel recién abierto,
      // después baja — no las dos cosas encima.
      idPausa = setTimeout(async () => {
        if (!vivo) return;
        await scrollSuaveHasta(fila, 900);
        if (!vivo) return;
        // El glow va en la card de Compras entera, no en la fila: dentro de
        // <table class="t"> (border-collapse:collapse) un box-shadow en un
        // <td> se pinta roto — solo el borde superior y algún borde vertical
        // suelto, medido el 8-sep. La card sí es una caja normal.
        const caja = (fila.closest(".card") as HTMLElement | null) ?? fila;
        caja.classList.add("linea-resaltada");
        const quitar = () => caja.classList.remove("linea-resaltada");
        caja.addEventListener("animationend", quitar, { once: true });
      }, 400);
    }
    raf = requestAnimationFrame(esperarFila);
    return () => { vivo = false; cancelAnimationFrame(raf); if (idPausa) clearTimeout(idPausa); };
  }, [resaltar]);

  if (bloques.length === 0) {
    return (
      <div className="empty-box">
        Este cliente no tiene ninguna compra registrada todavía.
      </div>
    );
  }

  return (
    <>
      {bloques.map((b) => (
        <Plegable
          key={b.programa.id}
          titulo={`Tier ${b.programa.tier}`}
          abiertoPorDefecto={b.vigente}
          forzarAbierto={!!resaltar && b.lineas.some((l) => l.clave === resaltar)}
          sellos={
            <>
              {b.vigente
                ? <span className="pill green">vigente</span>
                : <span className="pill">anterior</span>}
              {b.programa.meses_duracion && (
                <span className="pill">{b.programa.meses_duracion} meses</span>
              )}
            </>
          }
          resumen={
            <>
              <span className="mono">{money(b.total)}</span>
              <span className="hint">{dateEs(b.programa.fecha_inicio)}</span>
            </>
          }
        >
          {b.ascendioDe && (
            <p className="ascendio">
              Ascendió desde <strong>Tier {b.ascendioDe}</strong>
            </p>
          )}
          <div className="tabla-scroll">
            <table className="t tabla-compacta">
              <thead>
                <tr>
                  <th>Concepto</th><th>Fecha</th><th className="r">Importe</th><th>Estado</th>
                  {onCobrar && <th></th>}
                </tr>
              </thead>
              <tbody>
                {b.lineas.map((l) => (
                  <tr id={l.clave} key={l.clave} className={l.estado === "cobrada" ? "linea-cerrada" : undefined}>
                    <td className="concepto">
                      {/* La marca es el segundo portador del estado, además
                          del color del sello: el color no puede ser el único. */}
                      <span className="linea-marca" aria-hidden="true">
                        {l.estado === "pendiente" ? "○" : l.estado === "devuelto" ? "⊘" : "✓"}
                      </span>
                      {l.concepto}
                    </td>
                    <td className="mono">{dateEs(l.fecha)}</td>
                    <td className="r mono">
                      {money(l.eur)}
                      {l.usd != null && <><br /><span className="muted">{money(l.usd, "USD")}</span></>}
                    </td>
                    <td>
                      <span className={`pill ${SELLO[l.estado] ?? ""}`}>{ETIQUETA[l.estado]}</span>
                      {l.retraso != null && l.retraso > 0 && (
                        <span className="pill red"> {l.retraso} d</span>
                      )}
                    </td>
                    {onCobrar && (
                      <td className="r">
                        {l.estado === "pendiente" && (
                          <button type="button" className="linkbtn" onClick={onCobrar}>Cobrar</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Plegable>
      ))}
    </>
  );
}

const ASISTENCIA: Record<string, { clase: string; texto: string }> = {
  asistio: { clase: "green", texto: "asistió" },
  no_asistio: { clase: "red", texto: "no asistió" },
  reprogramada: { clase: "blue", texto: "reprogramada" },
};

/** Las sesiones: el cupo arriba y una fila plegable por sesión con sus notas. */
export function Sesiones({ sesiones, cupo }: { sesiones: SesionFicha[]; cupo: Cupo }) {
  const pct = cupo.incluidas ? Math.min((cupo.hechas / cupo.incluidas) * 100, 100) : 0;

  return (
    <>
      <div className="cupo">
        <span className="cupo-texto">
          {cupo.incluidas == null ? (
            <><strong>{cupo.hechas}</strong> {cupo.hechas === 1 ? "consultoría" : "consultorías"} hechas</>
          ) : (
            <><strong>{cupo.hechas} de {cupo.incluidas}</strong> consultorías</>
          )}
        </span>
        {cupo.incluidas != null && (
          <>
            <span
              className="cupo-barra"
              role="img"
              aria-label={`${cupo.hechas} de ${cupo.incluidas} consultorías usadas`}
            >
              <span className="cupo-hechas" style={{ width: `${pct}%` }} />
            </span>
            <span className="cupo-texto">
              {cupo.pendientes === 0
                ? "cupo agotado"
                : <>queda{cupo.pendientes === 1 ? "" : "n"} <strong>{cupo.pendientes}</strong></>}
            </span>
          </>
        )}
      </div>

      {sesiones.length === 0 ? (
        <div className="empty-box">Todavía no ha tenido ninguna sesión.</div>
      ) : (
        sesiones.map((s) => {
          const a = s.estado_asistencia ? ASISTENCIA[s.estado_asistencia] : null;
          return (
            <Plegable
              key={s.id}
              titulo={s.numero ? `Sesión ${s.numero}` : "Sesión"}
              sellos={
                <>
                  {s.numero && <span className={`pill ${colorSesion(s.numero)}`}>{s.numero}</span>}
                  {a
                    ? <span className={`pill ${a.clase}`}>{a.texto}</span>
                    : <span className="pill orange">sin registrar</span>}
                </>
              }
              resumen={
                <>
                  <span className="hint">
                    {s.coach ?? "sin consultor"}
                    {s.duracion_min ? ` · ${s.duracion_min} min` : ""}
                  </span>
                  <span className="mono">{dateEs(s.fecha)}</span>
                </>
              }
            >
              <div className="card-body-pad">
                {s.notas ? (
                  <>
                    <div className="d-label">Notas de la sesión</div>
                    <p className="sesion-notas">{s.notas}</p>
                  </>
                ) : (
                  <p className="hint">
                    Esta sesión no tiene notas. El consultor las escribe al registrarla.
                  </p>
                )}
                {/* `duracion_min` se teclea al registrar y hasta ahora no se
                    pintaba en ninguna pantalla: el 60 que escribe Manuel no
                    volvía a existir. */}
                {s.duracion_min != null && (
                  <p className="hint" style={{ marginTop: 10 }}>
                    Duró {s.duracion_min} minutos.
                  </p>
                )}
              </div>
            </Plegable>
          );
        })
      )}
    </>
  );
}

// Mismo wording que app/(os)/contratos/page.tsx — un solo nombre por
// estado/tipo de contrato en las dos pantallas.
const ETIQUETA_TIPO_CONTRATO: Record<string, string> = {
  venta_nueva: "Venta nueva",
  ampliacion: "Ampliación",
  // Igual que en la pestaña: para el equipo las dos son "una venta nueva".
  venta_nueva_v2: "Venta nueva",
};

// 🔴 El diccionario de estados que había aquí se fue a `estadoContrato()`
// (lib/contrato-estado.ts) el 16-sep. Decía tener el mismo wording que la
// pestaña y llevaba tiempo sin tenerlo: aquí 'pendiente' salía "Pendiente" y
// allí el mismo contrato salía "Error" en naranja. Y con el ciclo del cliente
// (0065) dejó de caber en un diccionario — hay que mirar `firmado_at`,
// `visto_at` y el `tipo`. Ahora las dos pantallas preguntan lo mismo y la
// respuesta tiene tests.

/** Los contratos generados de este cliente, más reciente primero (ya viene
    ordenado por la query). Sin Plegable: un contrato no anida cuotas. */
export function Contratos({ contratos }: { contratos: ContratoDeCliente[] }) {
  useEffect(() => {
    if (contratos.length === 0) return;
    const idMasReciente = `contrato-${contratos[0].id}`;
    let vivo = true;
    let raf = 0;
    let idPausa: ReturnType<typeof setTimeout> | null = null;
    const inicio = performance.now();
    function esperarFila() {
      if (!vivo) return;
      const fila = document.getElementById(idMasReciente);
      if (!fila) {
        if (performance.now() - inicio > 1000) return;
        raf = requestAnimationFrame(esperarFila);
        return;
      }
      idPausa = setTimeout(async () => {
        if (!vivo) return;
        await scrollSuaveHasta(fila, 900);
        if (!vivo) return;
        // Mismo criterio que en Compras: el glow va en la card entera, no en
        // el <tr> — dentro de una tabla con border-collapse se pinta roto.
        const caja = (fila.closest(".card") as HTMLElement | null) ?? fila;
        caja.classList.add("linea-resaltada");
        const quitar = () => caja.classList.remove("linea-resaltada");
        caja.addEventListener("animationend", quitar, { once: true });
      }, 400);
    }
    raf = requestAnimationFrame(esperarFila);
    return () => { vivo = false; cancelAnimationFrame(raf); if (idPausa) clearTimeout(idPausa); };
  }, [contratos]);

  if (contratos.length === 0) {
    // 🔴 "Aquí no aparece ninguno" y NO "este cliente no tiene ninguno". La
    // consulta pide columnas de la 0065 y, sin esa migración, PostgREST
    // contesta 400 a la petición entera, `rest()` no lanza y esto llega vacío
    // aunque el cliente tenga contratos (lo documenta getContratosDeCliente en
    // lib/data.ts). Afirmar que no los tiene invita a generarlos otra vez.
    return (
      <div className="empty-box">
        Aquí no aparece ningún contrato de este cliente. Si debería haber alguno, pregunta antes de
        volver a generarlo.
      </div>
    );
  }

  return (
    <div className="tabla-scroll">
      <table className="t">
        <thead>
          <tr>
            <th>Tipo</th><th>Programa</th><th>Fecha</th><th>Estado</th><th>Contrato</th>
          </tr>
        </thead>
        <tbody>
          {contratos.map((c) => {
            // La cinta importa MÁS aquí que en /contratos: ésta es la pantalla
            // donde alguien está justo cuando edita los bonos, o sea en el
            // instante en que un contrato se queda viejo. `fila-con-cinta`
            // reserva el hueco en la última celda (globals.css).
            // El cuarto argumento (`texto_editado_at`, 0065) es lo que
            // enciende la cinta "editado a mano". Sin él no se pintaba nunca.
            const cinta = cintaDeFila(c.pdf_path, c.recorregido_at, c.desactualizado_at, c.texto_editado_at);
            const estado = estadoContrato(c);
            // Hay un segundo PDF, el de la firma: desde que existe, es el que
            // vale y es el que abren los dos enlaces. Igual que en la pestaña.
            const firmado = !!c.pdf_firmado_path;
            return (
            <tr id={`contrato-${c.id}`} key={c.id} className={cinta ? "fila-con-cinta" : undefined}>
              <td>{c.tipo ? (ETIQUETA_TIPO_CONTRATO[c.tipo] ?? c.tipo) : "—"}</td>
              <td>{c.programas?.monto ? money(Number(c.programas.monto)) : "—"}</td>
              <td className="mono">{dateEs(c.fecha_firma ?? c.created_at)}</td>
              {/* Píldora y no texto suelto con un `style` naranja: el resto de
                  la ficha ya marca así los estados (las cuotas, las sesiones),
                  y el color vuelve a salir de la paleta en vez de escribirse
                  a mano en esta línea. */}
              <td>
                <span className={CLASE_PILL[estado.tono]} title={estado.detalle ?? undefined}>
                  {estado.etiqueta}
                </span>
                {/* Quién firmó, VISIBLE y no solo en el globo. En la pestaña
                    vive en el `title` porque la tabla tiene seis columnas y un
                    agrupado por cliente; aquí caben cuatro y sobra el alto de
                    una línea. Y un `title` no se ve en móvil ni lo anuncia un
                    lector de pantalla: el nombre de quien firma un contrato no
                    es un matiz, es el dato. La hora exacta sigue en el globo. */}
                {c.firmado_at && c.firma_nombre?.trim() ? (
                  <div className="hint">por {c.firma_nombre.trim()}</div>
                ) : null}
              </td>
              <td>
                {c.pdf_path ? (
                  <>
                    <ContratoPreview id={c.id} firmado={firmado} />
                    {" · "}
                    <Link href={`/api/contratos/${c.id}?descargar=1${firmado ? "&firmado=1" : ""}`}>
                      {firmado ? "Descargar firmado" : "Descargar"}
                    </Link>
                    {cinta ? <CintaContrato cinta={cinta} /> : null}
                  </>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
