"use client";
import { useCallback, useEffect, useState } from "react";
import { claveVapidABytes } from "@/lib/push";

const CLAVE = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type Estado =
  | "cargando"
  | "no-soportado"
  | "ios-sin-instalar" // en iPhone el push EXIGE la app en la pantalla de inicio
  | "bloqueado" // el usuario dijo que no; no se puede volver a preguntar
  | "inactivo"
  | "activo";

function esIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
function estaInstalada() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari en iOS no implementa display-mode y usa esta propiedad suya.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function AvisosPush() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [err, setErr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !CLAVE) {
      setEstado("no-soportado");
      return;
    }
    // El orden importa: en un iPhone sin instalar, `Notification` puede ni
    // existir, así que se comprueba ANTES de tocarla.
    if (esIOS() && !estaInstalada()) {
      setEstado("ios-sin-instalar");
      return;
    }
    if (Notification.permission === "denied") {
      setEstado("bloqueado");
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const sub = await reg.pushManager.getSubscription();
        if (vivo) setEstado(sub ? "activo" : "inactivo");
      } catch {
        if (vivo) setEstado("no-soportado");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const activar = useCallback(async () => {
    setOcupado(true);
    setErr(null);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "inactivo");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        // Obligatorio en todos los navegadores: cada push TIENE que producir
        // una notificación visible. No se puede usar para nada silencioso.
        userVisibleOnly: true,
        applicationServerKey: claveVapidABytes(CLAVE),
      });
      const r = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      // NO basta con `r.ok`. El middleware manda a /login con un 307 cuando la
      // sesión ha caducado, el navegador lo sigue solo, y /login responde 200
      // con HTML: `r.ok` sería true y daríamos por activada una suscripción que
      // nadie guardó. Se exige el `{ ok: true }` del propio endpoint.
      const d = await r.json().catch(() => null);
      if (!r.ok || d?.ok !== true) {
        // Si el servidor no la guarda, la del navegador sobra: dejarla viva
        // haría creer que llegan avisos cuando no va a llegar ninguno.
        await sub.unsubscribe();
        setErr(
          d?.error ??
            (r.redirected ? "Se cerró la sesión. Vuelve a entrar." : "No se pudo guardar la suscripción."),
        );
        setEstado("inactivo");
        return;
      }
      setEstado("activo");
    } catch (e) {
      setErr("No se pudieron activar los avisos.");
      setEstado("inactivo");
    } finally {
      setOcupado(false);
    }
  }, []);

  const desactivar = useCallback(async () => {
    setOcupado(true);
    setErr(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEstado("inactivo");
    } catch {
      setErr("No se pudieron desactivar.");
    } finally {
      setOcupado(false);
    }
  }, []);

  // Sin ruido cuando no hay nada que hacer o ya está resuelto: un panel de
  // ajustes permanente encima de la lista de conversaciones estorba a diario.
  if (estado === "cargando" || estado === "no-soportado") return null;

  if (estado === "activo") {
    return (
      <div className="push-fila">
        <span className="push-ok">● Avisos activados</span>
        <button type="button" className="linkbtn" onClick={desactivar} disabled={ocupado}>
          Desactivar
        </button>
      </div>
    );
  }

  if (estado === "ios-sin-instalar") {
    return (
      <div className="push-aviso">
        Para recibir avisos en el iPhone, añade el OS a la pantalla de inicio:
        toca <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>. Desde
        Safari, sin instalar, iOS no permite notificaciones.
      </div>
    );
  }

  if (estado === "bloqueado") {
    return (
      <div className="push-aviso">
        Las notificaciones están bloqueadas para esta web. Hay que reactivarlas
        en los ajustes del navegador — desde aquí ya no se puede volver a pedir.
      </div>
    );
  }

  return (
    <div className="push-fila">
      <button type="button" className="btn push-activar" onClick={activar} disabled={ocupado}>
        {/* "del OS" y no "de mensajes": desde el 3-sep también avisa de los
            nuevos cierres, y a quien no tiene inbox (setters) el texto viejo
            le prometía algo que nunca le iba a llegar. */}
        {ocupado ? "Activando…" : "Activar avisos del OS"}
      </button>
      {err && <span className="push-err">{err}</span>}
    </div>
  );
}
