import Link from "next/link";
import { etiquetaRolEquipo } from "@/lib/persona";
import { getMessages, getTeamMembers, getUltimoEntranteAt, type ConversationRow } from "@/lib/data";
import { displayName } from "@/lib/format";
import { toggleEstado, asignarCoach } from "@/app/actions";
import ReplyBox from "./ReplyBox";
import { ventanaCerrada } from "@/lib/ventana";
import { estadoWa } from "@/lib/wa-estado";
import LiveMessages from "./LiveMessages";

export default async function Thread({
  conv,
  volverHref,
}: {
  conv: ConversationRow;
  volverHref: string;
}) {
  const [messages, team, ultimoEntranteAt] = await Promise.all([
    getMessages(conv.id),
    getTeamMembers(),
    getUltimoEntranteAt(conv.id),
  ]);
  const fueraDeVentana = ventanaCerrada(ultimoEntranteAt, new Date());
  const resolved = conv.estado_atencion === "resuelto";
  const sub = [
    conv.telefono_e164,
    conv.tier ? `tier ${conv.tier}` : null,
    conv.persona?.estado ?? "desconocido",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="main">
      <div className="thread-head">
        {/* Solo se ve en móvil, donde la lista de conversaciones está oculta y
            esta sería una pantalla sin salida. */}
        <Link className="thread-volver" href={volverHref} aria-label="Volver a las conversaciones">
          ←
        </Link>
        <div className="who">
          <div className="nm">{displayName(conv.persona, conv.telefono_e164)}</div>
          <div className="ph">{sub}</div>
        </div>
        <div className="actions">
          <form action={asignarCoach}>
            <input type="hidden" name="convId" value={conv.id} />
            <select className="sel" name="coachId" defaultValue={conv.coach_asignado ?? ""}>
              <option value="">Sin consultor</option>
              {/* Los setters (0029) existen para atribuirles ventas, no para
                  atender clientes: no son asignables como coach. El resto del
                  equipo sigue saliendo igual que antes. */}
              {team.filter((t) => t.rol !== "setter").map((t) => (
                <option key={t.id} value={t.id}>
                  {/* `t.rol` es el valor CRUDO de la base, así que esta
                      opción se leía literalmente "Paula (coach)" — el único
                      sitio de todo el OS donde todavía se leía esa palabra, y
                      el que ningún `grep "coach"` encuentra, porque la cadena
                      no está escrita en ninguna parte: se pinta el dato.
                      Se traduce al pintar; el filtro de la línea de arriba
                      sigue comparando contra el valor de la base. */}
                  {t.nombre} ({etiquetaRolEquipo(t.rol)})
                </option>
              ))}
            </select>
            <button className="btn" type="submit" style={{ marginLeft: 6 }}>
              Asignar
            </button>
          </form>
          <form action={toggleEstado}>
            <input type="hidden" name="convId" value={conv.id} />
            <input type="hidden" name="next" value={resolved ? "pendiente" : "resuelto"} />
            <button className={`btn ${resolved ? "warn" : "primary"}`} type="submit">
              {resolved ? "Reabrir" : "Marcar resuelto"}
            </button>
          </form>
        </div>
      </div>

      <LiveMessages convId={conv.id} initial={messages} team={team} />

      <ReplyBox
        to={conv.telefono_e164}
        fueraDeVentana={fueraDeVentana}
        ultimoEntranteAt={ultimoEntranteAt}
        clienteNombre={conv.persona?.nombre ?? ""}
        waCaido={estadoWa().motivo}
      />
    </section>
  );
}
