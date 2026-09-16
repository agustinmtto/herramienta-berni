import "server-only";
import { isIP } from "node:net";
import { rest } from "@/lib/supabase";
import { getStorageBytes, uploadToStorage } from "@/lib/storage";
import { renderizarContratoPDF } from "@/lib/contrato-pdf";
import { BLOQUE_FIRMA } from "@/lib/contratos/plantilla-v2";
import {
  RE_TOKEN, CONSENTIMIENTO, CONSENTIMIENTO_VERSION,
  estadoDelEnlace, hashPdf, lineaEvidencia,
} from "@/lib/contrato-firma";

// ============================================================
// Lo que la ruta pública /c/<token> necesita de la base, y el acto de firmar.
//
// Es la PRIMERA escritura del OS pedida por alguien sin cookie de equipo. Por
// eso cada paso comprueba algo antes de escribir, y la escritura que importa
// (el PATCH de la firma) lleva `firmado_at=is.null` en el filtro: dos POST a
// la vez → uno escribe, el otro afecta 0 filas. Idempotente por construcción.
//
// Todo lo que decide algo sin tocar la base vive en `contrato-firma.ts` y
// tiene tests. Aquí solo hay orden de operaciones y consultas.
// ============================================================

export type ContratoFirma = {
  id: string;
  persona_id: string;
  programa_id: string | null;
  tipo: string | null;
  estado: string;
  pdf_path: string | null;
  pdf_firmado_path: string | null;
  texto_final: string | null;
  datos_bloque: Record<string, string>;
  firmado_at: string | null;
  firma_nombre: string | null;
  enviado_cliente_at: string | null;
  token_expira_at: string | null;
  hash_enviado: string | null;
  visto_at: string | null;
  personas: { nombre: string | null; email: string | null } | null;
};

const CAMPOS =
  "id,persona_id,programa_id,tipo,estado,pdf_path,pdf_firmado_path,texto_final,datos_bloque," +
  "firmado_at,firma_nombre,enviado_cliente_at,token_expira_at,hash_enviado,visto_at,personas(nombre,email)";

/**
 * Los placeholders que `BLOQUE_FIRMA` exige y que NO pone esta función:
 * hoy `fecha_firma` y `cliente_nombre`, que se guardan en `datos_bloque` al
 * generar el contrato.
 *
 * Se leen de la plantilla y no se escriben a mano a propósito. `rellenar()`
 * (contrato-pdf.ts) lanza con cualquier placeholder ausente que no esté en
 * OPCIONALES, y lo haría DENTRO de `firmarContrato`, en el segundo exacto en
 * que el cliente le da al botón. Leyendo la plantilla, el día que alguien le
 * añada `{{dni}}` el fallo sale por `faltanDelBloque` —con el nombre de la
 * clave que falta y sin haber tocado nada— en vez de reventar en su cara.
 *
 * Se EXPORTA porque `generarContrato` (contrato-envio.ts) escribe
 * `datos_bloque` con exactamente estas claves. Las dos puntas de la misma
 * promesa —lo que se guarda al generar y lo que se exige al firmar— salen así
 * de la misma línea: si alguien añade un placeholder al bloque, el lado que
 * escribe lo empieza a guardar en el mismo commit en que el lado que lee lo
 * empieza a pedir. Escritas a mano en los dos sitios, el día del `{{dni}}`
 * todos los contratos ya emitidos se vuelven imposibles de firmar.
 */
const PONE_LA_FIRMA = new Set(["firma_cliente", "firma_evidencia"]);
export const CLAVES_BLOQUE = [...new Set(
  [...BLOQUE_FIRMA.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
)].filter((k) => !PONE_LA_FIRMA.has(k));

/**
 * Las claves que `datos_bloque` no trae en condiciones. Mismo criterio que
 * `rellenar()` (ausente o vacío) más uno propio: un objeto o un array —jsonb
 * los admite— NO está vacío y se imprimiría dentro del contrato como
 * "[object Object]" o "a,b". Eso cuenta como que falta.
 */
function faltanDelBloque(datos: unknown): string[] {
  const d = (datos ?? {}) as Record<string, unknown>;
  return CLAVES_BLOQUE.filter((k) => {
    const v = d[k];
    if (v === undefined || v === null || typeof v === "object") return true;
    return String(v).trim() === "";
  });
}

/** `datos_bloque` viene de jsonb: puede traer números. El renderer quiere texto. */
function bloqueComoTexto(datos: unknown): Record<string, string> {
  const d = (datos ?? {}) as Record<string, unknown>;
  const salida: Record<string, string> = {};
  // Los objetos se quedan fuera por lo mismo que en `faltanDelBloque`: lo que
  // no se puede escribir como una frase no entra en un contrato.
  for (const [k, v] of Object.entries(d)) {
    if (v !== null && v !== undefined && typeof v !== "object") salida[k] = String(v);
  }
  return salida;
}

/**
 * `firma_ip` y `contrato_eventos.ip` son `inet`: a Postgres no se le puede
 * mandar cualquier cosa. Y lo que llega en `x-forwarded-for` lo escribe una
 * cabecera —no un humano—, así que un valor inventado haría fallar el PATCH
 * de la firma ENTERO con un 400, después de haber subido el PDF firmado. Lo
 * que no parece una IP se guarda como NULL: perder la IP debilita la
 * evidencia, pero no firmar es mucho peor.
 *
 * Lo valida `isIP` de `node:net` y no un regex propio: el regex que había aquí
 * dejaba pasar ":", ":::" , "1:2:3" y "1.2.3.007" —o sea, no cerraba el 400
 * que esta función existe para evitar—. Escribir un validador de IPv6 a mano
 * es una manera cara de equivocarse.
 */
function ipValida(bruta: string | null): string | null {
  if (!bruta) return null;
  // Vercel puede entregar la v6 entre corchetes y con zona (`[fe80::1%eth0]`);
  // el inet de Postgres no quiere ni una cosa ni la otra.
  const s = bruta.trim().replace(/^\[/, "").replace(/\]$/, "").split("%")[0];
  return isIP(s) ? s : null;
}

/** IP, agente y geo tal como los entrega Vercel. Todo puede faltar (local). */
export function datosDePeticion(req: Request): { ip: string | null; userAgent: string | null; geo: string | null } {
  const h = req.headers;
  const ip = ipValida((h.get("x-forwarded-for") ?? "").split(",")[0]) ?? ipValida(h.get("x-real-ip"));
  const userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  const pais = h.get("x-vercel-ip-country");
  const ciudad = h.get("x-vercel-ip-city");
  const geo = [ciudad && descodificar(ciudad), pais].filter(Boolean).join(", ").slice(0, 120) || null;
  return { ip, userAgent, geo };
}

/** `decodeURIComponent` LANZA con un `%` suelto, y esto corre en una ruta pública. */
function descodificar(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * Resuelve un token. `null` para inexistente o mal formado — la página pinta
 * lo mismo en los dos casos. El estado (caducado, firmado) lo decide
 * `estadoDelEnlace` sobre la fila, no esta consulta.
 */
export async function contratoPorToken(token: string): Promise<ContratoFirma | null> {
  const t = (token ?? "").trim();
  if (!RE_TOKEN.test(t)) return null;
  const r = await rest<ContratoFirma[]>(
    "GET",
    `contratos?token=eq.${encodeURIComponent(t)}&select=${CAMPOS}&limit=1`,
  );
  // 🔴 La pantalla es la misma para todo (no se le confirma a nadie qué
  // tokens existen), pero el LOG no: si esto se despliega antes de aplicar la
  // 0065, PostgREST responde 400 por las columnas que faltan y TODOS los
  // firmantes verían "enlace no válido" sin una sola línea en los registros.
  // Es la trampa que la propia 0065 avisa en su cabecera.
  // SOLO EL ESTADO. Ni `json`, ni `message`: el cuerpo de error de PostgREST
  // puede ecoar el valor filtrado, y ese valor es el token — o sea, la
  // credencial con la que se firma. Hasta el 16-sep esta línea nombraba ese
  // riesgo y acto seguido logueaba `message` igual. El estado basta para
  // diagnosticar lo que esto existe para diagnosticar. Va con el `code` de
  // PostgREST, que es un símbolo de PostgreSQL (`42703` = columna que no
  // existe = "falta la 0065") y NO puede contener el valor filtrado: sin él,
  // un 400 no distingue "falta la migración" de "filtro mal formado", que es
  // justo la diferencia que hace falta a las tres de la mañana.
  if (r.status >= 300) {
    const code = (r.json as { code?: string } | null)?.code;
    console.error("[firma] la consulta del token falló", r.status, code ?? "");
  }
  const fila = Array.isArray(r.json) ? r.json[0] : undefined;
  return fila ?? null;
}

/** Una fila en la traza. Nunca lanza: la traza es evidencia, no parte del servicio. */
export async function registrarEvento(
  contratoId: string,
  tipo: "enviado" | "abierto" | "firmado" | "rechazado" | "enlace_rotado",
  req: Request | null,
  datos: Record<string, unknown> = {},
): Promise<void> {
  try {
    const p = req ? datosDePeticion(req) : { ip: null, userAgent: null, geo: null };
    const r = await rest("POST", "contrato_eventos", {
      contrato_id: contratoId, tipo, ip: p.ip, user_agent: p.userAgent, geo: p.geo, datos,
    }, "return=minimal");
    if (r.status >= 300) console.error("[firma] evento no registrado", tipo, contratoId, r.status, r.json);
  } catch (e) {
    console.error("[firma] evento no registrado", tipo, contratoId, e);
  }
}

/** La primera apertura queda en la fila (para la pestaña); todas, en la traza. */
export async function marcarVisto(c: ContratoFirma, req: Request | null): Promise<void> {
  // El evento va PRIMERO: es la evidencia, y no depende de que el UPDATE salga.
  await registrarEvento(c.id, "abierto", req);
  if (c.visto_at) return;
  try {
    await rest("PATCH", `contratos?id=eq.${c.id}&visto_at=is.null`, { visto_at: new Date().toISOString() }, "return=minimal");
  } catch {
    /* telemetría */
  }
}

/** ¿Ya la firmó alguien? Ante la duda (lectura fallida) dice que no: quien manda es el PATCH condicionado. */
async function yaFirmado(id: string): Promise<boolean> {
  try {
    const r = await rest<{ firmado_at: string | null }[]>(
      "GET",
      `contratos?id=eq.${id}&select=firmado_at&limit=1`,
    );
    return Array.isArray(r.json) ? r.json[0]?.firmado_at != null : false;
  } catch {
    return false;
  }
}

export type ResultadoFirma =
  | { ok: true; contratoId: string; personaId: string }
  | { ok: false; motivo: "no_activo" | "firmado" | "hash" | "error" };

/**
 * El acto de firmar. Devuelve el motivo y NO LANZA: lo llama una ruta pública
 * y aquí dentro casi todo puede lanzar sin avisar (`rest` hace fetch y
 * JSON.parse a pelo, y Storage igual). Un throw suelto sería un 500 y un
 * cliente que no sabe si firmó.
 *
 * EL ORDEN ES TODO (y está razonado en task-7-report.md, "qué pasa si el
 * proceso muere en cada paso"):
 *
 *   1. leer por token          — sin fila, no hay nada que firmar
 *   2. estado del enlace       — firmado / caducado / no enviado se van aquí,
 *                                sin escribir ni renderizar nada
 *   3. ¿es firmable?           — v2, con texto, PDF, programa y datos_bloque
 *   4. ¿es el MISMO PDF?       — hash del archivo servido vs `hash_enviado`
 *   5. renderizar el firmado   — todavía sin tocar nada
 *   6. ¿firmó alguien mientras renderizábamos? — si sí, salir sin subir
 *   7. subir a firmados/<programa>-<hash>.pdf — la clave lleva el hash, así
 *      que dos firmas simultáneas escriben en SITIOS DISTINTOS y ninguna
 *      puede pisar a la otra
 *   8. PATCH con `firmado_at=is.null` — 0 filas = otro ganó la carrera
 *   9. evento + auditoría (la campana)
 *
 * La fila NO se marca como firmada hasta que el PDF está subido (paso 8 tras
 * el 7): una fila que dice "firmado" sin documento es una mentira sobre un
 * documento legal.
 */
export async function firmarContrato(token: string, nombre: string, req: Request): Promise<ResultadoFirma> {
  // `firmar` apunta aquí el id en cuanto resuelve el contrato, para que el
  // grito de abajo diga de cuál era. El token NO se loguea: es la credencial.
  const cual: { id?: string } = {};
  try {
    return await firmar(token, nombre, req, cual);
  } catch (e) {
    console.error("[firma] fallo inesperado al firmar", cual.id ?? "(contrato sin resolver)", e);
    return { ok: false, motivo: "error" };
  }
}

async function firmar(
  token: string,
  nombre: string,
  req: Request,
  cual: { id?: string },
): Promise<ResultadoFirma> {
  const c = await contratoPorToken(token);
  if (!c) return { ok: false, motivo: "no_activo" };
  cual.id = c.id;

  const ahora = new Date();
  const estado = estadoDelEnlace(c, ahora);
  if (estado === "firmado") return { ok: false, motivo: "firmado" };
  if (estado === "no_activo") return { ok: false, motivo: "no_activo" };

  // Solo la v2 sabe firmarse: es la única cuyo bloque de firma va aparte y
  // cuyo `texto_final` es el cuerpo sin ese bloque.
  if (c.tipo !== "venta_nueva_v2" || !c.texto_final || !c.pdf_path || !c.programa_id) {
    console.error("[firma] contrato no firmable", c.id, {
      tipo: c.tipo, texto: !!c.texto_final, pdf: !!c.pdf_path, programa: !!c.programa_id,
    });
    await registrarEvento(c.id, "rechazado", req, { motivo: "no_firmable", tipo: c.tipo });
    return { ok: false, motivo: "error" };
  }

  // Sin esto, el que revienta es `rellenar()` dentro del renderer, con el
  // cliente delante y un mensaje que no dice qué falta.
  const faltan = faltanDelBloque(c.datos_bloque);
  if (faltan.length > 0) {
    console.error("[firma] datos_bloque incompleto, faltan:", faltan.join(", "), c.id);
    await registrarEvento(c.id, "rechazado", req, { motivo: "datos_bloque", faltan });
    return { ok: false, motivo: "error" };
  }

  // El documento que el cliente vio tiene que ser el que se le mandó. Si Alex
  // lo editó entre medias, el hash no cuadra: se frena y hay que reenviar.
  //
  // 🔴 INVARIANTE DEL QUE DEPENDE "EL CLIENTE FIRMA LO QUE LEYÓ", y no es
  // evidente: esto compara los BYTES de `pdf_path`, pero el PDF firmado se
  // vuelve a renderizar desde `texto_final` + BLOQUE_FIRMA + `datos_bloque`.
  // Que las dos cosas digan lo mismo solo se sostiene mientras **`pdf_path` se
  // regenere SIEMPRE que cambie `texto_final` o `datos_bloque`, sin refrescar
  // `hash_enviado`**. Ese desfase es lo que mata el enlace viejo y obliga a
  // reenviar. Quien "arregle" `guardarTextoYRegenerar` actualizando
  // `hash_enviado` al regenerar dejará que un cliente firme un texto que nunca
  // vio, y aquí no saltará nada.
  //
  // Desde el 16-sep hay un segundo cierre, y conviene conocerlo para no
  // quitarlo por "duplicado": `enviarContratoAlCliente` REGENERA `pdf_path`
  // desde `texto_final` justo antes de hashearlo. Así este cerrojo deja de
  // depender de que todos los caminos que escriben uno escriban el otro —
  // "Storage == render(texto_final)" se cumple por construcción en el
  // instante en que se sella el hash. Lo de arriba sigue siendo obligatorio:
  // ese cierre cubre el envío, no las ediciones posteriores a él.
  const enviado = await getStorageBytes(c.pdf_path, "contratos");
  if (!enviado) {
    console.error("[firma] el PDF enviado ya no está en Storage", c.id, c.pdf_path);
    await registrarEvento(c.id, "rechazado", req, { motivo: "sin_pdf", pdf_path: c.pdf_path });
    return { ok: false, motivo: "error" };
  }
  const hashVisto = hashPdf(enviado.bytes);
  if (!c.hash_enviado || hashVisto !== c.hash_enviado) {
    await registrarEvento(c.id, "rechazado", req, {
      motivo: "hash", hash_visto: hashVisto, hash_enviado: c.hash_enviado,
    });
    return { ok: false, motivo: "hash" };
  }

  const p = datosDePeticion(req);
  const evidencia = lineaEvidencia({ nombre, firmadoAt: ahora, ip: p.ip, hash: c.hash_enviado });

  let pdf: Buffer;
  try {
    pdf = await renderizarContratoPDF(c.texto_final, BLOQUE_FIRMA, {
      ...bloqueComoTexto(c.datos_bloque),
      firma_cliente: nombre,
      firma_evidencia: evidencia,
    });
  } catch (e) {
    console.error("[firma] no se pudo renderizar el PDF firmado", c.id, e);
    return { ok: false, motivo: "error" };
  }

  // Releer antes de subir, no después: un reintento tardío del cliente (o una
  // pestaña que se quedó abierta) se va aquí sin escribir nada. No cierra el
  // doble clic —en un doble clic real los dos POST llegan con 100-300 ms de
  // diferencia y los dos pueden pasar por aquí—; de eso se encarga la clave
  // del objeto, justo abajo.
  if (await yaFirmado(c.id)) return { ok: false, motivo: "firmado" };

  // 🔴 EL HASH VA EN EL NOMBRE, y es lo que hace que dos firmas simultáneas no
  // puedan corromperse entre ellas. `uploadToStorage` va con `x-upsert: true`:
  // con una clave fija (`firmados/<programa_id>.pdf`) los dos POST escribirían
  // en el MISMO objeto, y como pdfkit estampa un `CreationDate` distinto en
  // cada render, el que ganara el PATCH podría acabar describiendo el fichero
  // del otro — `hash_firmado` dejaría de ser el sha256 de lo almacenado y se
  // rompería la cadena de custodia, que es justo lo que este módulo existe
  // para poder demostrar. Con el hash en la clave, cada render tiene su sitio
  // y la fila apunta (por `pdf_firmado_path`) al fichero cuyo hash guardó. El
  // perdedor deja un objeto suelto que nadie referencia: el mismo coste que ya
  // aceptamos si el proceso muere justo después de subir.
  //
  // Nadie más construye esta ruta: `/c/[token]/pdf` sirve `pdf_firmado_path`.
  const hashFirmado = hashPdf(pdf);
  const pathFirmado = `firmados/${c.programa_id}-${hashFirmado.slice(0, 12)}.pdf`;
  const subido = await uploadToStorage(pathFirmado, new Uint8Array(pdf).buffer, "application/pdf", "contratos");
  if (!subido) {
    console.error("[firma] no se pudo subir el PDF firmado", c.id, pathFirmado);
    return { ok: false, motivo: "error" };
  }
  // El PATCH va envuelto porque es el único punto donde un throw sería
  // invisible: el PDF firmado ya está subido, así que un corte de red aquí
  // deja el peor estado del módulo SIN la alarma, que es todo lo que hay para
  // detectarlo.
  let r: { status: number; json: { id: string }[] | null };
  try {
    r = await rest<{ id: string }[]>(
      "PATCH",
      `contratos?id=eq.${c.id}&firmado_at=is.null`,
      {
        estado: "firmado",
        firmado_at: ahora.toISOString(),
        firma_nombre: nombre,
        firma_ip: p.ip,
        firma_user_agent: p.userAgent,
        firma_geo: p.geo,
        hash_firmado: hashFirmado,
        pdf_firmado_path: pathFirmado,
        consentimiento: CONSENTIMIENTO,
        consentimiento_v: CONSENTIMIENTO_VERSION,
      },
      "return=representation",
    );
  } catch (e) {
    console.error("[firma] EL PDF FIRMADO SE SUBIÓ PERO LA FILA NO SE MARCÓ", c.id, e);
    return { ok: false, motivo: "error" };
  }
  if (r.status >= 300) {
    // El peor estado posible: el documento firmado existe en Storage y la fila
    // no lo sabe. Se avisa a gritos porque hay que arreglarlo a mano (o el
    // cliente reintenta: el enlace sigue vivo y el PATCH volverá a intentarse).
    console.error("[firma] EL PDF FIRMADO SE SUBIÓ PERO LA FILA NO SE MARCÓ", c.id, r.status, r.json);
    return { ok: false, motivo: "error" };
  }
  const filas = Array.isArray(r.json) ? r.json : [];
  // 0 filas = otro POST llegó entre la relectura y este PATCH (ventana de
  // milisegundos). El que manda es el de la fila, y el suyo está intacto
  // porque este subió a otra clave: aquí solo queda un objeto huérfano, dicho
  // en el log por si alguien audita el bucket.
  if (filas.length === 0) {
    console.error("[firma] carrera perdida DESPUÉS de subir; queda un PDF firmado sin referenciar", c.id, pathFirmado);
    return { ok: false, motivo: "firmado" };
  }

  await registrarEvento(c.id, "firmado", req, { nombre, hash_firmado: hashFirmado });
  // La campana. `autor_id` null: lo hizo el cliente, no alguien del equipo.
  try {
    const a = await rest("POST", "auditoria", {
      entidad: "contrato", entidad_id: c.id, accion: "firmado", autor_id: null,
      datos: { persona_id: c.persona_id, nombre: c.personas?.nombre ?? null, firma_nombre: nombre },
    }, "return=minimal");
    if (a.status >= 300) console.error("[firma] auditoría no escrita", c.id, a.status, a.json);
  } catch (e) {
    console.error("[firma] auditoría no escrita", c.id, e);
  }
  return { ok: true, contratoId: c.id, personaId: c.persona_id };
}
