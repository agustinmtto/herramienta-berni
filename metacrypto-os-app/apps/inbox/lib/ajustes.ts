import "server-only";
import { rest } from "@/lib/supabase";
import { decidirDestinatarios } from "@/lib/canales";

// Ajustes que se cambian desde la pantalla en vez de con un redeploy.
//
// El único de hoy es a quién se le manda el contrato: al equipo, o a las
// direcciones de prueba. Vivía en `CONTRATO_EMAIL_PRUEBA`, y cambiar una
// variable de entorno de Vercel obliga a redesplegar — lento, y con un modo de
// fallo caro: dejarse la variable puesta y mandarle a tres Gmail el contrato
// del primer cliente real.
//
// Tabla `ajustes_os` (0060). Una fila por ajuste.

export type ClaveAjuste = "contrato_modo_prueba" | "contrato_email_prueba";

/**
 * Lee un ajuste. Devuelve `null` si no está, si la tabla todavía no existe o
 * si la consulta falla.
 *
 * Que un fallo de lectura sea `null` y no una excepción es deliberado: quien
 * llama corre dentro del envío de un contrato, y un ajuste ilegible no puede
 * impedir que el contrato se genere. Lo que sí hace es dejar rastro.
 */
export async function ajusteOs(clave: ClaveAjuste): Promise<string | null> {
  try {
    const r = await rest<{ valor: string | null }[]>(
      "GET",
      `ajustes_os?clave=eq.${clave}&select=valor&limit=1`,
    );
    if (r.status >= 300) {
      console.error("[ajustes] no se pudo leer", clave, r.status, r.json);
      return null;
    }
    return r.json?.[0]?.valor ?? null;
  } catch (e) {
    console.error("[ajustes] no se pudo leer", clave, e);
    return null;
  }
}

/**
 * A qué direcciones va el contrato mientras el modo prueba esté encendido.
 *
 * Tres respuestas, y la tercera es la que importa:
 *
 *   - `[]`      → modo prueba APAGADO. Va al equipo de verdad.
 *   - `[...]`   → modo prueba encendido, con estas direcciones.
 *   - `null`    → **no se pudo saber**. No se manda nada.
 *
 * El `null` nació de un fallo real de diseño: antes, una lectura fallida caía a
 * `CONTRATO_EMAIL_PRUEBA`, que en Producción NO EXISTE (medido el 8-sep: 24
 * variables, y esa no está). Así que la cadena entera —tabla ilegible → cadena
 * vacía → `[]`— significaba "manda al equipo de verdad", mientras la pantalla
 * seguía diciendo "modo prueba". Y no era solo la ventana del despliegue: el
 * schema cache de PostgREST devuelve PGRST205 durante unos segundos tras crear
 * una tabla, y un 500 pasajero de Supabase en mitad de una venta real hace lo
 * mismo.
 *
 * Ahora un ajuste ilegible **frena el envío**. El contrato queda en
 * `error_envio`, con su PDF guardado y el botón de reenviar a mano. No mandar
 * es reversible; mandarle a tres personas el documento equivocado no lo es.
 *
 * `CONTRATO_EMAIL_PRUEBA` sigue funcionando como respaldo SOLO si está puesta:
 * sirve para local, donde la tabla puede no existir todavía.
 */
export async function destinatariosDePrueba(): Promise<string[] | null> {
  const modo = await ajusteOs("contrato_modo_prueba");
  const lista = modo === "on" ? await ajusteOs("contrato_email_prueba") : null;
  const decision = decidirDestinatarios(modo, lista, process.env.CONTRATO_EMAIL_PRUEBA);
  if (decision === null) {
    console.error("[ajustes] no se pudo decidir a dónde va el contrato (modo:", modo, ") — no se manda nada");
  }
  return decision;
}
