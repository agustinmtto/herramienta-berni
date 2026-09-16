"use client";
import { useState } from "react";

// La pantalla que ve el CLIENTE. Es lo único de todo el OS que sale del negocio,
// así que no reutiliza el shell del OS: ni nav, ni contadores, ni nada del
// equipo. Vive fuera de `app/(os)/` por eso.

export type EstrategiaCliente = {
  id: string;
  titulo: string;
  url: string;
  password: string | null;
  resumen: string | null;
  fecha: string;
};

export default function PortalEstrategias(props: {
  tipo: "ok" | "sin-acceso";
  nombre?: string | null;
  resumen?: string | null;
  estrategias?: EstrategiaCliente[];
}) {
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});

  if (props.tipo === "sin-acceso") {
    return (
      <main className="portal">
        <Marca />
        <div className="portal-vacio">
          <h1>Este enlace ya no está activo</h1>
          <p>
            Puede que haya sido reemplazado por uno nuevo. Escríbenos por WhatsApp
            y te mandamos el tuyo al momento.
          </p>
        </div>
      </main>
    );
  }

  const lista = props.estrategias ?? [];

  return (
    <main className="portal">
      <Marca />
      <header className="portal-head">
        <h1>{props.nombre ? `Hola, ${props.nombre}` : "Tus estrategias"}</h1>
        {props.resumen && <p className="portal-sub">{props.resumen}</p>}
      </header>

      {lista.length === 0 ? (
        <div className="portal-vacio">
          <h2>Todavía no tienes ninguna estrategia publicada</h2>
          <p>
            En cuanto Berni prepare la tuya, te llegará un aviso por WhatsApp y
            aparecerá aquí. Este enlace seguirá siendo el mismo.
          </p>
        </div>
      ) : (
        <div className="portal-lista">
          {lista.map((e) => (
            <article className="portal-card" key={e.id}>
              <div className="portal-card-top">
                <h2>{e.titulo}</h2>
                <span className="portal-fecha">{e.fecha}</span>
              </div>
              {e.resumen && <p className="portal-resumen">{e.resumen}</p>}

              {e.password && (
                <div className="portal-pw">
                  <span className="k">Contraseña</span>
                  <span className="v">
                    {abiertas[e.id] ? e.password : "••••••••••"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAbiertas((v) => ({ ...v, [e.id]: !v[e.id] }))}
                  >
                    {abiertas[e.id] ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              )}

              {/* `noreferrer` además de `noopener`: sin él, el token de este
                  portal viajaría en la cabecera Referer hasta GoHighLevel. */}
              <a className="portal-abrir" href={e.url} target="_blank" rel="noreferrer noopener">
                Abrir estrategia
              </a>
            </article>
          ))}
          <p className="portal-nota">Estas páginas son privadas y solo para ti. No las compartas.</p>
        </div>
      )}
    </main>
  );
}

function Marca() {
  return (
    <div className="portal-marca">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-horizontal.png" alt="MetaCrypto Club" width={150} height={31} />
    </div>
  );
}
