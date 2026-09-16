import Link from "next/link";
import { requireModulo } from "@/lib/guard";
import { getPagosAtribuidos, getTeamMembers, getAjustesDevolucion } from "@/lib/data";
import type { AjusteMes } from "@/lib/types";
import {
  comisionesDePago, agruparPorPersona, actividadPorRol, etiquetaRol, colorRol,
  type LineaComision, type Incidencia, type MotivoIncidencia, type RolComision,
} from "@/lib/comisiones";
import { moneyExacta, dateEs, monthLabel, colorPersona } from "@/lib/format";
import DesgloseComisiones from "@/components/DesgloseComisiones";
import type { FilaDesglose } from "@/lib/comisiones-vista";
import { IconoAlerta, IconoCheck } from "@/components/Iconos";

export const dynamic = "force-dynamic";

// Motivo de incidencia → explicación en lenguaje llano. Nunca se rellena con
// ceros: si un pago no se puede calcular, aquí se dice por qué, no se
// esconde detrás de un total limpio.
const TEXTO_INCIDENCIA: Record<MotivoIncidencia, string> = {
  sin_programa: "el pago no está atado a ninguna venta",
  sin_usd: "el pago no tiene registrado cuánto entró en dólares — y la comisión se calcula sobre eso",
  sin_atribuir: "la venta todavía está en la bandeja de atribución",
  fuente_sin_confirmar: "la fuente todavía no la ha confirmado Berni",
  ascension_sin_autor: "es una ascensión o renovación y no consta quién la hizo",
  sin_closer: "no consta quién cerró la venta",
  motivo_no_reconocido: "el tipo de venta no se reconoce — revísalo a mano",
};

// Banda histórica de comisiones/cash, tal y como la reportó Berni — mayo,
// junio y julio de 2026 no tienen atribución cargada en la base (el corte es
// el 1-ago, ver ATRIBUCION_CORTE en lib/comisiones.ts), así que no se pueden
// recalcular desde aquí: son la referencia fija contra la que se contrasta
// cada mes nuevo.
const BANDA_HISTORICA = [
  { mes: "mayo", pct: 13.2 },
  { mes: "junio", pct: 9.5 },
  { mes: "julio", pct: 11.2 },
];
const BANDA_MIN = Math.min(...BANDA_HISTORICA.map((b) => b.pct));
const BANDA_MAX = Math.max(...BANDA_HISTORICA.map((b) => b.pct));

function mesValido(m: string | undefined): string {
  const hoy = new Date().toISOString().slice(0, 7);
  return m && /^\d{4}-\d{2}$/.test(m) ? m : hoy;
}

export default async function ComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  // Mismo permiso que /nueva-venta y /atribucion: el informe se apoya en la
  // misma atribución, así que no hace falta un permiso nuevo que alguien
  // tenga que recordar conceder aparte.
  await requireModulo("ventas");
  const { mes } = await searchParams;
  const m = mesValido(mes);
  const [y, mo] = m.split("-").map(Number);
  const desde = `${m}-01`;
  // Primer día del mes siguiente (límite exclusivo): Date.UTC toma el mes
  // 0-indexado, así que pasarle `mo` (el mes humano, 1-indexado) da
  // directamente el mes de después.
  const hasta = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const mesAnterior = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  const mesSiguiente = hasta.slice(0, 7);

  const [pagos, equipo, ajustes] = await Promise.all([
    getPagosAtribuidos(desde, hasta),
    getTeamMembers(),
    getAjustesDevolucion(desde, hasta),
  ]);
  const nombre = new Map(equipo.map((t) => [t.id, t.nombre]));
  const pagoPorId = new Map(pagos.map((p) => [p.pago_id, p]));

  // Berni (dueño), Milo (admin) y Paula (cobra un fijo mensual, no un 5 %).
  // Sale de la base, no de una lista aquí: quién cobra es un dato del equipo,
  // no una constante del informe. Migración 0038.
  const quienCobra = {
    noCobran: new Set(equipo.filter((t) => !t.cobra_comision).map((t) => t.id)),
  };

  const lineas: LineaComision[] = [];
  const incidencias: Incidencia[] = [];
  for (const p of pagos) {
    const r = comisionesDePago(p, quienCobra);
    lineas.push(...r.lineas);
    incidencias.push(...r.incidencias);
  }

  const porPersona = agruparPorPersona(lineas);

  // Los ajustes NO entran en `agruparPorPersona`: se muestran aparte a
  // propósito. Un neto que ya viene restado esconde por qué bajó, y este
  // informe es justo el que alguien usa para preguntar "¿por qué cobro menos?".
  const ajustePorPersona = new Map<string, number>();
  const ajustesPorPersona = new Map<string, AjusteMes[]>();
  for (const a of ajustes) {
    ajustePorPersona.set(
      a.team_member_id,
      Math.round(((ajustePorPersona.get(a.team_member_id) ?? 0) + a.importe) * 100) / 100,
    );
    ajustesPorPersona.set(a.team_member_id, [
      ...(ajustesPorPersona.get(a.team_member_id) ?? []), a,
    ]);
  }
  const totalAjustes = ajustes.reduce((s2, a) => s2 + a.importe, 0);
  // Personas que solo tienen ajuste este mes (devolvieron algo que cobraron en
  // otro mes): sin esto no aparecerían en el informe y su descuento sería
  // invisible.
  const soloAjuste = [...ajustePorPersona.keys()].filter(
    (id) => !porPersona.some((t) => t.team_member_id === id),
  );
  const actividad = actividadPorRol(lineas);

  // Filas planas para <DesgloseComisiones> (client component): no se le
  // puede pasar un Map como prop, así que se resuelve acá el pago y el
  // nombre por línea.
  const filasDesglose: FilaDesglose[] = lineas.map((l, i) => {
    const p = pagoPorId.get(l.pago_id);
    return {
      clave: `${l.pago_id}-${l.rol}-${i}`,
      fecha: p?.fecha ?? null,
      cliente: p?.persona_nombre ?? "—",
      fuente: p?.fuente ?? null,
      rol: l.rol,
      rolEtiqueta: etiquetaRol(l.rol),
      team_member_id: l.team_member_id,
      quien: nombre.get(l.team_member_id) ?? "—",
      base: l.base,
      tasa: l.tasa,
      importe: l.importe,
    };
  });
  const colorRolDe: Record<RolComision, string> = {
    setter: colorRol("setter"), closer: colorRol("closer"), coach: colorRol("coach"),
  };

  // Cash del mes = TODO lo cobrado, no solo lo que se pudo calcular: es el
  // denominador del contraste de sanidad, y tiene que ser el cash real.
  //
  // En DÓLARES desde 0040, igual que la base de las comisiones. El ratio
  // seguía siendo consistente antes (€ sobre €), pero la banda histórica con
  // la que se contrasta se calculó en dólares — julio: 6.802,42 USD de
  // comisión sobre 60.508,80 USD de cash = 11,2 %, que es el valor de
  // BANDA_HISTORICA. Ahora las tres cifras hablan la misma divisa.
  const cash = pagos.reduce((s, p) => s + (p.usd_recibido ?? 0), 0);
  const sinUsd = pagos.filter((p) => p.usd_recibido == null).length;
  // Sobre el NETO: un mes con devoluciones parecería fuera de banda si se
  // midiera solo el devengado.
  const comisiones = lineas.reduce((s2, l) => s2 + l.importe, 0) + totalAjustes;
  const pct = cash > 0 ? (comisiones / cash) * 100 : null;
  const fueraDeBanda = pct !== null && (pct < BANDA_MIN || pct > BANDA_MAX);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Comisiones · {monthLabel(desde)}</h1>
        <div className="semana-nav">
          <Link className="btn" href={`/comisiones?mes=${mesAnterior}`} aria-label="Mes anterior">
            ‹
          </Link>
          <strong>{monthLabel(desde)}</strong>
          <Link className="btn" href={`/comisiones?mes=${mesSiguiente}`} aria-label="Mes siguiente">
            ›
          </Link>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Cash del mes</div>
          <div className="value gold">{moneyExacta(cash, "USD")}</div>
          <div className="sub">
            {pagos.length} pago{pagos.length === 1 ? "" : "s"}
            {/* Sin esto el denominador del % saldría más bajo que el real y
                el ratio comisiones/cash parecería más alto de lo que es. */}
            {sinUsd > 0 && (
              <span className="neg"> · <IconoAlerta /> {sinUsd} sin USD: el total está incompleto</span>
            )}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Comisiones a pagar</div>
          <div className="value">{moneyExacta(comisiones, "USD")}</div>
          <div className="sub">
            {lineas.length} línea{lineas.length === 1 ? "" : "s"} calculada{lineas.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Comisiones / cash</div>
          <div className={`value ${pct === null ? "" : fueraDeBanda ? "neg" : "pos"}`}>
            {pct === null ? "—" : `${pct.toFixed(1)} %`}
          </div>
          <div className="sub">
            banda histórica {BANDA_MIN.toFixed(1)}–{BANDA_MAX.toFixed(1)} % (
            {BANDA_HISTORICA.map((b) => `${b.mes} ${b.pct}%`).join(" · ")})
            {fueraDeBanda &&
              (incidencias.length > 0
                ? " — fuera de banda, pero hay incidencias sin calcular: no es comparable todavía"
                : " — fuera de la banda histórica, revísalo")}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Incidencias</div>
          <div className={`value ${incidencias.length === 0 ? "pos" : "gold"}`}>{incidencias.length}</div>
          <div className="sub">{incidencias.length === 0 ? "todo se pudo calcular" : "sin calcular, ver abajo"}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Total por persona</h2>
          <span className="hint">lo que hay que pagar</span>
        </div>
        <div className="card-body">
          {porPersona.length === 0 && ajustes.length === 0 ? (
            <div className="empty-box">Nada que pagar este mes con los datos disponibles.</div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th className="r">Líneas</th>
                  <th className="r">Devengado</th>
                  <th className="r">Devoluciones</th>
                  <th className="r">Neto a pagar</th>
                </tr>
              </thead>
              <tbody>
                {porPersona.map((t) => {
                  // Quien no cobra aparece igual, en 0. Es intencional: así se
                  // ve que participó en la venta y que su cero es una regla,
                  // no un cálculo que falló.
                  const noCobra = quienCobra.noCobran.has(t.team_member_id);
                  const aj = ajustePorPersona.get(t.team_member_id) ?? 0;
                  const neto = Math.round((t.total + aj) * 100) / 100;
                  return (
                    <tr key={t.team_member_id}>
                      <td>
                        <span className={`pill ${colorPersona(t.team_member_id)}`}>
                          {nombre.get(t.team_member_id) ?? t.team_member_id}
                        </span>
                        {noCobra && <span className="muted"> · no cobra comisión</span>}
                        {/* Cada ajuste con nombre y fechas: nadie tiene que
                            fiarse de un total que bajó, puede verlo. */}
                        {(ajustesPorPersona.get(t.team_member_id) ?? []).map((a, i) => (
                          <div key={i} className="hint">
                            ↩ {a.persona_nombre} · devuelto {dateEs(a.fecha_devolucion)}
                            {a.fecha_venta && ` · venta del ${dateEs(a.fecha_venta)}`}
                          </div>
                        ))}
                      </td>
                      <td className="r mono">{t.n}</td>
                      <td className="r mono">{moneyExacta(t.total, "USD")}</td>
                      <td className="r mono">
                        {aj === 0 ? "—" : <span className="neg">{moneyExacta(aj, "USD")}</span>}
                      </td>
                      <td className={`r mono ${noCobra ? "muted" : "gold"}`}>
                        {moneyExacta(neto, "USD")}
                      </td>
                    </tr>
                  );
                })}
                {/* Quien solo tiene ajuste: devolvió algo que cobró otro mes.
                    Sin esta fila su descuento no se vería en ningún sitio. */}
                {soloAjuste.map((id) => (
                  <tr key={id}>
                    <td>
                      {nombre.get(id) ?? id}
                      {(ajustesPorPersona.get(id) ?? []).map((a, i) => (
                        <div key={i} className="hint">
                          ↩ {a.persona_nombre} · devuelto {dateEs(a.fecha_devolucion)}
                          {a.fecha_venta && ` · venta del ${dateEs(a.fecha_venta)}`}
                        </div>
                      ))}
                    </td>
                    <td className="r mono">0</td>
                    <td className="r mono">{moneyExacta(0, "USD")}</td>
                    <td className="r mono">
                      <span className="neg">
                        {moneyExacta(ajustePorPersona.get(id) ?? 0, "USD")}
                      </span>
                    </td>
                    <td className="r mono gold">
                      {moneyExacta(ajustePorPersona.get(id) ?? 0, "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card bloque">
        <div className="card-head">
          <h2>Desglose</h2>
          <span className="hint">cada línea, para poder defenderla</span>
        </div>
        <div className="card-body">
          <DesgloseComisiones filas={filasDesglose} colorRolDe={colorRolDe} />
        </div>
      </div>

      <div className="card bloque">
        <div className="card-head">
          <h2>Actividad</h2>
          <span className="hint">qué se hizo, no solo cuánto cobra</span>
        </div>
        <div className="card-body">
          {actividad.length === 0 ? (
            <div className="empty-box">Sin actividad calculada este mes.</div>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Rol</th>
                  {/* Antes decía "Ventas" y "Ticket medio": pero cuentan PAGOS
                      (una venta a 3 cuotas cuenta 3 veces) y el importe medio
                      es por pago, no por venta. Ver `ActividadRol` en
                      lib/comisiones.ts — `ventas` ahí ya está comentado como
                      "pagos distintos en los que participó"; lo que estaba
                      mal era solo el rótulo visible aquí. */}
                  <th className="r">Pagos</th>
                  <th className="r">Cash</th>
                  <th className="r">Importe medio por pago</th>
                </tr>
              </thead>
              <tbody>
                {actividad.map((a, i) => {
                  const cColor = colorPersona(a.team_member_id);
                  const franja = cColor.startsWith("c-") ? `r-${cColor.slice(2)}` : "";
                  return (
                  <tr key={`${a.team_member_id}-${a.rol}-${i}`} className={franja}>
                    <td>
                      <span className={`pill ${cColor}`}>
                        {nombre.get(a.team_member_id) ?? "—"}
                      </span>
                    </td>
                    <td>
                      <span className={`pill ${colorRol(a.rol)}`}>{etiquetaRol(a.rol)}</span>
                    </td>
                    <td className="r mono">{a.ventas}</td>
                    <td className="r mono">{moneyExacta(a.cash, "USD")}</td>
                    <td className="r mono">{moneyExacta(a.ticket, "USD")}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="page-head bloque">
        <h2>No se pudo calcular{incidencias.length > 0 ? ` (${incidencias.length})` : ""}</h2>
        <p className="hint">
          Se muestran con su motivo, nunca con un cero: un total limpio que esconde agujeros es
          exactamente lo que este informe existe para evitar.
        </p>
      </div>
      {incidencias.length === 0 ? (
        <div className="card">
          <div className="empty-box"><IconoCheck /> Todo se pudo calcular este mes.</div>
        </div>
      ) : (
        <div className="atribucion-lista">
          {incidencias.map((inc, i) => {
            const p = pagoPorId.get(inc.pago_id);
            return (
              <div key={`${inc.pago_id}-${inc.motivo}-${i}`} className="card atribucion-fila">
                <div className="af-head">
                  <strong>{p?.persona_nombre ?? "—"}</strong>
                  {/* El dólar si lo hay; si no, el euro — que es justo el
                      caso `sin_usd`, donde enseñar "0,00 US$" escondería el
                      único dato que sí existe del pago. */}
                  <span className="mono muted">
                    {p ? dateEs(p.fecha) : "—"} ·{" "}
                    {!p
                      ? "—"
                      : p.usd_recibido != null
                        ? moneyExacta(p.usd_recibido, "USD")
                        : `${moneyExacta(p.monto)} (sin USD)`}
                  </span>
                </div>
                <p className="hint">{TEXTO_INCIDENCIA[inc.motivo]}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
