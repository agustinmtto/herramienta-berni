// Middleware de logging de requests — cada request de la app/API sale por
// terminal con método, path, UA y marca de sesión (docs/03 §6).
// Los assets estáticos y el favicon quedan silenciados en el matcher para
// que el log de la terminal se mantenga legible.

import { NextResponse } from "next/server";

const ts = () => new Date().toISOString().slice(11, 19); // hora corta
const dim = "\x1b[2m";      // gris tenue
const cyan = "\x1b[36m";    // cian para el path
const reset = "\x1b[0m";    // reset de color

// Loguea el request y deja que Next siga atendiendo normalmente.
export function middleware(request) {
  const { method } = request;
  const url = new URL(request.url);
  const pathAndQuery = url.pathname + (url.search || "");
  // UA recortado en el primer cierre de paréntesis para no ensuciar el log.
  const ua = (request.headers.get("user-agent") || "unknown-ua").split(")")[0] + ")";

  console.log(`${dim}[${ts()}]${reset} ← ${method} ${cyan}${pathAndQuery}${reset} ${dim}${ua}${reset}`);

  return NextResponse.next();
}

// Definición del matcher: cubre la app y la API exceptuando assets estáticos.
export function config() {
  return {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|frames/).*)"],
  };
}
