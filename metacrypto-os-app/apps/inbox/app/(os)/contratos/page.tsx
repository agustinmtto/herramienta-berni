import Link from "next/link";
import { requireModulo } from "@/lib/guard";
import { getContratos, type ContratoRow } from "@/lib/data";
import { ajusteOs } from "@/lib/ajustes";
import { dateEs, money, num } from "@/lib/format";
import { cintaDeFila } from "@/lib/contrato-datos";
import { estadoContrato, CLASE_PILL } from "@/lib/contrato-estado";
import { plantillaRegenerable } from "@/lib/contrato-guardas";
import CintaContrato from "@/components/CintaContrato";
import ContratoPreview from "@/components/ContratoPreview";
import ModoContrato from "@/components/ModoContrato";
import ReenviarContrato from "@/components/ReenviarContrato";
import RecorregirContrato from "@/components/RecorregirContrato";
import EditarContrato from "@/components/EditarContrato";
import EnviarAlCliente from "@/components/EnviarAlCliente";

export const dynamic = "force-dynamic";

// El contrato lleva el importe de la venta, así que va bajo el módulo
// "ventas" — el mismo gate que la ruta que sirve el PDF y que
// /api/ventas/contexto. Sin módulo nuevo: quien registra la venta es quien
// tiene que ver su contrato, y `ModuloKey` no crece por una pantalla.
const MODULO = "ventas" as const;

const ETIQUETA_TIPO: Record<string, string> = {
  venta_nueva: "Venta nueva",
  ampliacion: "Ampliación",
  // La misma etiqueta que `venta_nueva`, a propósito. Para el equipo las dos
  // son "una venta nueva": la diferencia es de qué plantilla salió el
  // documento y, de ahí, qué se puede hacer con él. Eso ya se ve en la fila
  // —la v2 tiene "Editar" y "Enviar al cliente", la vieja no— y ponerlo
  // además en el badge sería enseñar la cocina.
  venta_nueva_v2: "Venta nueva",
};

// NO reusa `.badge.tier` (tier de suscripción) ni `.badge.coach` (insignia de
// coach) — esas dos ya significan otra cosa en otras pantallas.
//
// Solo el tipo. La marca de recorregido/desactualizado ya NO vive aquí: era un
// segundo badge gris pegado a este, y dos píldoras iguales al lado hacían que
// una categoría ("Ampliación") y un hecho de la historia del documento
// ("Recorregido") se leyeran con el mismo rango. Ahora es la cinta de la
// esquina — ver `components/CintaContrato.tsx`, que la comparten esta pantalla
// y el bloque "Contratos" de la ficha del cliente.
function TagTipo({ tipo }: { tipo: string | null }) {
  if (!tipo) return <span>—</span>;
  const clase = tipo === "ampliacion" ? "tipo-ampliacion" : "tipo-nueva";
  return <span className={`badge ${clase}`}>{ETIQUETA_TIPO[tipo] ?? tipo}</span>;
}

// QUÉ dice y de qué color lo decide `estadoContrato()` (lib/contrato-estado.ts),
// no esta función. Se mudó allí el 16-sep por dos razones:
//
//  · Lo pintan DOS pantallas —ésta y el bloque "Contratos" de la ficha— y ya
//    habían divergido: aquí 'pendiente' se fundía con 'error_envio' en un
//    "Error" naranja y en la ficha salía "Pendiente" a secas. El mismo
//    contrato se leía como roto en una pantalla y como normal en la otra.
//  · Con el ciclo del cliente (0065) la regla dejó de ser un diccionario: hay
//    que mirar `firmado_at`, `visto_at` y hasta el `tipo` —'pendiente' quiere
//    decir dos cosas distintas según la plantilla— y eso es una regla, no un
//    pixel. Allí la cubren 14 tests; aquí no la cubriría ninguno.
//
// El `title` NO es decoración: es donde va lo que la píldora no puede
// prometer. "Abierto" quiere decir que se le sirvió el PDF, y el globo lo
// dice con todas las letras.
function EstadoContrato({ c }: { c: ContratoRow }) {
  const e = estadoContrato(c);
  return (
    <span className={CLASE_PILL[e.tono]} title={e.detalle ?? undefined}>
      {e.etiqueta}
    </span>
  );
}

export default async function ContratosPage() {
  const u = await requireModulo(MODULO);
  const [filas, modoRaw, emailPrueba] = await Promise.all([
    getContratos(),
    ajusteOs("contrato_modo_prueba"),
    ajusteOs("contrato_email_prueba"),
  ]);
  // Si la tabla `ajustes_os` no contesta, se asume "prueba": mismo criterio
  // que destinatariosDePrueba() en lib/ajustes.ts — mejor equivocarse hacia
  // el buzón de pruebas que hacia el equipo real.
  const modo: "on" | "off" = modoRaw === "off" ? "off" : "on";

  // A quién va a parar un contrato recorregido, en texto, para que el aviso
  // del modal lo diga en vez de mandar a mirar el interruptor de arriba. Sale
  // de lo que YA se leyó acá — no hay consulta nueva. Los nombres del modo
  // producción son los usernames de DESTINATARIOS (lib/contrato-envio.ts).
  const destinosVisibles =
    modo === "on" ? emailPrueba || "las direcciones de prueba" : "Berni, Alex y Paula";

  // Se agrupa por persona, no por nombre — ver el comentario en ContratoRow
  // (lib/data.ts). El orden de aparición de cada grupo sigue el de `filas`
  // (created_at desc): el cliente con el contrato más reciente queda arriba.
  const grupos = new Map<string, ContratoRow[]>();
  for (const c of filas) {
    const arr = grupos.get(c.persona_id) ?? [];
    arr.push(c);
    grupos.set(c.persona_id, arr);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Contratos</h1>
        <span className="hint">
          {filas.length === 0 ? "todavía no hay ninguno" : `${num(filas.length)} contratos`}
        </span>
      </div>

      {/* Solo `rol === "admin"`, que hoy es Milo y nadie más: el interruptor
          prueba/producción es un control de DEVELOPMENT y a Berni y Alex no les
          dice nada. Mira `rol` y NO `acceso_total` porque los tres lo tienen en
          `true` — son dos casillas distintas: `rol` dice qué hace la persona
          (comisiones, desplegables de la venta) y `acceso_total` a qué puertas
          entra. `cambiarModoContrato` sigue exigiendo `acceso_total` a
          propósito: este es el ÚNICO render del componente, así que sin él no
          queda ningún camino de UI y endurecer la action no esconde nada más.
          Lo que se resigna: Berni y Alex pierden el único clic que cambiaba el
          modo, y si queda en prueba hace falta Milo para sacarlo. */}
      {u.rol === "admin" && <ModoContrato modo={modo} emailPrueba={emailPrueba} />}

      {filas.length === 0 ? (
        // 🔴 "Esta lista está vacía" y NO "no se ha registrado ninguna venta".
        // La diferencia no es de estilo: `getContratos()` pide columnas de la
        // 0065 y, mientras esa migración no esté aplicada, PostgREST contesta
        // 400 a la petición entera, `rest()` no lanza nunca y esto llega vacío
        // CON TRES CONTRATOS REALES DENTRO (lib/data.ts lo documenta). Una
        // pantalla que en ese caso afirma "no hay ninguna venta" está mintiendo
        // con toda la seguridad del mundo, y la salida natural de quien lo lee
        // es volver a generar algo que ya existe. La frase que había antes de
        // esta tarea dejaba el resquicio ("...ninguna con el envío activo") y
        // al reescribirla se lo quité: esto lo devuelve.
        <p className="hint" style={{ padding: "24px 0" }}>
          Los contratos se generan al registrar una venta nueva o una ascensión, y los de venta
          nueva se mandan al cliente desde aquí o desde el modal de la venta. Esta lista está
          vacía: o no se ha registrado ninguna todavía, o no está llegando. Si esperabas ver
          alguno, pregunta antes de volver a generarlo.
        </p>
      ) : (
        <div className="tabla-scroll">
          <table className="t">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Programa</th>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Contrato</th>
              </tr>
            </thead>
            {/* Un `<tbody>` REAL por cliente, no un `Fragment`: el hover de
                grupo de más abajo (globals.css, `tbody:has(...)`) necesita un
                padre de verdad para cada grupo — HTML permite varios `tbody`
                en una misma tabla. */}
            {Array.from(grupos.values()).map((contratosDelCliente) => (
              <tbody key={contratosDelCliente[0].id}>
                {contratosDelCliente.map((c, i) => {
                  // Una sola vez por fila, y decide las dos cosas: la clase que
                  // reserva el sitio en la celda y la cinta que va dentro. Sin
                  // `pdf_path` no hay documento que esté viejo ni corregido, así
                  // que tampoco hay nada que reservar.
                  // El cuarto argumento es `texto_editado_at` (0065): sin él,
                  // la cinta "editado a mano" —la que avisa de que recorregir
                  // pisaría lo que escribió una persona— no se pintaba nunca,
                  // aunque `cintaContrato` supiera decidirla desde la Task 17.
                  const cinta = cintaDeFila(c.pdf_path, c.recorregido_at, c.desactualizado_at, c.texto_editado_at);
                  // Firmado = hay un SEGUNDO PDF, el que lleva la firma. A
                  // partir de ese momento es el documento que vale, así que es
                  // el que abren "Ver" y "Descargar"; el sin firmar sigue
                  // guardado y servido por la misma ruta sin `?firmado=1`.
                  const firmado = !!c.pdf_firmado_path;
                  // Editar y mandar al cliente, solo sobre la plantilla nueva y
                  // mientras no esté firmado. Las dos condiciones se calculan
                  // acá —y no dentro de cada botón— porque de ellas depende
                  // también el " · " que los separa: sin esto, una fila firmada
                  // se quedaba con dos separadores sueltos flotando.
                  const puedeTocar = c.tipo === "venta_nueva_v2" && !c.firmado_at;
                  // 🔴 ESPEJO de `bloqueoRecorregir()` (lib/contrato-guardas.ts).
                  // Si el servidor dice que no y el botón dice que sí, el closer
                  // se come el peor de los dos mundos: el paso 1 (editarBonos)
                  // escribe de verdad y el paso 2 se rechaza — la trampa que
                  // documenta el comentario de más abajo desde el 9-sep.
                  //
                  // La condición del TIPO se importa (`plantillaRegenerable`) en
                  // vez de copiarse: aquí había una lista NEGRA
                  // (`tipo !== "venta_nueva_v2"`) contra la lista BLANCA del
                  // servidor, y decían lo mismo solo por accidente.
                  //
                  // Las otras dos son copias a mano, y DIVERGEN A PROPÓSITO:
                  //  · `!c.texto_editado_at` — el servidor compara
                  //    `texto_final !== texto_generado`, así que quien edite y
                  //    deshaga hasta el original tendría el botón apagado con el
                  //    servidor diciendo que sí. Más estricto, y para un botón
                  //    esa es la dirección correcta: mejor que alguien pregunte
                  //    por qué no puede, a que descubra que sí podía. Traer el
                  //    criterio exacto costaría `texto_generado` + `texto_final`
                  //    (~12 KB por fila) en una pantalla que las lista todas.
                  //  · la cuarta guarda del servidor, "el cliente tiene el enlace
                  //    en pie", no se copia: solo puede darse en una fila v2, que
                  //    `plantillaRegenerable` ya deja fuera.
                  const puedeRecorregir =
                    !!c.pdf_path && u.acceso_total && plantillaRegenerable(c.tipo) && !c.firmado_at && !c.texto_editado_at;
                  return (
                  <tr key={c.id} className={cinta ? "fila-con-cinta" : undefined}>
                    {i === 0 && (
                      <td className="cliente-grupo" rowSpan={contratosDelCliente.length}>
                        {c.personas?.nombre ?? "—"}
                      </td>
                    )}
                    <td><TagTipo tipo={c.tipo} /></td>
                    <td>{c.programas?.monto ? money(Number(c.programas.monto)) : "—"}</td>
                    <td>{dateEs(c.fecha_firma ?? c.created_at)}</td>
                    <td><EstadoContrato c={c} /></td>
                    <td>
                      {c.pdf_path ? (
                        <>
                          {/* "Ver" abre una vista previa en el propio OS (modal
                              + iframe, misma ruta y sesión); ?descargar=1 sigue
                              forzando la descarga. */}
                          <ContratoPreview id={c.id} firmado={firmado} />
                          {" · "}
                          <Link href={`/api/contratos/${c.id}?descargar=1${firmado ? "&firmado=1" : ""}`}>
                            {firmado ? "Descargar firmado" : "Descargar"}
                          </Link>
                          {/* El ciclo con el cliente, en el orden en que se
                              usa: primero se lee y se corrige, después se
                              manda. Van ANTES de "Reenviar al equipo" y
                              "Recorregir" porque son lo que se hace todos los
                              días; aquellos dos son para arreglar algo. */}
                          {puedeTocar && (
                            <>
                              {" · "}
                              <EditarContrato id={c.id} />
                              {" · "}
                              <EnviarAlCliente
                                id={c.id}
                                email={c.personas?.email ?? null}
                                yaEnviado={!!c.enviado_cliente_at}
                              />
                            </>
                          )}
                          {" · "}
                          {/* 🔴 LA REGLA DE ESTA CELDA, que tuvo dos versiones y
                              conviene no volver a cambiar sin leer esto:
                              un botón que no se puede pulsar AHORA y podrá
                              pulsarse luego se pinta apagado; uno que no se
                              podrá pulsar nunca no se pinta.

                              "Reenviar al equipo" es el único del primer grupo:
                              lo apaga el `estado` del envío, que se mueve solo
                              (`pendiente` pasa a `enviado` en cuanto Resend
                              acepta), así que el atenuado informa.

                              "Recorregir", "Editar" y "Enviar al cliente" son
                              del segundo, y los tres se esconden. Lo que los
                              apaga —de qué plantilla salió el documento, si
                              está firmado— no cambia nunca. Dejarlos atenuados
                              era un enlace dorado al 50% de opacidad en cada
                              fila, para siempre, y en el 100% de las filas que
                              genere el camino nuevo; esta pantalla ya tiene un
                              historial de contraste escrito en globals.css:540.
                              Cada componente se esconde él mismo; la fila solo
                              decide el " · ", que es suyo y no del botón. */}
                          {/* acceso_total además del estado: reenviarContratoAction
                              ya lo exige desde el 8-sep, así que sin esto un closer
                              veía el botón activo y el rechazo recién al clickear. */}
                          <ReenviarContrato
                            id={c.id}
                            puedeReenviar={
                              (c.estado === "error_envio" || c.estado === "pendiente") && u.acceso_total
                            }
                            destinos={destinosVisibles}
                          />
                          {/* acceso_total, no solo pdf_path: recorregirContratoAction ya
                              lo exige, pero el paso previo (editarBonos) NO — sin este
                              chequeo acá, un closer sin acceso_total podía corregir los
                              bonos de verdad (paso 1, éxito) y quedarse con el paso 2
                              rechazado, dejando la venta con bonos nuevos y el contrato
                              viejo sin regenerar. Encontrado en revisión, 9-sep-2026.
                              El criterio entero, y por qué diverge del servidor en dos
                              puntos, está arriba junto a `puedeRecorregir`. */}
                          {puedeRecorregir && (
                            <>
                              {" · "}
                              <RecorregirContrato
                                id={c.id}
                                puedeRecorregir={puedeRecorregir}
                                personaId={c.persona_id}
                                programaId={c.programa_id}
                                mesesTier={c.programas?.tiers?.meses_default ?? null}
                                bonos={c.programas?.bonos ?? null}
                                destinos={destinosVisibles}
                              />
                            </>
                          )}
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
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
