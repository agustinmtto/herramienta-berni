// ============================================================
// En qué punto del ciclo está un contrato, en una sola píldora.
//
// Vive en un lib y no dentro de una pantalla porque lo pintan DOS: la pestaña
// /contratos y el bloque "Contratos" de la ficha del cliente. Hasta hoy cada
// una llevaba su propio diccionario —con un comentario en la ficha que decía
// "mismos diccionarios que contratos/page.tsx"— y ya no decían lo mismo: la
// pestaña fundía 'pendiente' con 'error_envio' en "Error" y la ficha pintaba
// "Pendiente" a secas. El mismo contrato se leía como roto en una pantalla y
// como normal en la otra.
//
// Mismo patrón que lib/clientes-vista.ts: la decisión es una regla, no un
// pixel, así que vive donde los tests la alcanzan. Sin imports "@/" —vitest no
// resuelve el alias en los libs— y sin React: aquí se decide QUÉ dice y de qué
// color; quien lo pinta es cada pantalla.
//
// 🔴 'pendiente' quiere decir DOS COSAS distintas según quién creó la fila, y
// por eso esta función necesita el `tipo`:
//   · venta_nueva / ampliacion (el camino viejo): la fila nace 'pendiente' y
//     pasa a 'enviado' en cuanto Resend acepta (contrato-envio.ts:325). Que se
//     quede ahí significa que el correo al equipo NO salió — es el fallo que
//     la pestaña lleva desde el 8-sep fundiendo con 'error_envio'.
//   · venta_nueva_v2 (el camino de la firma): el contrato se genera y se queda
//     en 'pendiente' a propósito, sin mandarse a nadie, hasta que alguien le
//     da a "Enviar al cliente" (contrato-envio.ts:1055). Ahí 'pendiente' es lo
//     normal, no un fallo, y pintarlo naranja diría que hay algo que arreglar
//     en el 100% de los contratos nuevos recién registrados.
// ============================================================
// 🔴 NI `dateEs` NI `fullTime` DE lib/format, y las dos exclusiones tienen un
// motivo distinto. Lo que se formatea aquí son `timestamptz` —instantes reales:
// cuándo salió el correo, cuándo se abrió el PDF, cuándo se firmó—, no fechas
// de calendario.
//
//  · `dateEs` fija `timeZone: "UTC"`, que es lo correcto para un vencimiento
//    (un día es el mismo día en todas partes) y lo incorrecto para un
//    instante: una firma de las 00:30 de Madrid saldría con la fecha del día
//    anterior.
//  · `fullTime` usa la zona del proceso, que es lo correcto cuando lo pinta el
//    navegador de quien lee —y así se usa en las cuatro pantallas que lo
//    tienen, todas de cliente— pero NO aquí: la pestaña /contratos es un
//    componente de servidor, así que "la zona del proceso" es la de Vercel
//    (UTC) y a Alex le diría 09:00 de algo que hizo a las 11:00. El bloque
//    "Contratos" de la ficha sí es de cliente: la misma función daría dos
//    horas distintas para el mismo evento según la pantalla.
//
// Se pinta la hora de España, como ya hace el OS con las citas de GHL
// (lib/sesiones.ts), los recordatorios (lib/recurrentes.ts, que además la
// etiqueta) y el .ics (lib/ics.ts): el negocio, el equipo y el contrato son
// españoles. Y se dice "(hora de España)" en el texto, porque quien mira esto
// desde Chile no tiene por qué adivinarlo.
const ZONA = "Europe/Madrid";

/** "2026-09-17T10:30:00Z" → "17 sept 26". Misma forma que `dateEs` —la de la
    columna Fecha, al lado— pero anclada a España en vez de a UTC. */
function diaEs(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "2-digit", timeZone: ZONA,
  });
}

/** "2026-09-18T09:05:00Z" → "18/09/2026 a las 11:05 (hora de España)".
    Con año, a diferencia de `fullTime`: esto va en el rastro de una firma. */
function momento(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: ZONA,
  });
  const hora = d.toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit", timeZone: ZONA,
  });
  return `${dia} a las ${hora} (hora de España)`;
}

export type TonoContrato = "neutro" | "verde" | "azul" | "oro" | "naranja";

/** La clase de `.pill` de cada tono. Las cinco ya existen en globals.css:373-379
    —ninguna se inventa aquí— y las usan las dos pantallas, para que el mismo
    estado no salga verde en una y azul en la otra. */
export const CLASE_PILL: Record<TonoContrato, string> = {
  neutro: "pill",
  verde: "pill green",
  azul: "pill blue",
  oro: "pill gold",
  naranja: "pill orange",
};

/** Lo que hace falta de la fila. Lo cumplen `ContratoRow` (la pestaña) y
    `ContratoDeCliente` (la ficha) sin tocarlas. */
export type FilaContratoEstado = {
  tipo: string | null;
  estado: string;
  enviado_cliente_at: string | null;
  visto_at: string | null;
  firmado_at: string | null;
  firma_nombre: string | null;
};

export type EstadoContratoVista = {
  /** Corto: la píldora va en una celda de tabla con `white-space: nowrap`. */
  etiqueta: string;
  tono: TonoContrato;
  /** El globo (`title`). Aquí va lo que la etiqueta no puede prometer. */
  detalle: string | null;
};

/**
 * 🔴 SOBRE LAS PALABRAS DE `visto_at`, que es donde es fácil mentir sin querer.
 *
 * `visto_at` se escribe cuando el servidor le SIRVE el PDF a quien abre el
 * enlace (app/c/[token]/pdf), filtrando bots. O sea: "se le entregó el
 * documento", no "lo leyó" y desde luego no "lo aceptó". Por eso la etiqueta
 * dice "Abierto" —un hecho: alguien pidió el fichero— y el globo lo acota.
 *
 * Y NO se cuenta cuántas veces: `contrato_eventos` registra un 'abierto' en
 * CADA carga del PDF (el iframe de la página del cliente, más cada vez que
 * vuelve a abrir el enlace), así que ese número no es "las veces que lo miró".
 * `visto_at` es solo la PRIMERA vez, y eso es lo único que se enseña.
 */
export function estadoContrato(c: FilaContratoEstado): EstadoContratoVista {
  // Firmado manda sobre todo lo demás: es el final del ciclo, y `estado`
  // también se mueve a 'firmado' (contrato-firma-datos.ts). Se miran los dos
  // porque 'firmado' existe en la CHECK desde la 0004 y hasta la 0065 no lo
  // escribía nadie: una fila histórica con ese estado y sin `firmado_at` no
  // debe caer al `default` y salir en minúsculas.
  if (c.firmado_at || c.estado === "firmado") {
    return {
      etiqueta: "Firmado",
      tono: "oro",
      detalle: c.firmado_at
        ? `Firmado por ${c.firma_nombre?.trim() || "el cliente"} el ${momento(c.firmado_at)}.`
        : null,
    };
  }

  if (c.estado === "enviado_cliente") {
    if (c.visto_at) {
      return {
        etiqueta: `Abierto el ${diaEs(c.visto_at)}`,
        tono: "azul",
        detalle:
          `Se le sirvió el PDF por primera vez el ${momento(c.visto_at)}. ` +
          "Que se abra no prueba que lo haya leído, ni que vaya a firmarlo.",
      };
    }
    return {
      etiqueta: "Enviado al cliente",
      tono: "azul",
      detalle: c.enviado_cliente_at
        ? `El enlace de firma salió el ${momento(c.enviado_cliente_at)}. Todavía no consta que lo haya abierto.`
        : "El enlace de firma ya salió. Todavía no consta que lo haya abierto.",
    };
  }

  // Verde y NO oro: el contrato salió, sí, pero al EQUIPO. Para el cliente
  // todavía no existe. El oro está reservado a la firma, que es el final.
  if (c.estado === "enviado") {
    return {
      etiqueta: "Enviado al equipo",
      tono: "verde",
      detalle: "El PDF salió por correo al equipo. Al cliente todavía no.",
    };
  }

  // Ver el bloque 🔴 de la cabecera: el mismo valor, dos significados.
  if (c.estado === "pendiente" && c.tipo === "venta_nueva_v2") {
    return {
      etiqueta: "Sin enviar",
      tono: "neutro",
      detalle: "Generado y guardado. Todavía no ha salido a nadie: se manda con «Enviar al cliente».",
    };
  }

  // La fusión de 'pendiente' y 'error_envio' del camino viejo, deliberada
  // desde el 8-sep: al closer no le importa CUÁL de los dos pasó, le importa
  // que el correo no llegó y que hay que reenviarlo. La base sigue guardando
  // el detalle real para debug.
  if (c.estado === "pendiente" || c.estado === "error_envio") {
    return {
      etiqueta: "No salió",
      tono: "naranja",
      detalle: "El correo con el contrato no llegó a salir. Se puede reenviar.",
    };
  }

  return { etiqueta: c.estado, tono: "neutro", detalle: null };
}
