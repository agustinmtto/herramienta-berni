// ============================================================
// GET /api/ghl/citas?personaId=<uuid> | ?email=<email> | ?telefono=<tel>
// Sirve al navegador las citas de VENTA de un cliente, ya traducidas. El
// cliente-side no habla con GHL: la clave vive solo en el servidor.
// Solo módulo "ventas", mismo gate que /api/ventas/contexto.
// ============================================================
import { rest } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/auth";
import { traerCitasDeVenta, traerContacto, buscarContacto } from "@/lib/ghl";
import { miembroDeUsuarioGhl, NOMBRE_CALENDARIO } from "@/lib/atribucion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const u = await getCurrentUser();
  if (!u) return Response.json({ error: "no auth" }, { status: 401 });
  if (!(u.acceso_total || (u.modulos ?? []).includes("ventas"))) {
    return Response.json({ error: "sin permiso" }, { status: 403 });
  }

  // Tres llaves, en orden de fiabilidad. `personaId` solo existe en
  // ascensiones; en una COMPRA NUEVA el cliente todavía no está en la base
  // —Alex lo está tecleando— pero su contacto de GHL SÍ existe desde que
  // agendó la llamada. Sin email/teléfono, toda compra nueva caería en la
  // bandeja y Alex tocaría cada venta dos veces.
  const q = new URL(request.url).searchParams;
  const personaId = q.get("personaId");
  const email = q.get("email");
  const telefono = q.get("telefono");
  if (!personaId && !email && !telefono) {
    return Response.json({ error: "falta personaId, email o telefono" }, { status: 400 });
  }

  let contactId: string | null = null;

  if (personaId) {
    const per = await rest<{ ghl_contact_id: string | null }[]>(
      "GET", `personas?id=eq.${personaId}&select=ghl_contact_id&limit=1`);
    contactId = per.json?.[0]?.ghl_contact_id ?? null;
  }

  // Búsqueda en GHL por email y luego por teléfono. El email es la llave
  // buena: en el sync de sesiones cruzó 2 de 3 contra 1 de 3 del teléfono.
  if (!contactId && (email || telefono)) {
    try {
      contactId = await buscarContacto(email, telefono);
    } catch (e) {
      console.error("[api/ghl/citas] búsqueda de contacto", e);
      return Response.json({ error: "GHL no responde" }, { status: 502 });
    }
  }

  // Sin contacto no hay citas que ofrecer, y eso NO es un error: Alex elige
  // "no vino de agenda" y sigue.
  if (!contactId) return Response.json({ citas: [] });

  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 365 * 24 * 60 * 60 * 1000);

  let citas;
  // `nombres` sale del catálogo real de GHL: un calendario nuevo (los de
  // evento, que Berni crea sobre la marcha) se enseña con su nombre de verdad
  // en vez de "calendario desconocido".
  let nombreCalendario: Record<string, string> = {};
  try {
    const r = await traerCitasDeVenta(contactId, desde, hasta);
    citas = r.citas;
    nombreCalendario = r.nombres;
  } catch (e) {
    console.error("[api/ghl/citas]", e);
    // 502 y no lista vacía: "GHL no responde" no puede parecerse a "este
    // cliente no tiene citas". La segunda invita a marcar "sin agenda" y
    // perder la atribución para siempre.
    return Response.json({ error: "GHL no responde" }, { status: 502 });
  }

  const equipo = await rest<{ id: string; nombre: string }[]>(
    "GET", "team_members?select=id,nombre");
  const nombre = new Map((equipo.json ?? []).map((t) => [t.id, t.nombre]));

  // Catálogo COMPLETO, no solo `confirmado=is.true`: hace falta ver también
  // las filas sin confirmar para poder distinguir "este source_id no existe
  // en la tabla" (el caso que rompe el guardado, ver más abajo) de "existe
  // pero Berni no lo ha validado todavía" (que si se filtrara aquí se vería
  // IGUAL que "no existe" — el mismo tipo de confusión que este arreglo
  // existe para evitar).
  const fuentes = await rest<
    { source_id: string; fuente: string; setter_id: string | null; confirmado: boolean }[]
  >("GET", "fuentes_atribucion?select=source_id,fuente,setter_id,confirmado");
  const cat = new Map((fuentes.json ?? []).map((f) => [f.source_id, f]));

  // El Source_ID cuelga del CONTACTO, no de la cita: todas las citas del
  // mismo contacto comparten fuente. Se lee de GHL una vez, y se CONGELA en
  // la venta al guardarla — no se cachea en `personas`, porque un valor
  // cacheado que alguien edite en GHL después reabriría justo el problema
  // que la congelación evita.
  //
  // `fuenteError` (no un 502): un fallo de GHL aquí NO puede pintarse igual
  // que "este cliente no tiene fuente" (el 14% legítimo sin Source_ID) — ver
  // docs/superpowers/specs/2026-08-11-comisiones-atribucion-design.md § 7.
  // Se opta por un campo explícito y no por tirar la respuesta entera a 502
  // porque `citas` YA se resolvió bien: perder esa lista por un fallo que
  // solo afecta a la fuente sería peor que servirla con un aviso. El mismo
  // razonamiento que el 502 de `traerCitasDeVenta` 20 líneas más arriba,
  // aplicado a un fallo que llega DESPUÉS de tener algo bueno que enseñar.
  let sourceId: string | null = null;
  let fuenteError = false;
  try {
    sourceId = (await traerContacto(contactId))?.sourceId ?? null;
  } catch (e) {
    console.error("[api/ghl/citas] contacto", e);
    fuenteError = true;
  }

  // Source_ID NUEVO — Berni acuña uno por cada pieza de contenido
  // (`igreel_shortmayo`, `yt_PRECIOCOMPRARBITCOIN`...) y no hay forma de que
  // GHL lo anuncie antes de que aparezca en un contacto real. Sin esto, la
  // fila no existe en `fuentes_atribucion`, y en cuanto la venta intente
  // guardar `programas.source_id = <ese código>`, la FK
  // `programas_source_id_fkey` la rechaza con 409 — el operador ve "Venta
  // registrada" (la venta en sí no depende de esto) pero pierde también el
  // `closer_id`, que viaja en el mismo PATCH. Se inserta aquí, PROVISIONAL
  // (confirmado=false, fuente = el propio código, sin setter): así la FK
  // queda satisfecha cuando la venta se guarde, y `comisionesDePago` ya sabe
  // tratar `fuente_sin_confirmar` como incidencia visible — no paga sobre
  // ella hasta que Berni la valide, que es exactamente el punto (diseño §7.4).
  if (sourceId && !cat.has(sourceId)) {
    const ins = await rest<{ source_id: string; fuente: string; setter_id: string | null; confirmado: boolean }[]>(
      "POST",
      "fuentes_atribucion",
      {
        source_id: sourceId,
        fuente: sourceId,
        setter_nombre: null,
        setter_id: null,
        nivel: "canal",
        confirmado: false,
        notas: `Fuente nueva vista por primera vez en GHL el ${new Date().toISOString().slice(0, 10)} — pendiente de que Berni la confirme.`,
      },
      // `ignore-duplicates`: dos peticiones concurrentes con el mismo
      // source_id nuevo no deben pelearse por la PK. `return=representation`
      // para poder usar la fila ya normalizada sin una segunda consulta.
      "resolution=ignore-duplicates,return=representation",
    );
    if (ins.status >= 300) {
      console.error("[api/ghl/citas] no se pudo registrar la fuente nueva", sourceId, ins.status, ins.json);
    } else {
      const fila = Array.isArray(ins.json) ? ins.json[0] : undefined;
      cat.set(sourceId, fila ?? { source_id: sourceId, fuente: sourceId, setter_id: null, confirmado: false });
    }
  }

  const f = sourceId ? cat.get(sourceId) : undefined;

  return Response.json({
    citas: citas.map((c) => {
      const closerId = miembroDeUsuarioGhl(c.assignedUserId);
      return {
        id: c.id,
        startTime: c.startTime,
        // Lo que hace falta para poder DISTINGUIR una cita de otra. Todo esto
        // ya venía en `CitaGhl` y se estaba tirando aquí: el selector recibía
        // solo la fecha, y como la fuente cuelga del contacto (y por tanto se
        // repite idéntica en todas sus citas), dos opciones del mismo cliente
        // se veían exactamente iguales salvo por la hora. Imposible elegir
        // con criterio de qué llamada depende una comisión.
        titulo: c.title?.trim() || null,
        estado: c.appointmentStatus ?? null,
        calendario: c.calendarId
          ? nombreCalendario[c.calendarId] ?? NOMBRE_CALENDARIO[c.calendarId] ?? null
          : null,
        agendadaEl: c.dateAdded ?? null,
        closerId,
        closerNombre: closerId ? nombre.get(closerId) ?? null : null,
        sourceId,
        fuente: f?.fuente ?? null,
        setterId: f?.setter_id ?? null,
        setterNombre: f?.setter_id ? nombre.get(f.setter_id) ?? null : null,
        // true = GHL no respondió al leer el contacto: la fuente se
        // desconoce por un FALLO, no porque el cliente legítimamente no
        // tenga una. El selector lo muestra distinto para que no se pueda
        // confundir con "sin fuente" y guardar una atribución a ciegas.
        fuenteError,
      };
    }),
  });
}
