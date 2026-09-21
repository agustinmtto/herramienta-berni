import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth por cookie de sesión firmada (HMAC-SHA256, verificado en edge con
// Web Crypto). Sin firma válida → redirige a /login.
// Excepciones públicas: /login, /api/login, /api/logout, y el webhook
// /api/wa-ingest (autenticado por su firma HMAC — Kapso no maneja cookies);
// y los crons /api/inbox/media-backfill y /api/sesiones/sync (auth propia
// por CRON_SECRET, sin cookie).

const SECRET = process.env.AUTH_TOKEN ?? "";

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validSession(cookie: string | undefined): Promise<boolean> {
  if (!cookie || !SECRET) return false;
  const i = cookie.lastIndexOf(".");
  if (i < 0) return false;
  const msg = cookie.slice(0, i);
  const sigHex = cookie.slice(i + 1);
  const [id, expStr] = msg.split(".");
  const exp = Number(expStr);
  if (!id || !exp || exp < Math.floor(Date.now() / 1000)) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
    const expected = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return safeEqualHex(expected, sigHex);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/api/wa-ingest") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/logout") ||
    // El Quiz Funnel (docs/11 D1): ruta PÚBLICA a propósito — es la captación.
    // Su protección no es el middleware sino el diseño: /quiz no expone nada,
    // y /api/lead valida, limita y persiste solo por el RPC server-side. Sin
    // estas líneas el funnel devolvería el redirect a /login (HTML) a todo
    // lead real, en silencio.
    pathname.startsWith("/quiz") ||
    pathname.startsWith("/api/lead") ||
    pathname.startsWith("/api/inbox/media-backfill") ||
    pathname.startsWith("/api/sesiones/sync") ||
    // Cron de notas del evento 26/08. Como los otros dos crons: sin esta
    // línea, Vercel Cron recibiría el HTML de /login con un 200 y el cron
    // "correría" sin escribir una nota jamás. Su auth es CRON_SECRET propia.
    pathname.startsWith("/api/ghl/evento-notas") ||
    // Cron de los avisos de las sesiones recurrentes. Verificado el 2-sep contra
    // producción: sin esta línea devuelve el redirect a /login y el cron corre
    // cada 5 min sin materializar una sola ocurrencia ni enviar un aviso, con
    // 200 y sin error. Es la quinta vez que este regex se come una ruta nueva.
    // Su auth es la misma CRON_SECRET que la de los otros tres.
    pathname.startsWith("/api/sesiones/recurrentes") ||
    // Cron que le pregunta a Resend si los correos llegaron. Se da de alta en
    // el MISMO commit que crea la ruta, y no después, porque el comentario de
    // arriba dice que este regex ya se ha comido cinco rutas nuevas: sin esta
    // línea el cron recibiría el HTML de /login con un 200 y "correría" sin
    // resolver una sola fila — exactamente el silencio que la ruta existe
    // para eliminar. Su auth es la misma CRON_SECRET que la de los otros.
    pathname.startsWith("/api/email/estados") ||
    // Cron de convergencia de las invitaciones de calendario. Misma
    // razón que las de arriba, y `crons-middleware.test.ts` lo vigila.
    pathname.startsWith("/api/email/invitaciones") ||
    // El cron de Fathom (cada 15 min). Sin esta línea el middleware le
    // devuelve el HTML de /login con un 200: el cron "corre", Vercel lo da por
    // bueno y no se ingiere nada — sin un solo error en ninguna parte. Lo cazó
    // `lib/__tests__/crons-middleware.test.ts`, que existe justo para esto.
    pathname.startsWith("/api/fathom/sync") ||
    pathname === "/login" ||
    // El manifest tiene que servirse SIN sesión: el navegador lo pide para
    // decidir si la app es instalable, y a veces antes de que nadie entre.
    // Si cae en el redirect a /login recibe HTML en vez de JSON y la
    // instalación falla sin decir por qué. No lleva ningún dato sensible:
    // nombre, iconos y pantalla de arranque.
    pathname === "/manifest.webmanifest" ||
    // Mismo motivo que el manifest, y la trampa es peor: el regex de abajo NO
    // cubre `.js`. Sin esta línea el navegador pide el service worker y recibe
    // el HTML del login con un 200 — no se registra y no llega ni un aviso,
    // sin un solo error en ninguna parte.
    pathname === "/sw.js" ||
    // EL PORTAL DEL CLIENTE. Es la única parte del OS que ve alguien de fuera,
    // así que tiene que pasar SIN cookie de equipo: su credencial es el token
    // de la propia URL, que `accesoPorToken` valida contra la base en cada
    // petición. Sin esta línea el cliente recibiría el HTML de /login con un
    // 200 y el fallo sería invisible — es exactamente lo que le pasó al
    // manifest, al service worker y al cron de media-backfill.
    //
    // El prefijo es "/e/" y no "/estrategias": ese es el módulo INTERNO, que
    // debe seguir exigiendo sesión de equipo. Son rutas distintas a propósito.
    pathname.startsWith("/e/") ||
    // LA FIRMA DEL CONTRATO. Mismo caso que el portal: la credencial es el
    // token de la URL, validado contra la base en cada petición. Dos rutas:
    // la página y su PDF (prefijo /c/) y el POST de firma, que es estático
    // porque necesita las fuentes de pdfkit (ver next.config.mjs).
    //
    // El POST va por igualdad EXACTA y no por prefijo: "/api/contratos" es el
    // resto del módulo (el PDF interno, `[contratoId]`), que tiene que seguir
    // exigiendo sesión de equipo y módulo "ventas". Un `startsWith` aquí lo
    // abriría entero.
    pathname.startsWith("/c/") ||
    pathname === "/api/contratos/firmar" ||
    /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }
  if (await validSession(req.cookies.get("mcc_session")?.value)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
