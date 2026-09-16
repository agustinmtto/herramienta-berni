"use client";
import { useMemo, useReducer, useState } from "react";
import { crearVenta, generarContratoAction } from "@/app/actions";
import { telefonoE164 } from "@/lib/venta";
import {
  reducer, estadoInicial, camposDeVenta, motivoBloqueo, planDeCobro,
  duplicadoDe, candidatosDe, llaveSelector, mesesBaseDeTier, METODOS,
  type EstadoVenta, type Accion, type Contexto,
} from "@/lib/venta-form";
import {
  BONOS_EVENTO, bonosAplicables, aplicaBonoDuracion, mesesConBonoDuracion,
  MAX_BONO_LIBRE,
} from "@/lib/bonos";
import type { VentaResult, VentaResumen } from "@/lib/types";
import type { ClienteOption, TierOption, TeamMember } from "@/lib/data";
import BotonBienvenida from "./BotonBienvenida";
import EditorContrato from "./EditorContrato";
// `import type` y no un import normal: `contrato-datos.ts` es de servidor y
// esto es un componente cliente. Un tipo se borra al compilar; el módulo no
// llega nunca al navegador.
import type { TipoContratoVenta } from "@/lib/contrato-datos";
import Modal from "@/components/Modal";
import SelectorAgenda from "./SelectorAgenda";
import { IconoCheck, IconoClip, IconoReciclar, IconoAlerta, IconoX } from "@/components/Iconos";
import { PAISES, etiquetaDe, paisPorIso } from "@/lib/paises";
import { money, dateEs } from "@/lib/format";
// Ver el comentario del campo "Otro bono", más abajo. Se destapa poniendo
// `true`, y solo cuando la migración `0059` esté aplicada.
const BONO_LIBRE_VISIBLE = false;

const TIPOS = [
  { id: "nueva", label: "Compra nueva" },
  { id: "ascension", label: "Ascensión" },
  { id: "extension", label: "Extensión" },
] as const;

// Cabecera de sección. El formulario ya tenía cinco bloques —① Tipo, ② Cliente,
// ③ Programa, ④ Cobro, ⑤ Cuotas— pero marcados SOLO en comentarios del código:
// en pantalla eran catorce campos seguidos sin un título que dijera dónde
// acaba una idea y empieza la siguiente.
function Seccion({ n, titulo, sub, children }: {
  n: number; titulo: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section className="vf-sec">
      <div className="vf-sec-head">
        <span className="vf-sec-n">{n}</span>
        <h3>{titulo}</h3>
        {sub && <span className="vf-sec-sub">{sub}</span>}
      </div>
      <div className="vf-sec-body">{children}</div>
    </section>
  );
}

export default function VentaForm({
  clientes,
  tiers,
  team,
  contratoActivo,
}: {
  clientes: ClienteOption[];
  tiers: TierOption[];
  // Equipo completo (para "¿Quién hizo esta ascensión?"). Se filtran los
  // setters aquí mismo, igual que en Thread.tsx: un setter no hace
  // ascensiones, así que no tiene sentido ofrecerlo en ese desplegable.
  team: TeamMember[];
  // `CONTRATO_ACTIVO === "true"`, leído en la página (esto es cliente: aquí no
  // hay `process.env`). En `false` —que es como está hasta la Task 22— esta
  // pantalla se comporta EXACTAMENTE igual que antes del 16-sep: nada se
  // genera, nada se abre, y la bienvenida sale cuando siempre salió.
  contratoActivo: boolean;
}) {
  // Toda la máquina de la venta vive en lib/venta-form.ts, que sí está
  // cubierta por tests. Aquí solo queda render + dispatch. `estadoInicial`
  // va como inicializador perezoso de useReducer para que las dos fechas se
  // calculen UNA vez, en el montaje, con la fecha local del navegador
  // (igual que los antiguos `defaultValue={hoy()}` y `useState(hoy())`).
  const red = useMemo(() => (e: EstadoVenta, a: Accion) => reducer(e, a, tiers), [tiers]);
  const [estado, dispatch] = useReducer(red, tiers, estadoInicial);
  const { tipo, nueva, existente, programa, cobro, comision, bonos: bonosPuestos } = estado;
  // Qué bonos se pueden ofrecer con el tier elegido ahora mismo. Desde el
  // 26-ago son siempre los 4: el de duración solo desaparece si el programa no
  // tiene duración que alargar (un vitalicio), en vez de quedar marcable pero
  // inerte. `mesesTier` es la duración SIN bono — la base del +50 %.
  const mesesTier = mesesBaseDeTier(programa.tier, tiers);
  const aplicables = bonosAplicables(mesesTier);

  // Fuera del reducer a propósito: esto no es el formulario, es lo que pasa
  // DESPUÉS de enviarlo. Depende de la respuesta del servidor, así que
  // dejarlo fuera es lo que mantiene el reducer 100 % puro y testeable.
  const [envio, setEnvio] = useState<{ saving: boolean; error: string; resumen: VentaResumen | null }>(
    { saving: false, error: "", resumen: null },
  );
  // "preguntando" = el modal está delante y hay que decidir. Arranca ahí en
  // cuanto se guarda una compra nueva con teléfono: el botón suelto se ignora.
  // Ojo: si `crear_venta` reutilizó una persona existente (mismo teléfono ya
  // registrado), NO se pregunta — esa persona ya estaba en el club y puede
  // tener su bienvenida de hace meses. Se deja el botón por si acaso, y el
  // guard del servidor decide. Preguntar a gritos algo cuya respuesta ya es
  // "no hace falta" es la forma más rápida de que el equipo aprenda a cerrar
  // el modal sin leerlo.
  const [bienvenida, setBienvenida] = useState<"preguntando" | "pospuesta" | "enviada">(
    "preguntando",
  );

  // El contrato tras la venta (spec 2026-09-15, decisión 3). Hasta el 16-sep
  // nacía en un `after()` de `crearVenta`: se generaba y se mandaba al equipo
  // sin que nadie lo viera, y si fallaba el único rastro era una línea en los
  // logs. Ahora lo pide esta pantalla y el resultado se mira.
  //
  //   null        no aplica (contrato apagado, o no es compra nueva)
  //   generando   el servidor lo está armando — una línea, sin modal
  //   error       no salió. LA VENTA SÍ. Con reintentar y con salida.
  //   listo       el modal delante
  //   cerrado     el modal se cerró; el contrato está guardado
  //   omitido     falló y él eligió seguir; NO hay contrato y queda dicho
  const [contrato, setContrato] = useState<
    | null
    | { estado: "generando" }
    | { estado: "error"; error: string }
    | {
        estado: "listo"; id: string; texto: string; textoGenerado: string;
        email: string | null; tipo: TipoContratoVenta;
      }
    | { estado: "cerrado" }
    | { estado: "omitido" }
  >(null);

  // Los dos tipos de venta que tienen plantilla. La extensión (renovación) no
  // tiene: Berni no pasó la suya (decisión de Patricio, 7-sep) y por eso
  // `tipoContratoDe` le devuelve `null`.
  //
  // 🔴 LISTA BLANCA, no `tipo !== "extension"`. Misma regla que la guarda de
  // plantilla de `recorregirContrato` (commit cd7899c) y por el mismo motivo:
  // esto decide si se le genera un documento legal a un cliente, y un tipo de
  // venta nuevo tiene que entrar aquí a mano y no colarse por ser "lo que no
  // es extensión".
  //
  // La ASCENSIÓN entra aunque no se firme en el OS. Genera su `ampliacion`, se
  // guarda y se puede leer y descargar; lo que no hace es abrirse editable
  // (`editable` sale `false` solo, más abajo) ni mandarse al cliente para
  // firmar — eso es v2 y hoy la v2 es solo de venta nueva. Es exactamente lo
  // que hacía el `after()` que esta tarea borró, menos el correo automático al
  // equipo, que la spec quita a propósito para todos (el equipo se entera por
  // la campana: `generarContrato` escribe en `auditoria`).
  const conContrato = contratoActivo && (tipo === "nueva" || tipo === "ascension");

  // 🔴 Qué tapa la pantalla. De esto depende que el modal de la bienvenida
  // espere su turno: dos modales encima del otro es no leer ninguno.
  //
  // "error" cuenta como delante A PROPÓSITO aunque no sea un modal: si la
  // bienvenida se abriera encima del fallo, el fallo se leería —si se lee— con
  // un modal delante, que es justo lo que esta tarea existe para evitar. Por
  // eso el bloque de error tiene salida explícita ("Seguir sin el contrato"),
  // y sin ella la bienvenida se quedaría enterrada para siempre.
  //
  // `cerrado` y `omitido` NO tapan: los dos son el final de esto, y lo único
  // que dejan en pantalla es una línea contando cómo acabó.
  const contratoDelante =
    contrato?.estado === "generando" || contrato?.estado === "listo"
    || contrato?.estado === "error";

  const candidatos = useMemo(
    () => candidatosDe(clientes, existente.busqueda),
    [existente.busqueda, clientes],
  );

  // Aviso NO bloqueante: el cliente ya podría existir (por nombre, email o teléfono).
  // El teléfono es la señal fuerte — es UNIQUE en la base y el RPC reutiliza esa persona.
  const dupNueva = useMemo(
    () => (tipo === "nueva" ? duplicadoDe(clientes, nueva) : null),
    [tipo, nueva, clientes],
  );

  // Los coaches del OS: quien tiene `rol = "coach"` en team_members. Hoy son
  // Berni y Manuel, pero no van escritos aquí — si mañana entra un tercero,
  // aparece solo con darle ese rol. `getTeamMembers` ya filtra por activo.
  const coaches = useMemo(() => team.filter((t) => t.rol === "coach"), [team]);

  const { sumaCuotas, totalPlan, descuadre } = planDeCobro(estado);
  const bloqueo = motivoBloqueo(estado);
  const llave = llaveSelector(estado);
  const { resumen } = envio;

  async function elegirCliente(c: ClienteOption) {
    dispatch({ t: "elegirCliente", personaId: c.id, nombre: c.nombre ?? "" });
    const r = await fetch(`/api/ventas/contexto?personaId=${c.id}`);
    if (r.ok) {
      const d: Contexto = await r.json();
      // Se manda el personaId con la respuesta: el reducer descarta la de un
      // cliente que ya no es el elegido (dos fetch en vuelo si se corrige la
      // búsqueda). Sin esa guardia, el contexto de A se pega al id de B.
      dispatch({ t: "contextoCargado", personaId: c.id, ctx: d });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnvio((p) => ({ ...p, saving: true, error: "" }));
    // SÍNCRONO y antes de cualquier await: después de un await
    // `e.currentTarget` ya es null. Y los inputs NO se deshabilitan mientras
    // se guarda: un campo `disabled` desaparece del FormData en silencio.
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    // Del DOM salen solo `comprobante` (el File) y `agenda` (el "on" del
    // radio de SelectorAgenda). Las otras 22 claves salen del estado, y las
    // que ya existían por su `name=` se sobreescriben con el mismo valor.
    for (const [k, v] of Object.entries(camposDeVenta(estado))) fd.set(k, v);
    let guardada: VentaResumen | null = null;
    try {
      const r: VentaResult = await crearVenta(fd);
      if (r.ok) { guardada = r.resumen; setEnvio({ saving: false, error: "", resumen: r.resumen }); }
      else setEnvio({ saving: false, error: r.error, resumen: null });
    } catch {
      // La server action no llegó o no respondió: no sabemos si la venta se guardó.
      setEnvio({
        saving: false,
        error: "Error de conexión — comprueba en Ingresos si la venta se guardó antes de reintentar",
        resumen: null,
      });
    }

    // 🔴 FUERA del try de arriba, y no por prolijidad.
    //
    // Ese `catch` pone `resumen: null`, o sea BORRA la pantalla de "Venta
    // registrada" y devuelve el formulario con "comprueba en Ingresos si la
    // venta se guardó". Si el contrato pudiera caer ahí, un fallo SUYO —de red,
    // de pdfkit, de Storage— le diría a Alex que no sabemos si la venta se
    // guardó sobre una venta que acabamos de guardar y cobrar. Y el siguiente
    // clic razonable sería registrarla otra vez.
    //
    // Los dos fallos son distintos y tienen que verse distintos: la venta falló
    // (se reintenta) o el contrato falló (la venta está hecha).
    //
    // `setContrato` corre antes del primer `await` de `generarElContrato`, o
    // sea en el mismo lote que el `setEnvio` de arriba: React 18 los agrupa y
    // el modal de la bienvenida no llega a asomar entre medias.
    if (guardada && conContrato) await generarElContrato(guardada);
  }

  /**
   * Pide el contrato de una venta ya guardada. Se llama al registrarla y desde
   * el botón de reintentar.
   *
   * Reintentar es seguro: `generarContrato` pregunta primero si el programa ya
   * tiene contrato y devuelve el que haya en vez de generar otro — el índice
   * único de `contratos.programa_id` es la red de debajo.
   */
  async function generarElContrato(v: VentaResumen) {
    setContrato({ estado: "generando" });
    const f = new FormData();
    f.set("persona_id", v.persona_id);
    f.set("programa_id", v.programa_id);
    f.set("pago_id", v.pago_id);
    f.set("tipo_venta", tipo);
    try {
      const g = await generarContratoAction(f);
      setContrato(
        g.ok
          ? {
              estado: "listo", id: g.contratoId, texto: g.texto,
              textoGenerado: g.textoGenerado, email: g.email, tipo: g.tipo,
            }
          : { estado: "error", error: g.error },
      );
    } catch {
      // Mismo criterio que arriba: el mensaje empieza por lo que NO pasó.
      setContrato({
        estado: "error",
        error: "No se pudo hablar con el servidor al generar el contrato.",
      });
    }
  }

  if (resumen) {
    return (
      <div className="venta-ok">
        <h3><IconoCheck /> Venta registrada</h3>

        {/* `pago_monto` es dinero de verdad y salía crudo: "cobro de hoy
            1500€", sin separador de miles. Con `money()` ya no se leen igual
            de rápido 1.500 y 15.000, que es lo que se cuadra contra Stripe.
            `tier` NO se formatea: es el nombre del programa ("3500", "OG"),
            no un importe, y pasarlo por money() sería inventar una cifra. */}
        <p><strong>{resumen.nombre}</strong> · programa {resumen.tier}€ · cobro de hoy {money(resumen.pago_monto)}
          {resumen.con_comprobante ? <> · <IconoClip /> comprobante adjunto</> : " · sin comprobante"}</p>
        {resumen.persona_reutilizada && (
          <p className="hint"><IconoReciclar /> cliente existente reutilizado (teléfono ya registrado)</p>
        )}

        {/* El contrato va DESPUÉS de la línea que dice qué se vendió y a
            quién, y antes de la bienvenida. Ese orden es deliberado: lo
            primero que busca quien acaba de darle a "Registrar venta" es la
            confirmación de lo que acaba de cobrar, y el bloque de error del
            contrato son tres párrafos que la empujarían fuera de la vista.
            Después ya sí: contrato, y luego bienvenida — el mismo orden en el
            que los dos modales se turnan. */}
        {contrato?.estado === "generando" && <p className="hint">Generando el contrato…</p>}

        {contrato?.estado === "error" && (
          <>
            {/* El orden de esta frase es el trabajo: primero lo que SÍ pasó.
                La venta está cobrada y guardada y no se deshace; lo que falló
                es el documento. Quien lea deprisa tiene que quedarse con eso y
                no con "error". */}
            <p className="error">
              <IconoAlerta /> <strong>La venta quedó registrada.</strong> Lo que no salió
              es el contrato: {contrato.error}
            </p>
            <div className="venta-bienvenida">
              <button type="button" className="btn" onClick={() => generarElContrato(resumen)}>
                Reintentar el contrato
              </button>
              {" "}
              {/* `omitido`, no `null`: seguir adelante no es que no haya
                  pasado nada. `null` borraba el error y dejaba la pantalla
                  idéntica a una venta que sí tuvo su contrato — justo lo que
                  esta tarea existe para que no pase, y encima asimétrico con
                  el `cerrado` del camino bueno. */}
              <button type="button" className="btn" onClick={() => setContrato({ estado: "omitido" })}>
                Seguir sin el contrato
              </button>
            </div>
            <p className="hint">
              No vuelvas a registrar la venta: ya está guardada con su pago y sus cuotas.
              Si el contrato sigue sin salir, sigue adelante y dilo — se puede generar
              después sin tocar nada de esto.
            </p>
          </>
        )}

        {contrato?.estado === "listo" && (
          <EditorContrato
            contratoId={contrato.id}
            textoInicial={contrato.texto}
            textoGenerado={contrato.textoGenerado}
            emailCliente={contrato.email}
            // Acaba de nacer 'pendiente': `generarContrato` no manda nada a
            // nadie, y nada más lo manda por su cuenta.
            yaEnviado={false}
            // 🔴 Hoy esto es `false` SIEMPRE, y por dos motivos distintos:
            // en compra nueva porque `tipoContratoDe("nueva")` devuelve
            // "venta_nueva" hasta la Task 22, y en ascensión porque una
            // `ampliacion` no se firma en el OS y nunca lo hará por aquí. El
            // modal se abre para leer: `EditorContrato` con `editable={false}`
            // lo dice en pantalla en vez de ofrecer un textarea que no guarda.
            // Con la Task 22 encendida, la compra nueva pasa a editable; la
            // ascensión se queda como está.
            editable={contrato.tipo === "venta_nueva_v2"}
            onCerrar={() => setContrato({ estado: "cerrado" })}
          />
        )}

        {contrato?.estado === "cerrado" && (
          <p className="hint">
            <IconoCheck /> El contrato está guardado — lo tienes en Contratos.
          </p>
        )}

        {contrato?.estado === "omitido" && (
          <p className="error">
            <IconoAlerta /> Esta venta se quedó sin contrato: hay que generarlo después.
            La venta, su pago y sus cuotas están guardados.
          </p>
        )}
        {tipo === "nueva" && resumen.telefono && bienvenida === "enviada" && (
          <p className="hint"><IconoCheck /> Bienvenida enviada por WhatsApp a {resumen.telefono}</p>
        )}
        {tipo === "nueva" && resumen.telefono
          && (bienvenida === "pospuesta" || resumen.persona_reutilizada) && (
          <div className="venta-bienvenida">
            <BotonBienvenida
              personaId={resumen.persona_id}
              etiqueta="Enviar bienvenida por WhatsApp"
              clase="btn"
              onEnviada={() => setBienvenida("enviada")}
            />
          </div>
        )}

        {/* Modal de bienvenida. A propósito NO se cierra pulsando fuera ni con
            Escape, al revés que el resto de modales del OS: existe justamente
            para que no se pueda pasar de largo sin decidir. "Ahora no" es una
            salida legítima — el cliente queda marcado en /clientes. */}
        {/* `!contratoDelante`: mientras el contrato esté generándose, delante
            o fallando, este modal espera. Ver `contratoDelante`, arriba. */}
        {tipo === "nueva" && resumen.telefono && !resumen.persona_reutilizada
          && bienvenida === "preguntando" && !contratoDelante && (
          // Este overlay NO tenía onClick: era el único modal sin salida por
          // fuera, a propósito, para que la bienvenida se decida. Se conserva
          // con `cerrarAlPulsarFuera={false}` — un clic fuera es fácil de dar
          // sin querer. Escape sí cierra, y equivale a "Ahora no", que es la
          // salida que el propio modal ya ofrecía dentro.
          <Modal
            titulo="¿Enviar la bienvenida por WhatsApp?"
            cerrarAlPulsarFuera={false}
            onCerrar={() => setBienvenida("pospuesta")}
          >
              <p>
                Se enviará a <strong>{resumen.nombre}</strong> ({resumen.telefono}) y quedará
                registrado en su ficha. Es lo que mete al cliente en el canal del club.
              </p>
              <div className="modal-actions">
                <BotonBienvenida
                  personaId={resumen.persona_id}
                  etiqueta="Sí, enviar bienvenida"
                  clase="btn primary"
                  onEnviada={() => setBienvenida("enviada")}
                />
                <button className="btn" onClick={() => setBienvenida("pospuesta")}>
                  Ahora no
                </button>
              </div>
              <p className="hint">
                Si eliges «Ahora no», el cliente aparecerá marcado en Clientes hasta que
                alguien se la envíe.
              </p>
          </Modal>
        )}
        {resumen.cuotas.length > 0 && (
          <div className="tabla-scroll">
            <table className="t"><thead><tr><th>Cuota</th><th className="r">EUR</th><th>Vence</th></tr></thead>
              <tbody>{resumen.cuotas.map((c, i) => (
                <tr key={i}><td>{i + 2}</td><td className="r mono">{c.monto}</td><td className="mono">{c.fecha}</td></tr>
              ))}</tbody></table>
          </div>
        )}
        <button className="btn" onClick={() => location.reload()}>Registrar otra venta</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="gasto-form venta-form">
      {/* ① Tipo */}
      <div className="venta-tipos">
        {TIPOS.map((t) => (
          <button type="button" key={t.id} className={`vt ${tipo === t.id ? "on" : ""}`}
            aria-pressed={tipo === t.id}
            // Cambiar de tipo cambia de cliente (o lo vacía): el reducer limpia
            // el comprador existente y la comisión. Misma razón que en
            // elegirCliente — una atribución que quedó puesta para el
            // cliente/tipo anterior no debe colarse en la venta nueva.
            onClick={() => dispatch({ t: "cambiarTipo", tipo: t.id })}>
            {t.label}
          </button>
        ))}
      </div>

      <Seccion n={1} titulo="Quién compra">
      {tipo === "nueva" ? (
        <>
          <div className="gf-row">
            <label>Nombre *<input name="nombre" required value={nueva.nombre}
              onChange={(e) => dispatch({ t: "editarNueva", campo: "nombre", valor: e.target.value })} /></label>
            <label>Email<input name="email" type="email" value={nueva.email}
              onChange={(e) => dispatch({ t: "editarNueva", campo: "email", valor: e.target.value })} /></label>
          </div>
          <div className="gf-row">
            <label>País<select name="pais_iso" value={nueva.iso}
              onChange={(e) => dispatch({ t: "editarNueva", campo: "iso", valor: e.target.value })}>
              {PAISES.map((p) => <option key={p.iso} value={p.iso}>{etiquetaDe(p)}</option>)}</select></label>
            <label>Teléfono<input name="telefono"
              placeholder={nueva.iso === "XX" ? "+595 981 394 196" : "620 000 000"}
              value={nueva.telefono}
              onChange={(e) => dispatch({ t: "editarNueva", campo: "telefono", valor: e.target.value })} /></label>
            {/* Solo viaja el ISO: crearVenta deriva de ahí el nombre del país y el
                prefijo, así que no hay dos campos que puedan discrepar. */}
          </div>
          {nueva.iso === "XX" && nueva.telefono.trim() && !telefonoE164("", nueva.telefono) && (
            <p className="warn">
              <IconoAlerta /> Con “Otro” hay que escribir el número <strong>completo, con su prefijo
              internacional</strong> (por ejemplo +595 981 394 196). Sin prefijo no se puede
              saber de qué país es, y la venta se guardaría sin teléfono.
            </p>
          )}
          {dupNueva && (
            <p className="warn">
              <IconoAlerta /> Puede que ya exista: “{dupNueva.cliente.nombre}” ({dupNueva.cliente.estado}).
              {dupNueva.porTelefono
                ? " Ese teléfono ya está registrado — se reutilizará ese cliente en vez de crear uno nuevo."
                : " Revisa antes de guardar."}
            </p>
          )}
        </>
      ) : (
        <>
          <label>Cliente *<input value={existente.busqueda}
            onChange={(e) => dispatch({ t: "teclearBusqueda", valor: e.target.value })}
            placeholder="Busca por nombre…" required /></label>
          {!existente.personaId && candidatos.length > 0 && (
            <ul className="venta-sugerencias">{candidatos.map((c) => (
              <li key={c.id}><button type="button" onClick={() => elegirCliente(c)}>{c.nombre} <span className="hint">({c.estado})</span></button></li>
            ))}</ul>
          )}
          {existente.ctx && (
            <div className="venta-ctx">
              <p><strong>Total pagado:</strong> {money(existente.ctx.total_pagado)} · <strong>Cuotas pendientes:</strong>{" "}
                {existente.ctx.cuotas_pendientes.length === 0 ? "ninguna" :
                  existente.ctx.cuotas_pendientes
                    .map((c) => `${money(c.monto)} (${dateEs(c.fecha_vencimiento)})`).join(" · ")}</p>
              <label>{tipo === "ascension" ? "Asciende desde" : "Extiende"} *
                <select value={existente.programaPrevio}
                  onChange={(e) => dispatch({ t: "elegirProgramaPrevio", id: e.target.value })} required>
                  {existente.ctx.programas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.tier}€ · {p.motivo} · desde {dateEs(p.fecha_inicio)}
                    </option>
                  ))}
                </select>
              </label>
              {tipo === "extension" && !tiers.some((t) => t.id === existente.ctx!.programas.find((p) => p.id === existente.programaPrevio)?.tier) &&
                existente.ctx.programas.find((p) => p.id === existente.programaPrevio) && (
                <p className="hint">
                  El programa de origen es {existente.ctx.programas.find((p) => p.id === existente.programaPrevio)?.tier}
                  {existente.ctx.programas.find((p) => p.id === existente.programaPrevio)?.tier === "OG"
                    ? " (vitalicio)" : " (ya no está a la venta)"} —
                  elige el tier del nuevo programa manualmente.
                </p>
              )}
            </div>
          )}
        </>
      )}
      </Seccion>

      {/* Aparece en los tres tipos de venta. En compra nueva el cliente
          todavía no existe en `personas`, así que se busca su contacto de GHL
          por el email/teléfono que se están tecleando (el selector ya sabe
          hacerlo). NUNCA bloquea la venta: si GHL no responde o se deja sin
          decidir, se guarda igual y cae en la bandeja de /atribucion.

          Iba en un <fieldset> sin clase, así que salía con el borde gris por
          defecto del navegador dentro de una app oscura — era lo que peor se
          veía de la pantalla. Y el título decía "Atribución", que es jerga
          nuestra: quien rellena esto acaba de colgar una llamada. */}
      <Seccion n={2} titulo="Qué llamada cerró la venta"
               sub="de aquí sale quién cobra comisión">
        {/* Las tres llaves salen normalizadas a null de llaveSelector: el
            selector elige llave con `||`, y una cadena vacía ya lo ocultó
            una vez. */}
        <SelectorAgenda
          personaId={llave.personaId}
          email={llave.email}
          telefono={llave.telefono}
          team={team}
          value={comision.atribucion}
          onChange={(a) => dispatch({ t: "elegirAtribucion", atribucion: a })}
        />
        {tipo !== "nueva" && (
          <label>
            {tipo === "ascension" ? "¿Quién hizo esta ascensión?" : "¿Quién hizo esta extensión?"}
            <select value={comision.upsellPor}
              onChange={(e) => dispatch({ t: "elegirUpsellPor", id: e.target.value })}>
              <option value="">— elegir —</option>
              {team.filter((t) => t.rol !== "setter").map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
            <span className="vf-ayuda">
              El 10 % es para quien la haya hecho, y para nadie más. Si no
              consta, no cobra nadie.
            </span>
          </label>
        )}
      </Seccion>

      <Seccion n={3} titulo="Qué compró">
      <div className="gf-row">
        <label>Programa (tier)<select name="tier" value={programa.tier}
          onChange={(e) => dispatch({ t: "elegirTier", id: e.target.value })}>
          {tiers.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
        {/* Escribir el total a mano NO regenera el plan de cuotas: es lo que
            hace saltar el aviso de descuadre. Solo el selector de tier lo hace. */}
        <label>Valor total (€)<input name="valor_total" type="number" step="0.01" min="1" required
          value={programa.valorTotal || ""}
          onChange={(e) => dispatch({ t: "editarValorTotal", valor: Number(e.target.value) })} /></label>
      </div>
      <div className="gf-row">
        <label>Fecha inicio<input name="fecha_inicio" type="date" required value={programa.fechaInicio}
          onChange={(e) => dispatch({ t: "editarFechaInicio", valor: e.target.value })} /></label>
        <label>Duración (meses)<input name="meses_duracion" type="number" min="1" max="24"
          value={programa.meses ?? ""}
          onChange={(e) => dispatch({ t: "editarMeses", valor: Number(e.target.value) })} /></label>
      </div>

      {/* Quién le atiende, decidido aquí y no tres pantallas después.
          Antes había que registrar la venta, ir a /clientes, buscar a la
          persona, abrir su ficha y editarla — y mientras tanto el cliente no
          aparecía en el cupo de ningún coach.

          `coach_id` NO pasa por el reducer: sale del DOM con el FormData,
          igual que `agenda` y `comprobante`. `camposDeVenta` no toca esta
          clave, así que sobrevive intacta. */}
      <div className="gf-row">
        <label>Consultor que le atenderá
          <select name="coach_id" defaultValue="">
            <option value="">— decidir más tarde —</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </label>
        <p className="vf-ayuda">
          {coaches.length === 0
            ? "No hay nadie con el rol de consultor en el equipo. Se asigna después desde la ficha del cliente."
            : "Se le asigna al guardar la venta. Se puede cambiar luego desde su ficha."}
        </p>
      </div>

      {/* Bonos del evento 26/08. No llevan name=: viajan por camposDeVenta,
          como las cuotas. El maestro existe porque en el evento los cuatro
          van juntos — Alex marca uno y el sistema pone el resto. */}
      <fieldset className="vf-bonos">
        <legend>Bonos del evento</legend>
        <label className="vf-bono vf-bono-maestro">
          <input type="checkbox"
            checked={bonosPuestos.length > 0 && bonosPuestos.length === aplicables.length}
            ref={(el) => { if (el) el.indeterminate =
              bonosPuestos.length > 0 && bonosPuestos.length < aplicables.length; }}
            onChange={(e) => dispatch({ t: "marcarBonosEvento", puesto: e.target.checked })} />
          <span>
            <strong>Venta del evento 26/08</strong>
            <span className="vf-ayuda">
              Marca de una los {aplicables.length} bonos que aplican a este tier.
              Cada uno se puede desmarcar después.
            </span>
          </span>
        </label>

        {aplicables.map((clave) => {
          const bono = BONOS_EVENTO.find((x) => x.clave === clave)!;
          return (
            <label key={clave} className="vf-bono">
              <input type="checkbox" checked={bonosPuestos.includes(clave)}
                onChange={() => dispatch({ t: "alternarBono", clave })} />
              <span>
                {bono.etiqueta}
                <span className="vf-ayuda">{bono.efecto}</span>
              </span>
            </label>
          );
        })}

        {/* 🔴 ESCONDIDO, no borrado. Decisión de Patricio del 8-sep.
            El campo funciona, pero la base todavía descarta lo que se escriba
            en él: `crear_venta` sanea los bonos contra su catálogo de 4 claves
            y tira el resto en silencio. Eso lo arregla la migración `0059`, que
            está en pausa hasta que Berni confirme si esos cuatro son todos los
            bonos que existen.
            Enseñarlo mientras tanto sería peor que no tenerlo: el closer le
            promete un bono al cliente y no queda escrito en ningún lado.
            PARA DESTAPARLO: poner `true` aquí. Nada más — el estado, el envío
            y el contrato ya saben qué hacer con él, y hay tests que lo cubren
            (`destinatarios-contrato.test.ts` no, `contrato-datos.test.ts` sí,
            en "el bono escrito a mano va después de los del catálogo"). */}
        {BONO_LIBRE_VISIBLE && (
        <label className="vf-bono vf-bono-libre">
          <span>
            Otro bono (opcional)
            <span className="vf-ayuda">
              Se imprime en el contrato tal cual se escriba. No suma
              consultorías ni alarga el programa.
            </span>
          </span>
          <input type="text" maxLength={MAX_BONO_LIBRE}
            placeholder="p. ej. Acceso al grupo de señales durante 3 meses"
            value={estado.bonoLibre}
            onChange={(e) => dispatch({ t: "bonoLibre", texto: e.target.value })} />
        </label>
        )}

        {aplicaBonoDuracion(mesesTier) ? (
          <p className="vf-ayuda vf-bonos-nota">
            Con el bono de <strong>+50 % de duración</strong> este programa pasa
            de {mesesTier} a {mesesConBonoDuracion(mesesTier)} meses.
          </p>
        ) : (
          <p className="vf-ayuda vf-bonos-nota">
            El bono de <strong>+50 % de duración</strong> no aparece: este
            programa no tiene duración que alargar.
          </p>
        )}
      </fieldset>
      </Seccion>

      <Seccion n={4} titulo="Cómo paga">
      <div className="gf-row">
        <label>Cobro de hoy (€) *<input name="pago_monto" type="number" step="0.01" min="0.01" required
          value={cobro.pagoMonto || ""}
          onChange={(e) => dispatch({ t: "editarPagoMonto", valor: Number(e.target.value) })} /></label>
        <label>Método<select name="metodo_pago" value={cobro.metodo}
          onChange={(e) => dispatch({ t: "editarMetodo", valor: e.target.value })}>
          {METODOS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      </div>
      <div className="gf-row">
        {/* String, nunca number: "" significa «vacío» y el servidor lo
            distingue de "0". Con estado numérico, Number("") sería 0 y
            "10.50" se convertiría en "10.5".

            OBLIGATORIO desde el 14-ago-2026: la comisión se calcula sobre el
            dólar cobrado, así que una venta sin este dato es una venta sobre
            la que no se le puede pagar a nadie — y se descubriría al cerrar
            el mes, no ahora. */}
        <label>USD recibido *<input name="usd_recibido" type="number" step="0.01" min="0.01" required
          placeholder="lo que entró en dólares"
          value={cobro.usdRecibido}
          onChange={(e) => dispatch({ t: "editarUsdRecibido", valor: e.target.value })} /></label>
        <label>Fecha de pago<input name="pago_fecha" type="date" required value={cobro.pagoFecha}
          onChange={(e) => dispatch({ t: "editarPagoFecha", valor: e.target.value })} /></label>
        {/* No puede volverse controlado (React no lo permite en un input file)
            ni salir del <form>: el servidor lo lee del FormData del DOM. */}
        <label>Comprobante (png/jpg/pdf)<input name="comprobante" type="file" accept="image/png,image/jpeg,application/pdf" /></label>
      </div>

      <label>Cuotas restantes
        <input type="number" min="0" max="24" value={cobro.nCuotas}
          onChange={(e) => dispatch({ t: "fijarNCuotas", n: Number(e.target.value) })} />
      </label>
      {/* Una tabla ligera con la cabecera UNA vez, en vez de dos <label>
          completos por fila. Los inputs siguen SIN `name=`: viajan
          serializados en la clave `cuotas`, y un `name` aquí metería claves
          (`monto`, `fecha`) que el RPC no espera. El aria-label sustituye al
          label visible que se ha quitado. */}
      {cobro.cuotas.length > 0 && (
        <div className={`vf-cuotas ${cobro.cuotas.length > 6 ? "scroll" : ""}`}>
          <div className="vf-cuotas-head">
            {/* El contador va en la cabecera porque la lista scrollea: sin él,
                7 cuotas se ven como 5 y media y la lista PARECE completa —
                mientras la línea de totales de abajo suma también las que no
                se ven y confirma un plan de pagos que nadie ha mirado. */}
            <span>#</span>
            <span>Importe (€)</span>
            <span>Vence</span>
            <span className="vf-cuotas-n">{cobro.cuotas.length}</span>
          </div>
          {cobro.cuotas.map((c, i) => (
            <div className="vf-cuota" key={i}>
              <span className="n">{i + 2}</span>
              <input type="number" step="0.01" min="0.01" aria-label={`Importe de la cuota ${i + 2} en euros`}
                value={c.monto || ""}
                onChange={(e) => dispatch({ t: "editarCuotaMonto", i, valor: Number(e.target.value) })} />
              <input type="date" aria-label={`Vencimiento de la cuota ${i + 2}`} value={c.fecha}
                onChange={(e) => dispatch({ t: "editarCuotaFecha", i, valor: e.target.value })} />
              <button type="button" className="btn-mini" aria-label={`Quitar la cuota ${i + 2}`}
                onClick={() => dispatch({ t: "quitarCuota", i })}>✕</button>
            </div>
          ))}
        </div>
      )}
      {/* Avisa pero NO bloquea: el texto sigue diciendo que se puede guardar
          igual, y sigue siendo verdad. */}
      <p className={descuadre ? "warn" : "hint"}>
        Hoy <span className="mono">{cobro.pagoMonto || 0}€</span> + cuotas <span className="mono">{sumaCuotas.toFixed(2)}€</span> = <strong className="mono">{totalPlan.toFixed(2)}€</strong> de <span className="mono">{programa.valorTotal || 0}€</span>
        {descuadre ? " — no cuadra con el valor total (se puede guardar igual)" : " ✓"}
      </p>
      </Seccion>

      {envio.error && <p className="error"><IconoX /> {envio.error}</p>}
      <div className="vf-guardar">
        <button className="btn primary" disabled={envio.saving || bloqueo !== null}>
          {envio.saving ? "Guardando…" : "Registrar venta"}
        </button>
        {/* El botón deshabilitado dice ahora por qué lo está. */}
        {bloqueo && <span className="vf-bloqueo">{bloqueo}</span>}
      </div>
    </form>
  );
}
