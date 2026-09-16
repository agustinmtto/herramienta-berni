"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money, num } from "@/lib/format";
import {
  mesDe, etiquetaMes, rangoDePreset, serieCash, mesesConDatos, pacing,
  cubreMesEntero, rangoCerrado, fxPorMes, clasificaCuotas, concentracion,
  devoluciones, ventasReales, ticketMedio, mixTiers, ventasPorMes, porVencer, reparto, cobertura,
  cobradoPorMes, fechaCorta, esLegacy, type DatosInicio, type Preset, type Rango,
} from "@/lib/inicio";
import type { FilaReparto } from "@/lib/inicio";
import InicioCash from "@/components/InicioCash";
import InicioRitmo from "@/components/InicioRitmo";
import InicioVentas from "@/components/InicioVentas";

const PRESETS: { k: Preset; txt: string }[] = [
  { k: "mes", txt: "Este mes" }, { k: "3m", txt: "3 meses" }, { k: "6m", txt: "6 meses" },
  { k: "12m", txt: "12 meses" }, { k: "anio", txt: "Este año" }, { k: "todo", txt: "Todo" },
];

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d).replace(".", ",")} %`;

/**
 * La pantalla de Inicio. Filtra y compara en el navegador: el servidor manda
 * las filas una vez (unos 35 KB) y a partir de ahí mover un rango es
 * instantáneo, sin ida y vuelta.
 *
 * Regla que gobierna todo: los filtros de arriba mandan sobre TODO lo de
 * abajo. Si dos bloques de la misma pantalla cuentan cosas distintas, se
 * acabó la confianza en la pantalla. La única excepción, declarada en su
 * propia acotación, es la curva de ritmo: ahí Berni elige los dos meses.
 */
export default function InicioPanel({ datos, hoy }: { datos: DatosInicio; hoy: string }) {
  const minFecha = useMemo(
    () => datos.pagos.map((p) => p.fecha).sort()[0] ?? `${mesDe(hoy)}-01`,
    [datos.pagos, hoy],
  );
  const [preset, setPreset] = useState<Preset | null>("12m");
  const [rango, setRango] = useState<Rango>(() => rangoDePreset("12m", hoy, minFecha));

  const aplicaPreset = (k: Preset) => { setPreset(k); setRango(rangoDePreset(k, hoy, minFecha)); };
  const cambiaFecha = (campo: "desde" | "hasta", valor: string) => {
    if (!valor) return;
    const nuevo = { ...rango, [campo]: valor };
    if (nuevo.desde > nuevo.hasta) return;   // un rango invertido no se aplica
    setPreset(null); setRango(nuevo);
  };

  const v = useMemo(() => calcula(datos, rango, hoy), [datos, rango, hoy]);
  const meses = useMemo(() => mesesConDatos(datos.pagos), [datos.pagos]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inicio</h1>
        {/* Decía "datos reales de Supabase". Berni describe el OS como
            "entrar a Supabase": la palabra estaba literalmente escrita en la
            primera pantalla que abre. Lo que necesita saber de esa línea es
            qué periodo está mirando, no de qué base sale. */}
        <p>
          {fechaCorta(rango.desde)} — {fechaCorta(rango.hasta)}
        </p>
      </div>

      {/* Filtros: UNA fila, encima de todo lo que gobiernan. */}
      <div className="filtros" role="group" aria-label="Filtros de fecha">
        <div className="grupo">
          <span className="etq">Rango</span>
          {PRESETS.map((p) => (
            <button key={p.k} type="button" className="chip" aria-pressed={preset === p.k}
              onClick={() => aplicaPreset(p.k)}>
              {p.txt}
            </button>
          ))}
        </div>
        <div className="sep" aria-hidden="true" />
        <div className="grupo">
          <label className="etq" htmlFor="f-desde">Desde</label>
          <input type="date" id="f-desde" value={rango.desde}
            onChange={(e) => cambiaFecha("desde", e.target.value)} />
          <label className="etq" htmlFor="f-hasta" style={{ marginLeft: 6 }}>Hasta</label>
          <input type="date" id="f-hasta" value={rango.hasta}
            onChange={(e) => cambiaFecha("hasta", e.target.value)} />
        </div>
      </div>

      {/* El titular. LA cifra de --t6, una sola en la pantalla. */}
      <div className="titular">
        <div>
          <div className="label">
            Cash collected · {v.mesEntero ? etiquetaMes(mesDe(hoy), true) : "rango filtrado"}
          </div>
          <div className="cifra-hero">{money(v.heroVal, "USD")}</div>
          <div className="pie">
            {v.mesEntero
              ? `${v.nPagosMes} pagos · ${money(v.eurMes)} facturado`
              : `${v.pagos.length} pagos en el rango`}
          </div>
        </div>
        <div className="pacing">
          <div className="celda">
            <div className="k">Proyección a cierre de mes</div>
            <div className="v">{v.mesEntero ? money(v.pace.proyeccion, "USD") : "—"}</div>
            <div className="n">
              {v.mesEntero
                ? `a ritmo de ${money(v.pace.ritmoDiario, "USD")}/día · día ${v.pace.dia} de ${v.pace.diasMes}`
                : v.cerrado
                  ? "el rango termina antes del mes en curso"
                  : "el rango no cubre el mes en curso entero"}
            </div>
          </div>
          <div className="celda">
            <div className="k">Mismo día del mes pasado</div>
            <div className="v">{v.mesEntero ? money(v.pace.prevMismoDia, "USD") : "—"}</div>
            <div className="n">
              {v.mesEntero && v.pace.dif !== null ? (
                <span className={v.pace.dif >= 0 ? "pos" : "neg"}>
                  {v.pace.dif >= 0 ? "+" : ""}{pct(v.pace.dif)} · {etiquetaMes(v.pace.mesPrevio, true)} a día {v.pace.dia}
                </span>
              ) : v.mesEntero ? (
                <span className="muted">sin base de comparación</span>
              ) : ""}
            </div>
          </div>
        </div>
      </div>
      <p className="acotacion" style={{ margin: "0 0 22px 2px" }}>
        El pacing solo aparece cuando el rango cubre el mes en curso entero: media cifra de agosto
        contra un julio completo daría una caída que no ha ocurrido.
      </p>

      <div className="kpis">
        {/* Los cuatro paneles que pidió Berni en CAMBIOS OS (6-sep), con sus
            nombres y todos acotados al rango filtrado — antes dos de ellos
            enseñaban totales de siempre junto a dos que sí filtraban, y eso
            hacía que la fila entera se leyera mal. */}
        <Kpi l="Cuotas por cobrar" v={money(v.cuotasRango.futuras.usd, "USD")}
          s={`${v.cuotasRango.futuras.n} cuotas que vencen en el rango`}
          href="/cuotas" />
        {/* Sustituye a "Clientes activos", que Berni quitó de la fila. La cifra
            es el número de VENTAS del rango y el subtítulo las reparte por
            familia de programa — ver `familiaDeTier` en lib/inicio.ts. */}
        <Kpi l="Programas" v={num(v.nProgramas)}
          s={v.tiers.length === 0
            ? "sin ventas en el rango"
            : v.tiers.map((t) => `${t.n}×${t.tier}`).join(" · ")} />
        {/* Sin `href`: no hay ninguna pantalla que enseñe "las ventas que
            componen este ticket medio". Enlazar a un listado que no responde
            la pregunta enseña a no pulsar los otros tres. */}
        <Kpi l="Ticket medio" v={v.ticket.media == null ? "—" : money(v.ticket.media)}
          s={v.ticket.sinImporte > 0
            ? `${v.ventas.length} ventas · ${v.ticket.sinImporte} sin importe cargado`
            : `${v.ventas.length} ventas en el rango`} />
        <Kpi l="Cash collected" v={money(v.cashRango, "USD")}
          s={`${v.pagos.length} pagos · ${v.nMeses} ${v.nMeses === 1 ? "mes" : "meses"}`}
          href="/ingresos" />
      </div>

      <InicioCash barras={v.barras} />
      <div className="bloque">
        <InicioRitmo pagos={datos.pagos} meses={meses} hoy={hoy} />
      </div>

      {/* Berni pidió estos dos repartos DOS VECES en el mismo documento: "me
          hace falta todos los datos de Ventas por fuente" y "de Ventas por
          método de pago". No existían en ninguna pantalla.

          Y enseñan el hueco a propósito. Medido el 11-sep: el método de pago
          está al 98 %, pero solo el 44 % de las ventas desde agosto tiene
          fuente atribuida. Un gráfico que escondiera eso diría "Instagram es
          tu canal" cuando lo que los datos sostienen es "de la mitad no
          sabemos de dónde vienen" — que además es lo accionable. */}
      <div className="grid-2 bloque">
        <Reparto titulo="Ventas por fuente" filas={v.porFuente} nota="de dónde vino cada venta" />
        <Reparto titulo="Ventas por método de pago" filas={v.porMetodo} nota="con qué se pagó la venta" />
      </div>

      <div className="grid-2 bloque">
        <div className="card">
          <div className="card-head">
            <div><h2>De dónde viene el dinero</h2><span className="hint">por tier, en el rango filtrado</span></div>
          </div>
          <div className="card-body">
            {v.tiers.length === 0 ? (
              <div className="empty-box">Sin ventas en este rango.</div>
            ) : (
              v.tiers.map((t) => (
                <div className="bar-row" key={t.tier}>
                  <span className="lbl">{t.tier}</span>
                  <span className="track">
                    {/* Si el mayor vale 0 (todas las ventas del rango sin importe),
                        dividir daba NaN% y la barra conservaba el ancho anterior. */}
                    <span className="fill"
                      style={{ width: v.tiers[0].eur > 0 ? `${(t.eur / v.tiers[0].eur) * 100}%` : "0%" }} />
                  </span>
                  <span className="num mono">{t.eur > 0 ? money(t.eur) : <span className="muted">sin importe</span>}</span>
                  <span className="n2">{t.n}×</span>
                </div>
              ))
            )}
          </div>
        </div>
        <InicioVentas filas={v.porMes} />
      </div>

      <div className="card-head" style={{ border: 0, padding: "26px 2px 12px" }}>
        <div><h2>Inteligencia</h2><span className="hint">lo que los números están diciendo</span></div>
      </div>
      <div className="senales">
        {v.senales.map((s) => (
          <div className={`senal ${s.cl}`} key={s.t}>
            <div className="t"><span aria-hidden="true">{s.ic}</span><span>{s.t}</span></div>
            <div className="v">{s.v}</div>
            <div className="d">{s.d}</div>
            {/* El pie de acción: la señal dice "es dinero que hay que ir a
                buscar" y hasta hoy no decía por dónde. La pantalla que cobra
                existe, funciona y estaba a un clic — pero nadie las conectó.
                Solo lo llevan las señales con un destino honesto: un enlace
                que no lleva a donde promete es peor que ninguno. */}
            {s.href && s.cta && (
              <Link className="senal-cta" href={s.href}>
                {s.cta}<span aria-hidden="true"> →</span>
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="grid-2 bloque">
        <div className="card">
          <div className="card-head">
            <div><h2>Últimos ingresos</h2><span className="hint">{v.ventas.length} en el rango</span></div>
          </div>
          <div className="card-body flush tabla-scroll">
            <table className="t">
              <thead>
                <tr><th>Fecha</th><th>Cliente</th><th>Tier</th><th>Tipo</th><th className="r">Importe</th></tr>
              </thead>
              <tbody>
                {v.ultimasCompras.length === 0 && (
                  <tr><td colSpan={5} className="muted">Sin compras en este rango.</td></tr>
                )}
                {v.ultimasCompras.map((p, i) => (
                  <tr key={`${p.fecha}-${p.personaId ?? p.nombre}-${i}`}>
                    <td className="mono">{fechaCorta(p.fecha)}</td>
                    <td>
                      {p.personaId
                        ? <Link href={`/clientes/${p.personaId}`}>{p.nombre}</Link>
                        : p.nombre}
                    </td>
                    <td><span className="pill gold">{p.tier}</span></td>
                    <td><span className={p.motivo === "upsell" ? "pill purple" : "pill"}>
                      {p.motivo === "upsell" ? "upsell" : "nueva"}
                    </span></td>
                    <td className="r mono">{p.eur == null ? <span className="muted">sin importe</span> : money(p.eur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div><h2>Últimos clientes</h2><span className="hint">{v.activos} activos</span></div>
          </div>
          <div className="card-body flush tabla-scroll">
            <table className="t">
              <thead>
                <tr><th>Alta</th><th>Cliente</th><th>País</th><th className="r">Entró con</th></tr>
              </thead>
              <tbody>
                {v.ultimosClientes.map((c, i) => (
                  <tr key={c.id}>
                    <td className="mono">{fechaCorta(c.alta)}</td>
                    <td><Link href={`/clientes/${c.id}`}>{c.nombre}</Link></td>
                    <td>{c.pais || "—"}</td>
                    <td className="r"><span className={c.tier ? "pill gold" : "pill"}>{c.tier ?? "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Un KPI. Con `href` es un enlace a la pantalla donde se actúa sobre esa
 * cifra; sin él, un bloque de solo lectura como hasta ahora.
 *
 * En 853 líneas de pantalla de inicio había cero botones y dos enlaces, los
 * dos al nombre de un cliente. Se entra aquí a ver cómo va el negocio y no se
 * podía ir a ningún sitio desde ninguna cifra.
 *
 * El afordance no puede ser solo el cursor: la flecha del pie distingue a
 * simple vista cuáles llevan a algún sitio, sin que haya que pasar el ratón
 * por encima — que en un móvil no existe.
 */
function Kpi({ l, v, s, href }: { l: string; v: string; s: string; href?: string }) {
  const cuerpo = (
    <>
      <div className="label">{l}</div>
      <div className="value">{v}</div>
      <div className="sub">
        {s}
        {href && <span className="kpi-flecha" aria-hidden="true"> →</span>}
      </div>
    </>
  );

  if (!href) return <div className="kpi">{cuerpo}</div>;

  return <Link className="kpi kpi-link" href={href}>{cuerpo}</Link>;
}

/**
 * Un reparto con su barra, y con la cobertura dicha en voz alta.
 *
 * La fila de «sin atribuir» se pinta apagada y con su porqué: no es un canal
 * con el que competir, es lo que falta por rellenar. Y el subtítulo dice qué
 * parte del total sí tiene el dato, porque un gráfico construido sobre el 44 %
 * de las ventas no puede presentarse igual que uno construido sobre el 98 %.
 */
function Reparto({ titulo, filas, nota }: { titulo: string; filas: FilaReparto[]; nota: string }) {
  const cob = cobertura(filas);
  const mayor = Math.max(...filas.map((f) => f.eur), 0);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{titulo}</h2>
          <span className="hint">
            {cob.con + cob.sin === 0
              ? nota
              : `${nota} · ${cob.pct}% con el dato${cob.sin > 0 ? ` · faltan ${num(cob.sin)}` : ""}`}
          </span>
        </div>
      </div>
      <div className="card-body">
        {filas.length === 0 ? (
          <div className="empty-box">Sin ventas en este rango.</div>
        ) : (
          filas.map((f) => (
            <div className={`bar-row${f.sinDato ? " rep-hueco" : ""}`} key={f.clave}>
              <span className="lbl">{f.clave}</span>
              <span className="track">
                <span className="fill" style={{ width: mayor > 0 ? `${(f.eur / mayor) * 100}%` : "0%" }} />
              </span>
              <span className="num mono">{f.eur > 0 ? money(f.eur) : <span className="muted">sin importe</span>}</span>
              <span className="n2">{f.n}×</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Todo lo que la pantalla necesita, derivado del rango. Un solo sitio. */
function calcula(datos: DatosInicio, rango: Rango, hoy: string) {
  const mesHoy = mesDe(hoy);
  const pagos = datos.pagos.filter((p) => p.fecha >= rango.desde && p.fecha <= rango.hasta);
  const ventas = ventasReales(datos.programas, rango, hoy);
  const fx = fxPorMes(datos.pagos);
  const cuotas = clasificaCuotas(datos.cuotas, fx, hoy);
  // Berni pidió "CUOTAS POR COBRAR (este rango)": las que vencen DENTRO del
  // rango filtrado, no todas las futuras del mundo. Se calcula aparte y no se
  // toca `cuotas`, que sigue alimentando las señales de más abajo (las
  // vencidas no entienden de rangos: están vencidas y punto).
  const cuotasRango = clasificaCuotas(
    datos.cuotas.filter((c) => c.fecha >= rango.desde && c.fecha <= rango.hasta),
    fx, hoy,
  );
  const pace = pacing(datos.pagos, hoy);
  const mesEntero = cubreMesEntero(rango, hoy);
  const cashRango = pagos.reduce((s, p) => s + p.usd, 0);
  const conc = concentracion(pagos, rango);
  const dev = devoluciones(pagos, rango);
  const barras = serieCash(datos.pagos, rango, hoy);
  const cobMes = cobradoPorMes(datos.pagos, rango);

  const conFuente = ventas.filter((p) => p.conFuente).length;
  const nUp = ventas.filter((p) => p.motivo === "upsell").length;
  const cola = porVencer(datos.programas, datos.personas, hoy, 2);

  // Primer programa de cada persona: con qué entró al club.
  const primerTier = new Map<string, string>();
  for (const p of [...datos.programas].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (!esLegacy(p) && !primerTier.has(p.nombre)) primerTier.set(p.nombre, p.tier);
  }

  // `href`/`cta` son opcionales a propósito: solo las señales que tienen un
  // destino honesto llevan pie de acción. "Concentración" no tiene una
  // pantalla a la que ir, y mandar a un sitio que no responde la pregunta es
  // peor que no ofrecer nada.
  const senales: {
    cl: string; ic: string; t: string; v: string; d: string;
    href?: string; cta?: string;
  }[] = [
    {
      cl: conc.pct > 0.5 ? "mal" : conc.pct > 0.33 ? "atencion" : "bien",
      ic: conc.pct > 0.33 ? "▲" : "●",
      t: "Concentración de ingresos", v: pct(conc.pct),
      // Los nombres se calculaban en `concentracion()` (lib/inicio.ts:350) y
      // se tiraban: la pantalla usaba solo `.length`. El mayor riesgo del
      // negocio —quién lo sostiene— estaba en memoria y no se pintaba.
      d: conc.nPersonas === 0
        ? "Sin cobros en el rango."
        : `del cash lo ${conc.top.length === 1 ? "pone" : "ponen"} ` +
          `${conc.top.map((p) => p.nombre).join(", ")} ` +
          `(${conc.top.length} de ${conc.nPersonas}). ` +
          (conc.pct > 0.33 ? "Si una se cae, se nota en el mes." : "Riesgo repartido."),
    },
    {
      cl: ventas.length && nUp / ventas.length < 0.1 ? "atencion" : "bien",
      ic: ventas.length && nUp / ventas.length < 0.1 ? "▲" : "●",
      t: "Renovación y upsell", v: `${nUp} de ${ventas.length}`,
      d: `${pct(ventas.length ? nUp / ventas.length : 0)} de las ventas del rango. Hay ${cola} programas ` +
         `que terminan en los próximos 2 meses: esa es la cola de renovación.`,
    },
    {
      cl: dev.tasa > 0.05 ? "mal" : "bien", ic: dev.tasa > 0.05 ? "▲" : "●",
      t: "Devoluciones", v: pct(dev.tasa),
      // "bruto" son solo los pagos positivos; el KPI de cash es NETO. Si no se
      // dice, las dos cifras de la misma pantalla parecen contradecirse.
      d: dev.devuelto > 0
        ? `${money(dev.devuelto, "USD")} devueltos sobre ${money(dev.bruto, "USD")} cobrados brutos en el rango.`
        : "Ninguna devolución en el rango.",
      ...(dev.devuelto > 0
        ? { href: "/devoluciones", cta: "Ver las devoluciones" }
        : {}),
    },
  ];
  if (cuotas.vencidas.n > 0) {
    senales.push({
      cl: "atencion", ic: "▲", t: "Cuotas vencidas sin cobrar", v: money(cuotas.vencidas.usd, "USD"),
      d: `${cuotas.vencidas.n} cuotas pasadas de fecha (la más vieja, ${fechaCorta(cuotas.vencidas.masVieja)}). ` +
         `No son un pronóstico: es dinero que hay que ir a buscar.`,
      href: "/cuotas",
      cta: `Ver ${cuotas.vencidas.n === 1 ? "la vencida" : `las ${cuotas.vencidas.n} vencidas`}`,
    });
  }
  const sinFuente = ventas.length - conFuente;
  senales.push({
    cl: "dato", ic: "◆", t: "Falta el dato de atribución", v: `${conFuente} de ${ventas.length}`,
    d: "ventas del rango saben de qué canal vienen. Hasta que se etiquete la agenda que cerró, " +
       "«qué trae el dinero» no se puede responder.",
    // Sin ventas por atribuir no hay nada que hacer en /atribucion: el enlace
    // llevaría a una pantalla vacía y enseñaría a no pulsarlo.
    ...(sinFuente > 0
      ? { href: "/atribucion", cta: `Atribuir ${sinFuente === 1 ? "1 venta" : `${sinFuente} ventas`}` }
      : {}),
  });
  senales.push({
    cl: "dato", ic: "◆", t: "Gastos incompletos", v: `${datos.mesesConGasto.length} meses`,
    d: `solo hay gastos cargados de ${datos.mesesConGasto.map((m) => etiquetaMes(m)).join(", ") || "ningún mes"}. ` +
       `Por eso no hay cifra de margen: sería mentira.`,
    href: "/gastos",
    cta: "Cargar gastos",
  });

  return {
    pagos, ventas, barras, pace, cuotas, senales,
    mesEntero, cerrado: rangoCerrado(rango, hoy),
    heroVal: mesEntero ? (cobMes.get(mesHoy) ?? 0) : cashRango,
    nPagosMes: pagos.filter((p) => mesDe(p.fecha) === mesHoy).length,
    eurMes: pagos.filter((p) => mesDe(p.fecha) === mesHoy).reduce((s, p) => s + p.eur, 0),
    cashRango,
    cuotasRango,
    // Berni: "PROGRAMAS (2000-3500-5000-8000) (en cantidad en este rango)".
    // `tiers` ya viene agrupado por familia (mixTiers), así que el total es la
    // suma de sus recuentos y el desglose es la propia lista.
    nProgramas: mixTiers(ventas).reduce((s, t) => s + t.n, 0),
    nMeses: barras.length,
    activos: datos.personas.filter((p) => p.estado === "cliente").length,
    exClientes: datos.personas.filter((p) => p.estado === "ex_cliente").length,
    ticket: ticketMedio(ventas),
    tiers: mixTiers(ventas),
    // Los dos repartos que Berni pidió DOS VECES en CAMBIOS OS y que no
    // existían en ninguna pantalla. `reparto` deja el hueco («sin atribuir»)
    // siempre en la última fila, por grande que sea — ver lib/inicio.ts.
    porFuente: reparto(ventas, (v) => v.fuente, (v) => v.eur),
    porMetodo: reparto(ventas, (v) => v.metodoPago, (v) => v.eur, "sin método"),
    porMes: ventasPorMes(ventas, rango, hoy),
    ultimasCompras: [...ventas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 9),
    ultimosClientes: datos.personas
      .filter((p) => p.estado === "cliente" && p.alta)
      .sort((a, b) => (b.alta ?? "").localeCompare(a.alta ?? ""))
      .slice(0, 9)
      .map((p) => ({ ...p, tier: primerTier.get(p.nombre) ?? null })),
  };
}
