// ============================================================
// De las filas de la base a los `{{placeholders}}` del contrato.
//
// Vive separado de `contrato-envio.ts` por el mismo motivo que `email.ts` vive
// separado de `email-envio.ts`: aquí no se importa Supabase, así que esto SÍ se
// puede cargar bajo vitest y comprobar de verdad. Y es lo que hay que
// comprobar — un fallo aquí no rompe nada visiblemente: produce un contrato
// perfecto que dice un importe o una duración que no son los contratados.
//
// 🔴 LA REGLA QUE GOBIERNA TODO ESTE FICHERO: los datos salen de las filas que
// el RPC `crear_venta` acaba de escribir, NUNCA del formulario. El RPC pisa la
// duración cuando el bono está activo (0052_bono_duracion_50.sql:113): con el
// bono puesto, el formulario manda 9 y el programa queda en 14. Leer el
// formulario pondría 9 en un documento que el cliente firma.
// ============================================================

// `TipoContrato` se importa del módulo GENERADO en vez de declararse otra vez,
// para que un tipo que se añada allí (plantillas.ts) se refleje aquí sin tener
// que acordarse de tocar dos sitios — olvidarlo no daría ningún error de
// compilación y reventaría en runtime dentro de `generarContratoPDF`, que es
// el peor sitio para enterarse. La lista de tipos CON PLANTILLA GENERADA la
// manda quien tiene las plantillas.
//
// 🔴 Esto YA NO hace que `TipoContratoVenta` sea idéntico a `TipoContrato`: a
// propósito, es un superconjunto. `venta_nueva_v2` vive solo en este repo
// (abajo) y nunca en `plantillas.ts` — así que el import de arriba sigue
// protegiendo contra un tercer tipo GENERADO que se olvide aquí, pero ya no
// contra "estas dos uniones son la misma lista". Son dos listas: la generada
// (`TipoContrato`) y la de venta (`TipoContratoVenta`), y la segunda extiende
// a la primera con lo que solo entiende el OS.
import { etiquetasBonos } from "./bonos";
import type { TipoContrato } from "./contratos/plantillas";

// `venta_nueva_v2` es la plantilla que vive en este repo (lib/contratos/
// plantilla-v2.ts): la cláusula 1 sale del catálogo y es la única que se
// firma en el OS. Las otras dos siguen siendo las generadas desde el cockpit.
export type TipoContratoVenta = TipoContrato | "venta_nueva_v2";

/** Lo que la cláusula 1 necesita saber del programa. Es la fila de `tiers`. */
export type TierContrato = {
  /**
   * Si el acceso al contenido grabado es vitalicio (0067).
   *
   * 🔴 NO tiene valor por defecto a propósito, y por eso es obligatorio en el
   * tipo: hasta el 16-sep-2026 la plantilla prometía "Acceso vitalicio" a
   * TODOS los tiers porque la línea estaba escrita a mano, y el 2.000 € no lo
   * da. Un `?? true` aquí devolvería en silencio justo esa promesa vieja al
   * primer sitio que olvide pedir la columna.
   */
  acceso_vitalicio: boolean;
  n_consultorias: number | null;
  n_sesiones_berni: number | null;
  acceso_discord: boolean;
  numero_berni: boolean;
  sesiones_directo: boolean;
};

/** Qué tipo de contrato le toca a una venta — o ninguno. */
export function tipoContratoDe(tipoVenta: string): TipoContratoVenta | null {
  // Plantilla v2 (lib/contratos/plantilla-v2.ts): la cláusula 1 sale del
  // catálogo y es la única que se firma dentro del OS. ENCENDIDA el
  // 16-sep-2026 con el texto revisado por Milo sobre los comentarios de Paula.
  // `venta_nueva` se queda porque los contratos emitidos antes de hoy siguen
  // siendo suyos y hay que poder regenerarlos.
  if (tipoVenta === "nueva") return "venta_nueva_v2";
  if (tipoVenta === "ascension") return "ampliacion";
  // `extension` (renovación) no tiene plantilla: Berni no pasó la suya y no hay
  // PDF de ejemplo del que derivarla. Decisión de Patricio del 7-sep-2026.
  // Devolver null y no lanzar es deliberado — quien llama avisa por consola y
  // sigue; una extensión sin contrato no puede romper una venta cobrada.
  return null;
}

/**
 * "8000.00" → "8.000" · "2500.50" → "2.500,50"
 *
 * Sin el símbolo de moneda: las plantillas ya lo llevan escrito al lado
 * (`{{importe_total}}€`), así que `money()` de lib/format duplicaría el €.
 * Y sin decimales cuando son cero, porque así están escritos los importes en
 * los contratos reales ("3.000", no "3.000,00").
 */
export function importe(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  const decimales = Number.isInteger(v) ? 0 : 2;
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: 2,
    // 🔴 `useGrouping: "always"` no es un adorno. El español tiene una regla de
    // agrupación mínima de 2 grupos: por defecto, Intl NO pone el punto de los
    // miles hasta cinco dígitos, así que 8000 sale "8000" y 10000 sale
    // "10.000". Los contratos reales escriben "3.000" y "8.000" —lo pilló el
    // test comparando contra el ejemplo aprobado—, y un importe formateado de
    // dos maneras distintas según su tamaño se lee como un documento chapucero.
    useGrouping: "always",
  }).format(v);
}

/**
 * "2026-09-07" → "07/09/2026", el formato de los contratos reales.
 *
 * `timeZone: "UTC"` no es decorativo, y la lección ya está pagada en
 * `lib/format.ts:80-89`: una cadena "YYYY-MM-DD" es medianoche UTC, y
 * formatearla sin fijar la zona la corre un día en cualquier zona negativa.
 * En un contrato eso es una fecha de firma equivocada.
 */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
  });
}

/**
 * "2026-08-01" → "1 de agosto de 2026".
 *
 * La cláusula 2 de la ampliación escribe las fechas de vigencia con el mes en
 * palabras, no en dígitos — verificado hoy extrayendo el texto del PDF real de
 * esa clienta. La fecha de FIRMA sí va en dígitos. Son dos formatos distintos en el
 * mismo documento, y así está en el original.
 */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

/**
 * Fin de vigencia = inicio + los meses del programa.
 *
 * ✅ CONFIRMADO POR PAULA EL 9-SEP-2026. Este comentario decía antes "SIN
 * CONFIRMAR CON BERNI", porque la regla no reproducía el contrato real de
 * esa clienta: su cláusula 2 dice "1 de agosto de 2026" → "3 de septiembre de 2027"
 * (13 meses y 2 días) mientras su cláusula 1 dice "por 12 meses extra", y esta
 * fórmula da "1 de agosto de 2027".
 *
 * Se le preguntó a Paula, que lleva los contratos, y eligió que **manda la
 * cláusula**: la ampliación dura exactamente los meses que esa cláusula diga,
 * contados desde el inicio. El mes de más de esa clienta fue un caso puntual
 * pactado con ella, no la regla. Así que esta fórmula se queda como está.
 */
export function fechaFin(inicioIso: string, meses: number): string {
  const d = new Date(inicioIso);
  const dia = d.getUTCDate();
  // 🔴 El día se pone a 1 ANTES de sumar los meses. Sin esto, `setUTCMonth`
  // desborda al mes siguiente cuando el destino es más corto: un programa que
  // empieza el 31-ene y dura 1 mes daba "3 de marzo" en vez de fin de febrero.
  // Lo encontró el revisor y lo reproduje: fechaFin("2026-01-31", 1) devolvía
  // "3 de marzo de 2026". En la cláusula 2 de una ampliación eso es una fecha
  // de fin de vigencia inventada.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  // Y se vuelve a poner el día original, recortado al último del mes destino:
  // el "mismo día del mes" del 31 de enero, un mes después, es el 28 (o 29).
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return fechaLarga(d.toISOString().slice(0, 10));
}

export type Cuota = { numero_cuota: number; fecha_vencimiento: string; monto: number | string };

/**
 * El primer cobro = el total menos lo que queda aplazado.
 *
 * 🔴 LANZA si sale negativo, y esa es toda la razón de que exista esta función
 * en vez de una resta suelta. `VentaForm.tsx:518-522` deja guardar una venta
 * cuyas cuotas NO cuadran con el valor total —avisa, no bloquea, y el texto
 * dice literalmente "se puede guardar igual"— y el RPC tampoco lo valida
 * (`0052_bono_duracion_50.sql:89-90` solo comprueba que no pasen de 24). Sin
 * este guard, una venta así producía un contrato firmado que decía
 * "PAGO EN 3 CUOTAS: -1.000€ hoy" — reproducido antes de escribir esto.
 *
 * Que no se genere el contrato es lo correcto: quien llama lo registra en
 * consola, la venta sigue cobrada, y la pestaña enseña esa venta sin contrato,
 * que es la señal de que hay un plan de pago que revisar a mano.
 */
function primerCobro(total: number | string, cuotas: Cuota[]): number {
  const aplazado = cuotas.reduce((s, c) => s + Number(c.monto), 0);
  const primera = Number(total) - aplazado;
  if (primera < 0) {
    throw new Error(
      `El plan de pago no cuadra: las cuotas suman ${importe(aplazado)}€ sobre un total de ` +
        `${importe(total)}€. Revisa la venta antes de emitir el contrato.`,
    );
  }
  return primera;
}

/**
 * La prosa del plan de pago para `{{forma_pago}}` (venta nueva).
 *
 * Se genera desde las cuotas reales y no se deja fija, porque la frase del
 * contrato de ejemplo ("primera cuota inmediata, segunda al mes siguiente")
 * solo describe el caso de 2 cuotas. Con 4, esa frase sería falsa.
 */
export function formaPago(total: number | string, cuotas: Cuota[]): string {
  if (cuotas.length === 0) return `PAGO ÚNICO de ${importe(total)}€.`;

  const orden = [...cuotas].sort((a, b) => a.numero_cuota - b.numero_cuota);
  const n = orden.length + 1; // las cuotas programadas + el cobro de hoy
  const fechas = orden.map((c) => fecha(c.fecha_vencimiento));

  // Si todas las cuotas son del mismo importe, se dice una vez. Si no, se
  // enumeran: un contrato que dice "4 cuotas de 2.000€" cuando la última es de
  // 1.500€ es un contrato que dice algo falso.
  const montos = orden.map((c) => Number(c.monto));
  const iguales = montos.every((m) => m === montos[0]);
  const primera = primerCobro(total, orden);

  if (iguales && Math.abs(primera - montos[0]) < 0.01) {
    return `PAGO EN ${n} CUOTAS de ${importe(montos[0])}€ cada una: la primera hoy, y ${
      fechas.length === 1 ? "la siguiente el día" : "las siguientes los días"
    } ${lista(fechas)}.`;
  }
  return `PAGO EN ${n} CUOTAS: ${importe(primera)}€ hoy, y ${lista(
    orden.map((c) => `${importe(c.monto)}€ el ${fecha(c.fecha_vencimiento)}`),
  )}.`;
}

/** La prosa de `{{calendario_cuotas}}` (ampliación), que va tras el importe. */
export function calendarioCuotas(total: number | string, cuotas: Cuota[]): string {
  if (cuotas.length === 0) return "en un pago único";

  const orden = [...cuotas].sort((a, b) => a.numero_cuota - b.numero_cuota);
  const montos = orden.map((c) => Number(c.monto));
  const primera = primerCobro(total, orden);
  const n = orden.length + 1;

  if (montos.every((m) => Math.abs(m - primera) < 0.01)) {
    return `en ${n} cuotas de ${importe(primera)}€ cada una (la primera inmediata, ${
      fechas(orden)
    })`;
  }
  return `en ${n} cuotas: ${importe(primera)}€ de forma inmediata, y ${lista(
    orden.map((c) => `${importe(c.monto)}€ el ${fecha(c.fecha_vencimiento)}`),
  )}`;
}

function fechas(cuotas: Cuota[]): string {
  return `${cuotas.length === 1 ? "la segunda" : "las siguientes"} el ${lista(
    cuotas.map((c) => fecha(c.fecha_vencimiento)),
  )}`;
}

/** "a, b y c" — la coma final en español es "y", no otra coma. */
function lista(xs: string[]): string {
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

const LETRAS = "abcdefghijklmnopqrstuvwxyz".split("");

// ── El armado ────────────────────────────────────────────────────────────────

export type FilasContrato = {
  nombre: string | null;
  /** La fila de `programas` que el RPC acaba de crear. */
  programa: {
    monto: number | string;
    meses_duracion: number | null;
    fecha_inicio: string;
    bonos?: readonly string[] | null;
  };
  /** Solo en ampliación: el programa del que viene. */
  programaPrevio?: { monto: number | string } | null;
  pago: { fecha: string; metodo_pago: string | null };
  cuotas: Cuota[];
  /** Solo la v2 lo necesita: la fila de `tiers` del programa. */
  tier?: TierContrato | null;
};

/**
 * Devuelve el diccionario de placeholders listo para `generarContratoPDF`.
 *
 * Lanza si falta el nombre o la duración: son los dos datos sin los cuales el
 * documento no se puede emitir, y un contrato a nombre de "" es peor que uno
 * que no se generó. `generarContratoPDF` también lanza si algún placeholder
 * queda sin valor — este chequeo está aquí para dar un error que se entienda.
 */
/**
 * El párrafo de bonos de la cláusula 1, o cadena vacía si esta venta no lleva
 * ninguno — `generarContratoPDF` salta los bloques que quedan vacíos, así que
 * un contrato sin bonos no enseña un hueco ni una lista de nada.
 *
 * Van los 4 del catálogo y también el que el closer escribió a mano: para el
 * contrato son lo mismo, texto que se promete. La diferencia entre unos y otro
 * (que los del catálogo mueven números en el OS) no le importa al cliente.
 *
 * El +50 % de duración se enumera aquí AUNQUE la cláusula 1 ya diga la
 * duración final —12 meses ya son 18—, pero YA NO con la etiqueta escueta.
 *
 * 🔴 CORREGIDO EL 9-SEP-2026. Esto decía antes que se enumeraba "para que el
 * contrato diga lo mismo que el que Berni firma a mano". La revisión de Milo
 * lo refutó, y tenía razón: el contrato manual escribe la duración BASE junto
 * al bono, y aquí se escribe la FINAL. No es lo mismo, así que ese argumento
 * no justificaba nada — justificaba precisamente el riesgo, que el cliente
 * aplique el +50 % sobre el 18 y reclame 27 meses.
 *
 * Se le preguntó a Paula, que lleva los contratos, y eligió la opción B: el
 * bono se queda en la lista pero con la cuenta desglosada. Por eso
 * `mesesFinales` —la duración final— va a `etiquetasBonos`: el porqué
 * completo está allí. Si no se pasa, la etiqueta vuelve a salir escueta.
 */
export function parrafoBonos(
  bonos: readonly string[] | null | undefined,
  mesesFinales?: number | null,
): string {
  const etiquetas = etiquetasBonos(bonos, mesesFinales);
  if (!etiquetas.length) return "";
  const lista = etiquetas.map((e, i) => `${LETRAS[i] ?? "-"}) ${e}`).join("; ");
  return (
    "Adicionalmente, EL CLIENTE recibe los siguientes bonos: " +
    lista +
    // Sin remitir a un número de cláusula: el mismo párrafo se usa en los dos
    // contratos y el precio es la cláusula 3 en venta nueva pero la 4 en
    // ampliación. Una remisión equivocada en un documento firmado es peor que
    // ninguna. Lo levantó la revisión del 8-sep.
    ". Estos beneficios se otorgan como cortesía adicional y no alteran el precio " +
    "ni las condiciones de pago pactadas."
  );
}

/**
 * Qué cinta lleva la fila de un contrato en /contratos, o `null` si ninguna.
 *
 * Roja gana sobre dorada, y no hace falta comparar fechas para decidirlo:
 * `recorregirContrato` apaga `desactualizado_at` en el MISMO PATCH en que
 * escribe `recorregido_at` (contrato-envio.ts). Así que las dos solo están
 * puestas a la vez cuando la corrección se quedó a medias —`editarBonos`
 * guardó los bonos nuevos y la regeneración falló—, y ahí el PDF que tiene el
 * equipo sigue siendo el viejo: rojo es exactamente lo que hay que decir.
 *
 * 0065 añade una tercera: "editado" (`texto_editado_at`), cuando alguien tocó
 * `texto_final` a mano después de generar. Precedencia completa:
 * desactualizado > editado > recorregido. Editado va por delante de
 * recorregido porque es lo que hay que saber ANTES de pulsar "Recorregir" —
 * ese botón regenera desde los datos y pisaría la edición manual.
 */
export type CintaContrato = { tipo: "desactualizado" | "recorregido" | "editado"; fecha: string };

/**
 * La misma decisión, pero partiendo de la fila entera: sin `pdf_path` no hay
 * documento que pueda estar viejo ni corregido, así que no hay nada que
 * marcar. Vive aquí y no en el componente que la pinta porque es una regla,
 * no un pixel — y aquí la cubren los tests.
 *
 * La usan las DOS pantallas que dibujan la cinta: /contratos y el bloque
 * "Contratos" de la ficha del cliente.
 */
export function cintaDeFila(
  pdfPath: string | null | undefined,
  recorregidoAt: string | null | undefined,
  desactualizadoAt: string | null | undefined,
  editadoAt?: string | null,
): CintaContrato | null {
  if (!pdfPath) return null;
  return cintaContrato(recorregidoAt, desactualizadoAt, editadoAt);
}

export function cintaContrato(
  recorregidoAt: string | null | undefined,
  desactualizadoAt: string | null | undefined,
  editadoAt?: string | null,
): CintaContrato | null {
  if (desactualizadoAt) return { tipo: "desactualizado", fecha: fechaLarga(desactualizadoAt) };
  // Editado a mano (spec, decisión 4): regenerar desde los datos pisaría la
  // edición. Va por encima de "recorregido" porque es lo que hay que saber
  // antes de pulsar ese botón.
  if (editadoAt) return { tipo: "editado", fecha: fechaLarga(editadoAt) };
  if (recorregidoAt) return { tipo: "recorregido", fecha: fechaLarga(recorregidoAt) };
  return null;
}

/**
 * La cláusula 1, línea a línea, desde el catálogo. Cada línea es una
 * prestación; las letras se corren solas cuando un programa no incluye algo
 * (el 2.000 € no lleva Discord ni sesiones con Berni). Quien la pinta separa
 * por "\n" — ver el renderer de listas en contrato-pdf.ts.
 *
 * Lo que dice cada línea es lo que Paula y Milo cerraron el 14-sep: dos
 * directos semanales y GRUPALES, el plan de acción como entregable propio, y
 * "consultoría" siempre (nunca "mentoría"). Berni y Paula aprueban el texto.
 */
export function prestaciones(t: TierContrato, meses: number): string {
  const n = (x: number | null | undefined) => Math.max(0, Math.trunc(Number(x ?? 0)));
  const consultorias = n(t.n_consultorias);
  const conBerni = n(t.n_sesiones_berni);
  // El acceso al contenido: vitalicio o por la duración del programa. Sale del
  // catálogo (0067) y no de la plantilla — hasta el 16-sep-2026 esta línea
  // estaba escrita a mano y prometía vitalicio a todo el mundo, incluido el
  // tier de 2.000 €, que no lo da.
  const items: string[] = [
    t.acceso_vitalicio
      ? 'Acceso vitalicio al contenido grabado del programa formativo "MetaCrypto Club".'
      : `Acceso al contenido grabado del programa formativo "MetaCrypto Club" durante ${meses} meses.`,
  ];
  // Sin directos (hoy el OG en el catálogo) no se promete la sesión semanal:
  // se leía del tipo (`sesiones_directo`) y se tiraba — el contrato prometía
  // el directo a tiers que lo tienen en `false`. Ronda de arreglo 1, Critical 1.
  if (t.sesiones_directo) {
    // 🔴 SIN "de turno" y SIN calificarlas de grupales ni de individuales
    // (Milo, 16-sep-2026, sobre los comentarios de Paula). "De turno" venía de
    // sustituir "Manuel" por un genérico y sonaba a que al cliente le atiende
    // quien caiga; la coletilla "Son sesiones grupales, no individuales"
    // señalaba lo que el servicio NO es, en un documento que está para decir
    // lo que sí es. Hay tests que fijan las dos ausencias.
    items.push(`Sesión semanal en directo los domingos con Berni y sesión semanal en directo los miércoles con el consultor, durante ${meses} meses.`);
  }
  // Sin consultorías (el OG: 0 en el catálogo) no se escribe "0 consultorías":
  // lo que no se promete, no se escribe — misma regla que Discord y el número.
  if (consultorias > 0) {
    items.push(`${consultorias} ${consultorias === 1 ? "consultoría individual" : "consultorías individuales"} 1 a 1 con el consultor asignado.`);
  }
  if (conBerni > 0) {
    items.push(`${conBerni} ${conBerni === 1 ? "sesión individual" : "sesiones individuales"} 1 a 1 con Berni.`);
  }
  // El documento de plan de acción se elabora EN la primera consultoría: sin
  // ninguna consultoría no hay dónde elaborarlo. Ronda de arreglo 1, Critical
  // 2 — ruling de Milo: se gatea, no se reescribe; otra redacción para ese
  // tier es decisión de Paula, no de este código.
  if (consultorias > 0) {
    items.push("Documento de plan de acción, elaborado en la primera consultoría.");
  }
  items.push(`Chat privado con el consultor por WhatsApp durante ${meses} meses.`);
  if (t.acceso_discord) {
    items.push(`Acceso al Discord privado con los movimientos de Berni durante ${meses} meses.`);
  }
  if (t.numero_berni) items.push("Número de teléfono directo de Berni.");
  return items.map((x, i) => `${LETRAS[i] ?? "-"}) ${x}`).join("\n");
}

export function datosContrato(tipo: TipoContratoVenta, f: FilasContrato): Record<string, string> {
  const nombre = (f.nombre ?? "").trim();
  if (!nombre) throw new Error("El contrato necesita el nombre del cliente.");

  const meses = f.programa.meses_duracion;
  if (!meses || meses < 1) {
    throw new Error(`El contrato necesita la duración del programa (llegó: ${meses}).`);
  }

  const comun = {
    cliente_nombre: nombre,
    duracion_meses: String(meses),
    metodo_pago: f.pago.metodo_pago?.trim() || "—",
    fecha_firma: fecha(f.pago.fecha),
    bonos: parrafoBonos(f.programa.bonos, meses),
  };

  if (tipo === "venta_nueva" || tipo === "venta_nueva_v2") {
    const ventaNueva = {
      ...comun,
      importe_total: importe(f.programa.monto),
      forma_pago: formaPago(f.programa.monto, f.cuotas),
    };
    if (tipo === "venta_nueva") return ventaNueva;
    if (!f.tier) throw new Error("El contrato v2 necesita el catálogo del programa (fila de tiers).");
    return {
      ...ventaNueva,
      prestaciones: prestaciones(f.tier, meses),
      // Vacíos al emitir: el PDF nace sin firmar. `renderizarContratoPDF` los
      // rellena cuando el cliente firma, y mientras tanto el bloque enseña la
      // línea en blanco donde firmará. Los dos están en `OPCIONALES`
      // (contrato-pdf.ts) para que el "" no haga lanzar a `rellenar`: sacarlos
      // de ahí revienta todo contrato v2 que aún no esté firmado.
      firma_cliente: "",
      firma_evidencia: "",
    };
  }

  const previo = f.programaPrevio;
  if (!previo) {
    throw new Error("El contrato de ampliación necesita el programa anterior del cliente.");
  }
  // La diferencia entre los dos programas, que es lo que el cliente abona:
  // la cláusula 4 de la plantilla dice literalmente "abonando la diferencia
  // correspondiente". No es el importe del programa nuevo.
  const diferencia = Number(f.programa.monto) - Number(previo.monto);
  return {
    ...comun,
    programa_previo_importe: importe(previo.monto),
    programa_nuevo_importe: importe(f.programa.monto),
    importe_ampliacion: importe(diferencia),
    // En palabras, como en el original de esa clienta — ver `fechaLarga`.
    fecha_inicio: fechaLarga(f.programa.fecha_inicio),
    fecha_fin: fechaFin(f.programa.fecha_inicio, meses),
    calendario_cuotas: calendarioCuotas(diferencia, f.cuotas),
    n_cuotas: String(f.cuotas.length + 1),
  };
}
