import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fija la raíz de tracing a esta app (evita que Next detecte lockfiles
  // ajenos en el home como workspace root). Runtime Node.js por defecto.
  outputFileTracingRoot: __dirname,
  // ffmpeg-static trae un binario nativo; no debe bundlearse con webpack.
  // pdfkit hace falta que quede FUERA del bundle, y el motivo no es el que
  // parece. Sus 14 metricas de fuente se piden por un atajo interno de su
  // package.json (`imports`: `#standard-fonts/*`) a traves de un
  // `createRequire(import.meta.url)` (`js/pdfkit.node.mjs`). Al bundlearlo,
  // webpack congela `import.meta.url` como un literal con la ruta de BUILD:
  // en el lambda eso apunta a `/vercel/path0/node_modules/pdfkit/js/
  // pdfkit.node.mjs`, que no existe, Node no encuentra ningun package.json
  // con el mapa `imports` y tira `Cannot find module
  // '#standard-fonts/Helvetica'`. Medido en los logs de produccion el
  // 2026-09-10: 5 ventas de prueba en produccion, 5 contratos perdidos en
  // silencio. Y antes, el 9-sep, una venta REAL de 3.500 EUR igual de muda.
  //
  // 🔴 Las dos piezas son necesarias y ninguna sola alcanza:
  //   · solo esta linea    -> 0 rutas se llevan las metricas.
  //   · solo los includes  -> las metricas viajan pero el literal congelado
  //     sigue ahi, o sea el mismo fallo con las fuentes ya copiadas. Y ese
  //     build NO se puede falsar en local, porque la ruta congelada si
  //     existe en la maquina que compilo.
  // El semaforo que separa los dos casos, y el unico que lo hace:
  //   grep -rE "file:///.*node_modules" .next/server   # tiene que salir VACIO
  serverExternalPackages: ["ffmpeg-static", "pdfkit"],
  // Fuerza a Vercel a incluir el binario de ffmpeg junto a la ruta de subida
  // (remux de notas de voz webm -> ogg/opus para que WhatsApp las acepte).
  outputFileTracingIncludes: {
    "/api/inbox/upload": ["./node_modules/ffmpeg-static/**"],
    // Las 14 metricas de fabrica de pdfkit. El rastreo de Next no sigue los
    // atajos `#` ni cuando el paquete es externo: en el build de arriba
    // pdfkit viaja a 11 rutas y solo estas dos (mas la de descarga, que
    // hereda la clave) se llevan las metricas. Son las dos unicas paginas
    // que montan un formulario capaz de generar un PDF: VentaForm en
    // nueva-venta, y Reenviar/Recorregir en contratos.
    "/nueva-venta": ["./node_modules/pdfkit/js/standard-fonts/**"],
    "/contratos": ["./node_modules/pdfkit/js/standard-fonts/**"],
    // El POST de firma regenera el PDF con el nombre del cliente: pdfkit y sus
    // metricas. Es una ruta ESTATICA a proposito — no hay precedente en este
    // fichero de una clave con segmento dinamico, y no se va a estrenar en la
    // ruta que firma contratos.
    "/api/contratos/firmar": ["./node_modules/pdfkit/js/standard-fonts/**"],
  },
  // El service worker NUNCA se cachea. Si un navegador se queda con una copia
  // vieja, sigue pintando las notificaciones con el código antiguo y no hay
  // forma cómoda de echarlo: el usuario tendría que desinstalar la app.
  async headers() {
    // Headers globales de seguridad (en el PR del funnel, acordado con el
    // negocio): nosniff + referrer + permissions + HSTS (HTTPS lo fuerza el
    // host; el header es aditivo y en HTTP dev no molesta). Sin CSP ni
    // frame-deny por ahora: necesitan iteración contra las pantallas
    // existentes (portales /e/ y /c/, embeds de video) y su propio ticket.
    const globales = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];
    return [
      {
        source: "/:path*",
        headers: globales,
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
