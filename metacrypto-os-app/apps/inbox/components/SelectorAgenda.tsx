"use client";
// ============================================================
// Selector de la agenda de GHL que cerró la venta. Habla con
// /api/ghl/citas (nunca con GHL directo: la clave vive solo en el
// servidor) y deja elegir una cita, ponerlo a mano (quién cerró y quién lo
// trajo, cuando la llamada no aparece) o posponer.
// ============================================================
import { useEffect, useState } from "react";
import { estadoDeCita } from "@/lib/atribucion";
import type { TeamMember } from "@/lib/types";
import { IconoAlerta } from "@/components/Iconos";

export type AtribucionElegida = {
  sourceId: string | null;
  setterId: string | null;
  closerId: string | null;
  ghlAppointmentId: string | null;
};

type CitaVenta = {
  id: string;
  startTime: string;
  // Lo que distingue una cita de otra. La fuente NO sirve para eso: cuelga
  // del contacto, así que es la misma en todas las citas del mismo cliente.
  titulo: string | null;
  estado: string | null;
  calendario: string | null;
  agendadaEl: string | null;
  closerId: string | null;
  closerNombre: string | null;
  sourceId: string | null;
  fuente: string | null;
  setterId: string | null;
  setterNombre: string | null;
  // true = GHL no respondió al leer el contacto: la fuente se desconoce por
  // un FALLO, no porque el cliente legítimamente no tenga una (el 14% de
  // ventas sin Source_ID). No se puede pintar igual que "sin fuente": esa
  // ambigüedad es la que hacía desaparecer el 5% del setter en silencio.
  fuenteError?: boolean;
};

export default function SelectorAgenda({
  personaId,
  email,
  telefono,
  team,
  value,
  onChange,
}: {
  personaId?: string | null;
  email?: string | null;
  telefono?: string | null;
  // El equipo, para poder decir A MANO quién cerró cuando la llamada no
  // aparece. El 27-ago-2026 pasó: la cita de Yajaira vivía en el calendario
  // del evento 26/08, que el OS no miraba, y la única salida era "no vino de
  // agenda" — que deja la venta SIN closer y por tanto sin comisión para
  // nadie (`sin_closer` en lib/comisiones.ts). Alex sabía perfectamente quién
  // cerró; el sistema no tenía dónde apuntarlo.
  team: TeamMember[];
  value: AtribucionElegida | null;
  onChange: (a: AtribucionElegida | null) => void;
}) {
  const [citas, setCitas] = useState<CitaVenta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sube al pulsar "reintentar". Antes, si GHL fallaba una vez, el selector se
  // quedaba con el aviso puesto hasta recargar la página entera.
  const [intento, setIntento] = useState(0);

  // Se re-busca cuando cambia cualquiera de las tres llaves. En compra nueva
  // eso ocurre mientras Alex teclea el email: el debounce evita una llamada
  // a GHL por pulsación.
  // `||`, no `??`: una cadena vacía ("" — el estado inicial habitual antes
  // de elegir cliente o teclear algo) debe caer al siguiente operando igual
  // que null/undefined. Con `??` una `personaId=""` se quedaría fija como
  // llave y ocultaría el selector aunque llegaran email/telefono válidos —
  // ya pasó una vez con el único llamador actual, que ahora normaliza a mano.
  const llave = personaId || email || telefono || null;
  useEffect(() => {
    if (!llave) {
      setCitas(null);
      return;
    }
    setCitas(null);
    setError(null);
    // `vigente` evita la condición de carrera: si la llave cambia (Alex
    // corrige el email, o se pasa de una ascensión a otro contacto) mientras
    // el fetch anterior sigue en vuelo, y ese fetch más lento resuelve
    // DESPUÉS del más reciente, sin este guardia `setCitas` pintaría las
    // citas de OTRO contacto — y como cada cita ya trae closerId/sourceId
    // resueltos, elegirla ataría la comisión a la persona equivocada. Se
    // comprueba antes de cada `setCitas`/`setError`, en el `.then` y en el
    // `.catch`: un error tardío de la petición vieja no puede pintar el
    // aviso sobre una búsqueda que sí salió bien.
    let vigente = true;
    const t = setTimeout(() => {
      const q = new URLSearchParams();
      if (personaId) q.set("personaId", personaId);
      if (email) q.set("email", email);
      if (telefono) q.set("telefono", telefono);
      fetch(`/api/ghl/citas?${q}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        })
        .then((d) => {
          if (vigente) setCitas(d.citas ?? []);
        })
        .catch(() => {
          if (vigente) {
            setError("No se pudieron cargar las agendas. La venta se guarda igual y queda en la bandeja.");
          }
        });
    }, 500);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [llave, personaId, email, telefono, intento]);

  if (!llave) return null;
  // El aviso de error YA NO corta el componente. Cuando GHL fallaba, este
  // return dejaba la pantalla sin UNA sola opción: ni "no vino de agenda", ni
  // poner el closer a mano, ni "lo dejo para después". Un fallo de GHL no
  // puede ser lo que impide decir quién cerró: el aviso se pinta arriba y las
  // opciones siguen debajo.
  if (citas === null && !error) return <p className="muted">Buscando agendas…</p>;

  const lista = citas ?? [];
  // La fuente es del CONTACTO, no de la cita: se enseña UNA vez, arriba.
  // Antes se repetía en cada opción, y eso hacía creer que distinguía unas
  // citas de otras cuando es idéntica en todas — parte de por qué el selector
  // era imposible de usar.
  const primera = lista[0];
  const elegida = lista.find((c) => c.id === value?.ghlAppointmentId);
  const avisoElegida = elegida && estadoDeCita(elegida.estado).tono === "malo";
  // La opción "a mano": hay decisión (`value` no es null) pero sin cita. Se
  // DERIVA de `value` en vez de tener estado propio, para que no puedan
  // divergir — y así la corrección desde /atribucion, que llega con el closer
  // ya guardado y sin cita, aparece marcada y rellena sola.
  const manual = value && value.ghlAppointmentId === null ? value : null;

  return (
    <div className="opts">
      {error && (
        <p className="cita-aviso">
          {error}{" "}
          <button type="button" className="btn-mini" onClick={() => setIntento((n) => n + 1)}>
            Reintentar
          </button>
        </p>
      )}
      {primera && (
        <p className="cita-fuente">
          {/* La fuente traducida, nunca el código crudo: "wa_set_db" no le dice
              nada a nadie. `fuenteError` va ANTES que `fuente` a propósito: un
              fallo de GHL nunca debe leerse como "sin fuente" (el caso
              legítimo), o el 5 % del setter desaparece sin que nadie lo note. */}
          {primera.fuenteError ? (
            <span className="neg">No se pudo leer de dónde vino este cliente — reintenta</span>
          ) : primera.fuente ? (
            <>
              Este cliente vino de <strong className="gold">{primera.fuente}</strong>
              {primera.setterNombre ? <> · lo trajo <strong>{primera.setterNombre}</strong></> : " · sin setter"}
            </>
          ) : (
            <>Este cliente no trae fuente — se cobrará el closer, no el setter</>
          )}
          {lista.length > 1 && " · es la misma para todas sus citas"}
          {/* Que se sepa en qué reloj están las horas de abajo: quien atribuye
              no siempre está en España. */}
          <span className="muted"> · horas en hora de España</span>
        </p>
      )}

      {lista.map((c) => {
        const est = estadoDeCita(c.estado);
        const cuando = new Date(c.startTime);
        return (
          <label key={c.id} className={`opt cita ${est.tono === "malo" ? "cita-malo" : ""}`}>
            <input
              type="radio"
              name="agenda"
              checked={value?.ghlAppointmentId === c.id}
              onChange={() =>
                onChange({
                  sourceId: c.sourceId,
                  setterId: c.setterId,
                  closerId: c.closerId,
                  ghlAppointmentId: c.id,
                })
              }
            />
            <span className="cita-cuerpo">
              <span className="cita-linea1">
                <strong className="cita-fecha">
                  {cuando.toLocaleDateString("es-ES", {
                    weekday: "short", day: "numeric", month: "short",
                    hour: "2-digit", minute: "2-digit",
                    // Hora de ESPAÑA, no la del ordenador que mira. Sin esto
                    // la cita de Yajaira —10:00 en GHL— se veía "04:00" desde
                    // Chile: seis horas de desfase, y de madrugada hasta el
                    // día cambia. Con dos citas del mismo cliente el mismo
                    // día, eso es elegir la llamada equivocada y pagar la
                    // comisión por otra. El resto del OS (cuotas, sesiones,
                    // estrategias) ya fija Europe/Madrid; esto era el único
                    // sitio que pintaba la hora local de cada cual.
                    timeZone: "Europe/Madrid",
                  })}
                </strong>
                <span className={`cita-estado ${est.tono}`}>{est.texto}</span>
              </span>
              <span className="cita-linea2">
                {c.calendario ?? "calendario desconocido"}
                {c.closerNombre ? <> · la llevó <strong>{c.closerNombre}</strong></> : " · no consta quién la llevó"}
                {c.titulo ? ` · «${c.titulo}»` : ""}
              </span>
              {c.agendadaEl && (
                <span className="cita-linea3">
                  se agendó el{" "}
                  {new Date(c.agendadaEl).toLocaleDateString("es-ES", {
                    day: "numeric", month: "short", timeZone: "Europe/Madrid",
                  })}
                </span>
              )}
            </span>
          </label>
        );
      })}

      {/* Elegir una cita cancelada o con no-show es legítimo a veces (se cerró
          por WhatsApp después), pero nunca debe pasar sin darse cuenta: de las
          215 citas de venta, 56 están canceladas. */}
      {avisoElegida && (
        <p className="cita-aviso">
          <IconoAlerta /> Esa llamada consta como <strong>{estadoDeCita(elegida!.estado).texto}</strong>.
          Si la venta se cerró igualmente, adelante — pero comprueba que es la correcta.
        </p>
      )}
      {/* El respaldo. Antes decía solo "No vino de agenda (referido, directo…)"
          y dejaba los tres campos en null, así que valía igual para el caso
          legítimo que para el fallo (su llamada existe, el OS no la ve) — y en
          los dos la venta se quedaba sin closer, sin comisión y sin rastro de
          que alguien la cerró. Ahora la opción pregunta a mano exactamente lo
          que la cita habría contestado sola. */}
      <label className="opt">
        <input
          type="radio"
          name="agenda"
          checked={manual !== null}
          onChange={() => onChange({ sourceId: null, setterId: null, closerId: null, ghlAppointmentId: null })}
        />
        <span>No vino de agenda, o su llamada no aparece aquí — lo pongo a mano</span>
      </label>
      {manual && (
        <div className="cierre-manual">
          <label>
            ¿Quién cerró la venta?
            <select
              value={manual.closerId ?? ""}
              onChange={(e) => onChange({ ...manual, closerId: e.target.value || null })}
            >
              <option value="">— elegir —</option>
              {/* Los setters no cierran: mismo filtro que el desplegable de
                  ascensión de VentaForm y de la bandeja. */}
              {team.filter((t) => t.rol !== "setter").map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </label>
          <label>
            ¿Quién lo trajo? <span className="muted">(setter — vacío si vino solo)</span>
            <select
              value={manual.setterId ?? ""}
              onChange={(e) => onChange({ ...manual, setterId: e.target.value || null })}
            >
              <option value="">— nadie / no consta —</option>
              {team.filter((t) => t.rol === "setter").map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </label>
          {/* Avisa, NO bloquea: hay ventas que de verdad no tienen closer y
              esto nunca puede frenar el registro de un cobro. Pero sin closer
              la venta sale en Comisiones como incidencia `sin_closer` y no
              paga a nadie — mejor verlo antes de guardar que descubrirlo el
              día del cierre. */}
          {!manual.closerId && (
            <p className="cita-aviso">
              Sin quién cerró, esta venta no genera comisión para nadie — saldrá marcada en Comisiones.
            </p>
          )}
        </div>
      )}
      <label className="opt">
        <input type="radio" name="agenda" checked={value === null} onChange={() => onChange(null)} />
        <span>Lo dejo para después</span>
      </label>
    </div>
  );
}
