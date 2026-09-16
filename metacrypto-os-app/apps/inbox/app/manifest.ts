import type { MetadataRoute } from "next";

// Convierte el OS en app instalable ("Añadir a pantalla de inicio"). Con esto
// y HTTPS basta para que se instale: el service worker NO hace falta para
// instalar, solo entra cuando construyamos las notificaciones.
export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` fija la identidad de la app. Va aparte de `start_url` a propósito:
    // si algún día la app abriera en otra pantalla, el teléfono la reconoce
    // como la misma y no aparece un icono duplicado.
    id: "/",
    name: "MetaCrypto OS",
    // Lo que cabe debajo del icono en la pantalla de inicio. Más de ~12
    // caracteres y el teléfono lo corta con puntos suspensivos.
    short_name: "MetaCrypto",
    description: "Sistema operativo de MetaCrypto Club — clientes, finanzas y WhatsApp",
    lang: "es",
    // Abre en el inbox: en el móvil se usa sobre todo para contestar clientes.
    // El resto del OS sigue a un toque de la hamburguesa.
    start_url: "/inbox",
    // CRÍTICO: el scope es TODO el OS, no /inbox. Si se dejara en /inbox,
    // tocar "Clientes" o "Ingresos" saldría de la app y abriría el navegador
    // por fuera, perdiendo la sesión visualmente y el modo pantalla completa.
    scope: "/",
    display: "standalone",
    // El negro del OS (--bg). `background_color` es lo que se ve en la
    // pantalla de arranque, antes de que pinte nada; si fuera blanco habría
    // un fogonazo en cada apertura.
    background_color: "#080808",
    theme_color: "#080808",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android (Samsung incluido) recorta el icono a la forma del sistema —
      // círculo, cuadrado redondeado, gota. Solo garantiza el 80% central, así
      // que estos llevan la marca más pequeña para que no le corte los lados.
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
