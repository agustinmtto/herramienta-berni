"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { OsCounts } from "@/lib/data";
import { puedeVer, type ModuloKey, type UserPerms } from "@/lib/modulos";
import AvisosPush from "@/components/AvisosPush";
import CampanaNovedades from "@/components/CampanaNovedades";

type Item = { href: string; label: string; count?: number; modulo: ModuloKey };

export default function OsNav({
  counts,
  perms,
  nombre,
}: {
  counts: OsCounts;
  perms: UserPerms;
  nombre?: string;
}) {
  const path = usePathname();
  const active = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  // El cajón de móvil. En escritorio la nav es una columna fija y este estado
  // no pinta nada: el botón que lo abre está oculto por CSS a partir de 900px.
  const [abierto, setAbierto] = useState(false);

  // Cerrar al navegar. Sin esto el cajón se queda encima de la página que
  // acabas de abrir y hay que darle a la X para ver a dónde has llegado.
  useEffect(() => {
    setAbierto(false);
  }, [path]);

  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto]);

  const allGroups: { label: string; items: Item[] }[] = [
    { label: "Principal", items: [{ href: "/", label: "Inicio", modulo: "inicio" }] },
    {
      label: "Finanzas",
      items: [
        { href: "/semana", label: "Reporte semanal", modulo: "ingresos" },
        { href: "/ingresos", label: "Ingresos / Pagos", modulo: "ingresos" },
        { href: "/cuotas", label: "Cuotas pendientes", count: counts.cuotasPendientes, modulo: "cuotas" },
        { href: "/pnl", label: "P&L · Resumen", modulo: "pnl" },
        { href: "/gastos", label: "Gastos", modulo: "gastos" },
        // SIN contador a proposito: el unico candidato seria "sin
        // clasificar", que hoy son 2 y se vacia una sola vez. Un badge
        // que no vuelve a subir ensena al equipo a ignorar los demas.
        { href: "/devoluciones", label: "Devoluciones", modulo: "devoluciones" },
      ],
    },
    {
      label: "Clientes",
      items: [
        { href: "/clientes", label: "Clientes", count: counts.clientes, modulo: "clientes" },
        // En "Clientes" y NO en "Ventas": Patricio lo buscaba acá. Estuvo un
        // rato en los dos sitios y verlo repetido se leía como un fallo, así
        // que se quitó el de Ventas (8-sep).
        //
        // El grupo es solo visual: quien decide quién lo ve es el `modulo` del
        // ítem, y sigue siendo `ventas`. Medido el 8-sep contra `team_members`:
        // lo ven berni, alex y milo (acceso total) y NO manuel, iker, dani ni
        // paula, exactamente igual que cuando colgaba de Ventas. Y el menú
        // esconde un grupo que se queda sin ítems visibles, así que tampoco
        // puede aparecer un encabezado "Clientes" vacío.
        //
        // SIN contador: el candidato sería "contratos sin firmar", que hoy no
        // lo mueve ningún proceso automático (solo una persona marca 'firmado'),
        // así que sería un badge que sube y no baja. Mismo criterio que
        // Devoluciones y Estrategias.
        { href: "/contratos", label: "Contratos", modulo: "ventas" },
      ],
    },
    {
      label: "Servicio",
      items: [
        // El contador son las sesiones ya pasadas sin asistencia registrada:
        // el módulo existe para que dejen de acumularse en silencio, así que
        // el número que incordia va en el menú, no escondido en la página.
        { href: "/sesiones", label: "Sesiones", count: counts.sesionesSinRegistrar, modulo: "sesiones" },
        // SIN contador, y es deliberado: el único candidato era "estrategias
        // ocultas", que mide trabajo TERMINADO (lo que retiras a mano) y por
        // tanto sólo sube y nunca vuelve a cero. Un badge que no se puede
        // vaciar enseña al equipo a ignorar todos los demás. El número que
        // importa —clientes activos sin estrategia— es un KPI de la página.
        { href: "/estrategias", label: "Estrategias", modulo: "estrategias" },
        // Las llamadas grabadas en Fathom, con su resumen. Módulo `sesiones`
        // porque la pantalla existe para convertirlas en sesiones — así Manuel
        // e Iker la ven sin conceder ningún permiso nuevo.
        //
        // SIN contador, y por el mismo criterio que Estrategias y Devoluciones:
        // el candidato sería "sin emparejar", que no se puede vaciar sin que
        // alguien decida de quién es cada llamada. Un badge que no baja enseña
        // al equipo a ignorar todos los demás. El número vive en la página.
        { href: "/llamadas", label: "Llamadas", modulo: "sesiones" },
      ],
    },
    {
      label: "Ventas",
      items: [
        { href: "/nueva-venta", label: "Nueva venta", modulo: "ventas" },
        // Mismo permiso que "Nueva venta" (Task 7): no es un módulo aparte,
        // es la red de la misma operación — quien registra ventas revisa las
        // que quedaron sin atribuir.
        { href: "/atribucion", label: "Sin atribuir", modulo: "ventas" },
        // Mismo permiso que "Nueva venta" (Task 8): el informe de comisiones
        // se apoya en la misma atribución, así que no hace falta un permiso
        // nuevo que alguien tenga que recordar conceder aparte.
        { href: "/comisiones", label: "Comisiones", modulo: "ventas" },
      ],
    },
    {
      label: "Comunicación",
      items: [{ href: "/inbox", label: "Inbox WhatsApp", count: counts.inboxPendientes, modulo: "inbox" }],
    },
    {
      // Grupo "Captación" (docs/11 §10): los leads del Quiz Funnel. Grupo
      // propio y módulo propio (`leads`) para que el negocio decida quién hace
      // el triaje sin tocar los permisos de `clientes` ni de `ventas`.
      // SIN contador: los leads no se "vacían" como las cuotas — el volumen
      // depende de la campaña y un badge que solo crece enseña a ignorarlo.
      // El número que importa (calientes sin gestionar) vive en la página.
      label: "Captación",
      items: [{ href: "/leads", label: "Leads", modulo: "leads" }],
    },
  ];

  const groups = allGroups
    .map((g) => ({ ...g, items: g.items.filter((it) => puedeVer(perms, it.modulo)) }))
    .filter((g) => g.items.length > 0);

  // Aquí vivían cinco entradas "Próximamente" (Contenido, Operaciones,
  // Formación, Comunidad, Equipo). Retiradas el 2-sep por decisión de Milo:
  // ocupaban un tercio del menú y casi media pantalla del cajón de móvil sin
  // llevar a ningún sitio, y un menú donde un tercio de lo que ves no se puede
  // pulsar enseña al ojo a dejar de leerlo. Vuelven cuando tengan fecha.

  // El contador de la cabecera de móvil: lo que hay pendiente ahora mismo. Con
  // la nav escondida detrás de un botón, si no sale aquí no se ve nunca.
  const pendientes = counts.inboxPendientes + counts.cuotasPendientes;

  return (
    <>
      <header className="os-topbar">
        <button
          type="button"
          className="os-burger"
          aria-label={abierto ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={abierto}
          aria-controls="osnav"
          onClick={() => setAbierto((v) => !v)}
        >
          {abierto ? "✕" : "☰"}
          {!abierto && pendientes > 0 && <span className="os-burger-dot" aria-hidden="true" />}
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-horizontal.png" alt="MetaCrypto Club" className="brand-logo" width={150} height={31} />
        {/* La campana vive AQUÍ y no en el cajón: con la nav escondida tras
            el burger, un contador dentro del cajón no se ve nunca (misma
            razón que os-burger-dot). Requisito de la spec de novedades. */}
        <CampanaNovedades />
      </header>

      {abierto && (
        <div className="os-backdrop" onClick={() => setAbierto(false)} aria-hidden="true" />
      )}

      <nav id="osnav" className={`osnav ${abierto ? "abierta" : ""}`}>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-horizontal.png" alt="MetaCrypto Club" className="brand-logo" width={150} height={31} />
        </div>
        {groups.map((g) => (
          <div className="group" key={g.label}>
            <div className="group-label">{g.label}</div>
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={`navitem ${active(it.href) ? "active" : ""}`}
              >
                <span>{it.label}</span>
                {typeof it.count === "number" && it.count > 0 && (
                  <span className="count">{it.count}</span>
                )}
              </Link>
            ))}
          </div>
        ))}
        <div className="nav-spacer" />
        {/* Quién está dentro. `nombre` llegaba a este componente desde
            layout.tsx:13, tipado y recibido, y no se pintaba en ninguna
            pantalla. Con permisos por módulo, saber con qué cuenta estás
            dentro es lo que explica por qué ves unas entradas y no otras —
            y estas tres personas comparten dispositivos. */}
        {nombre && (
          <div className="nav-usuario">
            <span className="nav-usuario-nombre">{nombre}</span>
            {/* En escritorio el topbar está oculto (globals.css:802): esta
                es la campana que se ve con la nav en columna fija. */}
            <CampanaNovedades />
          </div>
        )}
        {/* Activar los avisos del dispositivo. Estaba montado en la cabecera
            de la lista de conversaciones del inbox (Sidebar.tsx), encima del
            WhatsApp: Berni, que entra desde el móvil a mirar el cash, no
            pasaba por ahí y no iba a encontrarlo nunca. Aquí está en el pie
            del menú, que es donde se busca la configuración de una app, y se
            ve desde cualquier pantalla del OS. Se pinta solo si el navegador
            soporta push — si no, el componente no devuelve nada. */}
        <div className="nav-push">
          <AvisosPush />
        </div>
        <a className="logout" href="/api/logout">
          Cerrar sesión
        </a>
      </nav>
    </>
  );
}
