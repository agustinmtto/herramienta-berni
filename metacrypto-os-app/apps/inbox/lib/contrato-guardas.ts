// Ruta RELATIVA y sin `server-only`, a propósito: este fichero tiene tests y
// bajo vitest el alias `@/` no resuelve en runtime (misma disciplina que
// `contrato-pdf.ts:2-5` y `contrato-texto.ts`). `contrato-firma.ts` cumple la
// misma regla, así que se puede importar de verdad y no solo como tipo.
import { estadoDelEnlace, type FilaEnlace } from "./contrato-firma";

// ============================================================
// Cuándo NO se recorrige un contrato.
//
// `recorregirContrato` (contrato-envio.ts) regenera el PDF desde los datos
// ACTUALES de la venta y PISA el mismo `${programa_id}.pdf`. Eso era inofensivo
// mientras el contrato solo viajaba al equipo por correo: el peor caso era un
// adjunto repetido. Desde que el cliente lo lee y lo firma en el OS, esa misma
// escritura puede destrozar tres cosas distintas, y esta función es la que dice
// cuál — con el mensaje que el closer necesita leer en mitad de una venta.
//
// Vive aparte de `contrato-envio.ts` por la razón de siempre en este módulo:
// aquel fichero lleva `server-only` e importa con `@/`, así que no se puede ni
// cargar bajo vitest. Metida allí, la única barrera que impide rehacer un
// documento ya firmado no tendría un solo test. Aquí sí los tiene.
//
// DECIDE, NO ACTÚA: devolver un motivo es todo lo que hace. Quien llama no ha
// tocado nada todavía —ni Storage, ni la fila, ni el correo—, que es justo lo
// que convierte esto en una guarda y no en un aviso a toro pasado.
//
// 🔴 LOS MENSAJES DAN POR HECHO QUIÉN LLAMA. El único camino hasta aquí es el
// modal de bonos (`components/RecorregirContrato.tsx` →
// `recorregirContratoAction`), que GUARDA LOS BONOS ANTES de llamar: cuando
// esto dice que no, el cambio de bonos ya está hecho y el contrato ya quedó
// marcado `desactualizado_at`. Por eso los textos lo dan por sabido. Si algún
// día recorregir se llama desde otro sitio, hay que releerlos.
// ============================================================

export type FilaRecorregir = FilaEnlace & {
  tipo: string | null;
  estado: string | null;
  texto_generado: string | null;
  texto_final: string | null;
};

/**
 * Las plantillas que `recorregirContrato` sabe rehacer desde los datos.
 *
 * LISTA BLANCA, y se exporta para que no exista una segunda copia: la pestaña
 * /contratos apaga su botón «Recorregir» con este mismo criterio, y hasta el
 * 16-sep lo hacía con una lista NEGRA propia (`tipo !== "venta_nueva_v2"`).
 * Las dos decían lo mismo por accidente —el universo de `tipo` son cuatro
 * valores— y habrían dejado de decirlo el día que existiera un `ampliacion_v2`:
 * el servidor rechazando y la pantalla enseñando el botón encendido. Un botón
 * que miente, debajo de un comentario que jura ser un espejo.
 *
 * `null` = fila histórica sin tipo, que es v1.
 *
 * 🔴 NO SIRVE para decidir "¿esto se firma en el OS?", que es la otra pregunta
 * que se hace sobre `tipo`. Hoy son complementos exactos, pero un
 * `ampliacion_v2` sería "no regenerable" (cierto) y a la vez "no firmable
 * todavía" (el servidor lo rechaza en contrato-envio.ts y contrato-firma-datos.ts),
 * así que reusar esto allí fabricaría el mismo botón mentiroso al revés. Esa
 * pregunta necesita su propio predicado.
 */
export function plantillaRegenerable(tipo: string | null | undefined): boolean {
  return tipo == null || tipo === "venta_nueva" || tipo === "ampliacion";
}

export type BloqueoRecorregir = {
  /** Cuál de las cuatro paró. El código lo usa; el closer lee `error`. */
  motivo: "firmado" | "editado" | "enlace_vivo" | "plantilla_nueva";
  error: string;
};

/**
 * `null` = adelante. Cualquier otra cosa = el motivo y el mensaje.
 *
 * EL ORDEN ES LA ESPECIFICACIÓN, porque varias pueden ser ciertas a la vez y
 * el closer solo lee una:
 *
 *   1. firmado         — si está firmado, lo demás da igual. Es un documento
 *                        cerrado; rehacerlo es rehacer una firma.
 *   2. editado         — regenerar desde los datos borraría el texto que
 *                        escribió una persona, que es lo único que la plantilla
 *                        no sabe reproducir. Va antes que el enlace porque
 *                        explica mejor qué se perdería (misma precedencia que
 *                        la cinta de `cintaContrato`: editado gana a
 *                        recorregido) — y cuando además hay enlace vivo, lo
 *                        dice en el mismo mensaje en vez de callárselo.
 *   3. enlace_vivo     — el cliente tiene el documento delante AHORA.
 *   4. plantilla_nueva — todo lo que no sea una plantilla v1, que es lo único
 *                        que este camino sabe regenerar.
 *
 * 🔴 TODO ESTO ES INERTE PARA v1 (`venta_nueva` y `ampliacion`), y tiene que
 * seguir siéndolo: hay contratos emitidos que se recorrigen por ese camino y su
 * comportamiento no puede cambiar. No hace falta gatear las tres primeras por
 * `tipo` para conseguirlo — ninguna puede dispararse en una fila v1 viva,
 * porque las columnas que miran solo las escribe el ciclo de la v2:
 *   · `firmado_at` / `estado='firmado'`  los pone `firmarContrato`, que rechaza
 *                           todo lo que no sea v2.
 *   · `texto_final`         nace igual a `texto_generado` y solo lo mueve
 *                           `guardarTextoYRegenerar`, que también rechaza lo que no sea v2.
 *   · `enviado_cliente_at`  lo pone `enviarContratoAlCliente`, que exige v2.
 * Se dejan sin gatear a propósito: si alguna de esas columnas apareciera algún
 * día en una fila v1, negarse sigue siendo la respuesta correcta.
 */
export function bloqueoRecorregir(f: FilaRecorregir, ahora: Date): BloqueoRecorregir | null {
  // `!= null` y no una comprobación de verdad ("truthy"), igual que en
  // `estadoDelEnlace`: el tipo admite `firmado_at: ""` y con `if (f.firmado_at)`
  // ese caso se colaría hasta el `return null` del final — justo el documento
  // que esta guarda existe para no volver a escribir.
  //
  // Y se miran LOS DOS, como hace `contrato-estado.ts:125`, que es quien pinta
  // "Firmado" en la pestaña: `estado = 'firmado'` existe en la CHECK desde la
  // 0004 y hasta la 0065 no lo escribía nadie, así que una fila histórica puede
  // decir que está firmada sin tener fecha. Si una pantalla la enseña firmada,
  // esta función no puede regenerarla — que las dos discrepen sobre qué es un
  // contrato firmado es peor que cualquiera de las dos respuestas.
  if (f.firmado_at != null || f.estado === "firmado") {
    return {
      motivo: "firmado",
      error:
        "Este contrato ya está firmado por el cliente: no se puede regenerar. " +
        "Si los bonos han cambiado después de la firma, hace falta una adenda.",
    };
  }

  // "Editado" es respecto de lo que produjo la plantilla, no de lo que había
  // guardado — mismo criterio que `texto_editado_at` en `guardarTextoYRegenerar`:
  // si alguien deshizo sus cambios y volvió al original, nadie editó nada.
  //
  // Falla hacia el lado seguro: un `texto_final` con `texto_generado` en null
  // cuenta como editado. No se puede demostrar que salió de la plantilla, y
  // negarse no rompe nada (el texto sigue ahí, editable), mientras que
  // regenerar sí borraría lo que hubiera.
  if (f.texto_final !== null && f.texto_final !== f.texto_generado) {
    // Las dos cosas a la vez son el caso normal —un contrato que se retocó y se
    // mandó—, y el motivo que gana es el que menos dice de los dos. Se funde la
    // información en vez de reordenar las guardas: el closer tiene que saber
    // que lo que edite hay que reenviárselo al cliente, o lo dejará a medias.
    const vivo = estadoDelEnlace(f, ahora) === "listo";
    return {
      motivo: "editado",
      error:
        "Este contrato se editó a mano: regenerarlo desde los datos se llevaría por delante esa edición. " +
        "Cámbialo desde «Editar»." +
        (vivo
          ? " Y el cliente ya tiene su enlace de firma en pie: cuando lo cambies, habrá que volver a enviárselo."
          : ""),
    };
  }

  // La condición de "enlace vivo" NO se reescribe aquí: `estadoDelEnlace` ya
  // la tiene (enviado, con caducidad válida, vigente y sin firmar) y es total.
  // Su rama "firmado" no llega nunca a este punto — la guarda 1 se la comió—,
  // y eso está bien: si `firmado_at` estuviera puesto, ya habríamos parado.
  if (estadoDelEnlace(f, ahora) === "listo") {
    return {
      motivo: "enlace_vivo",
      error:
        "El cliente tiene ahora mismo su enlace de firma en pie: al regenerar, el documento le cambiaría " +
        "por debajo y el enlace dejaría de valer sin avisarle. Cámbialo desde «Editar» y vuelve a enviarle el enlace.",
    };
  }

  // 🔴 La cuarta, que no estaba en el brief y no es de seguridad sino de
  // honestidad: `recorregirContrato` elige la plantilla con un ternario
  // (`tipo === "ampliacion" ? "ampliacion" : "venta_nueva"`), así que cualquier
  // fila que no sea de las dos v1 saldría de ahí con el documento de la
  // plantilla ANTERIOR, pisando el PDF bueno y dejando `texto_final` diciendo
  // otra cosa que el fichero. Y ese desfase no lo caza ninguna guarda
  // posterior: si el enlace se manda DESPUÉS, `hash_enviado` se calcula sobre
  // el PDF ya estropeado, cuadra, y el cliente firma un documento que no es el
  // que leyó — porque `firmarContrato` vuelve a renderizar desde `texto_final`.
  //
  // LISTA BLANCA, no lista negra, y por eso no dice `=== "venta_nueva_v2"`: el
  // ternario al que protege también es permisivo (todo lo que no sea
  // "ampliacion" sale como "venta_nueva"), así que nombrar solo la v2 dejaría
  // la misma cadena reabierta, y en silencio, el día que alguien añada un
  // `ampliacion_v2`. Es inerte hoy: la CHECK `contratos_tipo_check` de la 0065
  // solo admite null, 'venta_nueva', 'ampliacion' y 'venta_nueva_v2'. El
  // `!= null` deja pasar las filas históricas sin tipo, que son v1.
  //
  // La condición vive en `plantillaRegenerable()` (arriba) y NO aquí, desde el
  // 16-sep: la pestaña /contratos apaga su botón con el mismo criterio y tenía
  // su propia copia, escrita como lista negra. Dos copias de una lista blanca
  // es una lista blanca y media.
  //
  // Hoy ni siquiera hay filas v2 (`tipoContratoDe` todavía devuelve
  // "venta_nueva": lo cambia la Task 22). QUIEN ENCIENDA ESA TAREA tiene aquí
  // lo que falta para que la v2 se pueda recorregir de verdad: pasar el tipo
  // real a `construirContratoPDF` (que ya lo admite), guardar `texto_generado`/
  // `texto_final` con `compactarHuecos` como hace `generarContrato`, y
  // refrescar `datos_bloque`. Los tres, o se produce la corrupción inversa (el
  // PDF nuevo y el texto viejo). Mientras tanto se dice que no, que es lo único
  // reversible.
  if (!plantillaRegenerable(f.tipo)) {
    return {
      motivo: "plantilla_nueva",
      error:
        "Este contrato es de la plantilla nueva y todavía no se regenera desde los datos: " +
        "saldría con la plantilla anterior. Los bonos ya han quedado guardados y el contrato está " +
        "marcado como desactualizado; para que el documento los recoja, ábrelo en «Editar» y corrige " +
        "el texto a mano.",
    };
  }

  return null;
}
