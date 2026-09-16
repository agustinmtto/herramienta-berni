import "server-only";
import { rest } from "@/lib/supabase";
import { destinatariosDePrueba } from "@/lib/ajustes";
import { getStorageBytes, uploadToStorage } from "@/lib/storage";
import { enviarYRegistrarEmail, type ResultadoEnvioEmail } from "@/lib/email-envio";
import { claveContrato, claveContratoCliente } from "@/lib/canales";
import { emailContrato, emailContratoCliente } from "@/lib/email-plantillas";
import { textoContrato, renderizarContratoPDF } from "@/lib/contrato-pdf";
import { BLOQUE_FIRMA } from "@/lib/contratos/plantilla-v2";
import { compactarHuecos, normalizarTexto, problemaDelTexto } from "@/lib/contrato-texto";
import { datosContrato, tipoContratoDe, type Cuota, type TipoContratoVenta } from "@/lib/contrato-datos";
import { nuevoToken, enlaceFirma, hashPdf, caducidad, DIAS_CADUCIDAD } from "@/lib/contrato-firma";
import { bloqueoRecorregir } from "@/lib/contrato-guardas";
import { registrarEvento, CLAVES_BLOQUE } from "@/lib/contrato-firma-datos";
import { RE_EMAIL } from "@/lib/persona";

// ============================================================
// Genera el contrato de una venta, lo guarda y avisa al equipo.
//
// Espejo de `lib/aviso-venta-email.ts`: mismo sitio de llamada (`after()` en
// `crearVenta`), misma promesa de no lanzar nunca, misma forma de resolver
// destinatarios contra `team_members`.
//
// NUNCA LANZA. Se llama desde `after()`, cuando la venta ya está cobrada y
// guardada: un contrato que no se pudo generar no puede convertir una venta
// pagada en un error en pantalla del closer. Todo fallo va a consola y ahí se
// queda — el hueco se ve en la pestaña, donde esa venta aparece sin contrato.
//
// EL ORDEN IMPORTA: generar → subir → registrar en la base → enviar.
// La razón ya NO es el enlace —desde el 8-sep el PDF va adjunto y no hay URL
// que pueda dar 404—: es que el insert es lo que gana el 409 del índice único
// de `contratos.programa_id`, y ese 409 es todo el antiduplicados. Enviar
// antes de registrar significa que un reintento del hook manda el contrato dos
// veces, a los destinatarios de `DESTINATARIOS`, sobre un documento legal.
//
// La fila nace en 'pendiente' y solo pasa a 'enviado' cuando Resend acepta.
// ============================================================

// Los del pedido de Berni (`mejoras-os/cambios-os.md:24`), por `username` y no
// por dirección de correo: así cambiar el email de alguien se hace en la base y
// no en un deploy, y sumar a un cuarto es un update, no un cambio de código.
//
// 🔴 `paula` está FUERA a propósito, y es temporal. Medido el 10-sep-2026
// preguntándole a Resend desde el propio deploy —su llave está marcada
// Sensitive en Vercel y no se puede leer en local—: la lista de supresión de
// la cuenta tenía UNA sola dirección, `paula@invierteconberni.com`, con
// `origin: "bounce"` del 8-sep 19:39:24.
//
// 🟢 RESUELTO EL 10-SEP-2026, y por otra vía que la prevista. Paula vuelve a
// la lista sin tocar nada de Resend: su dirección en `team_members` pasó a ser
// `companera.personal@gmail.com`, que nunca rebotó y no está suprimida. Como esta
// lista son NOMBRES DE USUARIO y el correo se lee de `team_members`, cambiar
// la fila bastó — mismo patrón que Dani, que también recibe en un Gmail.
//
// El buzón `paula@invierteconberni.com` sigue roto y NO se arregló: el MX del
// dominio es `smtp.google.com`, o sea Google Workspace, y un rebote duro suyo
// sobre una dirección propia significa que ese usuario no existe. Se dejó
// intacta en la lista de supresión a propósito — quitarla de ahí con el buzón
// roto solo produce otro rebote, que la vuelve a suprimir y de paso castiga la
// reputación del dominio. Si algún día se crea ese buzón, entonces sí: borrarla
// de la supresión y devolver su dirección en `team_members`.
//
// Y se cerró de paso una alarma falsa que no era de contratos. `emails_enviados`
// guarda UN estado por mensaje, que refleja al PEOR destinatario: mientras
// `paula@` estuvo en el aviso al equipo —que va a los seis—, cada aviso quedaba
// marcado `rebotado`/`rechazado` aunque los otros cinco lo recibieran. Medido
// el 10-sep: los avisos del 8 y el 9 de septiembre SÍ llegaron (leídos en el
// buzón de Milo, que es uno de los seis) y en el del 9 ya aparecen cinco
// destinatarios en vez de seis, porque Resend saltó a Paula. Sin esa dirección
// en ninguna parte, el estado vuelve a significar lo que dice.
const DESTINATARIOS = ["berni", "alex", "paula"];

/**
 * Válvula de prueba: si `CONTRATO_EMAIL_PRUEBA` trae direcciones separadas por
 * comas, el contrato NO va al equipo — va a esas, una por destinatario y en el
 * mismo orden que `DESTINATARIOS`.
 *
 * Existe porque el gatillo de esta feature es una VENTA REAL: no hay forma de
 * ensayarla sin que salga un correo. Sin esta variable, la única manera de
 * probar el camino completo sería mandarle a Berni, Alex y Paula un contrato
 * de un cliente que no existe.
 *
 * Se hace con una variable y no editando `DESTINATARIOS` a mano porque un
 * cambio de código hay que acordarse de revertirlo, y el día que no nos
 * acordemos el contrato de un cliente real se va a tres direcciones de prueba.
 * Una variable se borra del panel de Vercel y el código no se toca nunca.
 *
 * Misma forma que `AVISO_VENTA_EMAIL_ACTIVO` y `SESIONES_EMAIL_ACTIVO`: la
 * configuración del canal vive en el entorno, no en el fuente.
 */


type Miembro = { id: string; username: string | null; email: string | null };

type ContratoConstruido = {
  pdf: Buffer;
  datos: Record<string, string>;
  equipo: Miembro[];
  cuerpo: string;
  firma: string;
};

/**
 * Relee la venta desde la base y arma el PDF del contrato — el tramo que
 * comparten la emisión original y una recorrección (`recorregirContrato`,
 * más abajo): las dos necesitan los datos ACTUALES de la venta, no los que
 * había en el momento de la primera emisión. Extraído el 9-sep-2026 para el
 * hallazgo #2 de Milo (PR #3): antes solo vivía inline en
 * `generarYEnviarContrato` —la emisión automática dentro de `after()`,
 * borrada el 16-sep cuando el contrato pasó al modal— y no había forma de
 * reusarlo sin duplicarlo.
 *
 * NUNCA LANZA — salvo la sección 2. Todas las comprobaciones de la sección 1
 * (más abajo) devuelven `null` y loguean, igual que hacía inline el código
 * que reemplaza. La sección 2 (`datosContrato` / `textoContrato` / `rellenar`)
 * SÍ puede lanzar, a propósito — hasta el 16-sep esto no importaba porque el
 * camino v2 aún no era alcanzable; ahora que este `tipo` admite
 * `TipoContratoVenta`, sí lo es. Ver el comentario encima de la sección 2
 * sobre por qué ese throw no se envuelve en un try/catch.
 */
async function construirContratoPDF(
  personaId: string,
  programaId: string,
  pagoId: string,
  tipo: TipoContratoVenta,
): Promise<ContratoConstruido | null> {
  // ── 1. Las filas que el RPC acaba de escribir ────────────────────────────
  const [rPersona, rPrograma, rPago, rCuotas, rEquipo] = await Promise.all([
    rest<{ nombre: string | null }[]>("GET", `personas?id=eq.${personaId}&select=nombre&limit=1`),
    // 🔴 ANTES DEL DEPLOY, como la 0061 y la 0065 (mismo aviso, misma trampa):
    // este `select` pide `n_sesiones_berni` PARA LOS TRES TIPOS DE CONTRATO —
    // es una sola lectura, sin ramas por `tipo`, así que no hay forma de
    // pedirla solo para v2. Esa columna no existe todavía en `tiers`: la
    // migración que la crea (`0064_n_sesiones_berni.sql`) está escrita y
    // revisada pero SIN APLICAR, y encima vive en OTRA rama
    // (`feat/catalogo-2026`) — quien despliegue esta rama no la va a ver en
    // su propio diff.
    //
    // PostgREST responde 400 a la petición ENTERA cuando pide una columna que
    // no existe, no solo a esa columna. Con `rest()` sin lanzar nunca
    // (lib/supabase.ts:62-69), ese 400 hace que `rPrograma.status` salga ≥300
    // para CUALQUIER programa — `venta_nueva` y `ampliacion` incluidos, que
    // están vivos hoy — y cae en el `if (!programa || !pago)` de la línea
    // ~141: un `console.error` y `return null`. Deja de generarse cualquier
    // contrato, sin excepción y sin ninguna alarma más ruidosa que esa línea
    // de consola. `0064_n_sesiones_berni.sql` tiene que estar aplicada ANTES
    // de que este código llegue a producción — y desde el 16-sep también
    // `0067_vitalicio_y_retirar_legacy.sql`, por `acceso_vitalicio`: el
    // mismo 400 y el mismo silencio si falta cualquiera de las dos.
    rest<{
      monto: string; meses_duracion: number | null; fecha_inicio: string;
      programa_previo_id: string | null; bonos: string[] | null;
      tiers: { acceso_vitalicio: boolean; n_consultorias: number | null;
               n_sesiones_berni: number | null; acceso_discord: boolean;
               numero_berni: boolean; sesiones_directo: boolean } | null;
    }[]>(
      "GET",
      `programas?id=eq.${programaId}&select=monto,meses_duracion,fecha_inicio,programa_previo_id,bonos,` +
        `tiers(acceso_vitalicio,n_consultorias,n_sesiones_berni,acceso_discord,numero_berni,sesiones_directo)&limit=1`,
    ),
    rest<{ fecha: string; metodo_pago: string | null }[]>(
      "GET",
      `pagos?id=eq.${pagoId}&select=fecha,metodo_pago&limit=1`,
    ),
    rest<Cuota[]>(
      "GET",
      `cuotas_programadas?programa_id=eq.${programaId}&select=numero_cuota,fecha_vencimiento,monto&order=numero_cuota`,
    ),
    rest<Miembro[]>("GET", "team_members?select=id,username,email"),
  ]);

  const programa = Array.isArray(rPrograma.json) ? rPrograma.json[0] : null;
  const pago = Array.isArray(rPago.json) ? rPago.json[0] : null;
  if (!programa || !pago) {
    console.error("[contrato] no se pudo leer la venta", programaId, rPrograma.status, rPago.status);
    return null;
  }

  // 🔴 Las cuotas se comprueban por STATUS y no solo por forma, y es el único
  // de los cinco GET donde la distinción importa.
  //
  // `rest()` no lanza nunca ante un error de PostgREST (lib/supabase.ts:62-69):
  // un 500 o un timeout devuelven `{status: 500, json: {message: …}}`, un
  // objeto. Con un `Array.isArray(...) ? ... : []`, ese fallo se vuelve
  // indistinguible de "esta venta no tiene cuotas" — y entonces
  // `formaPago(8000, [])` escribe "PAGO ÚNICO de 8.000€" en el contrato de un
  // cliente que pactó cuatro cuotas. Sale el PDF, sale el correo, y no queda
  // ni una línea en consola.
  //
  // Los otros cuatro GET fallan de forma segura solos: si el fetch se cae, su
  // comprobación ("¿hay fila?", "¿el equipo está vacío?") da el mismo
  // resultado que si el dato no existiera, y se aborta. Aquí no: un array
  // vacío es un estado LEGÍTIMO (el pago único), así que hay que preguntar.
  //
  // Lo encontró el revisor (`metacrypto-club-cockpit-5d`) el 7-sep-2026.
  if (rCuotas.status >= 300 || !Array.isArray(rCuotas.json)) {
    console.error(
      "[contrato] no se pudo leer el plan de cuotas — no se emite el contrato",
      programaId, rCuotas.status, rCuotas.json,
    );
    return null;
  }

  // El equipo se comprueba AQUÍ y no justo antes de mandar el correo, aunque
  // solo haga falta al final: si esta lectura falló, más abajo se subiría el
  // PDF y se insertaría (o recorregiría) una fila con `estado = 'enviado'` que
  // nadie recibió. Una fila que miente sobre un documento legal es peor que
  // ninguna fila.
  const equipo = Array.isArray(rEquipo.json) ? rEquipo.json : [];
  if (rEquipo.status >= 300 || equipo.length === 0) {
    console.error("[contrato] no se pudo leer el equipo", rEquipo.status);
    return null;
  }

  // La ampliación necesita el importe del programa del que viene. Se lee
  // aparte porque solo entonces existe el id.
  let programaPrevio: { monto: string } | null = null;
  if (tipo === "ampliacion") {
    if (!programa.programa_previo_id) {
      console.error("[contrato] ascensión sin programa previo", programaId);
      return null;
    }
    const r = await rest<{ monto: string }[]>(
      "GET",
      `programas?id=eq.${programa.programa_previo_id}&select=monto&limit=1`,
    );
    programaPrevio = Array.isArray(r.json) ? (r.json[0] ?? null) : null;
  }

  // ── 2. El PDF ────────────────────────────────────────────────────────────
  // NO envolver esta sección en un try/catch propio. `datosContrato` lanza si
  // falta un dato (incluido el catálogo del tier para v2 — contrato-datos.ts,
  // "El contrato v2 necesita el catálogo del programa") y `textoContrato` /
  // `rellenar` lanzan si queda un placeholder sin rellenar: es el "falla
  // ruidosamente" que exige el brief de la Task 4, y ESTA función no lo
  // atenúa a propósito — el catch que importa es el de quien llama. Envolver
  // aquí "por prolijidad" convertiría ese error ruidoso en un `return null`
  // más, indistinguible de los de la sección 1 — exactamente lo que este
  // comentario existe para que nadie haga sin darse cuenta.
  //
  // ⚠️ QUIÉN LLAMA, HOY (el 16-sep desapareció `generarYEnviarContrato`, que
  // era el catch original y corría dentro de `after()`):
  //   · `generarContrato` — SÍ tiene try/catch, y convierte el throw en un
  //     mensaje que el closer lee en el modal de la venta.
  //   · `recorregirContrato` — NO lo tiene, y nunca lo tuvo. Un throw de
  //     aquí sale por su server action como un digest opaco de Next. Hoy es
  //     difícil de alcanzar (`bloqueoRecorregir` ya se llevó las filas v2,
  //     que son las que necesitan catálogo), pero no es imposible: `rellenar`
  //     lanza también en v1 si queda un placeholder sin sustituir.
  //
  // OJO — no todo lo que impide una cláusula vacía pasa por el `throw` de
  // arriba. Ese `throw` cubre un embed genuinamente vacío (`tiers: null` con
  // la fila leída bien — hay test para eso). El disparador realista a corto
  // plazo es otro: desplegar esto antes de aplicar `0064_n_sesiones_berni.sql`
  // (aviso completo junto al `select`, sección 1). Ese caso NO llega hasta
  // aquí — el `select` entero falla con 400, `programa` sale `null`, y se
  // sale por el `return null` silencioso de la línea ~141. Las dos rutas
  // cumplen el mismo objetivo (ningún contrato con la cláusula de
  // prestaciones vacía), pero solo una es ruidosa: no des por hecho que el
  // `throw` de esta sección te protege del escenario "falta la migración" —
  // a ese lo frena, en silencio, la sección 1.
  //
  // Dicho lo anterior: `datosContrato` lanza si falta un dato y
  // `textoContrato`/`rellenar` lanzan si queda un placeholder sin rellenar.
  // Las tres cosas las recoge el catch de quien llama —cuando lo tiene: ver
  // el ⚠️ de arriba—: mejor ningún contrato que uno que diga
  // "{{importe_total}}".
  const datos = datosContrato(tipo, {
    nombre: rPersona.json?.[0]?.nombre ?? null,
    programa,
    programaPrevio,
    pago,
    cuotas: rCuotas.json,
    tier: programa.tiers,
  });
  const { cuerpo, firma } = textoContrato(tipo, datos);
  const pdf = await renderizarContratoPDF(cuerpo, firma, datos);
  return { pdf, datos, equipo, cuerpo, firma };
}

/**
 * Deja la fila diciendo lo que de verdad pasó con el correo.
 *
 * Si este PATCH falla no hay nada más que hacer — queda el rastro en consola.
 * No se reintenta: un bucle de reintentos dentro de `after()` es peor que el
 * fallo que intenta arreglar. La fila se queda en 'pendiente', que sigue siendo
 * verdad y se puede reenviar a mano desde la pestaña.
 */
async function marcarEstado(
  contratoId: string,
  estado: "enviado" | "error_envio",
  programaId: string,
): Promise<void> {
  const pat = await rest("PATCH", `contratos?id=eq.${contratoId}`, { estado }, "return=minimal");
  if (pat.status >= 300) {
    console.error("[contrato] no se pudo marcar el estado", estado, pat.status, contratoId, programaId);
  }
}

/**
 * Un nombre de fichero que no rompe en ningún sistema: sin acentos, sin
 * espacios y sin lo que Windows no admite. Si no queda nada utilizable —un
 * nombre entero en otro alfabeto—, cae a "contrato" antes que a un fichero
 * llamado ".pdf".
 */
function normalizarNombreArchivo(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return limpio ? `Contrato-${limpio}` : "contrato";
}

/**
 * Vuelve a mandar un contrato que ya existe, a pedido de una persona.
 *
 * NO regenera nada: coge el PDF que ya está en Storage y lo manda otra vez. Si
 * volviera a generarlo podría salir un documento distinto del que se guardó —
 * los datos de la venta pueden haber cambiado — y entonces el contrato que
 * recibe el equipo no sería el que la pestaña enseña.
 *
 * Por qué existe: el envío automático corre dentro de `after()`, que pasa UNA
 * vez. Si Resend rechaza, la fila queda en 'error_envio' o en 'pendiente' y no
 * había forma de recuperarla sin tocar la base a mano.
 *
 * La clave de idempotencia lleva la hora del reenvío. Sin eso, `yaSeEnvioEmail`
 * encontraría la fila del intento anterior y devolvería `yaEstaba: true` — un
 * éxito falso que dejaría la fila en 'enviado' sin que saliera ningún correo.
 */
export async function reenviarContrato(
  contratoId: string,
): Promise<{ ok: boolean; error?: string; destinos?: string[] }> {
  const rc = await rest<
    { programa_id: string | null; tipo: string | null; pdf_path: string | null; personas: { nombre: string | null } | null }[]
  >("GET", `contratos?id=eq.${contratoId}&select=programa_id,tipo,pdf_path,personas(nombre)&limit=1`);
  const fila = rc.json?.[0];
  if (!fila) return { ok: false, error: "Ese contrato no existe." };
  if (!fila.pdf_path) return { ok: false, error: "Ese contrato no tiene PDF guardado." };
  if (!fila.programa_id) return { ok: false, error: "Ese contrato no está ligado a un programa." };

  const archivo = await getStorageBytes(fila.pdf_path, "contratos");
  if (!archivo) return { ok: false, error: "El PDF ya no está en el almacenamiento." };

  const cliente = fila.personas?.nombre ?? "cliente";
  const tipo = fila.tipo === "ampliacion" ? "ampliacion" : "venta_nueva";
  const correo = emailContrato({ cliente, tipo });

  const rEquipo = await rest<Miembro[]>("GET", "team_members?select=id,username,email");
  const destinos = await destinosDelContrato(Array.isArray(rEquipo.json) ? rEquipo.json : []);
  if (destinos === null) {
    return { ok: false, error: "No se pudo leer si el envío está en modo prueba. No se mandó nada." };
  }
  if (destinos.length === 0) return { ok: false, error: "No hay ninguna dirección a la que mandarlo." };

  const r = await enviarYRegistrarEmail({
    to: destinos,
    asunto: correo.asunto,
    html: correo.html,
    texto: correo.texto,
    adjuntos: [
      {
        filename: `${normalizarNombreArchivo(cliente)}.pdf`,
        content: Buffer.from(archivo.bytes).toString("base64"),
        content_type: "application/pdf",
      },
    ],
    clave: claveContrato(fila.programa_id, `r${Date.now()}`),
    tipo: "contrato" as const,
    from: (process.env.EMAIL_FROM_EQUIPO ?? "").trim() || undefined,
  });

  await marcarEstado(contratoId, r.ok ? "enviado" : "error_envio", fila.programa_id);
  return r.ok ? { ok: true, destinos } : { ok: false, error: r.error ?? "Resend rechazó el envío." };
}

/**
 * A quién va el contrato: las direcciones de prueba si el modo prueba está
 * encendido, y si no las del equipo. Compartida por el envío automático y el
 * reenvío para que los dos manden exactamente a lo mismo.
 */
async function destinosDelContrato(equipo: Miembro[]): Promise<string[] | null> {
  const prueba = await destinatariosDePrueba();
  // `null` = no se pudo saber en qué modo estamos. No se adivina: se frena.
  // Quien llama lo trata como "nadie a quien mandarlo".
  if (prueba === null) return null;
  if (prueba.length > 0) return prueba;
  return equipo
    .filter((m) => m.username && DESTINATARIOS.includes(m.username))
    .sort((a, b) => DESTINATARIOS.indexOf(a.username!) - DESTINATARIOS.indexOf(b.username!))
    .map((m) => (m.email ?? "").trim())
    .filter(Boolean);
}

/**
 * Regenera el PDF de un contrato ya emitido con los datos ACTUALES de la
 * venta (bonos, duración) y lo reenvía — a diferencia de `reenviarContrato`,
 * que reusa a propósito el PDF viejo. Existe para el hallazgo #2 de Milo
 * (PR #3): un contrato emitido no se enteraba si los bonos se corregían
 * después de mandarlo.
 *
 * Pisa el mismo `pdf_path` (`${programaId}.pdf`) — mismo criterio que la
 * emisión original, no deja huérfanos en Storage.
 *
 * El pago se relee por `programa_id` (no se guarda `pago_id` en `contratos`):
 * mismo patrón ya usado en `app/actions.ts:840` para el mismo problema.
 *
 * 🔴 ESA SOBRESCRITURA ES LO QUE HAY QUE VIGILAR, Y POR ESO ESTO YA NO ENTRA A
 * CIEGAS. Cuando se escribió, el contrato solo viajaba al equipo por correo:
 * pisar el PDF no le hacía daño a nadie. Hoy ese mismo fichero es el que el
 * cliente lee en `/c/<token>/pdf` y el que `firmarContrato` vuelve a hashear
 * antes de dejarle firmar. Así que antes de tocar Storage se le pregunta a
 * `bloqueoRecorregir` (lib/contrato-guardas.ts, puro y con tests), que dice que
 * no en cuatro casos: firmado, editado a mano, con el enlace del cliente en
 * pie, y la plantilla v2 entera.
 *
 * SE NIEGA; NO ARREGLA SOBRE LA MARCHA. Para el enlace vivo había otra salida
 * posible —recorregir igualmente y matar el token en la misma operación— y se
 * descartó a conciencia: el cliente perdería sin previo aviso un enlace que
 * puede tener abierto en ese momento, y nadie se lo diría, porque esta función
 * solo sabe contestar "recorregido y enviado a …" y quien la llama es un modal
 * de bonos (`components/RecorregirContrato.tsx`). Negarse no destruye nada y
 * deja en pie el camino que YA existe y que sí anuncia lo que hace: editar el
 * texto (`guardarTextoYRegenerar`, que regenera y devuelve `requiereReenvio`) y
 * volver a mandarle el enlace.
 */
export async function recorregirContrato(
  contratoId: string,
): Promise<{ ok: boolean; error?: string; destinos?: string[] }> {
  // ⚠️ ANTES DEL DEPLOY, como el `select` de `construirContratoPDF`: cinco de
  // las columnas de este `select` (`firmado_at`, `enviado_cliente_at`,
  // `token_expira_at`, `texto_generado`, `texto_final`) las crea la 0065, que
  // está escrita y revisada pero SIN APLICAR. PostgREST responde 400 a la
  // petición ENTERA cuando se le pide una columna que no existe —no solo a esa
  // columna— y `rest()` no lanza nunca: sin el `rc.status` de aquí abajo, ese
  // 400 se leería como "ese contrato no existe" y recorregir dejaría de
  // funcionar para TODOS, v1 incluidos, con un mensaje que además miente.
  // (`estado` no es de esas: existe desde la 0004 y se pide para que la guarda
  // de "firmado" mire lo mismo que mira la pestaña — ver contrato-guardas.ts.)
  const rc = await rest<
    {
      persona_id: string; programa_id: string | null; tipo: string | null; estado: string | null;
      firmado_at: string | null; enviado_cliente_at: string | null; token_expira_at: string | null;
      texto_generado: string | null; texto_final: string | null;
    }[]
  >(
    "GET",
    `contratos?id=eq.${contratoId}&select=persona_id,programa_id,tipo,estado,` +
      `firmado_at,enviado_cliente_at,token_expira_at,texto_generado,texto_final&limit=1`,
  );
  if (rc.status >= 300) {
    console.error("[contrato] no se pudo leer el contrato a recorregir", contratoId, rc.status, rc.json);
    return { ok: false, error: "No se pudo leer el contrato. Inténtalo otra vez." };
  }
  const fila = rc.json?.[0];
  if (!fila) return { ok: false, error: "Ese contrato no existe." };
  if (!fila.programa_id) return { ok: false, error: "Ese contrato no está ligado a un programa." };

  // Las guardas, antes de generar nada y mucho antes de subir nada. La decisión
  // vive entera en `contrato-guardas.ts` —pura, total y con la tabla de casos
  // en tests— y aquí solo se obedece: este fichero lleva `server-only` y alias
  // `@/`, así que una condición escrita AQUÍ no podría probarse bajo vitest.
  const bloqueo = bloqueoRecorregir(fila, new Date());
  if (bloqueo) return { ok: false, error: bloqueo.error };

  // A partir de aquí solo hay `venta_nueva`, `ampliacion` y las filas
  // históricas sin tipo: la guarda `plantilla_nueva` se llevó todo lo demás,
  // por lista blanca. Por eso este ternario —igual de permisivo: todo lo que no
  // sea "ampliacion" sale como "venta_nueva"— sigue siendo correcto. Si algún
  // día se levanta esa guarda, esto es LO PRIMERO que hay que arreglar, porque
  // una fila v2 saldría de aquí con el documento de la plantilla anterior
  // encima del bueno.
  const tipo = fila.tipo === "ampliacion" ? ("ampliacion" as const) : ("venta_nueva" as const);

  // `tipo=in.(nueva,upsell)` explícito, no solo `order=fecha.desc`: un
  // `refund` (0046_devoluciones_rpc.sql:155) también inserta con
  // `programa_id` propio, y una devolución registrada después de la venta
  // sería más reciente que el pago original — el filtro por tipo la excluye
  // por diseño en vez de confiar en el orden. `nueva` es el pago de la venta
  // nueva, `upsell` el de una ascensión (0052_bono_duracion_50.sql:168-172),
  // que son justo los dos tipos de contrato que existen (Task 3).
  const rPago = await rest<{ id: string }[]>(
    "GET",
    `pagos?programa_id=eq.${fila.programa_id}&tipo=in.(nueva,upsell)&select=id&order=fecha.desc&limit=1`,
  );
  const pagoId = rPago.json?.[0]?.id;
  if (!pagoId) return { ok: false, error: "No se encontró el pago de esta venta." };

  const construido = await construirContratoPDF(fila.persona_id, fila.programa_id, pagoId, tipo);
  if (!construido) return { ok: false, error: "No se pudo regenerar el PDF — revisá los logs." };

  const path = `${fila.programa_id}.pdf`;
  const bytes = new Uint8Array(construido.pdf).buffer;
  const subido = await uploadToStorage(path, bytes, "application/pdf", "contratos");
  if (!subido) return { ok: false, error: "No se pudo subir el PDF regenerado." };

  const destinos = await destinosDelContrato(construido.equipo);
  if (destinos === null) {
    return { ok: false, error: "No se pudo leer si el envío está en modo prueba. No se mandó nada." };
  }
  if (destinos.length === 0) return { ok: false, error: "No hay ninguna dirección a la que mandarlo." };

  const correo = emailContrato({ cliente: construido.datos.cliente_nombre, tipo, recorregido: true });
  const r = await enviarYRegistrarEmail({
    to: destinos,
    asunto: correo.asunto,
    html: correo.html,
    texto: correo.texto,
    adjuntos: [
      {
        filename: `${normalizarNombreArchivo(construido.datos.cliente_nombre)}.pdf`,
        content: construido.pdf.toString("base64"),
        content_type: "application/pdf",
      },
    ],
    clave: claveContrato(fila.programa_id, `recorregido-${Date.now()}`),
    tipo: "contrato" as const,
    from: (process.env.EMAIL_FROM_EQUIPO ?? "").trim() || undefined,
  });

  const pat = await rest(
    "PATCH",
    `contratos?id=eq.${contratoId}`,
    {
      estado: r.ok ? "enviado" : "error_envio",
      recorregido_at: new Date().toISOString(),
      // Y se apaga el aviso rojo en el MISMO PATCH. Así la pantalla no tiene
      // que comparar fechas para saber cuál de las dos marcas manda: si
      // `desactualizado_at` sigue puesta, es que esta corrección no llegó a
      // terminar, y el PDF de la bandeja sigue siendo el viejo.
      desactualizado_at: null,
      // 🔴 NO se escriben `texto_generado` ni `texto_final`, aunque el brief de
      // la Task 19 lo pedía, y el motivo es más estrecho de lo que parece.
      // `generarContrato` inserta los dos textos para TODOS los tipos, así que
      // una `ampliacion` nacida de ahí ya los tiene y escribirlos no le
      // cambiaría nada. Las filas a las que sí les cambiaría el comportamiento
      // son las v1 LEGADAS —las 3 de producción, emitidas antes del 16-sep con
      // `texto_final` nulo—: hoy `textoDeContrato` devuelve null para ellas y el
      // modal de la venta dice "es de la plantilla anterior, no se edita ni se
      // firma aquí"; con un texto escrito les abriría el editor, y
      // `guardarTextoYRegenerar` lo rechazaría después por no ser v2. Eso es
      // cambiar la v1, que es lo único que este plan promete no tocar.
      //
      // EFECTO LATERAL QUE SE ACEPTA, dicho aquí para que no se descubra solo:
      // una `ampliacion` nacida de `generarContrato` queda, tras recorregir,
      // con `texto_final` describiendo los bonos VIEJOS y el PDF de Storage los
      // nuevos. La fila y el fichero divergen. No es peligroso —firmar exige v2
      // y el editor está gateado a v2, así que nadie renderiza desde ese
      // texto—, pero hoy no lo declara nadie más que este comentario.
      //
      // El día que la v2 se recorrija de verdad, el texto sí va en este PATCH,
      // pero pasando por `compactarHuecos` (como hace `generarContrato`) y con
      // `datos_bloque` refrescado en la misma escritura.
    },
    "return=minimal",
  );
  // Mismo criterio que marcarEstado(): si el PATCH falla no hay reintento
  // (un bucle acá es peor que el fallo que intenta arreglar), pero SÍ queda
  // logueado — antes esto se descartaba en silencio, y un PDF regenerado sin
  // marcar recorregido_at en la fila es exactamente el bug #2 de vuelta.
  if (pat.status >= 300) {
    console.error("[contrato] recorregido, pero no se pudo marcar la fila", pat.status, contratoId);
  }
  return r.ok ? { ok: true, destinos } : { ok: false, error: r.error ?? "Resend rechazó el envío." };
}

/**
 * Renderiza el PDF "para firmar" desde el texto guardado y lo deja en
 * `pdf_path`, pisando lo que hubiera. Devuelve los BYTES SUBIDOS, y ese es el
 * detalle que importa: quien los hashee está hasheando exactamente lo que el
 * cliente se va a descargar, sin pasar por una relectura de Storage en la que
 * cabría otra escritura.
 *
 * Lo comparten los dos sitios que reescriben `pdf_path` DESPUÉS de que el
 * contrato exista —`guardarTextoYRegenerar` (donde vivía inline) y
 * `enviarContratoAlCliente`— para que no puedan divergir: el día que el
 * bloque de firma pida un dato más, lo pide en los dos sitios a la vez.
 *
 * Ojo, que no son los únicos que escriben ahí: `generarContrato` también
 * sube a `pdf_path`, y en su camino de error puede pisar el PDF de un
 * contrato v2 ya enviado (lo explica en su propio comentario, donde admite
 * ser "el único caso en que se puede pisar un PDF"). Falla cerrado —el hash
 * deja de cuadrar y el enlace muere— pero si algún día se toca ese camino,
 * mírese también desde aquí.
 *
 * `firma_cliente` y `firma_evidencia` vacíos: este PDF es el que se manda a
 * firmar, no el firmado. Los dos están en OPCIONALES, así que el hueco se
 * pinta como la línea en blanco donde firmará el cliente. El resto de lo que
 * `BLOQUE_FIRMA` pide sale de `datos_bloque`, guardado al generar.
 *
 * NO toca `hash_enviado` ni ninguna otra columna: esta función solo sabe de
 * Storage. Qué significa haber regenerado —matar el enlace viejo o sellar el
 * nuevo— lo decide quien llama, que es donde están los comentarios.
 */
async function regenerarPdfParaFirmar(
  pdfPath: string,
  texto: string,
  datosBloque: Record<string, string> | null,
): Promise<{ ok: true; pdf: Buffer } | { ok: false; error: string }> {
  let pdf: Buffer;
  try {
    pdf = await renderizarContratoPDF(texto, BLOQUE_FIRMA, {
      ...(datosBloque ?? {}),
      firma_cliente: "",
      firma_evidencia: "",
    });
  } catch (e) {
    // `rellenar` lanza con el nombre del dato que falta: se lo enseñamos.
    return { ok: false, error: `No se pudo generar el PDF: ${mensajeDe(e)}` };
  }
  const subido = await uploadToStorage(pdfPath, new Uint8Array(pdf).buffer, "application/pdf", "contratos");
  if (!subido) return { ok: false, error: "No se pudo subir el PDF." };
  return { ok: true, pdf };
}

/**
 * Manda al cliente el enlace de firma. Cada envío es un token NUEVO (el
 * anterior muere), REGENERA el PDF desde `texto_final` y guarda el hash de lo
 * que acaba de subir: al firmar se comprueba que sigue siendo ese. El porqué
 * de regenerar algo que ya existía está en el bloque 🔴 de dentro, junto a la
 * llamada — no es trabajo duplicado.
 *
 * El modo prueba manda: si `contrato_modo_prueba` está encendido, esto va al
 * buzón de pruebas y no al cliente, igual que la copia interna.
 *
 * EL ORDEN IMPORTA: el token, su caducidad, el hash del PDF Y
 * `enviado_cliente_at` se escriben TODOS antes de mandar el correo — los
 * cuatro en el mismo PATCH. Si el proceso muere entre ese PATCH y el envío,
 * queda un enlace vivo sin correo — se puede reenviar (rota el token) o el
 * closer se entera por la pestaña de que el `estado` nunca llegó a
 * "enviado_cliente". Si se mandara primero, un fallo de escritura DESPUÉS de
 * que Resend ya aceptó dejaría un correo con un enlace que la base no
 * reconoce.
 *
 * 🔴 Por qué `enviado_cliente_at` va en el PRIMER PATCH y no en el segundo
 * (junto a `estado`, más abajo), aunque el nombre sugiera "ya se mandó":
 * `estadoDelEnlace` (lib/contrato-firma.ts) exige `enviado_cliente_at` no
 * nulo para considerar el enlace "listo" — es la condición que decide si
 * `/c/<token>` deja pasar o dice "enlace no válido", y no distingue ese caso
 * de "inexistente" o "caducado" a propósito (misma decisión que el portal de
 * estrategias: no confirmarle a quien prueba tokens cuál existe).
 *
 * En un PRIMER envío, `enviado_cliente_at` nace en NULL. Si esta columna se
 * escribiera en el segundo PATCH (después de que Resend ya aceptó) y ESE
 * PATCH fallara, la fila quedaría con `token` y `token_expira_at` vigentes
 * pero `enviado_cliente_at` en null — el cliente recibe un correo legítimo,
 * abre su enlace, y `estadoDelEnlace` le dice "no_activo". Ni él ni el closer
 * se enteran: la action ya devolvió `{ok:true}` porque Resend había
 * aceptado. Es EXACTAMENTE el caso que un revisor encontró el 16-sep.
 *
 * Escribiéndolo aquí, antes de mandar, el enlace queda operativo en cuanto
 * este PATCH sale bien — igual que el token y el hash — y ya no depende de
 * una segunda escritura posterior al compromiso de Resend. El PATCH de más
 * abajo se queda solo con `estado`, que es contabilidad para la pestaña
 * (`app/(os)/contratos/page.tsx`, columna EstadoContrato) y no con lo que
 * decide si el enlace del cliente responde.
 *
 * El coste que se acepta a cambio: si el PRIMER PATCH sale bien pero el
 * envío de después falla, la fila dice `enviado_cliente_at` con una marca de
 * tiempo aunque el correo no llegara. Es el trade-off correcto porque un
 * enlace vivo que nadie recibió es inofensivo — el token no se filtra a
 * nadie sin el correo, y el closer, que SÍ ve el `{ok:false}` de la action,
 * puede reenviar sin más coste que rotar el token otra vez — mientras que un
 * enlace que el cliente ya tiene en la mano y el sistema rechaza es un
 * cliente bloqueado sin explicación. Y para el equipo, mirando la pestaña,
 * no hay señal falsa: el `estado` (lo único que esa pantalla pinta) solo
 * pasa a "enviado_cliente" si Resend aceptó — `enviado_cliente_at` no se
 * muestra en ninguna pantalla hoy, solo lo consume `estadoDelEnlace`.
 */
export async function enviarContratoAlCliente(
  contratoId: string,
  autorId: string,
): Promise<{ ok: true; destino: string; enPrueba: boolean } | { ok: false; error: string }> {
  const rc = await rest<{
    id: string; persona_id: string; programa_id: string | null; tipo: string | null;
    pdf_path: string | null; firmado_at: string | null; texto_final: string | null;
    datos_bloque: Record<string, string> | null;
    personas: { nombre: string | null; email: string | null } | null;
  }[]>(
    "GET",
    `contratos?id=eq.${contratoId}&select=id,persona_id,programa_id,tipo,pdf_path,firmado_at,texto_final,` +
      `datos_bloque,personas(nombre,email)&limit=1`,
  );
  const c = rc.json?.[0];
  if (!c) return { ok: false, error: "Ese contrato no existe." };
  if (c.tipo !== "venta_nueva_v2") return { ok: false, error: "Este contrato es de la plantilla anterior y no se firma en el OS." };
  if (c.firmado_at) return { ok: false, error: "Ya está firmado." };
  if (!c.pdf_path || !c.texto_final || !c.programa_id) return { ok: false, error: "El contrato no tiene PDF generado. Genera primero." };

  const email = (c.personas?.email ?? "").trim();
  if (!RE_EMAIL.test(email)) {
    return { ok: false, error: "El cliente no tiene un email válido en su ficha. Añádelo y vuelve a enviar." };
  }

  // Tres respuestas, no dos (lib/ajustes.ts): `[]` es "manda de verdad", una
  // lista es "manda a estas de prueba", `null` es "no se pudo saber — no
  // mandes nada". Tratar `null` como `[]` mandaría un contrato real al
  // cliente cuando el sistema no podía confirmar que el modo prueba estaba
  // apagado.
  const prueba = await destinatariosDePrueba();
  if (prueba === null) return { ok: false, error: "No se pudo leer si el envío está en modo prueba. No se mandó nada." };
  const enPrueba = prueba.length > 0;
  const destino = enPrueba ? prueba : [email];

  const base = (process.env.PORTAL_BASE_URL ?? "").trim();
  if (!base) return { ok: false, error: "Falta PORTAL_BASE_URL en las env vars." };

  // ══════════════════════════════════════════════════════════════════════
  // 🔴 EL PDF SE REGENERA AQUÍ AUNQUE YA EXISTA EN STORAGE. NO ES TRABAJO
  // DUPLICADO, Y QUITARLO REABRE LA ÚNICA GRIETA DE "EL CLIENTE FIRMA LO QUE
  // LEYÓ" — que es la propiedad entera de este módulo.
  //
  // `hash_enviado` (unas líneas más abajo) es el sha256 de lo que hay en
  // `pdf_path`, y `firmarContrato` renderiza el PDF firmado desde
  // `texto_final`. Los tres cerrojos de hash del módulo comparan el PDF
  // CONSIGO MISMO a lo largo del tiempo: ninguno comprueba que el fichero
  // diga lo mismo que la fila. Esa comprobación no existe en ninguna parte;
  // lo único que la sostenía era que `guardarTextoYRegenerar` sube el PDF y
  // PATCHea el texto en el mismo acto.
  //
  // Y ese acto se puede partir por la mitad: si la subida sale y el PATCH
  // falla ("El PDF se regeneró pero el texto no quedó guardado"), Storage se
  // queda con el texto NUEVO y la fila con el VIEJO. Si el contrato todavía
  // no se había mandado —el caso normal, porque se genera, se edita y se
  // manda en la misma sesión—, este envío hashearía el PDF nuevo, el cliente
  // leería el texto nuevo, y al firmar se renderizaría el viejo desde
  // `texto_final`. Los tres cerrojos pasarían en verde y nadie se enteraría.
  //
  // Regenerando aquí, "lo que hay en Storage" == "render(texto_final)" POR
  // CONSTRUCCIÓN en el instante exacto en que se toma el hash, venga de donde
  // viniera el fichero anterior. Cierra esa ventana y cualquier otra futura
  // que escriba uno de los dos sin el otro. Cuesta un render por envío.
  //
  // SI LA REGENERACIÓN FALLA NO SE MANDA NADA, y se sale ANTES del PATCH: sin
  // token, sin caducidad y sin `enviado_cliente_at`, o sea con la fila y el
  // enlace anterior exactamente como estaban. Mandar el PDF viejo "porque ya
  // estaba" sería mandar un documento del que no se puede afirmar qué dice, y
  // el propósito entero de este envío es que el hash describa lo que el
  // cliente va a leer.
  //
  // LO QUE SÍ CUESTA ALGO, Y CONVIENE NO OLVIDARLO: la regeneración escribe
  // en Storage ANTES de que el PATCH de abajo tenga ocasión de fallar. En un
  // REENVÍO —contrato ya mandado, enlace vivo— una subida buena seguida de un
  // PATCH malo deja `pdf_path` con bytes nuevos y `hash_enviado` con el de
  // los viejos, y eso MATA el enlace que el cliente pueda tener abierto: los
  // cerrojos del visor comparan el fichero con el hash y dejan de cuadrar.
  // Y pasa aunque el texto sea idéntico, porque pdfkit estampa un
  // `CreationDate` distinto en cada render (ver el comentario de
  // `contrato-firma-datos.ts` sobre por qué el PDF firmado no se puede
  // recomponer byte a byte). Sigue fallando cerrado —nadie firma lo que no
  // leyó— pero no es gratis, y por eso el mensaje de error de más abajo dice
  // que el enlace anterior ha dejado de valer en vez de sugerir que no ha
  // pasado nada.
  // ══════════════════════════════════════════════════════════════════════
  const regen = await regenerarPdfParaFirmar(c.pdf_path, c.texto_final, c.datos_bloque);
  if (!regen.ok) return { ok: false, error: regen.error };

  const token = nuevoToken();
  const enlace = enlaceFirma(base, token);
  const ahora = new Date();

  // El token, el hash Y `enviado_cliente_at` se escriben ANTES de mandar:
  // cuando el correo llegue, el enlace tiene que estar ya "listo" para
  // `estadoDelEnlace` — no a medias, esperando un segundo PATCH posterior al
  // envío. Ver el porqué de `enviado_cliente_at` aquí (y no junto a `estado`,
  // más abajo) en el comentario de cabecera de esta función.
  //
  // `firmado_at=is.null` en el filtro: si el cliente firmó en el segundo
  // exacto en que Alex pulsaba "enviar", este PATCH afecta 0 filas y no hay
  // forma de rotar el token de un contrato ya firmado por debajo del acto de
  // firmar. `pt.status` sigue siendo <300 con 0 filas afectadas (no se pidió
  // `return=representation`), así que esa carrera no se distingue aquí — el
  // check de `c.firmado_at` de arriba, leído unos milisegundos antes, es la
  // única defensa; la ventana es la misma que ya acepta `reenviarContrato`.
  const pt = await rest(
    "PATCH",
    `contratos?id=eq.${c.id}&firmado_at=is.null`,
    {
      token,
      token_expira_at: caducidad(ahora),
      // El hash de los bytes que ACABAN de subirse, no de una relectura de
      // Storage: entre subir y releer cabe otra escritura.
      hash_enviado: hashPdf(regen.pdf),
      enviado_cliente_at: ahora.toISOString(),
    },
    "return=minimal",
  );
  if (pt.status >= 300) {
    // No es "no ha pasado nada": el PDF ya se regeneró arriba, así que un
    // enlace anterior que estuviera vivo acaba de dejar de valer. Se lo
    // decimos, porque la acción que toca es volver a enviar, no esperar.
    return {
      ok: false,
      error: "No se pudo preparar el enlace. Si ya le habías enviado uno, ha dejado de valer: vuelve a enviarlo.",
    };
  }
  await registrarEvento(c.id, "enlace_rotado", null, { autor_id: autorId });

  const correo = emailContratoCliente({ cliente: c.personas?.nombre ?? "", enlace, dias: DIAS_CADUCIDAD });
  let r: ResultadoEnvioEmail;
  try {
    r = await enviarYRegistrarEmail({
      to: destino,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      clave: claveContratoCliente(c.programa_id, token),
      tipo: "contrato_cliente",
      personaId: c.persona_id,
      // Sin `from`: cae a EMAIL_FROM, la identidad de Berni — el correo es
      // "de" quien vende, no del equipo (regla de oro de este repo: nunca
      // @gmail.com como From).
    });
  } catch (e) {
    return { ok: false, error: `No se pudo mandar: ${String(e)}` };
  }
  if (!r.ok) return { ok: false, error: r.error ?? "Resend rechazó el envío." };

  // Solo `estado`: contabilidad para la pestaña. `enviado_cliente_at` ya
  // quedó escrito en el PATCH de arriba, ANTES de mandar — el enlace ya
  // estaba vivo mientras Resend procesaba el envío.
  const pe = await rest(
    "PATCH",
    `contratos?id=eq.${c.id}`,
    { estado: "enviado_cliente" },
    "return=minimal",
  );
  if (pe.status >= 300) console.error("[contrato] enviado al cliente pero la fila no se marcó", c.id, pe.status);
  await registrarEvento(c.id, "enviado", null, { destino: destino.join(", "), en_prueba: enPrueba, autor_id: autorId });
  return { ok: true, destino: destino.join(", "), enPrueba };
}

/* ══════════════════════════════════════════════════════════════════════════
   GENERAR SIN MANDAR · EDITAR · REGENERAR      (spec, decisiones 3 y 4)
   ══════════════════════════════════════════════════════════════════════════
   Todo lo de arriba es el camino viejo: el contrato se genera y sale al
   equipo de un tirón, dentro de `after()`. Lo de aquí abajo es el nuevo: se
   genera al registrar la venta y NO sale a nadie; Alex lo lee, lo corrige si
   hace falta —"como un Word"— y solo entonces se manda al cliente
   (`enviarContratoAlCliente`).

   Por eso estas tres funciones SÍ devuelven el error en vez de tragárselo.
   No corren dentro de `after()` sino dentro de una server action, con el
   closer mirando la pantalla: un fallo que solo llega a consola aquí es un
   modal que se queda en blanco y una venta que nadie sabe si tiene contrato.
   ══════════════════════════════════════════════════════════════════════════ */

/** El mensaje de un error, venga como venga. */
function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Lo que `datos_bloque` tiene que guardar: exactamente las claves que
 * `BLOQUE_FIRMA` pide y que el acto de firmar NO pone (hoy `cliente_nombre`
 * y `fecha_firma`).
 *
 * La lista sale de `CLAVES_BLOQUE` (contrato-firma-datos.ts), que la deriva de
 * la plantilla, y no de dos nombres escritos aquí a mano: es la misma lista
 * que `firmarContrato` exige al firmar. Ver el porqué completo junto a esa
 * constante — resumido: escrita dos veces, el día que alguien añada un
 * `{{dni}}` al bloque, el lado que lee lo empieza a pedir y el lado que
 * escribe no se entera.
 *
 * Solo para v2: las plantillas v1 llevan su bloque de firma DENTRO del cuerpo
 * y no se firman en el OS, así que su `datos_bloque` se queda en `{}` y
 * `firmarContrato` las rechaza antes de mirarlo.
 */
function datosDelBloque(datos: Record<string, string>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const k of CLAVES_BLOQUE) {
    const v = datos[k];
    if (v !== undefined) salida[k] = v;
  }
  return salida;
}

/** El email al que va el enlace de firma. Vacío o ausente cuentan igual. */
async function emailDePersona(personaId: string): Promise<string | null> {
  const r = await rest<{ email: string | null }[]>(
    "GET",
    `personas?id=eq.${personaId}&select=email&limit=1`,
  );
  return (Array.isArray(r.json) ? r.json[0]?.email : null)?.trim() || null;
}

type ContratoDelPrograma =
  | { hay: false }
  | {
      hay: true;
      datos:
        | {
            contratoId: string; texto: string; textoGenerado: string;
            email: string | null;
            // 🔴 EL DE LA FILA, no el que le tocaría a la venta hoy. Es toda la
            // diferencia: de aquí sale el `editable` del editor, y una fila v1
            // tiene que abrirse en lectura aunque la plantilla por defecto ya
            // sea la v2. Ver `tipoDeFila`, más abajo.
            tipo: TipoContratoVenta;
          }
        | null;
    };

/**
 * El `tipo` de una fila de `contratos`, tal y como vale para decidir qué se
 * puede hacer con ella.
 *
 * LISTA BLANCA, y en la dirección segura: lo que no se reconozca —`null` de
 * una fila histórica, o un valor que no esperábamos— sale como `venta_nueva`,
 * que es el tipo que NO se edita ni se firma en el OS. Equivocarse hacia "v1"
 * cuesta un modal en lectura de más; equivocarse hacia "v2" abre un textarea
 * editable sobre un documento que el servidor va a rechazar guardar.
 *
 * Es la misma forma y el mismo criterio del ternario de `recorregirContrato`.
 */
function tipoDeFila(tipo: string | null): TipoContratoVenta {
  if (tipo === "venta_nueva_v2") return "venta_nueva_v2";
  if (tipo === "ampliacion") return "ampliacion";
  return "venta_nueva";
}

/**
 * ¿Esta venta ya tiene contrato, y se puede abrir en el editor?
 *
 * Se pregunta ANTES de generar nada, y esa es toda la gracia: el índice único
 * de `contratos.programa_id` (0057) devuelve un 409 en el INSERT, o sea
 * DESPUÉS de haber subido el PDF a `${programaId}.pdf` — que es la misma
 * clave del contrato que ya existía. Sin esta comprobación previa, reabrir el
 * modal de una venta vieja le pisa el PDF guardado con uno recién generado
 * (con los datos de HOY, que pueden no ser los del día de la venta) y solo
 * después descubre que no hacía falta. Para eso ya está `recorregirContrato`,
 * que es de administrador y avisa a quien corresponde.
 *
 * `hay: true, datos: null` es el contrato v1 ya emitido: existe, pero nació
 * sin `texto_final` y no hay nada que editar.
 */
async function contratoDelPrograma(programaId: string): Promise<ContratoDelPrograma> {
  const r = await rest<{ id: string; tipo: string | null }[]>(
    "GET",
    `contratos?programa_id=eq.${programaId}&select=id,tipo&limit=1`,
  );
  const fila = Array.isArray(r.json) ? r.json[0] : null;
  const id = fila?.id ?? null;
  if (!id) {
    // Una lectura rota NO es "no hay contrato", pero tampoco frena: el 409 del
    // índice único sigue siendo el antiduplicados de verdad, y frenar aquí
    // dejaría una venta sin contrato por un hipo de red. Queda dicho en
    // consola porque es también el único caso en que se puede pisar un PDF.
    if (r.status >= 300) {
      console.error("[contrato] no se pudo comprobar si ya existía", programaId, r.status, r.json);
    }
    return { hay: false };
  }
  const t = await textoDeContrato(id);
  return {
    hay: true,
    datos: t
      ? {
          contratoId: id, texto: t.texto, textoGenerado: t.textoGenerado,
          email: t.email, tipo: tipoDeFila(fila?.tipo ?? null),
        }
      : null,
  };
}

/**
 * Genera el contrato de una venta y lo deja en `pendiente`, SIN mandarlo a
 * nadie. Lo llama el modal que se abre al registrar la venta (decisión 3 de
 * la spec: fuera de `after()`, para que un fallo se vea).
 *
 * Si ya existía, devuelve el que hay con `yaExistia: true` y no genera nada:
 * el closer acaba de registrar la venta y espera ver SU contrato, no un
 * error. Reabrir el modal no duplica ni pisa.
 *
 * El PDF se sube antes de insertar la fila, igual que en el camino viejo y
 * por el mismo motivo: el 409 del índice único es lo que impide el duplicado,
 * y para ganárselo hay que llegar al INSERT.
 */
export async function generarContrato(
  personaId: string,
  programaId: string,
  pagoId: string,
  tipoVenta: string,
  autorId: string,
): Promise<
  // `tipo` viaja de vuelta porque quien abre el editor tiene que saber si se
  // puede editar: solo la v2 se edita y se firma en el OS, y el componente no
  // puede averiguarlo solo (`contratos.tipo` no viaja en ninguna otra
  // respuesta).
  //
  // Es SIEMPRE el de la fila que se devuelve: el de la que se acaba de crear
  // en el camino normal, y el que `contratoDelPrograma` leyó de la base en los
  // dos caminos de "ya existía". Las dos cosas coinciden hoy, pero dejan de
  // coincidir el día que la Task 22 haga que `tipoContratoDe("nueva")` empiece
  // a devolver v2 y queden filas v1 de antes.
  | { ok: true; contratoId: string; texto: string; textoGenerado: string; email: string | null; tipo: TipoContratoVenta; yaExistia: boolean }
  | { ok: false; error: string }
> {
  const tipo = tipoContratoDe(tipoVenta);
  if (!tipo) return { ok: false, error: "Este tipo de venta no lleva contrato." };

  const YA_EMITIDO =
    "Esta venta ya tiene un contrato de la plantilla anterior: no se edita ni se firma aquí.";
  const existente = await contratoDelPrograma(programaId);
  if (existente.hay) {
    // 🔴 SIN `tipo` detrás del spread, y no es un descuido. `existente.datos`
    // ya trae el de la FILA; escribir `tipo` aquí lo pisaría con el que le
    // tocaría a esta venta HOY, que es otra cosa en cuanto la Task 22 cambie
    // `tipoContratoDe`: una fila v1 vieja se reportaría como v2, el editor se
    // abriría editable, y el guardado lo rechazaría el servidor. El `tipo`
    // local solo vale para la fila que se crea más abajo, porque es la que se
    // escribe con él.
    return existente.datos
      ? { ok: true, ...existente.datos, yaExistia: true }
      : { ok: false, error: YA_EMITIDO };
  }

  // 🔴 El try/catch NO es de adorno y no estaba en el camino viejo por una
  // razón que aquí ya no vale. `construirContratoPDF` LANZA a propósito en su
  // sección 2 (`datosContrato` si falta un dato del catálogo, `rellenar` si
  // queda un placeholder sin sustituir) — ver su cabecera. Allí lo recogía el
  // catch de `generarYEnviarContrato` (la emisión automática dentro de
  // `after()`, borrada el 16-sep con esta misma tarea). Esto, en cambio,
  // corre dentro de una server action: un throw sin recoger sale por la red
  // como un digest opaco de Next, y el closer ve "algo ha ido mal" sobre una
  // venta ya cobrada. El mensaje del error dice exactamente qué dato falta y
  // es el que hay que enseñarle.
  let construido: ContratoConstruido | null;
  try {
    construido = await construirContratoPDF(personaId, programaId, pagoId, tipo);
  } catch (e) {
    console.error("[contrato] fallo generando el contrato", programaId, e);
    return { ok: false, error: `No se pudo generar el contrato: ${mensajeDe(e)}` };
  }
  if (!construido) return { ok: false, error: "No se pudo generar el contrato — revisa los logs." };
  const { pdf, datos, cuerpo } = construido;

  // El texto que verá el editor, no el que se pintó: una venta sin bonos deja
  // tres líneas en blanco seguidas donde iba `{{bonos}}`, invisibles en el PDF
  // y muy visibles en un textarea. `compactarHuecos` las cierra sin cambiar el
  // documento — hay un test que lo fija (ver su docstring).
  const texto = compactarHuecos(cuerpo);

  // 🔴 Lo que el bloque de firma va a necesitar el día que el cliente firme,
  // comprobado HOY. `cliente_nombre` lo protege `rellenar` (sale también en el
  // cuerpo), pero `fecha_firma` SOLO vive en `BLOQUE_FIRMA`: si llegara vacío
  // —`fecha()` devuelve "" con una fecha de pago nula— el contrato se
  // generaría, se mandaría, y reventaría en `faltanDelBloque` con el cliente
  // delante y el dedo en el botón, que devuelve un "error" sin explicación.
  // Aquí cuesta un mensaje en pantalla y el closer puede arreglar la venta.
  const datosBloque = tipo === "venta_nueva_v2" ? datosDelBloque(datos) : {};
  if (tipo === "venta_nueva_v2") {
    const faltan = CLAVES_BLOQUE.filter((k) => !(datosBloque[k] ?? "").trim());
    if (faltan.length > 0) {
      console.error("[contrato] faltan datos del bloque de firma, no se genera", programaId, faltan);
      return { ok: false, error: `Faltan datos para poder firmarlo: ${faltan.join(", ")}.` };
    }
  }

  // Misma clave que el camino viejo: el id del programa, sin nada aleatorio.
  const path = `${programaId}.pdf`;
  const subido = await uploadToStorage(path, new Uint8Array(pdf).buffer, "application/pdf", "contratos");
  if (!subido) return { ok: false, error: "No se pudo subir el PDF." };

  const ins = await rest<{ id: string }[]>(
    "POST",
    "contratos",
    {
      persona_id: personaId,
      programa_id: programaId,
      tipo,
      // Nace 'pendiente' y se queda ahí: esta función no manda nada. El estado
      // lo mueve quien envía (al equipo o al cliente).
      estado: "pendiente",
      pdf_path: path,
      // NULL a propósito: el contrato acaba de nacer, nadie lo ha firmado.
      fecha_firma: null,
      // Iguales al nacer: si mañana difieren, es que alguien lo editó.
      texto_generado: texto,
      texto_final: texto,
      datos_bloque: datosBloque,
    },
    "return=representation",
  );

  // El 409 es el índice único: alguien se adelantó entre la comprobación de
  // arriba y este INSERT (dos pestañas, dos clics). No es un error — es el
  // antiduplicados haciendo su trabajo. Se devuelve el que ganó la carrera.
  if (ins.status === 409) {
    const otra = await contratoDelPrograma(programaId);
    // Sin `tipo` detrás del spread, por lo mismo que arriba: el que vale es el
    // de la fila que ganó la carrera, que puede no ser la que íbamos a escribir.
    if (otra.hay && otra.datos) return { ok: true, ...otra.datos, yaExistia: true };
    return { ok: false, error: otra.hay ? YA_EMITIDO : "El contrato ya existía pero no se pudo leer." };
  }
  const contratoId = Array.isArray(ins.json) ? ins.json[0]?.id : null;
  if (ins.status >= 300 || !contratoId) {
    console.error("[contrato] EL PDF SE SUBIÓ PERO NO QUEDÓ REGISTRADO", ins.status, ins.json, programaId);
    return { ok: false, error: "El PDF se generó pero no quedó registrado." };
  }

  // La campana de novedades lee de `auditoria`. Si falla, el contrato sigue
  // siendo un éxito: la auditoría no frena una venta ya cobrada.
  try {
    const a = await rest(
      "POST",
      "auditoria",
      {
        entidad: "contrato",
        entidad_id: contratoId,
        accion: "generado",
        autor_id: autorId,
        datos: { persona_id: personaId, programa_id: programaId, tipo },
      },
      "return=minimal",
    );
    if (a.status >= 300) console.error("[contrato] auditoría no escrita", contratoId, a.status, a.json);
  } catch (e) {
    console.error("[contrato] auditoría no escrita", contratoId, e);
  }

  const email = await emailDePersona(personaId);
  return { ok: true, contratoId, texto, textoGenerado: texto, email, tipo, yaExistia: false };
}

/**
 * Lo que el editor necesita para abrirse sobre un contrato que ya existe:
 * el texto vigente, el que produjo la plantilla (para poder deshacer), a
 * quién iría, y si ya no se puede tocar.
 *
 * `null` si el contrato no existe o no tiene texto editable — que es el caso
 * de todos los contratos emitidos antes del 16-sep-2026: nacieron sin
 * `texto_final`, y para ellos no hay editor.
 */
export async function textoDeContrato(contratoId: string): Promise<
  { texto: string; textoGenerado: string; email: string | null; firmado: boolean; enviado: boolean } | null
> {
  const r = await rest<{
    texto_final: string | null;
    texto_generado: string | null;
    firmado_at: string | null;
    enviado_cliente_at: string | null;
    personas: { email: string | null } | null;
  }[]>(
    "GET",
    `contratos?id=eq.${contratoId}` +
      `&select=texto_final,texto_generado,firmado_at,enviado_cliente_at,personas(email)&limit=1`,
  );
  const c = Array.isArray(r.json) ? r.json[0] : null;
  if (!c || !c.texto_final) return null;
  return {
    texto: c.texto_final,
    // Si `texto_generado` faltara, el original es lo mejor que hay: así el
    // botón de "deshacer mis cambios" nunca deja el editor en blanco.
    textoGenerado: c.texto_generado ?? c.texto_final,
    email: c.personas?.email?.trim() || null,
    firmado: !!c.firmado_at,
    enviado: !!c.enviado_cliente_at,
  };
}

/**
 * Guarda el texto que Alex dejó y regenera el PDF desde él (decisión 4 de la
 * spec: "como un Word"). El bloque de firma lo añade el renderer desde
 * `BLOQUE_FIRMA` y los datos de `datos_bloque`: el texto editable no lo lleva
 * y por eso no se puede borrar sin querer la línea donde firma el cliente.
 *
 * 🔴🔴 NO REFRESCA `hash_enviado`, Y ESO NO ES UN OLVIDO.
 *
 * `hash_enviado` es el sha256 del PDF que se le MANDÓ al cliente. Al firmar,
 * `firmarContrato` (contrato-firma-datos.ts, "INVARIANTE DEL QUE DEPENDE 'EL
 * CLIENTE FIRMA LO QUE LEYÓ'") vuelve a hashear el PDF servido y lo compara:
 * si no coincide, no firma. Regenerar el PDF sin tocar ese hash es lo que
 * MATA el enlace viejo a propósito — el cliente ya no puede firmar el
 * documento que se cambió por debajo, y hay que reenviárselo (token nuevo,
 * hash nuevo, correo nuevo), que es exactamente lo que devuelve
 * `requiereReenvio`.
 *
 * Quien "arregle" esta función poniendo aquí un `hash_enviado` nuevo porque
 * el viejo parece caducado, deja que un cliente firme un texto que nunca vio,
 * y no saltará ninguna alarma en ninguna parte. Es el único sitio del sistema
 * donde ese daño se puede hacer con una línea que parece de limpieza.
 *
 * Lo mismo, dicho al revés: aquí se regenera SIEMPRE que cambie el texto. Es
 * la otra mitad del invariante — el PDF de `pdf_path` y `texto_final` tienen
 * que decir lo mismo, porque el PDF que se firma se vuelve a renderizar desde
 * `texto_final`.
 */
export async function guardarTextoYRegenerar(
  contratoId: string,
  texto: string,
  autorId: string,
): Promise<{ ok: true; requiereReenvio: boolean } | { ok: false; error: string }> {
  const t = normalizarTexto(texto);
  const problema = problemaDelTexto(t);
  if (problema) return { ok: false, error: problema };

  const r = await rest<{
    tipo: string | null;
    pdf_path: string | null;
    firmado_at: string | null;
    enviado_cliente_at: string | null;
    texto_generado: string | null;
    texto_final: string | null;
    datos_bloque: Record<string, string> | null;
  }[]>(
    "GET",
    `contratos?id=eq.${contratoId}` +
      `&select=tipo,pdf_path,firmado_at,enviado_cliente_at,texto_generado,texto_final,datos_bloque&limit=1`,
  );
  if (r.status >= 300) return { ok: false, error: "No se pudo leer el contrato. Inténtalo otra vez." };
  const c = Array.isArray(r.json) ? r.json[0] : null;
  if (!c) return { ok: false, error: "Ese contrato no existe." };
  // Solo la v2 se edita: es la única cuyo cuerpo va sin el bloque de firma.
  // Editar una v1 borraría su firma, que vive dentro del texto.
  if (c.tipo !== "venta_nueva_v2") {
    return { ok: false, error: "Solo los contratos de la plantilla nueva se editan aquí." };
  }
  if (c.firmado_at) return { ok: false, error: "Ya está firmado: no se puede cambiar." };
  if (!c.pdf_path) return { ok: false, error: "Este contrato no tiene PDF." };

  // Guardar sin haber cambiado nada no regenera ni obliga a reenviar: el PDF
  // que el cliente tiene delante sigue siendo el bueno y su enlace, vivo.
  if (t === c.texto_final) return { ok: true, requiereReenvio: false };

  // Se pisa el MISMO `pdf_path`. Es lo que deja el enlace viejo sin poder
  // firmar (el hash deja de cuadrar) y lo que hace que no queden PDFs
  // huérfanos en Storage. Ver el bloque 🔴🔴 de la cabecera.
  const regen = await regenerarPdfParaFirmar(c.pdf_path, t, c.datos_bloque);
  if (!regen.ok) return { ok: false, error: regen.error };

  // "Editado" es respecto de lo que produjo la plantilla, no de lo que había
  // guardado: si Alex deshace sus cambios y vuelve al original, la columna
  // tiene que quedar limpia otra vez — nadie editó ese contrato.
  const editado = t !== (c.texto_generado ?? "");
  const pat = await rest<{ id: string }[]>(
    "PATCH",
    `contratos?id=eq.${contratoId}&firmado_at=is.null`,
    {
      texto_final: t,
      texto_editado_por: editado ? autorId : null,
      texto_editado_at: editado ? new Date().toISOString() : null,
      // 🔴 `hash_enviado` NO se toca. Ver la cabecera de esta función.
    },
    "return=representation",
  );
  // Este fallo deja Storage con el texto NUEVO y la fila con el VIEJO, y era
  // la puerta por la que un cliente podía acabar firmando algo distinto de lo
  // que leyó. Ya no llega hasta ahí: `enviarContratoAlCliente` regenera desde
  // `texto_final` antes de hashear, así que lo que se mande será siempre lo
  // que diga la fila. Lo que queda es lo que el mensaje dice — el editor y el
  // PDF guardado discrepan hasta que alguien vuelva a guardar.
  if (pat.status >= 300) return { ok: false, error: "El PDF se regeneró pero el texto no quedó guardado." };
  // Cero filas y un 200: el `firmado_at=is.null` del filtro no encontró nada
  // que tocar, o sea que el cliente firmó en el segundo exacto en que Alex
  // guardaba. Se pide `return=representation` solo para poder distinguirlo:
  // sin eso, una carrera perdida se ve igual que un guardado correcto.
  if (Array.isArray(pat.json) && pat.json.length === 0) {
    return { ok: false, error: "Ya está firmado: no se puede cambiar." };
  }
  return { ok: true, requiereReenvio: !!c.enviado_cliente_at };
}
