"use server";
// ============================================================
// Server Actions del inbox — mutaciones de triage (Supabase, service_role).
// Se usan desde <form action={...}>. Revalidan las rutas afectadas.
// ============================================================
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { randomUUID, randomBytes } from "node:crypto";
import { rest } from "@/lib/supabase";
import { uploadToStorage, deleteFromStorage } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import { ajusteDeDevolucion } from "@/lib/comisiones";
import { getTeamMembers, motivoDePago } from "@/lib/data";
import type { DevolucionResult } from "@/lib/types";
import { telefonoE164, esFechaISO } from "@/lib/venta";
import { soloDigitos } from "@/lib/telefono";
import { paisPorIso } from "@/lib/paises";
import { enviarPlantilla } from "@/lib/plantillas";
import { enviarYRegistrarEmail } from "@/lib/email-envio";
import { emailEstrategia } from "@/lib/email-plantillas";
import { canales, claveEstrategia } from "@/lib/canales";
import { estadoWa } from "@/lib/wa-estado";
import { BIENVENIDA_PLANTILLA, BIENVENIDA_IDIOMA, puedeEnviarBienvenida } from "@/lib/bienvenida";
import { guardarAtribucion, parcheDeAtribucion } from "@/lib/guardar-atribucion";
import { avisarNuevaVenta } from "@/lib/push-envio";
import { avisarNuevaVentaEmail } from "@/lib/aviso-venta-email";
import {
  reenviarContrato, recorregirContrato, enviarContratoAlCliente,
  generarContrato, guardarTextoYRegenerar, textoDeContrato,
} from "@/lib/contrato-envio";
import { ingerirFathom } from "@/lib/fathom-ingesta";
import { resumenEnTexto } from "@/lib/fathom";
import { confirmarFuenteConRest } from "@/lib/confirmar-fuente";
import { prepararEdicion } from "@/lib/persona";
import { normalizarUrl, validarFormulario, enlacePortal } from "@/lib/estrategias";
import { passwordDeEstrategia } from "@/lib/estrategias-datos";
import { puedeVer } from "@/lib/modulos";
import { bonosLibres, normalizarBonos, resumenBonos, PREFIJO_BONO_LIBRE } from "@/lib/bonos";
import type {
  VentaResult, CuotaResult, BienvenidaResult, AtribuirResult, ConfirmarFuenteResult,
  PersonaResult, GastoResult, GastoRow,
} from "@/lib/types";
import { normalizaConcepto, fechaEnMes, etiquetaMes } from "@/lib/gastos";

const COMPROBANTE_MAX = 10 * 1024 * 1024;
const COMPROBANTE_MIMES: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf",
};

// Marcadores de error técnico de Postgres (inglés) que NO se le deben enseñar
// crudos al operador: se sustituyen por un mensaje en español + detalle entre paréntesis.
const PG_TECNICO =
  /invalid input syntax|violates|duplicate key|null value in column|out of range|does not exist|syntax error|permission denied|could not |relation "|column "|operator does not/i;

function mensajeRpc(raw: string): string {
  if (!raw) return "No se pudo guardar la venta — revisa los datos e inténtalo de nuevo.";
  if (PG_TECNICO.test(raw)) {
    return `No se pudo guardar la venta — revisa los datos e inténtalo de nuevo (${raw})`;
  }
  return raw;
}

export async function toggleEstado(formData: FormData) {
  const convId = String(formData.get("convId") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!convId || (next !== "pendiente" && next !== "resuelto")) return;
  await rest(
    "PATCH",
    `wa_conversaciones?id=eq.${convId}`,
    { estado_atencion: next },
    "return=minimal",
  );
  revalidatePath(`/inbox/c/${convId}`);
  revalidatePath("/inbox");
}

export async function asignarCoach(formData: FormData) {
  const convId = String(formData.get("convId") ?? "");
  const coachId = String(formData.get("coachId") ?? "");
  if (!convId) return;
  await rest(
    "PATCH",
    `wa_conversaciones?id=eq.${convId}`,
    { coach_asignado: coachId || null },
    "return=minimal",
  );
  revalidatePath(`/inbox/c/${convId}`);
  revalidatePath("/inbox");
}

/**
 * Devuelve un resultado en vez de `void`. Antes abortaba con `return;` si
 * faltaba un campo y no comprobaba el status del POST, mientras `GastoForm`
 * pintaba "✓ Gasto registrado" en los dos casos. Un check verde sobre algo
 * que no se guardó es peor que un error: el gasto no se vuelve a cargar y la
 * señal "Gastos incompletos" de Inicio sigue encendida sin que nadie
 * entienda por qué.
 */
export async function crearGasto(formData: FormData): Promise<GastoResult> {
  // Guard de sesión (antes no existía): hace falta el autor para auditar el
  // gasto, y de paso la acción deja de aceptar peticiones sin sesión.
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "Sin sesión." };
  const concepto = String(formData.get("concepto") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "");
  const monto = Number(formData.get("monto"));
  const fecha = String(formData.get("fecha") ?? "");
  const tipo_gasto = String(formData.get("tipo_gasto") ?? "");
  const metodo_pago = String(formData.get("metodo_pago") ?? "");
  const notas = String(formData.get("notas") ?? "").trim();
  if (!concepto) return { ok: false, error: "Falta el concepto del gasto." };
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: "El importe debe ser un número mayor que 0." };
  }
  if (!fecha) return { ok: false, error: "Falta la fecha del gasto." };
  const r = await rest(
    "POST",
    "gastos",
    {
      concepto,
      categoria: categoria || null,
      monto,
      divisa: "USD",
      fecha,
      tipo_gasto: tipo_gasto || null,
      metodo_pago: metodo_pago || null,
      notas: notas || null,
    },
    // representation y no minimal: el id del gasto hace falta para auditarlo.
    "return=representation",
  );
  if (r.status >= 300) {
    return { ok: false, error: `No se ha podido guardar el gasto (error ${r.status}).` };
  }

  // El gasto en la auditoría — la campana de novedades lee de ahí. La divisa
  // viaja SIEMPRE en datos: los gastos son USD y money() por defecto pinta
  // EUR — sin ella, el feed mentiría el símbolo. Un fallo aquí no rompe el
  // gasto (consola y ya). traerRecurrentes queda fuera a propósito: los
  // fijos del mes no son novedad (decisión de la spec de novedades).
  const gastoId = Array.isArray(r.json) ? ((r.json[0] as { id?: string })?.id ?? null) : null;
  if (gastoId) {
    try {
      const ra = await rest(
        "POST",
        "auditoria",
        {
          entidad: "gasto",
          entidad_id: gastoId,
          accion: "alta",
          autor_id: u.id,
          datos: { concepto, monto, divisa: "USD", mes: fecha.slice(0, 7) },
        },
        "return=minimal",
      );
      if (ra.status >= 300) console.error("[novedades] gasto sin auditar", gastoId, ra.status);
    } catch (e) {
      console.error("[novedades] gasto sin auditar", gastoId, e);
    }
  } else {
    console.error("[novedades] gasto creado sin id en la respuesta: sin auditar");
  }

  revalidatePath("/gastos");
  revalidatePath("/pnl");
  revalidatePath("/");
  return { ok: true, mensaje: `Gasto registrado: ${concepto}.` };
}

export async function editarGasto(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const concepto = String(formData.get("concepto") ?? "").trim();
  const categoria = String(formData.get("categoria") ?? "");
  const monto = Number(formData.get("monto"));
  const fecha = String(formData.get("fecha") ?? "");
  const tipo_gasto = String(formData.get("tipo_gasto") ?? "");
  const metodo_pago = String(formData.get("metodo_pago") ?? "");
  const notas = String(formData.get("notas") ?? "").trim();
  if (!id || !concepto || !Number.isFinite(monto) || monto <= 0 || !fecha) return;
  await rest(
    "PATCH",
    `gastos?id=eq.${id}`,
    {
      concepto,
      categoria: categoria || null,
      monto,
      fecha,
      tipo_gasto: tipo_gasto || null,
      metodo_pago: metodo_pago || null,
      notas: notas || null,
    },
    "return=minimal",
  );
  revalidatePath("/gastos");
  revalidatePath("/pnl");
  revalidatePath("/");
}

/**
 * Copia al mes indicado los gastos recurrentes que se le pasen.
 *
 * Por qué existe: 81 de los 105 gastos del negocio son recurrentes y 18
 * conceptos se repiten cada mes (Google Drive, Zoom, GoHighLevel, los
 * salarios). Cargarlos a mano son ~19 altas en un formulario de siete campos,
 * cada mes — por eso no se hacía, y por eso la señal "Gastos incompletos" de
 * Inicio no se apagaba nunca.
 *
 * Human-in-the-loop, como todo lo que toca dinero: quien llama ya ha visto la
 * lista, ha podido desmarcar y ha confirmado el total. Aquí solo se escribe.
 *
 * Se releen los gastos de origen desde la base en vez de fiarse de los
 * importes que manda el navegador: si no, quien manipule el formulario decide
 * cuánto se registra como gasto. Del cliente solo se acepta QUÉ copiar (ids),
 * nunca CUÁNTO.
 */
export async function traerRecurrentes(formData: FormData): Promise<GastoResult> {
  const mesDestino = String(formData.get("mes") ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(mesDestino)) {
    return { ok: false, error: "Falta el mes al que copiar los gastos." };
  }

  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (ids.length === 0) {
    return { ok: false, error: "No has seleccionado ningún gasto." };
  }

  const origenR = await rest<GastoRow[]>(
    "GET",
    `gastos?id=in.(${ids.join(",")})` +
      "&select=id,concepto,categoria,monto,divisa,fecha,tipo_gasto,metodo_pago,notas",
  );
  if (!Array.isArray(origenR.json) || origenR.json.length === 0) {
    return { ok: false, error: "No se han podido leer los gastos de origen." };
  }

  // Releído de la base AHORA, no del navegador: entre que se pintó la lista y
  // se pulsó el botón, otra persona puede haber cargado ya el mes. Sin esto,
  // dos operadores duplicarían los 19 recibos del mes.
  const yaR = await rest<{ concepto: string }[]>(
    "GET",
    `gastos?fecha=gte.${mesDestino}-01&fecha=lt.${siguienteMes(mesDestino)}-01&select=concepto&limit=500`,
  );
  const yaEstan = new Set(
    (Array.isArray(yaR.json) ? yaR.json : []).map((x) => normalizaConcepto(x.concepto)),
  );

  const filas = origenR.json
    .filter((g) => !yaEstan.has(normalizaConcepto(g.concepto)))
    .map((g) => ({
      concepto: g.concepto,
      categoria: g.categoria,
      monto: g.monto,
      divisa: "USD",
      fecha: fechaEnMes(g.fecha, mesDestino),
      tipo_gasto: g.tipo_gasto,
      metodo_pago: g.metodo_pago,
      notas: g.notas,
    }));

  if (filas.length === 0) {
    return { ok: false, error: "Esos gastos ya estaban cargados en el mes." };
  }

  const r = await rest("POST", "gastos", filas, "return=minimal");
  if (r.status >= 300) {
    return { ok: false, error: `No se han podido copiar los gastos (error ${r.status}).` };
  }

  revalidatePath("/gastos");
  revalidatePath("/pnl");
  revalidatePath("/");

  const total = filas.reduce((s, f) => s + Number(f.monto || 0), 0);
  const omitidos = origenR.json.length - filas.length;
  return {
    ok: true,
    mensaje:
      `${filas.length} ${filas.length === 1 ? "gasto copiado" : "gastos copiados"} a ${etiquetaMes(mesDestino)}` +
      ` (${total.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD).` +
      (omitidos > 0 ? ` ${omitidos} ya estaban y se han saltado.` : ""),
  };
}

/** El mes siguiente, para acotar el rango de fechas de una consulta. */
function siguienteMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
}

export async function eliminarGasto(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await rest("DELETE", `gastos?id=eq.${id}`, undefined, "return=minimal");
  revalidatePath("/gastos");
  revalidatePath("/pnl");
  revalidatePath("/");
}

export async function crearVenta(formData: FormData): Promise<VentaResult> {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return { ok: false, error: "Sin permiso para registrar ventas." };
  }
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const tipo = s("tipo_venta");
  if (!["nueva", "ascension", "extension"].includes(tipo)) return { ok: false, error: "Tipo de venta inválido." };

  let cuotas: { monto: number; fecha: string }[] = [];
  try { cuotas = JSON.parse(s("cuotas") || "[]"); } catch { return { ok: false, error: "Cuotas mal formadas." }; }
  if (cuotas.length > 24) return { ok: false, error: "Máximo 24 cuotas." };

  const pagoMonto = Number(s("pago_monto"));
  if (!Number.isFinite(pagoMonto) || pagoMonto <= 0) return { ok: false, error: "El cobro de hoy debe ser mayor que 0." };

  // Validación en español ANTES de tocar la base: si algo de esto llega al RPC,
  // Postgres responde con errores crudos ("invalid input syntax for type date: ...").
  const valorTotal = Number(s("valor_total"));
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    return { ok: false, error: "El valor total del programa debe ser un número mayor que 0." };
  }
  if (!esFechaISO(s("fecha_inicio"))) {
    return { ok: false, error: "La fecha de inicio es obligatoria y debe tener formato AAAA-MM-DD." };
  }
  if (!esFechaISO(s("pago_fecha"))) {
    return { ok: false, error: "La fecha de pago es obligatoria y debe tener formato AAAA-MM-DD." };
  }
  // Bonos del evento: llegan como JSON (FormData solo lleva strings). Aquí se
  // podan contra el CATÁLOGO — una clave inventada no pasa de esta línea.
  //
  // Lo que NO se hace aquí es la regla de duración, y es deliberado: desde el
  // 26-ago el bono es un +50 % sobre la duración del tier, y esa duración vive
  // en `tiers.meses_default`, que esta capa no lee. Aplicar aquí un ×1,5 sobre
  // los meses que ya vienen calculados del formulario los multiplicaría por
  // segunda vez (9 → 14). El único sitio que tiene el dato base es el RPC, y
  // es el que manda. Ver `docs/bonos-evento.md` § "Quién calcula la duración".
  let bonos: string[] = [];
  try {
    const crudo = JSON.parse(s("bonos") || "[]");
    if (!Array.isArray(crudo)) return { ok: false, error: "Bonos mal formados." };
    bonos = normalizarBonos(crudo.map(String));
    // El bono que el closer escribió a mano viaja en el MISMO array, con
    // prefijo `libre:`. Desde la 0059 el RPC lo deja pasar (`or b like
    // 'libre:%'`) en vez de descartarlo contra el catálogo, así que no hace
    // falta una segunda escritura: `crear_venta` lo guarda y lo audita como
    // todo lo demás.
    // Uno solo: del formulario no puede venir más (hay un input), pero el
    // array llega de un `<form>` y un POST armado a mano podría traer cincuenta
    // — impresos en un documento que se firma. `bonoLibreDe` ya acota el largo;
    // esto acota la cantidad.
    bonos = [
      ...bonos,
      ...bonosLibres(crudo.map(String)).slice(0, 1).map((t) => PREFIJO_BONO_LIBRE + t),
    ];
  } catch { return { ok: false, error: "Bonos mal formados." }; }

  const mesesRaw = s("meses_duracion");
  if (mesesRaw !== "") {
    const meses = Number(mesesRaw);
    if (!Number.isInteger(meses) || meses < 1 || meses > 24) {
      return { ok: false, error: "La duración debe ser un número entero de meses entre 1 y 24 (o dejarse vacía)." };
    }
  }
  // OBLIGATORIO desde el 14-ago-2026 (antes era opcional). La comisión se
  // calcula sobre el dólar cobrado, así que un pago sin este dato es un pago
  // sobre el que no se puede pagar a nadie — y lo descubriríamos el 30-ago,
  // al cerrar comisiones, en vez de ahora. `pago_monto` ya se validó > 0 más
  // arriba, así que aquí siempre hay un cobro real que declarar.
  const usdRaw = s("usd_recibido");
  if (usdRaw === "") {
    return {
      ok: false,
      error: "Falta el USD recibido. Es obligatorio: las comisiones se calculan sobre el dólar cobrado, no sobre el importe en euros.",
    };
  }
  {
    const usd = Number(usdRaw);
    if (!Number.isFinite(usd) || usd <= 0) {
      return { ok: false, error: "USD recibido debe ser un número mayor que 0." };
    }
  }
  for (let i = 0; i < cuotas.length; i++) {
    const c = cuotas[i];
    const monto = Number(c?.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return { ok: false, error: `La cuota ${i + 2} debe tener un importe mayor que 0.` };
    }
    if (!esFechaISO(String(c?.fecha ?? ""))) {
      return { ok: false, error: `La cuota ${i + 2} necesita una fecha de vencimiento válida (AAAA-MM-DD).` };
    }
  }

  // Comprobante (opcional): si viene y falla la subida, falla TODO el submit.
  let comprobantePath = "";
  const file = formData.get("comprobante");
  if (file instanceof File && file.size > 0) {
    const ext = COMPROBANTE_MIMES[file.type];
    if (!ext) return { ok: false, error: `Comprobante: tipo no permitido (${file.type || "?"}). Solo PNG, JPG o PDF.` };
    if (file.size > COMPROBANTE_MAX) return { ok: false, error: "Comprobante: máximo 10 MB." };
    comprobantePath = `ventas/${randomUUID()}.${ext}`;
    const okUp = await uploadToStorage(comprobantePath, await file.arrayBuffer(), file.type, "comprobantes");
    if (!okUp) return { ok: false, error: "No se pudo subir el comprobante. Reintenta." };
  }

  // Solo la compra nueva trae teléfono en el formulario. En ascensión/extensión
  // el cliente ya existía y el form no lo pide.
  //
  // El país y el prefijo se DERIVAN del ISO, no llegan como dos campos sueltos:
  // así la incoherencia país↔prefijo tampoco se puede expresar en el cable, no
  // solo en la interfaz. Un ISO desconocido no inventa prefijo (devuelve null),
  // y entonces telefonoE164 exige que el número declare su país.
  const pais = paisPorIso(s("pais_iso"));
  const telefonoFormulario = telefonoE164(pais?.prefijo ?? "", s("telefono"));
  const payload = {
    tipo_venta: tipo,
    nombre: s("nombre"),
    telefono_e164: telefonoFormulario ?? "",
    email: s("email"), pais: pais?.nombre ?? "",
    persona_id: s("persona_id"), programa_previo_id: s("programa_previo_id"),
    tier: s("tier"), valor_total: s("valor_total"),
    fecha_inicio: s("fecha_inicio"),
    // La duración la manda el formulario tal cual la vio el operador. Si el
    // bono de duración está puesto, el RPC la recalcula desde el tier y la
    // fuerza: el bono y el número no pueden discrepar, pero el que sabe la
    // duración base es él, no esta capa.
    meses_duracion: s("meses_duracion"),
    pago_monto: String(pagoMonto), pago_fecha: s("pago_fecha"),
    usd_recibido: s("usd_recibido"), metodo_pago: s("metodo_pago"),
    comprobante_path: comprobantePath,
    cuotas,
    bonos,
  };
  // Si la llamada al RPC revienta (red/DNS/base caída), la venta NO se guardó:
  // hay que limpiar el comprobante subido para no dejar huérfanos en Storage.
  let r: Awaited<ReturnType<typeof rest>>;
  try {
    r = await rest("POST", "rpc/crear_venta", { payload });
  } catch {
    if (comprobantePath) await deleteFromStorage(comprobantePath, "comprobantes");
    return { ok: false, error: "No se pudo guardar la venta (error de conexión con la base)" };
  }
  if (r.status >= 300 || !r.json || (r.json as any).message) {
    if (comprobantePath) await deleteFromStorage(comprobantePath, "comprobantes");
    const raw = (r.json as any)?.message;
    return { ok: false, error: raw ? mensajeRpc(String(raw)) : `Error del servidor (${r.status}).` };
  }
  const ids = r.json as {
    persona_id: string; programa_id: string; pago_id: string; n_cuotas: number;
    persona_reutilizada?: boolean;
    // Los bonos YA SANEADOS por el RPC (0052:205). No son los que mandó el
    // formulario: `crear_venta` quita `duracion_50` si el tier no tiene
    // duración que alargar, y esa poda tiene que sobrevivir a lo de abajo.
    bonos?: string[];
  };

  // La atribución va en un segundo paso, a propósito: no es atómica con el
  // cobro y no debe serlo. `crear_venta` (Task 4) NO se toca. Si esto falla,
  // la venta ya está guardada y cae en la bandeja de /atribucion, que es su
  // red — bloquear una venta ya cobrada por un fallo de contabilidad sería
  // mucho peor.
  if (ids.programa_id && ids.pago_id) {
    const res = await guardarAtribucion(
      ids.programa_id,
      ids.pago_id,
      {
        sourceId: s("source_id") || null,
        setterId: s("setter_id") || null,
        closerId: s("closer_id") || null,
        upsellPorId: s("upsell_por_id") || null,
        ghlAppointmentId: s("ghl_appointment_id") || null,
        decidido: s("atribuido") === "true",
      },
      rest,
    );
    if (!res.pagoAtado || !res.atribucionGuardada) {
      console.error("[crearVenta] atribución incompleta", ids.programa_id, res);
    }
  }

  // El coach que atenderá a este cliente, asignado en el mismo acto de vender.
  //
  // Antes había que registrar la venta, ir a /clientes, buscar a la persona,
  // abrir su ficha y editarla — cuatro pasos que se hacen otro día o no se
  // hacen, y mientras tanto el cliente no aparece en el cupo de nadie.
  //
  // Va DESPUÉS del RPC y por separado, igual que la atribución y por el mismo
  // motivo: la venta ya está cobrada y guardada. Si esto falla, se pierde una
  // asignación que se puede rehacer desde la ficha en diez segundos; bloquear
  // una venta cobrada por eso sería mucho peor. Se registra en consola y la
  // venta sigue siendo un éxito.
  //
  // Se usa el RPC `editar_persona` y no un PATCH directo para que el cambio
  // quede en la auditoría con su autor, igual que si se hubiera hecho a mano
  // desde la ficha.
  const coachId = s("coach_id");
  if (coachId && ids.persona_id) {
    try {
      const rc = await rest("POST", "rpc/editar_persona", {
        payload: {
          persona_id: ids.persona_id,
          // La convención del RPC: cadena vacía = "no tocar este campo".
          nombre: "", telefono_e164: "", email: "", pais: "", estado: "",
          coach_id: coachId,
          autor_id: u.id,
        },
      });
      if (rc.status >= 300 || (rc.json as any)?.message) {
        console.error("[crearVenta] no se pudo asignar el coach", ids.persona_id, rc.json);
      }
    } catch (e) {
      console.error("[crearVenta] no se pudo asignar el coach", ids.persona_id, e);
    }
  }


  // Aviso del cierre a todo el equipo, diferido a after(): corre cuando la
  // respuesta ya salió y jamás puede bloquear ni "romper" una venta cobrada
  // (`avisarNuevaVenta` además nunca lanza). Mismo patrón que el aviso de
  // mensaje entrante en wa-ingest. Sin monto NI TIER a propósito (los ids de
  // tier son el precio en euros): pantallas bloqueadas de todo el equipo.
  if (ids.persona_id && ids.pago_id) {
    const personaId = ids.persona_id;
    const pagoId = ids.pago_id;
    // El autor según la regla de comisiones (lib/comisiones.ts, Berni 12-ago):
    // en "nueva" es el closer; en ascensión/extensión "da igual quién cerró" —
    // acredita quien hizo la venta, no el closer de la cita atribuida.
    const autorId = (tipo === "nueva" ? s("closer_id") : s("upsell_por_id")) || null;
    after(() => avisarNuevaVenta(personaId, pagoId, { tipo, autorId }));

    // Segundo canal del mismo aviso, por correo. Nace APAGADO a propósito
    // (`AVISO_VENTA_EMAIL_ACTIVO`, mismo criterio que `SESIONES_EMAIL_ACTIVO`):
    // hasta que `team_members.email` tenga las direcciones reales del equipo
    // confirmadas, encenderlo mandaría el aviso a nadie o a la dirección
    // equivocada. `avisarNuevaVentaEmail` tampoco lanza nunca.
    if (process.env.AVISO_VENTA_EMAIL_ACTIVO === "true") {
      after(() => avisarNuevaVentaEmail(personaId, pagoId, { tipo, autorId }));
    }

    // 🔴 EL CONTRATO YA NO NACE AQUÍ, y esto no es un olvido.
    //
    // Hasta el 16-sep-2026 colgaba de un `after()` como los dos avisos de
    // arriba: se generaba, se subía y se mandaba por correo al equipo sin que
    // nadie lo viera, y si fallaba —un dato del catálogo que falta, Storage
    // caído— el único rastro era una línea en los logs de Vercel. Un documento
    // legal a nombre de un cliente real no puede salir (ni dejar de salir) en
    // silencio.
    //
    // Ahora lo genera `generarContratoAction`, que llama el modal que se abre
    // sobre la pantalla de "Venta registrada" (`components/VentaForm.tsx`).
    // Corre dentro de la petición del closer, así que un fallo se ve en su
    // pantalla y se puede reintentar ahí mismo. `CONTRATO_ACTIVO` sigue siendo
    // el interruptor, pero ahora decide si el modal se abre, no si corre un
    // `after()` mudo — y lo lee la página, no esta action.
    //
    // Se conservan los DOS tipos que tenían contrato aquí: compra nueva y
    // ascensión. El modal se abre en los dos (`conContrato` en VentaForm), y
    // la ascensión sale en modo lectura porque una `ampliacion` no se firma en
    // el OS — la firma es de la plantilla v2 y la v2 es solo de venta nueva
    // ("fuera de alcance" de la spec 2026-09-15). Lo único que sí desaparece,
    // y para todos, es el correo interno automático al equipo: ahora se
    // enteran por la campana, que lee la fila que `generarContrato` escribe en
    // `auditoria`. Reenviarlo a mano sigue estando en /contratos.
    //
    // Spec 2026-09-15, decisión 3.

    // La venta en la auditoría — la campana de novedades lee de ahí.
    // autor_id = quien REGISTRÓ (u.id), como en toda la auditoría; la regla
    // de comisiones viaja en datos.autor_venta_id y el feed la resuelve a
    // nombre. Sin tier a propósito: sus ids SON el precio. Si esto falla, la
    // venta sigue siendo un éxito (consola y ya). El RPC crear_venta no se
    // toca: este insert es de la app, como los de atribución.
    try {
      const ra = await rest(
        "POST",
        "auditoria",
        {
          entidad: "venta",
          entidad_id: ids.programa_id,
          accion: "alta",
          autor_id: u.id,
          datos: {
            persona_id: personaId,
            nombre: s("nombre") || "",
            tipo,
            pago_monto: pagoMonto,
            valor_total: valorTotal,
            divisa: "EUR",
            autor_venta_id: autorId,
          },
        },
        "return=minimal",
      );
      if (ra.status >= 300) {
        console.error("[novedades] venta sin auditar", ids.programa_id, ra.status);
      }
    } catch (e) {
      console.error("[novedades] venta sin auditar", ids.programa_id, e);
    }
  }

  revalidatePath("/ingresos"); revalidatePath("/cuotas"); revalidatePath("/clientes");
  revalidatePath("/pnl"); revalidatePath("/");

  // Teléfono del resumen: solo compra nueva lo trae del formulario (y coincide con lo
  // que el RPC guardó/reutilizó en `personas`, sea cliente nuevo o dedupe por teléfono
  // — ver 0015_crear_venta_dedupe.sql, que nunca actualiza telefono_e164). En
  // ascensión/extensión se deja en null A PROPÓSITO, no por descuido: el único lugar
  // que lee este campo es el botón de bienvenida en VentaForm, que solo se muestra en
  // compra nueva. Consultarlo aquí para esos dos tipos costaría un round-trip a la
  // base DESPUÉS de que la venta ya quedó guardada (RPC + revalidatePath ya corrieron):
  // si esa consulta fallara sin protección, el operador vería un error de conexión
  // sobre una venta que en realidad se guardó bien, y podría duplicarla sin querer.
  const telefono = tipo === "nueva" ? telefonoFormulario : null;

  return {
    ok: true,
    resumen: { ...ids, nombre: s("nombre") || "(cliente existente)", tier: s("tier"),
               pago_monto: pagoMonto, con_comprobante: !!comprobantePath,
               persona_reutilizada: !!ids.persona_reutilizada, cuotas, telefono },
  };
}

/* ---------------- Cuotas ---------------- */

// Permiso + identidad para cualquier operación sobre cuotas.
// El autor SIEMPRE sale de la sesión: el cliente no lo envía.
async function guardCuotas(): Promise<
  { ok: true; autorId: string } | { ok: false; error: string }
> {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("cuotas"))) {
    return { ok: false, error: "Sin permiso para gestionar cuotas." };
  }
  return { ok: true, autorId: u.id };
}

// Traduce la respuesta de un RPC de cuotas a CuotaResult.
async function llamarRpcCuota(fn: string, payload: unknown, exito: string): Promise<CuotaResult> {
  let r: Awaited<ReturnType<typeof rest>>;
  try {
    r = await rest("POST", `rpc/${fn}`, { payload });
  } catch {
    return { ok: false, error: "No se pudo guardar (error de conexión con la base)." };
  }
  if (r.status >= 300 || !r.json || (r.json as any).message) {
    const raw = (r.json as any)?.message;
    return { ok: false, error: raw ? mensajeRpc(String(raw)) : `Error del servidor (${r.status}).` };
  }
  revalidatePath("/cuotas"); revalidatePath("/ingresos"); revalidatePath("/pnl"); revalidatePath("/");
  return { ok: true, mensaje: exito };
}

export async function pagarCuota(formData: FormData): Promise<CuotaResult> {
  const g = await guardCuotas();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const cuotaId = s("cuota_id");
  if (!cuotaId) return { ok: false, error: "Falta la cuota." };
  const importe = Number(s("importe"));
  if (!Number.isFinite(importe) || importe <= 0) {
    return { ok: false, error: "El importe debe ser un número mayor que 0." };
  }
  if (!esFechaISO(s("fecha"))) {
    return { ok: false, error: "La fecha del pago es obligatoria (AAAA-MM-DD)." };
  }
  // Obligatorio, igual que en crearVenta: una cuota cobrada también devenga
  // comisión ("tanto primer pago como segundas cuotas", Berni), y también se
  // calcula sobre el dólar. El `importe` ya se validó > 0 más arriba.
  const usdRaw = s("usd_recibido");
  if (usdRaw === "") {
    return {
      ok: false,
      error: "Falta el USD recibido. Es obligatorio: la comisión de esta cuota se calcula sobre el dólar cobrado.",
    };
  }
  {
    const usd = Number(usdRaw);
    if (!Number.isFinite(usd) || usd <= 0) {
      return { ok: false, error: "USD recibido debe ser un número mayor que 0." };
    }
  }

  // Comprobante opcional: si falla la subida, no se toca la base.
  let comprobantePath = "";
  const file = formData.get("comprobante");
  if (file instanceof File && file.size > 0) {
    const ext = COMPROBANTE_MIMES[file.type];
    if (!ext) return { ok: false, error: `Comprobante: tipo no permitido (${file.type || "?"}). Solo PNG, JPG o PDF.` };
    if (file.size > COMPROBANTE_MAX) return { ok: false, error: "Comprobante: máximo 10 MB." };
    comprobantePath = `cuotas/${randomUUID()}.${ext}`;
    const okUp = await uploadToStorage(comprobantePath, await file.arrayBuffer(), file.type, "comprobantes");
    if (!okUp) return { ok: false, error: "No se pudo subir el comprobante. Reintenta." };
  }

  const res = await llamarRpcCuota(
    "pagar_cuota",
    { cuota_id: cuotaId, importe: String(importe), fecha: s("fecha"),
      metodo_pago: s("metodo_pago"), comprobante_path: comprobantePath,
      usd_recibido: usdRaw, autor_id: g.autorId },
    "Cuota registrada.",
  );
  // El pago no se guardó ⇒ el comprobante subido quedaría huérfano en Storage.
  if (!res.ok && comprobantePath) await deleteFromStorage(comprobantePath, "comprobantes");
  return res;
}

export async function editarCuota(formData: FormData): Promise<CuotaResult> {
  const g = await guardCuotas();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const cuotaId = s("cuota_id");
  if (!cuotaId) return { ok: false, error: "Falta la cuota." };
  const montoRaw = s("monto");
  if (montoRaw !== "") {
    const monto = Number(montoRaw);
    if (!Number.isFinite(monto) || monto <= 0) {
      return { ok: false, error: "El importe debe ser un número mayor que 0." };
    }
  }
  const fecha = s("fecha_vencimiento");
  if (fecha !== "" && !esFechaISO(fecha)) {
    return { ok: false, error: "La fecha de vencimiento debe tener formato AAAA-MM-DD." };
  }
  if (montoRaw === "" && fecha === "") return { ok: false, error: "No hay nada que cambiar." };

  return llamarRpcCuota(
    "editar_cuota",
    { cuota_id: cuotaId, monto: montoRaw, fecha_vencimiento: fecha, autor_id: g.autorId },
    "Cuota actualizada.",
  );
}

export async function deshacerPagoCuota(formData: FormData): Promise<CuotaResult> {
  const g = await guardCuotas();
  if (!g.ok) return g;
  const pagoId = String(formData.get("pago_id") ?? "").trim();
  if (!pagoId) return { ok: false, error: "Falta el pago a deshacer." };
  return llamarRpcCuota(
    "deshacer_pago_cuota",
    { pago_id: pagoId, autor_id: g.autorId },
    "Pago deshecho — la cuota vuelve a estar pendiente.",
  );
}

export async function anularCuota(formData: FormData): Promise<CuotaResult> {
  const g = await guardCuotas();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const cuotaId = s("cuota_id");
  if (!cuotaId) return { ok: false, error: "Falta la cuota." };
  // El motivo también se exige aquí, no solo en el RPC: así el operador ve el
  // error en el modal donde está escribiendo, en vez de recibir el mensaje
  // crudo de Postgres.
  const motivo = s("motivo");
  if (!motivo) {
    return {
      ok: false,
      error: "Escribe por qué se anula (p. ej. «cliente dado de baja»). Queda registrado en la auditoría.",
    };
  }
  return llamarRpcCuota(
    "anular_cuota",
    { cuota_id: cuotaId, motivo, autor_id: g.autorId },
    "Cuota anulada — sale de las cuentas, pero queda registrada.",
  );
}

export async function reactivarCuota(formData: FormData): Promise<CuotaResult> {
  const g = await guardCuotas();
  if (!g.ok) return g;
  const cuotaId = String(formData.get("cuota_id") ?? "").trim();
  if (!cuotaId) return { ok: false, error: "Falta la cuota." };
  return llamarRpcCuota(
    "reactivar_cuota",
    { cuota_id: cuotaId, autor_id: g.autorId },
    "Cuota reactivada — vuelve a estar pendiente.",
  );
}

export async function crearCuota(formData: FormData): Promise<CuotaResult> {
  const g = await guardCuotas();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const programaId = s("programa_id");
  if (!programaId) return { ok: false, error: "Falta el programa." };
  const monto = Number(s("monto"));
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: "El importe debe ser un número mayor que 0." };
  }
  if (!esFechaISO(s("fecha_vencimiento"))) {
    return { ok: false, error: "La fecha de vencimiento es obligatoria (AAAA-MM-DD)." };
  }
  return llamarRpcCuota(
    "crear_cuota",
    { programa_id: programaId, monto: String(monto),
      fecha_vencimiento: s("fecha_vencimiento"), autor_id: g.autorId },
    "Cuota añadida.",
  );
}

/* ---------------- Atribución pendiente (bandeja) ---------------- */

// Atribuye (o corrige) una venta ya registrada, desde la bandeja de
// /atribucion. Antes hacía un PATCH directo sobre `programas` — eso sellaba
// `atribucion_at` sin comprobar que el pago siguiera atado. Cuando el
// intento original de `crearVenta` había fallado en atar el pago (por eso
// la venta cayó en la bandeja en primer lugar, ver guardar-atribucion.ts:50),
// resolverla aquí sellaba igual y el pago se quedaba huérfano PARA SIEMPRE:
// la venta sale de la bandeja pero aparece como `sin_programa` en /comisiones
// sin ninguna pantalla que lo arregle. Se reutiliza `guardarAtribucion`, que
// ya ata el pago y condiciona el sellado a que atarlo funcione de verdad.
export async function atribuirVenta(fd: FormData): Promise<AtribuirResult> {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return { ok: false, error: "Sin permiso para atribuir ventas." };
  }
  const s = (k: string) => String(fd.get(k) ?? "");
  const programaId = s("programaId");
  if (!programaId) return { ok: false, error: "Falta la venta." };

  const atribucion = {
    sourceId: s("source_id") || null,
    setterId: s("setter_id") || null,
    closerId: s("closer_id") || null,
    upsellPorId: s("upsell_por_id") || null,
    ghlAppointmentId: s("ghl_appointment_id") || null,
    decidido: s("decidido") === "true",
  };
  // Misma validación de siempre ("lo dejo para después" no debe sellar
  // nada), aplicada sobre el mismo `parcheDeAtribucion` ya probado — el
  // patch de verdad lo construye `guardarAtribucion` más abajo, condicionado
  // a que el pago se ate.
  const probe = parcheDeAtribucion(atribucion);
  if (!probe.atribucion_at) {
    return { ok: false, error: "Elige una opción antes de guardar." };
  }

  // `pagos.programa_id` no vive en el formulario: esta venta puede llevar
  // rato registrada y la bandeja solo conoce `programaId`. Se busca el
  // pago (o pagos) que YA cuelgan de esta venta — el primer cobro de
  // `crear_venta` siempre pone esa columna directa (ver 0032, comentario de
  // `v_pagos_atribuidos`: "solo el primer pago de una venta necesita la
  // columna directa"). Si no aparece ninguno, no hay nada seguro que atar:
  // mejor decirlo que sellar una atribución que deja el pago sin encontrar.
  const pagosR = await rest<{ id: string }[]>(
    "GET", `pagos?programa_id=eq.${programaId}&select=id`,
  );
  const pagoIds = Array.isArray(pagosR.json) ? pagosR.json.map((p) => p.id) : [];
  if (pagoIds.length === 0) {
    return {
      ok: false,
      error: "No se encontró ningún pago atado a esta venta — no se puede atribuir sin dejarlo huérfano. Revísalo a mano.",
    };
  }

  const res = await guardarAtribucion(programaId, pagoIds, atribucion, rest);
  if (!res.pagoAtado) {
    return { ok: false, error: "No se pudo confirmar que el pago sigue atado a la venta. Reintenta." };
  }
  if (!res.atribucionGuardada) {
    return { ok: false, error: "El pago está atado, pero no se pudo guardar la atribución. Reintenta." };
  }

  // La columna es `datos` (jsonb) — verificado contra el esquema real el
  // 11-ago. Un fallo de auditoría NO revierte la atribución, que ya quedó
  // guardada y ya sacó a la venta de la bandeja: se registra el fallo y se
  // sigue, mismo criterio que guardarAtribucion.ts.
  const a = await rest("POST", "auditoria", {
    entidad: "programa", entidad_id: programaId,
    accion: "atribuir", autor_id: u.id, datos: probe,
  });
  if (a.status >= 300) console.error("[atribuirVenta] no se pudo auditar", a.status, a.json);

  revalidatePath("/atribucion");
  revalidatePath("/comisiones");
  return { ok: true };
}

/* ---------------- Fuentes por confirmar ---------------- */

// Sube una fuente de `fuentes_atribucion` a `confirmado=true` — la única
// puerta para hacerlo sin editar la base a mano. Cada Source_ID nuevo que
// `/api/ghl/citas` ve en GHL entra con `confirmado=false`
// (fuente = el propio código, sin setter, nivel "canal") precisamente para
// que ningún pago genere comisión sobre una lectura que nadie ha validado
// (ver ese archivo y `comisionesDePago` en lib/comisiones.ts). Sin esta
// action, cada pieza de contenido nueva de Berni congelaría sus comisiones
// hasta que alguien entrara a Supabase.
export async function confirmarFuente(fd: FormData): Promise<ConfirmarFuenteResult> {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return { ok: false, error: "Sin permiso para confirmar fuentes." };
  }
  const s = (k: string) => String(fd.get(k) ?? "");
  const input = {
    sourceId: s("source_id"),
    fuente: s("fuente"),
    nivel: s("nivel"),
    setterId: s("setter_id") || null,
  };

  // Toda la validación (fuente no vacía, nivel dentro del CHECK, coherencia
  // setter_id/setter_nombre) vive en confirmar-fuente.ts, del lado del
  // servidor — el `disabled` del botón en el cliente es solo comodidad.
  const res = await confirmarFuenteConRest(input, rest);
  if (!res.ok) return res;

  // Auditoría: `auditoria.entidad_id` es `uuid` (migración 0016) pero
  // `fuentes_atribucion.source_id` es `text` — no hay ningún uuid natural
  // que identifique una fuente. Se genera uno nuevo por evento de
  // confirmación (no se reutiliza entre confirmaciones de la misma fuente:
  // no hace falta, una fuente se confirma una sola vez en su vida) y el
  // `source_id` real viaja DENTRO de `datos`, que es donde habría que
  // filtrar (`datos->>'source_id'`) si algún día hiciera falta reconstruir
  // el historial de auditoría de una fuente concreta en vez de por fecha.
  //
  // Un fallo aquí NO revierte ni bloquea: la fila ya quedó confirmada en la
  // línea de arriba, y no hay una operación de dinero pendiente que
  // deshacer — mismo criterio que atribuirVenta más arriba.
  try {
    const a = await rest("POST", "auditoria", {
      entidad: "fuente_atribucion",
      entidad_id: randomUUID(),
      accion: "confirmar",
      autor_id: u.id,
      datos: {
        source_id: input.sourceId,
        fuente: input.fuente.trim(),
        nivel: input.nivel,
        setter_id: input.setterId,
        setter_nombre: res.setterNombre,
      },
    });
    if (a.status >= 300) console.error("[confirmarFuente] no se pudo auditar", a.status, a.json);
  } catch (e) {
    console.error("[confirmarFuente] no se pudo auditar", e);
  }

  revalidatePath("/atribucion");
  revalidatePath("/comisiones");
  return { ok: true };
}

/* ---------------- Bienvenida ---------------- */

export async function enviarBienvenida(personaId: string): Promise<BienvenidaResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sesión caducada. Vuelve a entrar." };
  if (!puedeEnviarBienvenida(user)) return { ok: false, error: "No tienes permiso para enviar la bienvenida." };
  if (!/^[0-9a-f-]{36}$/i.test(personaId)) return { ok: false, error: "Cliente no válido." };

  const p = await rest<{ nombre: string | null; telefono_e164: string | null }[]>(
    "GET",
    `personas?id=eq.${personaId}&select=nombre,telefono_e164&limit=1`,
  );
  const persona = Array.isArray(p.json) ? p.json[0] : undefined;
  if (!persona) return { ok: false, error: "Cliente no encontrado." };
  if (!persona.telefono_e164) return { ok: false, error: "Este cliente no tiene teléfono registrado." };

  // Guard anti doble envío — qué cubre y qué NO:
  // Es check-then-act: entre este GET y el INSERT de más abajo hay un viaje
  // de ida y vuelta a Kapso. Cubre el doble clic y los reintentos
  // secuenciales (mismo operador, o distinto, pulsando otra vez tras ver un
  // error o una carga lenta) porque para entonces el mensaje anterior ya
  // quedó registrado. NO cubre a dos operadores pulsando "enviar bienvenida"
  // para el mismo cliente casi al mismo tiempo: ambos pueden pasar este
  // chequeo antes de que el primero termine de registrar su mensaje, y
  // saldrían dos WhatsApp reales.
  // Se acepta esa ventana a propósito — pero no porque la alternativa sea
  // "peor" en abstracto, sino porque la exposición real es despreciable: la
  // ventana son ~1 segundo (la ida y vuelta a Kapso) y hacen falta DOS de las
  // tres personas del equipo pulsando "enviar bienvenida" sobre el MISMO
  // cliente recién creado casi en el mismo instante. Blindar eso con una
  // reserva antes de enviar sería una mitigación desproporcionada al riesgo.
  // La reserva simple (crear un claim, enviar, confirmar) sí tiene el
  // defecto que motivó descartarla: si el claim se crea y el envío falla
  // después, el cliente queda marcado "ya enviada" para siempre y nunca
  // recibe la bienvenida, en silencio. Existe una variante que sí lo evita
  // —reserva CON CADUCIDAD: índice único + TTL en la derivación, de forma
  // que un claim huérfano expira y vuelve a estar disponible— y es el patrón
  // al que volver el día que el disparo se automatice o el equipo crezca.
  // Por ahora, un duplicado visible (se ve en el chat, se puede pedir
  // disculpas) sigue siendo preferible a una omisión invisible. Un índice
  // único simple tampoco resolvería esta carrera: el registro ocurre
  // DESPUÉS de que el WhatsApp ya salió, así que a lo sumo impediría el
  // segundo apunte en la tabla, no el segundo mensaje. Y en la práctica, el
  // camino más probable a un duplicado no es esta carrera de milisegundos
  // sino el 5xx de Kapso (ver más abajo, tras `enviarPlantilla`): eso es lo
  // que arregla el mensaje diferenciado para 5xx.
  // Se comprueba contra el registro de mensajes, que es la fuente de verdad.
  // El filtro sobre la tabla embebida (`conversacion.telefono_e164=eq.`)
  // exige `!inner` para que PostgREST lo aplique como INNER JOIN — verificado
  // por lectura contra la base real (ver task-3-report.md).
  const digitos = soloDigitos(persona.telefono_e164);
  const ya = await rest<{ id: string }[]>(
    "GET",
    `wa_mensajes?plantilla_nombre=eq.${BIENVENIDA_PLANTILLA}` +
      `&conversacion.telefono_e164=eq.${digitos}` +
      `&select=id,conversacion:wa_conversaciones!inner(telefono_e164)&limit=1`,
  );
  // Si la comprobación falla (PostgREST no lanza en fallos HTTP), `ya.json`
  // no es un array y el `Array.isArray` de abajo pasaría de largo: sin este
  // corte se enviaría una plantilla real sin haber podido comprobar si ya
  // se había mandado. Mejor bloquear y pedir reintento que arriesgar un
  // doble envío.
  if (ya.status >= 300) {
    console.error("[bienvenida] fallo al comprobar envíos previos", ya.status, ya.json);
    return { ok: false, error: "No se pudo comprobar si ya se envió la bienvenida. Reintenta." };
  }
  if (Array.isArray(ya.json) && ya.json.length > 0) {
    return { ok: true, yaEstaba: true };
  }

  const nombre = (persona.nombre ?? "").trim().split(/\s+/)[0] || "";
  const envio = await enviarPlantilla({
    to: digitos,
    name: BIENVENIDA_PLANTILLA,
    language: BIENVENIDA_IDIOMA,
    variables: { nombre },
    autor: user.id,
  });
  if (!envio.ok) {
    // Un 5xx es de Kapso, no de Meta — y ya pasó una vez (6-ago: su Postgres
    // en solo lectura devolvió 500 después de que el WhatsApp SÍ llegara,
    // solo falló el registro). Si aquí devolviéramos el texto genérico de
    // interpretarErrorEnvio ("espera y reintenta"), estaríamos invitando a
    // un segundo envío real: como no se registró nada, el guard anti doble
    // envío de arriba no ve nada y no protege. Un 4xx sí es un rechazo firme
    // de Meta — ahí no salió nada y el texto de interpretarErrorEnvio (que
    // ya distingue el mensaje de Meta) es correcto tal cual.
    //
    // Se pregunta por `incierto`, no por `status >= 500`: los guards locales
    // de `enviarPlantilla` (falta `KAPSO_API_KEY`) devuelven 501 sin haber
    // llamado a Kapso. Con la comparación de status, al operador le salía
    // "puede haber salido igual, mira el chat antes de reintentar" cuando
    // consta con certeza que no salió nada — le hacía perder el tiempo
    // buscando un mensaje inexistente y, peor, le enseñaba a desconfiar del
    // único aviso que sí importa cuando aparece de verdad.
    if (envio.incierto) {
      return {
        ok: false,
        error:
          "Kapso falló al registrar el envío, pero el WhatsApp puede haber salido igualmente " +
          "(ya pasó el 6 de agosto: Kapso devolvió error y el mensaje llegó de todas formas). " +
          "Antes de reintentar, mira el chat de este cliente — si la bienvenida ya está ahí, no la reenvíes.",
      };
    }
    return { ok: false, error: envio.error };
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${personaId}`);
  return { ok: true };
}

/* ---------------- Sesiones del servicio ---------------- */

// Permiso + identidad para cualquier operación sobre sesiones. Mismo patrón que
// `guardCuotas`: el autor SIEMPRE sale de la sesión del navegador, nunca del
// formulario. Si viniera del cliente, la traza de `auditoria` no valdría nada —
// cualquiera podría firmar con el nombre de otro.
async function guardSesiones(): Promise<
  { ok: true; autorId: string } | { ok: false; error: string }
> {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("sesiones"))) {
    return { ok: false, error: "Sin permiso para gestionar sesiones." };
  }
  return { ok: true, autorId: u.id };
}

// Traduce la respuesta de un RPC de sesiones. Las funciones de la 0037 lanzan
// mensajes ya escritos para humanos ("No se puede marcar como asistida una
// sesión que aún no ha ocurrido"), así que `mensajeRpc` los deja pasar tal cual
// y sólo envuelve los errores técnicos de Postgres.
async function llamarRpcSesion(
  fn: string,
  payload: unknown,
  exito: string,
): Promise<CuotaResult> {
  let r: Awaited<ReturnType<typeof rest>>;
  try {
    r = await rest("POST", `rpc/${fn}`, { payload });
  } catch {
    return { ok: false, error: "No se pudo guardar (error de conexión con la base)." };
  }
  if (r.status >= 300 || !r.json || (r.json as any).message) {
    const raw = (r.json as any)?.message;
    return { ok: false, error: raw ? mensajeRpc(String(raw)) : `Error del servidor (${r.status}).` };
  }
  revalidatePath("/sesiones");
  revalidatePath("/clientes");
  return { ok: true, mensaje: exito };
}

// Las operaciones viajan como JSON en un campo del formulario, no como campos
// sueltos: son una lista de longitud variable y "operaciones[2][capital]" sería
// reinventar mal un formato que ya existe. La función de la base ignora las
// filas sin dirección, así que la fila vacía con la que arranca el formulario
// no molesta.
function operacionesDelFormulario(crudo: string): unknown[] {
  if (!crudo.trim()) return [];
  try {
    const v = JSON.parse(crudo);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function crearSesion(formData: FormData): Promise<CuotaResult> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  if (!s("persona_id")) return { ok: false, error: "Falta el cliente." };
  // El texto se lee en el formulario de registrar sesión; la clave "coach_id"
  // NO se toca: la pone `name="coach_id"` en SesionForm y viaja al RPC.
  if (!s("coach_id")) return { ok: false, error: "Falta el consultor." };
  if (!s("fecha")) return { ok: false, error: "Falta la fecha de la sesión." };

  return llamarRpcSesion(
    "registrar_sesion",
    {
      autor_id: g.autorId,
      persona_id: s("persona_id"),
      coach_id: s("coach_id"),
      fecha: s("fecha"),
      estado_asistencia: s("estado_asistencia"),
      notas: s("notas"),
      url_grabacion: s("url_grabacion"),
      duracion_min: s("duracion_min"),
      capital_total: s("capital_total"),
      exchange: s("exchange"),
      proximo_paso: s("proximo_paso"),
      operaciones: operacionesDelFormulario(s("operaciones")),
    },
    "Sesión registrada.",
  );
}

export async function editarSesion(formData: FormData): Promise<CuotaResult> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  if (!s("sesion_id")) return { ok: false, error: "Falta la sesión a editar." };

  // Sólo se mandan las claves presentes en el formulario: la función de la base
  // distingue "no viene" (deja lo que había) de "viene vacío" (borra el campo)
  // con `payload ? 'clave'`, y meter aquí todas las claves con "" convertiría
  // cualquier edición parcial en un borrado silencioso del resto.
  const payload: Record<string, unknown> = { autor_id: g.autorId, sesion_id: s("sesion_id") };
  for (const k of [
    "persona_id", "coach_id", "fecha", "estado_asistencia", "notas",
    "url_grabacion", "duracion_min", "capital_total", "exchange", "proximo_paso",
  ]) {
    if (formData.has(k)) payload[k] = s(k);
  }
  if (formData.has("operaciones")) {
    payload.operaciones = operacionesDelFormulario(s("operaciones"));
  }

  return llamarRpcSesion("editar_sesion", payload, "Sesión actualizada.");
}

export async function borrarSesion(formData: FormData): Promise<CuotaResult> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  if (!s("sesion_id")) return { ok: false, error: "Falta la sesión a borrar." };

  return llamarRpcSesion(
    "borrar_sesion",
    { autor_id: g.autorId, sesion_id: s("sesion_id"), motivo: s("motivo") },
    "Sesión borrada. Queda el rastro en la auditoría.",
  );
}

// Edita una sesión recurrente (miércoles con Manuel, domingo con Berni):
// hora, enlace de Zoom y el interruptor del aviso. PATCH directo, sin RPC de
// auditoría: es configuración (como los gastos), no un dato del servicio. La
// audiencia no se edita aquí a propósito — hoy la lista blanca de
// lib/recurrentes.ts solo conoce "todos" y un select de una opción es ruido.
export async function editarRecurrente(formData: FormData): Promise<CuotaResult> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const id = s("recurrente_id");
  // El id va interpolado en la query de PostgREST: aquí no hay RPC que lo
  // parametrice, así que se valida la forma antes de tocar la URL.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: "Falta la sesión recurrente." };
  }

  const hora = s("hora"); // "HH:MM" del <input type=time>, o "" si se vació
  const enlace = s("enlace");
  const activa = s("activa") === "1";

  if (hora && !/^\d{2}:\d{2}$/.test(hora)) {
    return { ok: false, error: "La hora no tiene formato HH:MM." };
  }
  if (enlace && !/^https?:\/\//.test(enlace)) {
    return { ok: false, error: "El enlace tiene que empezar por http(s)://." };
  }
  // Activar sin datos dejaría la regla "encendida" pero muda (el cron la
  // salta y la cuenta en `sinDatos`): mejor negarse aquí, con el motivo.
  if (activa && (!hora || !enlace)) {
    return { ok: false, error: "Para activar el aviso hacen falta la hora y el enlace de Zoom." };
  }

  const r = await rest(
    "PATCH",
    `sesiones_recurrentes?id=eq.${id}`,
    { hora: hora || null, enlace: enlace || null, activa },
    "return=minimal",
  );
  if (r.status >= 300) {
    return { ok: false, error: `No se pudo guardar (${r.status}).` };
  }
  revalidatePath("/sesiones");
  return {
    ok: true,
    mensaje: activa
      ? "Guardada y ACTIVA. El aviso saldrá 1 h antes cuando el envío global esté encendido."
      : "Guardada. El aviso queda apagado.",
  };
}

export async function asignarClienteSesion(formData: FormData): Promise<CuotaResult> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  if (!s("sesion_id") || !s("persona_id")) {
    return { ok: false, error: "Falta la sesión o el cliente." };
  }

  return llamarRpcSesion(
    "asignar_cliente_sesion",
    { autor_id: g.autorId, sesion_id: s("sesion_id"), persona_id: s("persona_id") },
    "Sesión asignada al cliente.",
  );
}

/* ---------------- Ficha del cliente: edición ---------------- */
// Berni, 14-ago-2026: "conseguí el número de Nombre Ejemplo y no veo cómo lo puedo
// añadir para poder escribirle". Hasta ahora la ficha era de solo lectura y el
// único camino para tocar un dato era PostgREST a mano.

async function guardClientes(): Promise<
  { ok: true; autorId: string; puedeCambiarEstado: boolean } | { ok: false; error: string }
> {
  const u = await getCurrentUser();
  if (!u || !puedeVer(u, "clientes")) {
    return { ok: false, error: "Sin permiso para editar clientes." };
  }
  // Editar datos ≠ archivar. Manuel tiene el módulo `clientes` porque es quien
  // consigue los teléfonos, pero archivar saca a una persona de todas las
  // listas del OS — eso se reserva a `acceso_total`.
  return { ok: true, autorId: u.id, puedeCambiarEstado: u.acceso_total };
}

/**
 * Corrige los bonos de una venta ya registrada. Nace de un caso real: Alex
 * cerró un cliente en el evento y se le olvidó marcarlos, y sin esto la única
 * salida era tocar la base a mano.
 *
 * Permiso `ventas` y no `clientes`: esto edita una VENTA (cambia la duración
 * del programa y el cupo de consultorías), no los datos de contacto.
 */
export async function editarBonos(formData: FormData): Promise<PersonaResult> {
  const u = await getCurrentUser();
  if (!u || !puedeVer(u, "ventas")) {
    return { ok: false, error: "Sin permiso para editar ventas." };
  }
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const programaId = s("programa_id");
  const personaId = s("persona_id");
  if (!programaId) {
    return { ok: false, error: "Este cliente no tiene un programa activo al que aplicarle bonos." };
  }

  let bonos: string[] = [];
  try {
    const crudo = JSON.parse(s("bonos") || "[]");
    if (!Array.isArray(crudo)) return { ok: false, error: "Bonos mal formados." };
    // Se poda contra el catálogo; la regla del tier la aplica el RPC, que es
    // quien sabe de qué tier es el programa sin fiarse del formulario.
    bonos = normalizarBonos(crudo.map(String));
  } catch { return { ok: false, error: "Bonos mal formados." }; }

  let r: Awaited<ReturnType<typeof rest>>;
  try {
    r = await rest("POST", "rpc/editar_bonos", {
      payload: { programa_id: programaId, bonos, autor_id: u.id },
    });
  } catch {
    return { ok: false, error: "No se pudo guardar (error de conexión con la base)." };
  }
  if (r.status >= 300 || !r.json || (r.json as any).message) {
    const raw = (r.json as any)?.message;
    return { ok: false, error: raw ? String(raw) : `Error del servidor (${r.status}).` };
  }

  // El PDF que el equipo tiene en la bandeja se acaba de quedar viejo: se
  // generó con los bonos de antes. Esta marca es lo que cierra el hallazgo #2
  // de Milo — hasta ahora existía el botón "Recorregir" pero NADA avisaba de
  // que hubiera que apretarlo, así que el aviso dependía de que alguien se
  // acordara.
  //
  // Se filtra por `programa_id` y no por el id del contrato porque desde aquí
  // no se sabe si existe: si esa venta nunca emitió contrato, el PATCH afecta
  // 0 filas y no pasa nada. Es más barato que consultar primero.
  //
  // No se toca `recorregido_at`, y quien limpia ESTA marca es
  // `recorregirContrato()`, que escribe `desactualizado_at: null` en el mismo
  // PATCH en que pone `recorregido_at` (lib/contrato-envio.ts).
  //
  // 🔴 Ese `desactualizado_at: null` NO es código muerto — no lo quites. Una
  // versión anterior de este comentario decía que `cintaContrato()` comparaba
  // las dos fechas y que recorregir apagaba el aviso "por ser más reciente,
  // sin que nadie limpie nada". Es falso: `cintaContrato()` decide por
  // PRECEDENCIA (si hay `desactualizado_at`, roja; si no, dorada) y no mira
  // cuál es más reciente. Sin esa limpieza explícita, la cinta roja se queda
  // encendida para siempre en todo contrato ya corregido — o sea, la pantalla
  // vuelve a mentir sobre el estado del PDF, que es justo el hallazgo #2.
  //
  // Que las dos queden puestas a la vez es normal, no un fallo: pasa cuando se
  // recorrige bien y DESPUÉS alguien vuelve a tocar los bonos. Ahí manda la
  // roja, que es lo correcto.
  try {
    const marca = await rest(
      "PATCH",
      `contratos?programa_id=eq.${programaId}`,
      { desactualizado_at: new Date().toISOString() },
      "return=minimal",
    );
    // 🔴 `rest()` NO lanza con un status de error: hace el fetch y devuelve
    // `{ status, json }` (lib/supabase.ts:68). Sin este chequeo, un 400 —el
    // `42703` de la 0061 sin aplicar, o un rechazo de RLS— pasaría en
    // silencio. Mismo patrón que el PATCH de recorregirContrato.
    if (marca.status >= 300) {
      console.error(
        "[contratos] bonos editados, pero no se pudo marcar el contrato",
        marca.status,
        programaId,
      );
    }
  } catch {
    // Aquí solo cae un error de red. Los bonos YA se guardaron y eso es lo que
    // el closer pidió: si la marca no entra, el aviso no sale, pero no se
    // deshace el trabajo hecho ni se le miente diciendo que falló.
    console.error("[contratos] bonos editados, marca no enviada (red)", programaId);
  }

  // El cupo de consultorías vive en /sesiones y sale de la vista, así que la
  // pantalla de sesiones también tiene que refrescarse: si no, Manuel sigue
  // viendo el cupo viejo hasta que le caduque la caché.
  if (personaId) revalidatePath(`/clientes/${personaId}`);
  revalidatePath("/sesiones");
  revalidatePath("/clientes");
  // Sin esto la cinta roja no aparece hasta que caduque la caché de /contratos.
  revalidatePath("/contratos");

  const guardados = (r.json as any)?.bonos ?? bonos;
  const resumen = resumenBonos(Array.isArray(guardados) ? guardados.map(String) : []);
  return {
    ok: true,
    mensaje: resumen ? `Bonos guardados — ${resumen}.` : "Bonos quitados de esta venta.",
  };
}

export async function editarPersona(formData: FormData): Promise<PersonaResult> {
  const g = await guardClientes();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const personaId = s("persona_id");
  if (!personaId) return { ok: false, error: "Falta el cliente." };

  // El estado actual llega en campos ocultos del formulario y NO se relee de
  // la base: es lo que el operador tenía delante al abrir el modal. Sirve para
  // calcular la diferencia; la consistencia real la garantiza el `for update`
  // del RPC, que es quien tiene la foto buena.
  const prep = prepararEdicion(
    { nombre: s("nombre"), telefono: s("telefono"), email: s("email"),
      pais: s("pais"), coach_id: s("coach_id"), estado: s("estado") },
    { nombre: s("actual_nombre") || null, telefono_e164: s("actual_telefono") || null,
      email: s("actual_email") || null, pais: s("actual_pais") || null,
      coach_id: s("actual_coach_id") || null, estado: s("actual_estado") },
    { puedeCambiarEstado: g.puedeCambiarEstado },
  );
  if (!prep.ok) return prep;

  let r: Awaited<ReturnType<typeof rest>>;
  try {
    r = await rest("POST", "rpc/editar_persona", {
      payload: { persona_id: personaId, ...prep.campos, autor_id: g.autorId },
    });
  } catch {
    return { ok: false, error: "No se pudo guardar (error de conexión con la base)." };
  }
  if (r.status >= 300 || !r.json || (r.json as any).message) {
    const raw = (r.json as any)?.message;
    // `mensajeRpc` habla de ventas; aquí los errores del RPC ("Ese número ya
    // es de Miriam Blanco") ya están escritos para el operador y se pasan tal
    // cual. Solo se envuelve lo que huele a error técnico de Postgres.
    if (!raw) return { ok: false, error: `Error del servidor (${r.status}).` };
    const txt = String(raw);
    return {
      ok: false,
      error: PG_TECNICO.test(txt)
        ? `No se pudo guardar — revisa los datos (${txt})`
        : txt,
    };
  }

  revalidatePath(`/clientes/${personaId}`);
  revalidatePath("/clientes");
  revalidatePath("/inbox");
  revalidatePath("/");

  // Que el hilo se haya adoptado es la mitad del valor de poner el teléfono:
  // decirlo evita que alguien vaya al inbox a buscar por qué "no aparece".
  const adoptada = (r.json as any)?.conversacion_adoptada ?? null;
  return {
    ok: true,
    mensaje: adoptada
      ? "Ficha actualizada — y se vinculó una conversación de WhatsApp que estaba suelta."
      : "Ficha actualizada.",
  };
}

// ============================================================
// ESTRATEGIAS — módulo de servicio (spec 2026-08-20)
// ============================================================

// Permiso + identidad, calcado de `guardSesiones`. NO es redundante con el
// `requireModulo` de la página: aquello protege el RENDER, y un server action
// es un POST a la propia ruta que el middleware deja pasar con sólo tener
// cookie de equipo válida — ni mira la ruta, ni el método, ni el módulo. Sin
// esto, cualquier miembro logueado podría crear estrategias o revocar el
// acceso de un cliente sin tener el módulo, y el permiso sería decorativo.
async function guardEstrategias(): Promise<
  { ok: true; autorId: string } | { ok: false; error: string }
> {
  const u = await getCurrentUser();
  if (!u || !puedeVer(u, "estrategias")) {
    return { ok: false, error: "Sin permiso para gestionar estrategias." };
  }
  return { ok: true, autorId: u.id };
}

async function llamarRpcEstrategia(
  fn: string,
  payload: unknown,
): Promise<{ ok: true; datos: any } | { ok: false; error: string }> {
  let r: Awaited<ReturnType<typeof rest>>;
  try {
    r = await rest("POST", `rpc/${fn}`, { payload });
  } catch {
    return { ok: false, error: "No se pudo guardar (error de conexión con la base)." };
  }
  if (r.status >= 300 || !r.json || (r.json as any).message) {
    const raw = (r.json as any)?.message;
    return { ok: false, error: raw ? mensajeRpc(String(raw)) : `Error del servidor (${r.status}).` };
  }
  return { ok: true, datos: r.json };
}

export async function crearEstrategia(fd: FormData): Promise<CuotaResult> {
  const g = await guardEstrategias();
  if (!g.ok) return { ok: false, error: g.error };

  const personaId = String(fd.get("persona_id") ?? "").trim();
  const titulo = String(fd.get("titulo") ?? "").trim();
  const urlCruda = String(fd.get("url") ?? "");
  const avisar = fd.get("avisar") === "on";

  const problema = validarFormulario({ persona_id: personaId, titulo, url: urlCruda });
  if (problema) return { ok: false, error: problema };
  const url = normalizarUrl(urlCruda)!;

  const fecha = String(fd.get("fecha_lanzamiento") ?? "").trim();
  if (fecha && !esFechaISO(fecha)) return { ok: false, error: "La fecha no es válida." };

  // El token viaja generado desde aquí y no desde Postgres para no depender de
  // que pgcrypto esté instalado. 24 bytes = 192 bits: la fuerza bruta es
  // irrelevante, que importa porque este repo no tiene rate limiting.
  // `crear_estrategia` sólo lo usa si la persona aún no tenía llave — así el
  // enlace de un cliente NUNCA cambia por publicarle una estrategia más.
  const tokenNuevo = randomBytes(24).toString("base64url");

  const r = await llamarRpcEstrategia("crear_estrategia", {
    persona_id: personaId,
    titulo,
    url,
    password: String(fd.get("password") ?? "").trim() || null,
    resumen: String(fd.get("resumen") ?? "").trim() || null,
    fecha_lanzamiento: fecha || null,
    autor_id: g.autorId,
    token_nuevo: tokenNuevo,
  });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/estrategias");

  if (!avisar) return { ok: true, mensaje: "Estrategia guardada. El cliente no ha sido avisado." };

  const aviso = await avisarEstrategia(
    personaId,
    r.datos?.token ?? tokenNuevo,
    String(r.datos?.id ?? ""),
    g.autorId,
  );
  return { ok: true, mensaje: `Estrategia guardada. ${aviso.mensaje}` };
}

// El aviso va aparte de la creación a propósito: si el envío falla, la
// estrategia YA está guardada y el equipo puede reintentar el aviso sin
// duplicar la fila. Al revés —todo en una transacción— un 5xx haría perder el
// alta entera.
//
// Desde el 3-sep sale por DOS canales (D2). Tres cosas que la revisión
// adversarial obligó a cambiar y que no son cosméticas:
//
//  · La consulta trae `email`. Antes no, así que el dato con el que hay que
//    mandar ni siquiera estaba cargado.
//  · Faltar el teléfono ya NO corta la función. Cortaba con un `return`
//    antes de cualquier envío — y un cliente con email pero sin teléfono es
//    justo el perfil que el segundo canal existe para cubrir.
//  · La clave de idempotencia va por ESTRATEGIA, no por token. El token del
//    portal es por persona y permanente: usarlo habría permitido un solo
//    correo de estrategia por cliente en toda su vida.
//
// `PORTAL_BASE_URL` sigue cortando los dos canales, y esa sí es correcta: sin
// base el enlace sale suelto ("/e/xxx") y lo que reciba el cliente no sirve
// por ningún canal.
async function avisarEstrategia(
  personaId: string,
  token: string,
  estrategiaId: string,
  autorId: string,
): Promise<{ ok: boolean; mensaje: string }> {
  const p = await rest<{ nombre: string | null; telefono_e164: string | null; email: string | null }[]>(
    "GET",
    `personas?id=eq.${encodeURIComponent(personaId)}&select=nombre,telefono_e164,email&limit=1`,
  );
  const persona = Array.isArray(p.json) ? p.json[0] : undefined;
  if (!persona) return { ok: false, mensaje: "No se pudo leer el cliente, así que no se avisó." };

  const link = enlacePortal(process.env.PORTAL_BASE_URL ?? "", token);
  if (!link) return { ok: false, mensaje: "No se avisó: falta PORTAL_BASE_URL en las env vars." };

  const nombre = (persona.nombre ?? "").trim().split(/\s+/)[0] || "";
  const salidas = canales(estadoWa());
  const hechos: string[] = [];
  const fallos: string[] = [];

  // ── WhatsApp ────────────────────────────────────────────────────────────
  // Sin nombre no se puede: la plantilla lleva `{{nombre}}` y Meta rechaza un
  // parámetro vacío con un error que no dice cuál falta. El email sí puede —
  // su plantilla saluda con "Hola," y ya está.
  if (!salidas.whatsapp) {
    fallos.push("WhatsApp está caído");
  } else if (!persona.telefono_e164) {
    fallos.push("no tiene teléfono");
  } else if (!nombre) {
    fallos.push("no tiene nombre (la plantilla de WhatsApp lo exige)");
  } else {
    const envio = await enviarPlantilla({
      to: persona.telefono_e164,
      name: "recurso_estrategia_es",
      language: "es",
      variables: { nombre, link },
      bodyResuelto:
        `Hola ${nombre} 👋 Aquí tienes la estrategia de inversión que hablamos.\n\n` +
        `Puedes verla en este enlace: ${link}\n\nCualquier duda, escríbenos por este chat.`,
      autor: autorId,
      // sesionId NO se pasa: es FK a `sesiones` y este módulo no tiene ninguna.
    });
    if (envio.ok) hechos.push("WhatsApp");
    else
      fallos.push(
        envio.incierto
          ? `WhatsApp: ${envio.error} Puede haber salido igualmente — mira el chat antes de reenviar`
          : `WhatsApp: ${envio.error}`,
      );
  }

  // ── Email ───────────────────────────────────────────────────────────────
  // 🔴 Este camino nació SIN llave, al contrario que los tres crons, y eso lo
  // dejaba armado en producción desde el primer despliegue: bastaba que
  // alguien publicara una estrategia para que saliera un correo real a un
  // cliente real, con una plantilla que nunca había pasado por el tubo y
  // desde un subdominio sin historial de envío. Lo destapó una auditoría
  // adversarial el 4-sep; el resto del sistema estaba apagado y este no.
  //
  // Ahora comparte el patrón de los demás: nace apagado y se enciende a
  // propósito. Ojo, encender la variable en Vercel NO basta: el runtime lleva
  // la foto de las env vars del despliegue, así que hay que redesplegar.
  if (process.env.ESTRATEGIA_EMAIL_ACTIVO !== "1") {
    // Silencio deliberado, no un fallo: mientras esté apagado, el aviso por
    // email simplemente no forma parte del flujo y no hay nada que contarle
    // al equipo.
  } else if (!persona.email) {
    fallos.push("no tiene email");
  } else if (!estrategiaId) {
    // Sin id no hay clave, y sin clave no hay antiduplicados. Antes de mandar
    // sin red, no mandar.
    fallos.push("email: la estrategia no devolvió id");
  } else {
    const correo = emailEstrategia({ nombre: persona.nombre ?? "", enlace: link });
    const envio = await enviarYRegistrarEmail({
      to: persona.email,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      clave: claveEstrategia(estrategiaId),
      tipo: "estrategia",
      personaId,
    });
    if (envio.ok) hechos.push("email");
    else fallos.push(`email: ${envio.error}`);
  }

  if (hechos.length && !fallos.length) return { ok: true, mensaje: `Avisado por ${hechos.join(" y ")}.` };
  if (hechos.length) return { ok: true, mensaje: `Avisado por ${hechos.join(" y ")}, pero ${fallos.join("; ")}.` };
  return { ok: false, mensaje: `El aviso no salió: ${fallos.join("; ")}.` };
}

export async function editarEstrategia(fd: FormData): Promise<CuotaResult> {
  const g = await guardEstrategias();
  if (!g.ok) return { ok: false, error: g.error };

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Falta la estrategia." };

  const urlCruda = String(fd.get("url") ?? "").trim();
  let url: string | undefined;
  if (urlCruda) {
    const limpia = normalizarUrl(urlCruda);
    if (!limpia) return { ok: false, error: "El enlace no es válido. Pega la URL completa." };
    url = limpia;
  }

  const fecha = String(fd.get("fecha_lanzamiento") ?? "").trim();
  if (fecha && !esFechaISO(fecha)) return { ok: false, error: "La fecha no es válida." };

  const r = await llamarRpcEstrategia("editar_estrategia", {
    id,
    titulo: String(fd.get("titulo") ?? "").trim() || null,
    url: url ?? null,
    password: String(fd.get("password") ?? ""),
    resumen: String(fd.get("resumen") ?? ""),
    fecha_lanzamiento: fecha || null,
    autor_id: g.autorId,
  });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/estrategias");
  return { ok: true, mensaje: "Estrategia actualizada." };
}

export async function visibilidadEstrategia(fd: FormData): Promise<CuotaResult> {
  const g = await guardEstrategias();
  if (!g.ok) return { ok: false, error: g.error };

  const id = String(fd.get("id") ?? "").trim();
  const visible = String(fd.get("visible") ?? "") === "true";
  if (!id) return { ok: false, error: "Falta la estrategia." };

  const r = await llamarRpcEstrategia("visibilidad_estrategia", {
    id, visible, autor_id: g.autorId,
  });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/estrategias");
  return {
    ok: true,
    mensaje: visible ? "El cliente vuelve a verla." : "Oculta para el cliente (se conserva).",
  };
}

/**
 * La contraseña de una estrategia, sólo cuando alguien la pide.
 *
 * Existe para que el listado NO la lleve: un Client Component serializa sus
 * props en el payload del RSC, así que mandarla con la fila y taparla con
 * puntos la dejaría en claro en el código fuente de /estrategias. Pasa por el
 * mismo guard que el resto del módulo.
 */
export async function verPassword(id: string): Promise<{ ok: true; password: string | null } | { ok: false; error: string }> {
  const g = await guardEstrategias();
  if (!g.ok) return { ok: false, error: g.error };
  if (!id.trim()) return { ok: false, error: "Falta la estrategia." };
  return { ok: true, password: await passwordDeEstrategia(id) };
}

/** El enlace del portal de un cliente, para reenviárselo a mano. */
export async function enlaceDeCliente(
  personaId: string,
): Promise<{ ok: true; enlace: string | null } | { ok: false; error: string }> {
  const g = await guardEstrategias();
  if (!g.ok) return { ok: false, error: g.error };
  const r = await rest<{ token: string; revocado_at: string | null }[]>(
    "GET",
    `portal_accesos?persona_id=eq.${encodeURIComponent(personaId)}&select=token,revocado_at&limit=1`,
  );
  const fila = Array.isArray(r.json) ? r.json[0] : undefined;
  if (!fila || fila.revocado_at) return { ok: true, enlace: null };
  return { ok: true, enlace: enlacePortal(process.env.PORTAL_BASE_URL ?? "", fila.token) };
}

/**
 * Corta el enlace de un cliente y le da uno nuevo.
 *
 * Rotar y no sólo revocar: el cliente no puede quedarse sin acceso a su propia
 * estrategia por un susto. El viejo deja de funcionar al instante.
 */
export async function rotarEnlace(
  personaId: string,
): Promise<{ ok: true; enlace: string; mensaje: string } | { ok: false; error: string }> {
  const g = await guardEstrategias();
  if (!g.ok) return { ok: false, error: g.error };
  if (!personaId.trim()) return { ok: false, error: "Falta el cliente." };

  const r = await llamarRpcEstrategia("rotar_acceso_portal", {
    persona_id: personaId,
    autor_id: g.autorId,
    token_nuevo: randomBytes(24).toString("base64url"),
  });
  if (!r.ok) return { ok: false, error: r.error };

  const enlace = enlacePortal(process.env.PORTAL_BASE_URL ?? "", r.datos?.token ?? "");
  if (!enlace) return { ok: false, error: "Enlace rotado, pero falta PORTAL_BASE_URL para componerlo." };
  revalidatePath("/estrategias");
  return {
    ok: true,
    enlace,
    mensaje: r.datos?.era_nuevo
      ? "Enlace creado. Mándaselo al cliente."
      : "Enlace rotado. El anterior ya no funciona — mándale el nuevo.",
  };
}

// ---- Devoluciones (spec 2026-08-21) ----
// Regla de Berni, 21-ago: "las comisiones simplemente desaparecen" y "se resta
// en este [mes]". Criterio de caja — ver docs/devoluciones.md.

async function guardDevoluciones(): Promise<
  { ok: true; autorId: string } | { ok: false; error: string }
> {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("devoluciones"))) {
    return { ok: false, error: "Sin permiso para registrar devoluciones." };
  }
  return { ok: true, autorId: u.id };
}

async function llamarRpcDevolucion(
  fn: string, payload: unknown, exito: string,
): Promise<DevolucionResult> {
  let r: Awaited<ReturnType<typeof rest>>;
  try {
    r = await rest("POST", `rpc/${fn}`, { payload });
  } catch {
    return { ok: false, error: "No se pudo guardar (error de conexión con la base)." };
  }
  if (r.status >= 300 || !r.json || (r.json as { message?: string }).message) {
    const raw = (r.json as { message?: string } | null)?.message;
    return { ok: false, error: raw ? mensajeRpc(String(raw)) : `Error del servidor (${r.status}).` };
  }
  // Una devolución toca las cinco pantallas de la cascada.
  revalidatePath("/devoluciones"); revalidatePath("/ingresos"); revalidatePath("/cuotas");
  revalidatePath("/clientes"); revalidatePath("/comisiones"); revalidatePath("/pnl");
  revalidatePath("/");
  return { ok: true, mensaje: exito };
}

// Calcula las líneas de comisión a revertir para pasárselas a la RPC, que solo
// las escribe. El cálculo vive aquí y no en SQL para que las reglas de reparto
// tengan una sola fuente de verdad (lib/comisiones.ts, con tests).
async function lineasARevertir(
  programaId: string, revierteId: string | null, usdDevuelto: number,
): Promise<unknown[]> {
  const equipo = await getTeamMembers();
  const quienCobra = {
    noCobran: new Set(equipo.filter((t) => !t.cobra_comision).map((t) => t.id)),
  };
  const nombre = new Map(equipo.map((t) => [t.id, t.nombre]));
  const filtro = revierteId ? `pago_id=eq.${revierteId}` : `programa_id=eq.${programaId}`;
  const [r, prog] = await Promise.all([
    rest<Array<Record<string, unknown>>>("GET", `v_pagos_atribuidos?${filtro}&select=*`),
    rest<Array<{ fecha_inicio: string }>>("GET", `programas?id=eq.${programaId}&select=fecha_inicio`),
  ]);
  const pagos = Array.isArray(r.json) ? r.json : [];
  const fechaVenta = prog.json?.[0]?.fecha_inicio;

  const out: unknown[] = [];
  for (const p of pagos) {
    const pa = {
      pago_id: String(p.pago_id), monto: Number(p.monto),
      usd_recibido: p.usd_recibido == null ? null : Number(p.usd_recibido),
      motivo: motivoDePago(p.motivo),
      programa_id: p.programa_id ? String(p.programa_id) : null,
      setter_id: p.setter_id ? String(p.setter_id) : null,
      closer_id: p.closer_id ? String(p.closer_id) : null,
      upsell_por_id: p.upsell_por_id ? String(p.upsell_por_id) : null,
      atribuido: Boolean(p.atribuido), fuente_confirmada: Boolean(p.fuente_confirmada),
    };
    const usd = revierteId ? usdDevuelto : -(pa.usd_recibido ?? 0);
    const { lineas } = ajusteDeDevolucion(pa, usd, quienCobra, fechaVenta);
    for (const l of lineas) {
      out.push({
        team_member_id: l.team_member_id, nombre: nombre.get(l.team_member_id) ?? null,
        rol: l.rol, tasa: l.tasa, base: l.base, importe: l.importe,
        pago_original_id: l.pago_id,
      });
    }
  }
  return out;
}

export async function registrarDevolucion(formData: FormData): Promise<DevolucionResult> {
  const g = await guardDevoluciones();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();

  const personaId = s("persona_id");
  const programaId = s("programa_id");
  if (!personaId || !programaId) return { ok: false, error: "Falta el cliente o su programa." };

  const alcance = s("alcance");
  if (alcance !== "total" && alcance !== "parcial") {
    return { ok: false, error: "Elige si se devuelve el programa entero o solo un cobro." };
  }
  const revierteId = alcance === "parcial" ? s("revierte_pago_id") : "";
  if (alcance === "parcial" && !revierteId) {
    return { ok: false, error: "Elige de la lista qué cobro se está devolviendo." };
  }
  // El motivo se exige también aquí para que el error salga en el formulario
  // donde el operador está escribiendo, no como mensaje crudo de Postgres.
  const motivo = s("motivo");
  if (!motivo) {
    return { ok: false, error: "Escribe por qué se devuelve. Queda registrado en la auditoría." };
  }
  if (!esFechaISO(s("fecha"))) {
    return { ok: false, error: "La fecha de la devolución es obligatoria (AAAA-MM-DD)." };
  }
  const usd = Number(s("usd"));
  if (!Number.isFinite(usd) || usd === 0) {
    return {
      ok: false,
      error: "Falta el USD devuelto — es la base sobre la que se revierte la comisión.",
    };
  }
  const eur = Number(s("eur") || "0");
  if (!Number.isFinite(eur)) return { ok: false, error: "El importe en euros no es un número." };

  const usdNeg = -Math.abs(usd);
  const ajuste = await lineasARevertir(programaId, revierteId || null, usdNeg);

  return llamarRpcDevolucion(
    "registrar_devolucion",
    {
      persona_id: personaId, programa_id: programaId, alcance,
      fecha: s("fecha"), eur: String(-Math.abs(eur)), usd: String(usdNeg),
      motivo, revierte_pago_id: revierteId || null,
      autor_id: g.autorId, ajuste_comision: ajuste,
    },
    "Devolución registrada — el mes en curso ya la refleja.",
  );
}

export async function clasificarDevolucion(formData: FormData): Promise<DevolucionResult> {
  const g = await guardDevoluciones();
  if (!g.ok) return g;
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const id = s("devolucion_id");
  if (!id) return { ok: false, error: "Falta la devolución." };
  const alcance = s("alcance");
  if (alcance !== "total" && alcance !== "parcial") {
    return { ok: false, error: "Elige si fue el programa entero o solo un cobro." };
  }
  const motivo = s("motivo");
  if (!motivo) return { ok: false, error: "Escribe qué fue esta devolución." };
  return llamarRpcDevolucion(
    "clasificar_devolucion",
    { devolucion_id: id, alcance, motivo,
      revierte_pago_id: s("revierte_pago_id") || null, autor_id: g.autorId },
    "Devolución clasificada.",
  );
}

export async function deshacerDevolucion(formData: FormData): Promise<DevolucionResult> {
  const g = await guardDevoluciones();
  if (!g.ok) return g;
  const id = String(formData.get("devolucion_id") ?? "").trim();
  if (!id) return { ok: false, error: "Falta la devolución." };
  return llamarRpcDevolucion(
    "deshacer_devolucion",
    { devolucion_id: id, autor_id: g.autorId },
    "Devolución deshecha — las cuotas y el estado del cliente vuelven a como estaban.",
  );
}

/**
 * Cambia el modo del envío de contratos: prueba ↔ producción, sin desplegar.
 *
 * En prueba, el contrato va a las direcciones de `ajustes_os.contrato_email_prueba`.
 * En producción va a Berni, Alex y Paula. El interruptor vive en la base
 * (`0060`) y no en una variable de entorno justamente para que cambiarlo sea un
 * clic: una variable de Vercel obliga a redesplegar, y el modo de fallo caro no
 * es tardar — es dejársela puesta.
 *
 * Solo `acceso_total`: decide si un documento legal sale al equipo o a un buzón
 * de pruebas. Mismo criterio que el resto de acciones que cambian configuración.
 */
export async function cambiarModoContrato(formData: FormData): Promise<{ ok: boolean; error?: string; modo?: "on" | "off" }> {
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "Sin sesión." };
  if (!u.acceso_total) return { ok: false, error: "Solo un administrador puede cambiar el modo de envío." };

  // El valor llega del formulario y NO se calcula aquí leyendo el actual: dos
  // pestañas abiertas con el interruptor en estados distintos harían que un
  // "alterna lo que haya" dejara el modo contrario al que se ve en pantalla.
  const modo = String(formData.get("modo") ?? "");
  if (modo !== "on" && modo !== "off") return { ok: false, error: "Modo desconocido." };

  const r = await rest(
    "POST",
    "ajustes_os",
    { clave: "contrato_modo_prueba", valor: modo, actualizado_at: new Date().toISOString(), autor_id: u.id },
    "resolution=merge-duplicates",
  );
  if (r.status >= 300) {
    console.error("[ajustes] no se pudo cambiar el modo de contrato", r.status, r.json);
    return { ok: false, error: "No se pudo guardar el cambio." };
  }

  revalidatePath("/contratos");
  return { ok: true, modo };
}

/**
 * Reenvía a mano un contrato que ya existe. Nace de un caso real: el envío
 * automático corre dentro de `after()`, que pasa una vez — si Resend rechaza,
 * la fila queda en "No salió" y no había forma de recuperarla sin tocar la base.
 *
 * Solo `acceso_total`: manda un documento legal a tres personas.
 */
export async function reenviarContratoAction(formData: FormData): Promise<{ ok: boolean; error?: string; destinos?: string[] }> {
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "Sin sesión." };
  if (!u.acceso_total) return { ok: false, error: "Solo un administrador puede reenviar un contrato." };

  const id = String(formData.get("contrato_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "Contrato no válido." };

  const r = await reenviarContrato(id);
  if (r.ok) revalidatePath("/contratos");
  return r;
}

/**
 * Alex manda el enlace de firma al cliente. Módulo "ventas", NO
 * `acceso_total`: es el closer quien cierra el ciclo — decisión de Milo,
 * 15-sep. Reenviar rota el token; el enlace anterior deja de valer, y eso es
 * lo correcto: apunta a un PDF que ya no es el vigente.
 */
export async function enviarContratoAlClienteAction(
  formData: FormData,
): Promise<{ ok: true; destino: string; enPrueba: boolean } | { ok: false; error: string }> {
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "Sin sesión." };
  if (!(u.acceso_total || (u.modulos ?? []).includes("ventas"))) return { ok: false, error: "Sin permiso." };

  const id = String(formData.get("contrato_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "Contrato no válido." };

  const r = await enviarContratoAlCliente(id, u.id);
  if (r.ok) revalidatePath("/contratos");
  return r;
}

/**
 * Regenera y reenvía un contrato con los datos ACTUALES de la venta —
 * a diferencia de reenviarContratoAction, que reusa el PDF viejo. Existe
 * para el hallazgo #2 de Milo (PR #3): un contrato ya emitido no se enteraba
 * si los bonos del cliente se corregían después.
 *
 * Solo `acceso_total`: regenera y manda de nuevo un documento legal.
 */
export async function recorregirContratoAction(formData: FormData): Promise<{ ok: boolean; error?: string; destinos?: string[] }> {
  const u = await getCurrentUser();
  if (!u) return { ok: false, error: "Sin sesión." };
  if (!u.acceso_total) return { ok: false, error: "Solo un administrador puede recorregir un contrato." };

  const id = String(formData.get("contrato_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: "Contrato no válido." };

  const r = await recorregirContrato(id);
  if (r.ok) revalidatePath("/contratos");
  return r;
}

/* ---------------- El contrato que se edita y se firma en el OS ----------------
 * Las tres del editor: generar sin mandar, guardar lo editado, y releer.
 *
 * Módulo "ventas" y NO `acceso_total`, igual que `enviarContratoAlClienteAction`
 * y por la misma decisión de Milo (15-sep): quien cierra la venta es quien
 * lleva el contrato de punta a punta. Las de arriba —reenviar, recorregir—
 * siguen siendo de administrador porque mandan un documento legal al equipo;
 * estas se quedan dentro del OS hasta que alguien le da a enviar.
 */

// Permiso + identidad para el editor de contratos. El autor SIEMPRE sale de
// la sesión: el cliente no lo manda (queda escrito en `texto_editado_por`).
async function guardVentas(): Promise<
  { ok: true; autorId: string } | { ok: false; error: string }
> {
  const u = await getCurrentUser();
  if (!u || !(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return { ok: false, error: "Sin permiso para gestionar contratos." };
  }
  return { ok: true, autorId: u.id };
}

/**
 * Genera el contrato de una venta recién registrada y lo deja listo para
 * revisar, sin mandarlo a nadie. Lo llama el modal que se abre al terminar
 * la venta. Si ya existía, devuelve el que hay.
 */
export async function generarContratoAction(formData: FormData) {
  const g = await guardVentas();
  if (!g.ok) return g;

  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const [personaId, programaId, pagoId] = [s("persona_id"), s("programa_id"), s("pago_id")];
  if (![personaId, programaId, pagoId].every((x) => /^[0-9a-f-]{36}$/.test(x))) {
    return { ok: false as const, error: "Venta no válida." };
  }

  const r = await generarContrato(personaId, programaId, pagoId, s("tipo_venta"), g.autorId);
  if (r.ok) revalidatePath("/contratos");
  return r;
}

/**
 * Guarda el texto que el closer dejó en el editor y regenera el PDF desde él.
 *
 * `requiereReenvio` en la respuesta no es un aviso decorativo: si el contrato
 * ya había salido al cliente, su enlace deja de poder firmarse en cuanto el
 * texto cambia (el hash del PDF ya no cuadra, a propósito — ver
 * `guardarTextoYRegenerar`). Hay que volver a enviárselo.
 */
export async function guardarTextoContratoAction(formData: FormData) {
  const g = await guardVentas();
  if (!g.ok) return g;

  const id = String(formData.get("contrato_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false as const, error: "Contrato no válido." };

  const r = await guardarTextoYRegenerar(id, String(formData.get("texto") ?? ""), g.autorId);
  if (r.ok) revalidatePath("/contratos");
  return r;
}

/** Lo que el editor necesita para abrirse sobre un contrato que ya existe. */
export async function textoContratoAction(formData: FormData) {
  const g = await guardVentas();
  if (!g.ok) return g;

  const id = String(formData.get("contrato_id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false as const, error: "Contrato no válido." };

  const t = await textoDeContrato(id);
  return t ? { ok: true as const, ...t } : { ok: false as const, error: "Ese contrato no tiene texto editable." };
}

/* ---------------- Llamadas de Fathom ---------------- */
// Berni, en CAMBIOS OS (6-sep): que las sesiones se registren solas cuando
// Fathom confirme la llamada, y que el consultor solo tenga que "revisar,
// añadir la landing y validar". Estas tres acciones son ese "revisar y validar".
//
// Ninguna escribe en `sesiones` por su cuenta salvo `crearSesionDesdeLlamada`,
// que pasa por el MISMO RPC auditado que el alta manual. El porqué está en la
// cabecera de la migración 0062.

/** Un id de fila de la bandeja. Mismo criterio que reenviarContratoAction. */
function idLlamada(formData: FormData): string | null {
  const id = String(formData.get("llamada_id") ?? "");
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

/**
 * Asignar (o quitar) el cliente de una llamada a mano.
 *
 * Marca `emparejado_por = 'manual'`, y eso tiene una consecuencia importante:
 * la ingesta deja de tocar el cliente y el tipo de esa fila para siempre. Si
 * alguien corrige un emparejamiento es justamente porque la regla se equivocó;
 * que el cron de dentro de 15 minutos lo revirtiera sería el peor de los mundos.
 */
export async function emparejarLlamada(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const id = idLlamada(formData);
  if (!id) return { ok: false, error: "Llamada no válida." };

  const personaId = String(formData.get("persona_id") ?? "").trim();
  if (personaId && !/^[0-9a-f-]{36}$/.test(personaId)) {
    return { ok: false, error: "Cliente no válido." };
  }

  const r = await rest(
    "PATCH",
    `fathom_llamadas?id=eq.${id}`,
    {
      persona_id: personaId || null,
      emparejado_por: personaId ? "manual" : null,
      actualizado_at: new Date().toISOString(),
    },
    "return=minimal",
  );
  // `rest()` no lanza con un status de error (lib/supabase.ts): sin este
  // chequeo, un 400 dejaría la pantalla diciendo que se guardó.
  if (r.status >= 300) return { ok: false, error: `No se pudo guardar (${r.status}).` };

  revalidatePath("/llamadas");
  if (personaId) revalidatePath(`/clientes/${personaId}`);
  return { ok: true };
}

/**
 * Sacar una llamada de la bandeja sin borrarla.
 *
 * Se archiva y no se borra porque la ingesta la volvería a traer en la
 * siguiente pasada: `recording_id` es único y el upsert la recrearía. Con la
 * marca puesta, sigue existiendo y deja de estorbar.
 */
export async function descartarLlamada(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const id = idLlamada(formData);
  if (!id) return { ok: false, error: "Llamada no válida." };

  const deshacer = String(formData.get("deshacer") ?? "") === "1";
  const r = await rest(
    "PATCH",
    `fathom_llamadas?id=eq.${id}`,
    { descartada_at: deshacer ? null : new Date().toISOString(), actualizado_at: new Date().toISOString() },
    "return=minimal",
  );
  if (r.status >= 300) return { ok: false, error: `No se pudo guardar (${r.status}).` };
  revalidatePath("/llamadas");
  return { ok: true };
}

/**
 * Convierte una llamada en una sesión del servicio — el paso que la ingesta
 * NO hace sola.
 *
 * Pasa por `registrar_sesion`, el mismo RPC que el alta manual: así la
 * auditoría, el cupo de consultorías y las comisiones se comportan igual que
 * siempre, en vez de tener un segundo camino que se comporta parecido.
 *
 * El consultor se deduce de quién grabó en Fathom, cruzando el correo con
 * `team_members`. Si esa persona no está en el equipo, se corta: es preferible
 * pedir el dato a colgarle la sesión —y su comisión— a quien no la hizo.
 */
export async function crearSesionDesdeLlamada(formData: FormData): Promise<CuotaResult> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const id = idLlamada(formData);
  if (!id) return { ok: false, error: "Llamada no válida." };

  const rl = await rest<
    {
      persona_id: string | null; inicio: string | null; duracion_min: number | null;
      url: string | null; resumen_md: string | null; grabado_por_email: string | null;
      sesion_id: string | null;
    }[]
  >(
    "GET",
    `fathom_llamadas?id=eq.${id}&select=persona_id,inicio,duracion_min,url,resumen_md,grabado_por_email,sesion_id&limit=1`,
  );
  const ll = Array.isArray(rl.json) ? rl.json[0] : null;
  if (!ll) return { ok: false, error: "Esa llamada no existe." };
  if (ll.sesion_id) return { ok: false, error: "Esta llamada ya tiene una sesión." };
  if (!ll.persona_id) return { ok: false, error: "Primero hay que decir de qué cliente es." };
  if (!ll.inicio) return { ok: false, error: "La llamada no tiene fecha." };

  const rc = await rest<{ id: string }[]>(
    "GET",
    `team_members?select=id&email=eq.${encodeURIComponent(ll.grabado_por_email ?? "")}&limit=1`,
  );
  const coachId = Array.isArray(rc.json) ? rc.json[0]?.id : null;
  if (!coachId) {
    return { ok: false, error: `Quien grabó (${ll.grabado_por_email ?? "?"}) no está en el equipo del OS.` };
  }

  const fd = new FormData();
  fd.set("persona_id", ll.persona_id);
  fd.set("coach_id", coachId);
  fd.set("fecha", ll.inicio);
  // Fathom solo tiene la grabación si la llamada ocurrió, así que "asistió" es
  // un hecho, no una suposición — es justo lo que Berni pidió que dejara de
  // registrarse a mano.
  fd.set("estado_asistencia", "asistio");
  fd.set("duracion_min", String(ll.duracion_min ?? ""));
  fd.set("url_grabacion", ll.url ?? "");
  // El resumen sin los enlaces con marca de tiempo: dentro de Fathom sirven,
  // pegados en las notas de una sesión son ilegibles.
  fd.set("notas", resumenEnTexto(ll.resumen_md));
  // La landing y el capital NO se rellenan: son justo lo que Berni dijo que
  // añade el consultor al revisar. Inventarlos sería peor que dejarlos vacíos.

  const r = await crearSesion(fd);
  if (!r.ok) return r;

  // Enlazar la llamada con su sesión. Se busca la recién creada por cliente y
  // fecha porque `registrar_sesion` no devuelve el id.
  const rs = await rest<{ id: string }[]>(
    "GET",
    `sesiones?select=id&persona_id=eq.${ll.persona_id}&order=created_at.desc&limit=1`,
  );
  const sesionId = Array.isArray(rs.json) ? rs.json[0]?.id : null;
  if (sesionId) {
    const pat = await rest(
      "PATCH",
      `fathom_llamadas?id=eq.${id}`,
      { sesion_id: sesionId, actualizado_at: new Date().toISOString() },
      "return=minimal",
    );
    // Si esto falla la sesión YA existe y es correcta; lo único que se pierde
    // es la marca de "ya convertida", así que la llamada seguiría en la
    // bandeja. Se avisa en vez de fingir que todo salió bien.
    if (pat.status >= 300) {
      console.error("[fathom] sesión creada pero la llamada no quedó marcada", pat.status, id);
      return { ok: true, mensaje: "Sesión creada, pero la llamada sigue en la bandeja (revisar logs)." };
    }
  }

  revalidatePath("/llamadas");
  revalidatePath("/sesiones");
  return { ok: true, mensaje: "Sesión creada desde la llamada." };
}

/** Traer ahora lo que haya en Fathom, sin esperar al cron de cada 15 minutos. */
export async function sincronizarFathom(): Promise<{ ok: boolean; error?: string; mensaje?: string }> {
  const g = await guardSesiones();
  if (!g.ok) return g;
  const r = await ingerirFathom();
  revalidatePath("/llamadas");
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    mensaje: `${r.vistas} llamadas en Fathom · ${r.guardadas} guardadas · ${r.emparejadas} con cliente.`,
  };
}
