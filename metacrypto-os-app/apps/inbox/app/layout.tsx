import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Sora } from "next/font/google";
import "./globals.css";
// DESPUÉS de globals.css, y el orden importa: en un empate de especificidad
// gana el último que se carga. Es lo que permite corregir reglas de
// globals.css —que lo lleva otro carril— sin editarlo.
import "./inbox.css";

export const metadata: Metadata = {
  title: "MetaCrypto OS",
  description: "Sistema operativo de MetaCrypto Club — datos reales del negocio",
  // Safari en iOS no se fía solo del manifest: sin `apple-mobile-web-app-capable`
  // el icono de la pantalla de inicio abre una pestaña normal, con su barra de
  // direcciones, en vez de la app a pantalla completa.
  appleWebApp: {
    capable: true,
    // Lo que se lee bajo el icono en iOS (el `short_name` del manifest es el
    // de Android).
    title: "MetaCrypto",
    // "default" reserva la franja del reloj en vez de dejar que el contenido
    // pase por debajo. Menos vistoso que "black-translucent", pero no puede
    // colisionar con la hora. Se cambia si al probarlo se ve bien.
    statusBarStyle: "default",
  },
};

/**
 * LA tipografía del OS. Una sola familia para todo: titulares, texto y cifras.
 *
 * Antes eran cuatro —Oswald, Sora, JetBrains Mono y Georgia—, tres de ellas
 * pedidas por <link> a Google sin `preconnect`, bloqueando el render. Y Oswald,
 * que es una grotesca CONDENSADA de titular, estaba sobre las cifras de dinero,
 * contra lo que dice el §4 del spec: «un número es un número, la misma voz en
 * la cifra de 52px, en la tabla y en el recibo».
 *
 * `next/font` la descarga en el build y la sirve desde nuestro propio dominio:
 * se acaba el viaje a fonts.googleapis.com en cada carga y el parpadeo de
 * fuente que traía. Sora y no otra porque ya era la del cuerpo: así el texto
 * que Berni lee todos los días no cambia de forma, solo dejan de cantar los
 * titulares y las cifras.
 *
 * `display: "swap"` — el texto se ve desde el primer instante con la fuente de
 * respaldo y salta a Sora cuando llega. La alternativa es una pantalla en
 * blanco mientras carga, que es peor en un móvil con mala cobertura.
 *
 * Decisión de Milo, 2-sep-2026.
 */
const sora = Sora({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// Next ya pone width=device-width por defecto; lo que hay que anadir es
// `interactiveWidget`: con el shell a 100dvh y overflow:hidden, el teclado del
// movil se dibuja ENCIMA y tapa el compositor del inbox. `resizes-content`
// hace que el layout encoja y el cuadro de escribir siga a la vista.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={sora.variable}>
      <head>
        {/* `appleWebApp.capable` de Next emite el estándar nuevo
            (`mobile-web-app-capable`), no el de Apple. En iOS 16.4+ basta con
            el `display: standalone` del manifest, pero esta etiqueta lleva
            quince años siendo LA que decide si el icono abre a pantalla
            completa o una pestaña con barra de direcciones. Va a mano para no
            depender de qué versión de iOS tenga cada uno. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>{children}</body>
    </html>
  );
}
