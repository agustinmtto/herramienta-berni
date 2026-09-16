"use client";
import { useEffect, useState } from "react";
import { registrarDevolucion } from "@/app/actions";
import type { CobroElegible, ProgramaElegible } from "@/lib/types";
import { money, dateEs } from "@/lib/format";

// La fecha de HOY en Madrid, no `new Date().toISOString()`. Este componente
// corre en el navegador, pero el mismo bug ya mordió en VentaForm y en la
// página de cuotas: a las 00:30 en Madrid, toISOString() da el día anterior y
// la devolución se imputaría al mes equivocado — que es exactamente la regla
// que este módulo existe para respetar.
function hoyMadrid(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

export default function DevolucionForm({
  personaId,
  personaNombre,
}: {
  personaId: string;
  personaNombre: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [alcance, setAlcance] = useState<"total" | "parcial">("total");
  const [datos, setDatos] = useState<{
    cobros: CobroElegible[];
    programas: ProgramaElegible[];
  } | null>(null);
  const [programaId, setProgramaId] = useState("");
  const [elegido, setElegido] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    fetch(`/api/devoluciones/cobros?persona=${personaId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setDatos(d);
        // Un solo programa: se elige solo. Con varios, que decida quien registra.
        if (d.programas?.length === 1) setProgramaId(d.programas[0].programa_id);
      })
      .catch(() => setMsg({ ok: false, texto: "No se pudieron cargar los cobros del cliente." }));
  }, [abierto, personaId]);

  const cobro = datos?.cobros.find((c) => c.pago_id === elegido);
  // En una parcial, el programa sale del cobro elegido: no puede haber
  // desacuerdo entre los dos, y la RPC lo rechazaría.
  const programaEfectivo = alcance === "parcial" ? (cobro?.programa_id ?? programaId) : programaId;

  async function onSubmit(fd: FormData) {
    setEnviando(true);
    const r = await registrarDevolucion(fd);
    setEnviando(false);
    setMsg(r.ok ? { ok: true, texto: r.mensaje } : { ok: false, texto: r.error });
    if (r.ok) {
      setAbierto(false);
      setElegido("");
    }
  }

  if (!abierto) {
    return (
      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={() => setAbierto(true)}>
          Registrar devolución
        </button>
        {msg && <p className={msg.ok ? "ok" : "error"}>{msg.texto}</p>}
      </div>
    );
  }

  return (
    <form action={onSubmit} className="card" style={{ marginTop: 12 }}>
      <div className="card-head">
        <h2>Devolución de {personaNombre}</h2>
        <span className="hint">se resta del mes de la fecha que pongas</span>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        <input type="hidden" name="persona_id" value={personaId} />
        <input type="hidden" name="programa_id" value={programaEfectivo} />

        <div>
          <div className="label">¿Qué se devuelve?</div>
          <label style={{ display: "block" }}>
            <input
              type="radio" name="alcance" value="total"
              checked={alcance === "total"} onChange={() => setAlcance("total")}
            />{" "}
            El programa entero — se anulan sus cuotas pendientes y pasa a ex-cliente
          </label>
          <label style={{ display: "block" }}>
            <input
              type="radio" name="alcance" value="parcial"
              checked={alcance === "parcial"} onChange={() => setAlcance("parcial")}
            />{" "}
            Solo un cobro — el programa sigue vivo
          </label>
        </div>

        {alcance === "total" && (
          <label className="f">
            <span className="label">Programa</span>
            <select
              required value={programaId}
              onChange={(e) => setProgramaId(e.target.value)}
            >
              <option value="">Elige el programa…</option>
              {(datos?.programas ?? []).map((g) => (
                <option key={g.programa_id} value={g.programa_id}>
                  {dateEs(g.fecha_inicio)} · tier {g.tier ?? "—"} ·{" "}
                  {g.monto != null ? money(g.monto) : "sin valor"} · {g.motivo ?? ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {alcance === "parcial" && (
          <label className="f">
            <span className="label">Cobro que se devuelve</span>
            {/* Nunca un importe a mano: se elige de los cobros reales, con su
                USD ya grabado, que es la base sobre la que se revierte la
                comisión. Un número tecleado aquí es dinero mal descontado. */}
            <select
              name="revierte_pago_id" required value={elegido}
              onChange={(e) => setElegido(e.target.value)}
            >
              <option value="">Elige un cobro…</option>
              {(datos?.cobros ?? []).map((c) => (
                <option key={c.pago_id} value={c.pago_id}>
                  {dateEs(c.fecha)} · {money(c.monto)} ·{" "}
                  {c.usd_recibido != null ? money(c.usd_recibido, "USD") : "sin USD"}
                  {c.ya_devuelto_usd > 0
                    ? ` · ya devuelto ${money(c.ya_devuelto_usd, "USD")}`
                    : ""}
                </option>
              ))}
            </select>
            {elegido && cobro?.usd_recibido == null && (
              <span className="error">
                Ese cobro no tiene registrado el USD. Sin ese dato no se puede revertir la comisión.
              </span>
            )}
          </label>
        )}

        <div className="gf-row">
          <label className="f">
            <span className="label">Fecha de la devolución</span>
            <input type="date" name="fecha" required defaultValue={hoyMadrid()} />
          </label>
          <label className="f">
            <span className="label">Euros devueltos</span>
            <input type="number" name="eur" step="0.01" min="0" required />
          </label>
          <label className="f">
            <span className="label">Dólares devueltos</span>
            <input type="number" name="usd" step="0.01" min="0" required />
          </label>
        </div>

        <label className="f">
          <span className="label">¿Por qué se devuelve?</span>
          <textarea
            name="motivo" required rows={2}
            placeholder="Queda registrado en la auditoría y se lee en el recibo."
          />
        </label>

        <p className="hint">
          Se restará del mes de la fecha de arriba. Los meses anteriores no se tocan, y la comisión
          que se hubiera pagado se descuenta del mes en curso.
        </p>

        <div className="modal-actions">
          <button type="submit" className="btn primary" disabled={enviando || !programaEfectivo}>
            {enviando ? "Registrando…" : "Registrar devolución"}
          </button>
          <button type="button" className="btn" onClick={() => setAbierto(false)}>
            Cancelar
          </button>
        </div>
        {msg && !msg.ok && <p className="error">{msg.texto}</p>}
      </div>
    </form>
  );
}
