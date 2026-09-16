// Service worker del OS. Su único trabajo son las notificaciones: NO cachea
// nada. Un OS que enseña dinero y cuotas no puede servir datos viejos desde
// una caché — vale mil veces más un "sin conexión" honesto que un cash
// collected de ayer con pinta de ser el de hoy.

self.addEventListener("install", () => {
  // Sin esto, un service worker nuevo se queda "esperando" a que se cierren
  // todas las pestañas viejas. En un teléfono eso puede no pasar en semanas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let d;
  try {
    d = event.data.json();
  } catch {
    return; // carga ilegible: mejor nada que una notificación vacía
  }

  event.waitUntil(
    self.registration.showNotification(d.title || "MetaCrypto", {
      body: d.body || "Nuevo mensaje",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Agrupa por conversación: cinco mensajes seguidos del mismo cliente
      // dejan UNA notificación actualizada, no cinco apiladas.
      tag: d.tag || "inbox",
      renotify: true,
      // url puede venir null a propósito (un aviso de venta a un miembro sin
      // pantalla buena a la que llevarle): el clic entonces solo enfoca.
      data: { url: d.url || null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = event.notification.data?.url || null;

  event.waitUntil(
    (async () => {
      // matchAll solo devuelve ventanas de ESTE origen: todas son el OS.
      const ventanas = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // SIEMPRE por pathname, nunca por substring de la URL completa: toda
      // URL absoluta contiene "/" (un destino "/" casaría con cualquier
      // ventana) y "/inbox/c/x" contiene "/inbox" (la home del inbox casaría
      // con la conversación abierta de otro cliente).
      const ruta = (v) => {
        try { return new URL(v.url).pathname; } catch { return ""; }
      };

      // Sin destino (miembro sin pantalla buena a la que llevarle): enfocar
      // la app si está abierta y nada más. Abrir "/" aquí lo estamparía
      // contra el /login de sesión válida que el destino nulo quería evitar.
      if (!destino) {
        const v = ventanas.find((w) => "focus" in w);
        if (v) await v.focus();
        return;
      }

      // Una ventana que YA enseña exactamente el destino solo se enfoca:
      // navegarla sería recargarla, y abrir otra dejaría dos copias.
      for (const v of ventanas) {
        if (ruta(v) === destino && "focus" in v) {
          await v.focus();
          return;
        }
      }

      // Solo la LISTA del inbox (pathname exacto /inbox) se navega: es la
      // única pantalla del OS sin nada a medio escribir. Una conversación
      // (/inbox/c/…) lleva el compositor con la respuesta tecleada o un audio
      // grabándose, y /nueva-venta las cuotas puestas y el comprobante
      // adjunto — navegar cualquiera de esas destruiría el trabajo sin aviso.
      // Por eso, si no hay ventana "segura", se abre una nueva aunque queden
      // dos copias: una copia de más se cierra; un formulario perdido no se
      // recupera.
      for (const v of ventanas) {
        if (ruta(v) === "/inbox" && "focus" in v) {
          await v.focus();
          if ("navigate" in v) await v.navigate(destino);
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(destino);
    })(),
  );
});
