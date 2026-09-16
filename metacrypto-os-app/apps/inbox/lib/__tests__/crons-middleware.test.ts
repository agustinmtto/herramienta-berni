import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// Guarda de regresión — todo cron de `vercel.json` está en la lista blanca
// del middleware.
//
// El propio `middleware.ts` lo dice: «Es la quinta vez que este regex se come
// una ruta nueva». El fallo no da error — Vercel Cron recibe el HTML de
// /login con un **200**, así que el cron consta como ejecutado correctamente
// y no hace absolutamente nada. Se descubre días después, por lo que NO pasó.
//
// Es el mismo modo de fallo que el baneo de la WABA del 2-sep (un 200 que no
// significa lo que parece), y por eso merece un test y no un comentario más.
//
// Lee los ficheros en vez de importarlos: lo que se vigila es la
// correspondencia entre dos ficheros de configuración, no un comportamiento.
// ============================================================
const AQUI = dirname(fileURLToPath(import.meta.url));
// __tests__ → lib → inbox. Anclado al propio fichero y no a `process.cwd()`,
// por lo mismo que en `numero-emisor.test.ts`: con cwd, lanzar vitest desde
// la raíz del repo mataría el test con un ENOENT que no tiene nada que ver
// con lo que vigila — y un test de seguridad que falla por un motivo ajeno es
// un test que alguien silencia.
const INBOX = resolve(AQUI, "..", "..");

const crons: { path: string }[] = JSON.parse(
  readFileSync(resolve(INBOX, "vercel.json"), "utf8"),
).crons;
const middleware = readFileSync(resolve(INBOX, "middleware.ts"), "utf8");

describe("todo cron programado pasa el middleware", () => {
  it("hay crons que comprobar (si no, el test se estaría autoengañando)", () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  for (const cron of crons) {
    it(`${cron.path} está en la lista blanca`, () => {
      // Se acepta la ruta exacta o cualquier prefijo suyo: el middleware usa
      // `startsWith`, así que dar de alta "/api/sesiones" cubriría
      // "/api/sesiones/sync".
      const cubierto = prefijos(cron.path).some((p) =>
        middleware.includes(`startsWith("${p}")`),
      );
      expect(cubierto, `${cron.path} no aparece en middleware.ts — el cron devolverá el HTML de /login con un 200 y no hará nada`).toBe(true);
    });
  }
});

// "/api/email/estados" → ["/api/email/estados", "/api/email", "/api"]
function prefijos(ruta: string): string[] {
  const partes = ruta.split("/").filter(Boolean);
  return partes.map((_, i) => "/" + partes.slice(0, partes.length - i).join("/"));
}

// ============================================================
// Segunda guarda, mismo modo de fallo y otra víctima: las rutas que ve alguien
// de FUERA del equipo. Sin su línea en el middleware, el cliente recibe el HTML
// de /login con un 200 y no puede firmar — y encima el redirect le mete el
// token en `?next=`, o sea en los registros. Ninguna de estas está en
// `vercel.json`, así que el bloque de arriba no las cubriría jamás.
// ============================================================
const RUTAS_PUBLICAS = ["/e/", "/c/", "/api/contratos/firmar"];

describe("toda ruta pública pasa el middleware", () => {
  for (const ruta of RUTAS_PUBLICAS) {
    it(`${ruta} está en la lista blanca`, () => {
      const cubierto =
        middleware.includes(`startsWith("${ruta}")`) || middleware.includes(`pathname === "${ruta}"`);
      expect(cubierto, `${ruta} no aparece en middleware.ts — devolverá el HTML de /login con un 200`).toBe(true);
    });
  }
});
