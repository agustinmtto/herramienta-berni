"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Modal from "@/components/Modal";
import { enviarContratoAlClienteAction, guardarTextoContratoAction } from "@/app/actions";
import { IconoAlerta, IconoCheck } from "@/components/Iconos";
import { LARGO_MAX, LARGO_MIN, normalizarTexto, problemaDelTexto } from "@/lib/contrato-texto";
import { num } from "@/lib/format";

// ============================================================
// La previsualización "como un Word" (spec 2026-09-15, decisión 4).
//
// A la izquierda el texto del contrato con los datos YA metidos; a la derecha
// el PDF, que se regenera desde ese texto. El bloque de firma no está en el
// editor: lo pone el sistema al renderizar, y por eso nadie puede borrar sin
// querer la línea donde firma el cliente. Lo que se manda es lo que queda aquí.
//
// 🔴 EL CLOSER ESTÁ EN MEDIO DE UNA VENTA, PROBABLEMENTE CON EL CLIENTE AL
// TELÉFONO. Todo lo raro de este componente sale de esa frase:
//
//   1. Nada cierra sin guardar. `cerrar()` guarda primero (la spec lo pide
//      así: "Cerrar guarda lo editado y deja el contrato en pendiente") y solo
//      cierra si el guardado salió bien. Si falla, el modal se queda abierto
//      con el texto intacto. La única salida que pierde algo la confirma él.
//   2. Ningún error vacía el textarea. `texto` solo cambia cuando él teclea.
//   3. Lo que no se va a poder guardar se dice ANTES de que escriba cinco
//      minutos, no después: `problemaDelTexto` —la MISMA función que usa el
//      servidor para decidir— corre aquí en cada tecla.
//   4. `beforeunload` mientras haya cambios sin guardar, por si cierra la
//      pestaña en vez del modal.
//
// 🔴 EL BOTÓN SE LLAMA "GUARDAR Y ACTUALIZAR LA VISTA PREVIA" PORQUE ES LO QUE
// HACE. No hay forma de refrescar el PDF sin guardar: lo dibuja pdfkit en el
// servidor a partir de `texto_final`, así que para verlo con el texto nuevo hay
// que haberlo escrito antes. Se llamaba "Actualizar vista previa" y guardaba de
// tapadillo; Milo lo cortó el 16-sep, y tiene razón: una sorpresa en una
// pantalla donde alguien está a mitad de una venta es cara.
//
// La limitación se acepta con su deuda anotada (informe de la Task 15): el
// arreglo de verdad es una ruta que renderice el PDF sin persistirlo, y no se
// estrena una ruta nueva en una pantalla que nadie ha visto todavía.
//
// El precio de que guardar sea el único camino es que no había marcha atrás.
// Por eso existe "Volver al texto original": `texto_generado` está en la fila,
// así que deshacer es gratis y el closer tiene salida si se arrepiente.
// ============================================================

/**
 * Un aviso al pie. Tres tonos y no dos: "espera" no es un éxito (verde
 * mintiendo) ni un fallo (rojo asustando). Nació para lo que dice el modal
 * cuando alguien intenta cerrarlo a mitad de un guardado.
 */
type Aviso = { tono: "ok" | "error" | "espera"; texto: string };

export default function EditorContrato({
  contratoId,
  textoInicial,
  textoGenerado,
  emailCliente,
  yaEnviado,
  editable = true,
  onCerrar,
}: {
  contratoId: string;
  textoInicial: string;
  /** Lo que produjo la plantilla. Si `texto` difiere, el contrato está editado a mano. */
  textoGenerado: string;
  emailCliente: string | null;
  yaEnviado: boolean;
  /**
   * `false` = plantilla v1: se lee, no se guarda ni se manda.
   *
   * 🔴 El componente NO PUEDE AVERIGUARLO SOLO, y por eso es una prop: no
   * recibe `contratos.tipo` por ningún otro sitio, y la única forma de
   * preguntárselo al servidor sería intentar un guardado — que en una carrera
   * pisaría la edición de otra persona. Así que lo dice quien abre el modal,
   * que sí lo tiene delante. Los dos lo tienen:
   *
   *   · `EditarContrato` (pestaña /contratos) solo pinta el botón cuando
   *     `c.tipo === "venta_nueva_v2"`, así que el `true` por defecto es
   *     correcto ahí y no tiene que pasar nada.
   *   · `VentaForm` lo pasa desde el 16-sep (Task 16): `generarContrato`
   *     devuelve el `tipo` de la fila y el formulario monta esto con
   *     `editable={contrato.tipo === "venta_nueva_v2"}`. Hoy le sale `false`
   *     siempre — en compra nueva porque `tipoContratoDe("nueva")` todavía
   *     devuelve "venta_nueva" hasta la Task 22, y en ascensión porque una
   *     `ampliacion` no se firma en el OS y no lo hará por ese camino.
   *
   * El defecto es `true` porque el caso normal —y el único que existe cuando
   * esto esté encendido de verdad— es un contrato v2 editable.
   */
  editable?: boolean;
  onCerrar: () => void;
}) {
  // Para devolverle el foco cuando "Volver al texto original" se desmonta a sí
  // mismo. Ver `deshacer()`.
  const area = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState(textoInicial);
  // El texto que produjo el PDF que se está viendo a la derecha.
  const [guardado, setGuardado] = useState(textoInicial);
  // Cambia el `key` del iframe y lo obliga a recargar. Ver el iframe.
  const [version, setVersion] = useState(0);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [enviado, setEnviado] = useState(yaEnviado);
  // Se pone cuando un guardado falla por algo que no depende del texto (red,
  // permiso, el contrato firmado por debajo). Sirve para que "Cerrar" no
  // encierre a nadie reintentando un guardado que no va a salir: a la segunda
  // pregunta si cerrar perdiendo los cambios. Se limpia al teclear.
  const [noSeGuarda, setNoSeGuarda] = useState(false);
  // Alguien ya intentó cerrar mientras se guardaba. Ver `cerrar()`.
  const [insistio, setInsistio] = useState(false);
  const [pending, start] = useTransition();

  // Se compara SIEMPRE normalizado, con la misma función que usa el servidor:
  // un salto de línea al final no es un cambio para él y no debe serlo aquí
  // tampoco, o "Cerrar" mandaría a guardar un texto idéntico.
  //
  // Los dos de referencia van memoizados porque no cambian con las teclas y
  // aquí se re-renderiza en cada una: son ~9.000 caracteres cada uno.
  const limpio = normalizarTexto(texto);
  const refGuardado = useMemo(() => normalizarTexto(guardado), [guardado]);
  const refGenerado = useMemo(() => normalizarTexto(textoGenerado), [textoGenerado]);
  const sucio = limpio !== refGuardado;
  const editadoAMano = limpio !== refGenerado;

  // La MISMA validación que el servidor, corriendo en cada tecla. No es una
  // copia: es `lib/contrato-texto.ts`, el módulo puro que se escribió sin
  // importaciones justamente para poder usarse a los dos lados.
  const problema = editable ? problemaDelTexto(limpio) : null;
  const llaves = problema !== null && limpio.includes("{{");

  // Se puede intentar guardar. Si no, ni se pinta el botón: un botón apagado
  // que nunca se va a poder pulsar es peor que no tenerlo (y en este repo ya
  // hubo uno atenuado por dos hojas a la vez que acabó en 2,08:1).
  const sePuedeGuardar = editable && problema === null;

  // En cuanto el servidor contesta, la insistencia caduca: el próximo intento
  // de cerrar vuelve a ser un intento normal y no hereda el susto del anterior.
  useEffect(() => {
    if (!pending) setInsistio(false);
  }, [pending]);

  // Aviso del navegador si cierra la pestaña con cambios sin guardar. Es la
  // única pérdida que este componente no puede evitar por su cuenta.
  useEffect(() => {
    if (!sucio) return;
    const alSalir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [sucio]);

  function fd(extra: Record<string, string> = {}) {
    const f = new FormData();
    f.set("contrato_id", contratoId);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  function alTeclear(v: string) {
    setTexto(v);
    setNoSeGuarda(false);
    // El aviso viejo habla del texto anterior. Dejarlo puesto mientras se
    // teclea es decirle "guardado" a algo que ya no lo está.
    setAviso(null);
  }

  /**
   * Guarda y regenera. Devuelve si salió bien, para que `enviar()` pueda
   * encadenar y `cerrar()` pueda decidir si cierra.
   *
   * `texto` se captura en la llamada: si el closer sigue tecleando mientras el
   * servidor trabaja, lo que queda marcado como "guardado" es lo que se mandó,
   * no lo que hay ahora en pantalla — y `sucio` vuelve a ser verdad solo.
   */
  async function guardar(textoAGuardar: string): Promise<boolean> {
    const r = await guardarTextoContratoAction(fd({ texto: textoAGuardar }));
    if (!r.ok) {
      setNoSeGuarda(true);
      setAviso({ tono: "error", texto: r.error });
      return false;
    }
    setNoSeGuarda(false);
    setGuardado(textoAGuardar);
    setVersion((v) => v + 1);
    setAviso({
      tono: "ok",
      texto: r.requiereReenvio
        ? "Vista previa actualizada. El contrato cambió, así que el enlace que el cliente ya tiene dejó de valer: dale a «Reenviar al cliente» para mandarle el nuevo."
        : "Vista previa actualizada.",
    });
    return true;
  }

  function actualizar() {
    setAviso(null);
    const t = texto;
    start(async () => {
      await guardar(t);
    });
  }

  /**
   * Volver al texto que produjo la plantilla.
   *
   * Solo toca el textarea: NO guarda. Es una edición como cualquier otra y
   * pasa por la misma puerta que todas —el botón de guardar—, que es la única
   * que sabe advertir de lo que guardar cuesta (el enlace del cliente). Un
   * botón que además escribiera en la base sería un segundo camino de
   * escritura con sus propias advertencias que mantener.
   *
   * Confirma antes porque deshacer sin querer hace el mismo daño que perder el
   * texto, que es justo lo que este componente entero intenta que no pase.
   */
  function deshacer() {
    if (!confirm(DESCARTAR_CORRECCIONES)) return;
    alTeclear(textoGenerado);
    // 🔴 Este botón SE DESMONTA A SÍ MISMO: al volver el texto al original,
    // `editadoAMano` pasa a false y deja de pintarse — con el foco dentro. El
    // foco cae al <body>, y la trampa de Tab de `Modal` se orienta por
    // `document.activeElement`: desde el <body> no entra por ninguna de sus
    // dos ramas y el siguiente Tab se escapa del diálogo, a la página de
    // detrás, que está tapada por el overlay pero sigue siendo pulsable.
    // Al textarea, que además es donde el closer quiere estar.
    area.current?.focus();
  }

  function enviar() {
    if (!emailCliente) {
      setAviso({ tono: "error", texto: SIN_EMAIL });
      return;
    }
    const que = editadoAMano ? "un contrato EDITADO A MANO" : "el contrato";
    const extra =
      (sucio ? "\n\nAntes se guarda el texto tal y como está ahora." : "") +
      (enviado ? "\n\nEl enlace anterior dejará de valer." : "");
    if (!confirm(`¿Mandar ${que} a ${emailCliente}?${extra}`)) return;
    setAviso(null);
    const t = texto;
    start(async () => {
      // Guardar primero, siempre: lo que se manda es el PDF que hay en
      // Storage, y ese solo se regenera al guardar. Sin esto, editar y darle
      // directamente a "Enviar" le mandaría al cliente el texto de antes.
      if (sucio && !(await guardar(t))) return;
      const r = await enviarContratoAlClienteAction(fd());
      if (!r.ok) {
        setAviso({ tono: "error", texto: r.error });
        return;
      }
      setEnviado(true);
      setAviso({
        tono: "ok",
        texto: r.enPrueba
          ? `MODO PRUEBA: fue a ${r.destino}, no al cliente.`
          : `Enviado a ${r.destino}. El cliente ya puede abrirlo y firmarlo.`,
      });
    });
  }

  /**
   * Cerrar guarda (spec: "Cerrar guarda lo editado y deja el contrato en
   * pendiente, recuperable desde la pestaña"), y por eso puede NO cerrar:
   *
   *   · si el guardado falla, el modal se queda abierto con el texto intacto;
   *   · si el guardado avisa de que hay que reenviar, tampoco cierra a la
   *     primera — ese mensaje es lo único que separa a un cliente con un
   *     enlace muerto de un cliente al que se le reenvía. Como al volver ya no
   *     hay cambios pendientes, el segundo intento cierra sin más.
   *
   * Es la misma función que recibe `Modal`, así que el Escape y la ✕ hacen
   * exactamente esto y no hay una tercera puerta por la que perder el texto.
   */
  function cerrar() {
    // 🔴 A media escritura en el servidor no se cierra —el resultado del
    // guardado en curso no tendría dónde verse—, pero NEGARSE EN SILENCIO ES
    // UNA PANTALLA SIN SALIDA. Esto era un `return` mudo: si la acción se
    // colgaba, Escape no hacía nada, la ✕ no hacía nada, `Modal` tenía el
    // scroll del fondo congelado, y nadie decía por qué. El `aria-busy` y el
    // `cursor: progress` no le llegan a quien está aporreando Escape.
    //
    // Así que la primera vez se explica, y la segunda se deja salir: lo que no
    // puede pasar es que una petición colgada secuestre la pantalla. Cerrar
    // así no cancela nada —la petición sigue viva y puede llegar a guardar—, y
    // por eso el texto de la confirmación no promete que no se guardó: dice
    // que no se va a saber.
    if (pending) {
      if (!insistio) {
        setInsistio(true);
        setAviso({ tono: "espera", texto: "Guardando, espera un momento." });
        return;
      }
      if (!confirm(CERRAR_MIENTRAS_GUARDA)) return;
      onCerrar();
      return;
    }
    if (!sucio) {
      onCerrar();
      return;
    }
    if (!sePuedeGuardar || noSeGuarda) {
      if (!confirm(PERDER_CAMBIOS)) return;
      onCerrar();
      return;
    }
    const t = texto;
    // `enviado` leído AQUÍ es el estado de antes del guardado: si el contrato
    // ya había salido, este guardado acaba de matar el enlace del cliente y el
    // aviso que `guardar` deja puesto es lo único que lo dice. No se cierra
    // encima de él; al volver a pulsar ya no hay cambios y cierra directo.
    const habraQueReenviar = enviado;
    start(async () => {
      if (!(await guardar(t))) return;
      if (habraQueReenviar) return;
      onCerrar();
    });
  }

  const pdfSrc = `/api/contratos/${contratoId}?v=${version}`;

  return (
    <Modal
      titulo="Contrato"
      subtitulo={
        <>
          {editadoAMano ? "Editado a mano" : "Tal como lo genera la plantilla"}
          {enviado && " · ya enviado al cliente"}
        </>
      }
      ancho="grande"
      /* Aquí se teclea un documento legal: un clic fuera no puede ser la
         forma de salir. Escape y ✕ pasan por `cerrar()`, que guarda. */
      cerrarAlPulsarFuera={false}
      onCerrar={cerrar}
    >
      {!editable && (
        <p className="note editor-contrato-nota">
          Este contrato es de la plantilla anterior: aquí solo se puede leer. No se edita ni se firma
          en el OS — para ese camino sigue GoHighLevel, como hasta ahora.
        </p>
      )}
      {editable && enviado && (
        <p className="note editor-contrato-nota">
          Este contrato ya está en manos del cliente. Si cambias el texto, el enlace que tiene deja
          de valer y hay que volver a enviárselo.
        </p>
      )}
      {editable && !emailCliente && (
        <p className="note editor-contrato-nota">{SIN_EMAIL}</p>
      )}

      <div className="editor-contrato">
        <textarea
          ref={area}
          className="editor-contrato-texto"
          value={texto}
          onChange={(e) => alTeclear(e.target.value)}
          readOnly={!editable}
          spellCheck
          aria-label="Texto del contrato"
          /* Condicionado igual que el elemento que describe: el segundo
             párrafo del pie solo se monta si `editable`, así que en un
             contrato v1 este atributo apuntaba a un id que no está en el DOM.
             Los lectores de pantalla lo ignoran —es inofensivo— pero una
             referencia rota es una referencia rota. */
          aria-describedby={
            editable ? "editor-contrato-pie editor-contrato-pie-2" : "editor-contrato-pie"
          }
        />
        <div className="editor-contrato-col">
          {/* Encima del visor y no debajo, por el mismo motivo que en la
              página del cliente: si el navegador no pinta PDF dentro de un
              iframe, lo único que queda es este enlace y tiene que verse. */}
          <a
            className="editor-contrato-abrir"
            href={pdfSrc}
            target="_blank"
            rel="noreferrer noopener"
          >
            Abrir el PDF en una pestaña
          </a>
          {/* `key` y no solo `src`: cambiar el `src` de un iframe vivo deja una
              entrada en el historial del navegador, y al cabo de cuatro
              retoques el botón «atrás» del OS recorre versiones del PDF en vez
              de salir de la pantalla. Un iframe recién montado carga sin
              apuntar nada en el historial. */}
          <iframe
            key={version}
            className="editor-contrato-pdf"
            src={pdfSrc}
            title="Vista previa del contrato"
          />
        </div>
      </div>

      <p className="hint editor-contrato-pie" id="editor-contrato-pie">
        Las líneas que empiezan por <code>###</code> son títulos de cláusula. El bloque de firma lo
        añade el sistema y no se edita aquí.
      </p>
      {/* 🔴 ESTA LÍNEA TAPA EL ÚNICO AGUJERO QUE QUEDA, Y ES AL REVÉS DE LO
          QUE PARECE. Aquí nadie pierde texto: Escape, la ✕ y "Cerrar" guardan
          los tres. El riesgo es el contrario — una tecla suelta en el textarea
          más un Escape COMPROMETEN un texto que nadie quería comprometer:
          escriben `texto_final`, estampan `texto_editado_at`, encienden la
          cinta "Editado a mano" y dejan "Recorregir" muerto en esa fila.
          Nadie lo dice en ninguna pantalla, así que lo dice esta línea.
          La segunda mitad es la que lo convierte en susto y no en daño:
          deshacer y guardar devuelve `texto_editado_at` a NULL (el servidor
          escribe null cuando el texto vuelve a coincidir con el generado) y
          con ello "Recorregir" revive. */}
      {editable && (
        <p className="hint editor-contrato-pie" id="editor-contrato-pie-2">
          Guardar rehace el PDF de la derecha, y <strong>cerrar guarda también</strong>. Nada de
          esto es definitivo: «Volver al texto original» deshace las correcciones, aquí o
          reabriendo el contrato desde la pestaña Contratos.
        </p>
      )}

      {/* La región viva se monta SIEMPRE, vacía. Un `role="status"` que
          aparece a la vez que su contenido no lo anuncia ningún lector de
          pantalla: tiene que estar en el documento antes de llenarse.
          `:empty` la esconde mientras no dice nada. */}
      <div className="editor-contrato-aviso" role="status" aria-live="polite">
        {problema && (
          <span className="mal">
            <IconoAlerta /> {problema}
            {llaves
              ? " Quita esas llaves y escribe el dato tal y como tiene que salir en el contrato."
              : ` Ahora hay ${num(limpio.length)} caracteres; el mínimo son ${num(LARGO_MIN)} y el máximo ${num(LARGO_MAX)}.`}{" "}
            Mientras siga así no se guarda ni se manda.
          </span>
        )}
        {!problema && aviso && (
          <span className={TONO[aviso.tono]}>
            {aviso.tono === "ok" && <IconoCheck />}
            {aviso.tono === "error" && <IconoAlerta />}
            {aviso.tono !== "espera" && " "}
            {aviso.texto}
          </span>
        )}
      </div>

      {/* Solo se pintan los botones que se pueden pulsar. El `disabled` que
          hay es el de "ya estoy trabajando", que dura lo que dura la llamada y
          va acompañado del cambio de texto — no una atenuación permanente. */}
      <div className="modal-actions editor-contrato-acciones" aria-busy={pending}>
        {sePuedeGuardar && (
          <button type="button" className="btn" disabled={pending} onClick={actualizar}>
            {pending ? "Guardando…" : "Guardar y actualizar la vista previa"}
          </button>
        )}
        {/* Solo cuando hay algo que deshacer. Si el texto ya es el original,
            este botón no tendría nada que hacer y no se pinta. */}
        {editable && editadoAMano && (
          <button type="button" className="btn" disabled={pending} onClick={deshacer}>
            Volver al texto original
          </button>
        )}
        {sePuedeGuardar && emailCliente && (
          <button type="button" className="btn primary" disabled={pending} onClick={enviar}>
            {pending ? "Trabajando…" : enviado ? "Reenviar al cliente" : "Enviar al cliente"}
          </button>
        )}
        <button
          type="button"
          className="btn editor-contrato-cerrar"
          disabled={pending}
          onClick={cerrar}
        >
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

/** El tono del aviso → la clase que lo pinta. Las tres viven en inbox.css. */
const TONO: Record<Aviso["tono"], string> = {
  ok: "bien",
  error: "mal",
  espera: "espera",
};

const CERRAR_MIENTRAS_GUARDA =
  "Sigue guardando. Si cierras ahora, no vas a saber si el texto quedó guardado — puedes comprobarlo abriendo el contrato desde la pestaña Contratos.\n\n¿Cerrar de todas formas?";

/** Se dice en dos sitios (la nota de arriba y el guardarraíl de `enviar`). */
const SIN_EMAIL =
  "Este cliente no tiene email en su ficha, así que el contrato no se le puede mandar. Añádeselo en su ficha y mándaselo desde la pestaña Contratos — el contrato queda guardado igual.";

const DESCARTAR_CORRECCIONES =
  "Esto descarta tus correcciones y deja el contrato tal y como lo generó la plantilla.\n\nNo se guarda todavía: para que el PDF y el contrato cambien de verdad hay que darle después a «Guardar y actualizar la vista previa».\n\n¿Volver al texto original?";

const PERDER_CAMBIOS =
  "Este texto no se puede guardar tal y como está, así que si cierras ahora pierdes los cambios.\n\n¿Cerrar de todas formas?";
