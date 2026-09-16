import "server-only";
import { rest } from "@/lib/supabase";
import { enviarYRegistrarEmail, type ResultadoEnvioEmail } from "@/lib/email-envio";
import { decidirRegistro } from "@/lib/email";
import { claveAvisoVentaEquipo } from "@/lib/canales";
import { emailAvisoVentaEquipo } from "@/lib/email-plantillas";
import { contenidoAvisoVenta, destinatariosVenta, filtrarPorAlcanceVenta, type MiembroVenta } from "@/lib/push";

// ============================================================
// Espejo de `avisarNuevaVenta` (lib/push-envio.ts) para el segundo canal: el
// mismo aviso de cierre, ahora por correo, a todo el equipo activo.
//
// Reutiliza `contenidoAvisoVenta` en vez de redactar su propio texto: así el
// push y el correo dicen exactamente lo mismo (nombre · tipo · autor, sin
// monto ni tier) y una revisión de la copia solo tiene un sitio que mirar.
//
// El remitente NO es `EMAIL_FROM` (identidad "Berni · MetaCrypto Club" para
// hablarle a un cliente): con Berni como destinatario del aviso, ese remitente
// haría que se avisara "a sí mismo". `EMAIL_FROM_EQUIPO` es la identidad del
// propio OS.
//
// Nunca lanza — se llama desde `after()` en `crearVenta`, junto a
// `avisarNuevaVenta`: la venta ya está cobrada y guardada, y un aviso perdido
// no puede convertirla en un error.
// ============================================================

type MiembroVentaEmail = MiembroVenta & { email: string | null; aviso_venta_alcance: string | null };

export async function avisarNuevaVentaEmail(
  personaId: string,
  pagoId: string,
  venta: { tipo: string; autorId: string | null },
): Promise<void> {
  try {
    const [rPersona, rEquipo] = await Promise.all([
      // Decorativo, igual que en avisarNuevaVenta: si esto falla, el aviso
      // sale igual (con "Cliente" o "Cliente nuevo").
      rest<{ nombre: string | null }[]>(
        "GET",
        `personas?id=eq.${personaId}&select=nombre&limit=1`,
      ).catch(() => ({ status: 0, json: null }) as { status: number; json: { nombre: string | null }[] | null }),
      rest<MiembroVentaEmail[]>(
        "GET",
        "team_members?select=id,nombre,activo,acceso_total,modulos,email,aviso_venta_alcance",
      ),
    ]);

    // Un no-2xx trae el objeto de error de PostgREST, no un array — tratarlo
    // como datos se llevaría por delante el aviso de TODO el equipo.
    if (!Array.isArray(rEquipo.json)) {
      console.error("[email] venta: no se pudo leer el equipo", rEquipo.status);
      return;
    }
    const equipo = rEquipo.json;
    const activos = destinatariosVenta(equipo);
    if (activos.length === 0) return;

    // El setter solo se busca si a alguien le hace falta. En el caso normal
    // —todo el equipo en 'todas'— esto no cuesta ni una consulta.
    let setterId: string | null = null;
    if (activos.some((m) => m.aviso_venta_alcance === "asignadas")) {
      const rPago = await rest<{ programa_id: string | null }[]>(
        "GET",
        `pagos?id=eq.${pagoId}&select=programa_id&limit=1`,
      );
      const programaId = Array.isArray(rPago.json) ? (rPago.json[0]?.programa_id ?? null) : null;
      if (programaId) {
        const rProg = await rest<{ setter_id: string | null }[]>(
          "GET",
          `programas?id=eq.${programaId}&select=setter_id&limit=1`,
        );
        // Si esta lectura falla, `setterId` se queda en null y quien esté en
        // 'asignadas' no recibe. Es el lado seguro: mandarle el cierre de otro
        // sería peor que no mandarle el suyo.
        setterId = Array.isArray(rProg.json) ? (rProg.json[0]?.setter_id ?? null) : null;
      }
    }

    const aAvisar = filtrarPorAlcanceVenta(activos, setterId);
    if (aAvisar.length === 0) return;

    const autor = venta.autorId
      ? (equipo.find((m) => m.id === venta.autorId)?.nombre ?? null)
      : null;
    const aviso = contenidoAvisoVenta({
      nombre: rPersona.json?.[0]?.nombre ?? null,
      tipo: venta.tipo,
      autor,
    });

    const from = (process.env.EMAIL_FROM_EQUIPO ?? "").trim() || undefined;
    // Mismo dominio que sirve el resto del OS (histórico: la variable nació
    // para el portal de estrategias, pero es la URL del OS entero).
    const base = (process.env.PORTAL_BASE_URL ?? "").replace(/\/+$/, "");

    // 🔴 UN correo con todo el equipo en el "para", no uno por persona.
    //
    // Antes salían seis correos idénticos, uno por miembro, y eso traía dos
    // problemas: seis envíos contra el límite de 2/s de Resend (que provocaban
    // 429 en los últimos), y seis veces el gasto de la cuota diaria para decir
    // exactamente lo mismo. Un cierre es un hecho, no seis avisos.
    //
    // El precio es que el enlace deja de ser personalizado. Antes
    // `urlAvisoVenta` mandaba a cada uno a donde podía entrar: a la ficha del
    // cliente si tenía el módulo, y a su pantalla de inicio si no. Con un solo
    // correo hay un solo enlace, así que va a la ficha y punto — decisión de
    // Milo (8-sep), tomada junto con la de dar el módulo `clientes` a todo el
    // equipo para que a nadie le salga un "sin permiso". Los importes NO
    // viajan con ese permiso: el bloque de dinero de la ficha está detrás de
    // `puedeVerImportes`, que exige el módulo `ingresos`.
    const destinos = aAvisar.map((m) => (m.email ?? "").trim()).filter(Boolean);
    const sinEmail = aAvisar.length - destinos.length;
    if (sinEmail > 0) {
      console.warn("[email] venta: sin email registrado para", sinEmail, "miembros del equipo");
    }
    if (destinos.length === 0) {
      console.warn("[email] venta: nadie del equipo tiene email, no se manda nada");
      return;
    }

    const enlace = base ? `${base}/clientes/${personaId}` : null;
    const correo = emailAvisoVentaEquipo({ titulo: aviso.title, resumen: aviso.body, enlace });

    const args = {
      to: destinos,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      // Por PAGO, ya no por miembro: un correo, una clave. Ver canales.ts.
      clave: claveAvisoVentaEquipo(pagoId),
      tipo: "aviso_venta_equipo" as const,
      personaId,
      from,
    };

    let r: ResultadoEnvioEmail;
    try {
      r = await enviarYRegistrarEmail(args);
    } catch (e) {
      console.error("[email] venta: el aviso no salió", pagoId, e);
      return;
    }

    // Un reintento, y SOLO si es reintentable. `decidirRegistro` es la misma
    // función que decide si se escribe fila: ante un 429 o un 5xx no registra
    // nada a propósito, y la `Idempotency-Key` viaja a Resend, que deduplica
    // 24 h. A ciegas no valdría: un fallo permanente (400/422) sí deja fila, y
    // el segundo intento la leería como `yaEstaba: true`, un éxito falso.
    if (!r.ok && !decidirRegistro(r).registrar) {
      console.warn("[email] venta: reintentando el aviso", r.status, r.error);
      await new Promise((res) => setTimeout(res, 1200));
      try {
        r = await enviarYRegistrarEmail(args);
      } catch (e) {
        console.error("[email] venta: el reintento tampoco salió", pagoId, e);
        return;
      }
    }

    // `enviarYRegistrarEmail` no lanza ante un fallo: devuelve {ok:false}. Sin
    // mirar el VALOR, con la clave de Resend vencida el envío «termina bien» y
    // nadie se entera de que el equipo no recibió nada.
    if (!r.ok) {
      console.error("[email] venta: el aviso NO llegó al equipo", r.status, r.error);
    }
  } catch (e) {
    console.error("[email] fallo avisando de la venta", pagoId, e);
  }
}
