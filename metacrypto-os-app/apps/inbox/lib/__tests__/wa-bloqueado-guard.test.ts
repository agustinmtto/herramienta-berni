import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// Guarda de regresión — los dos caminos de envío consultan `estadoWa`
// ANTES de llamar a Kapso.
//
// El 2-sep-2026, con la WABA baneada, Kapso siguió devolviendo 200 a todo.
// El fallo real llegaba después por webhook y `wa_mensajes.status` nunca lo
// recoge, así que el OS mostraba como enviados mensajes que Meta tiraba. Los
// dos crons de `vercel.json` (`/api/sesiones/sync` y `.../recurrentes`)
// dispararon contra ese canal muerto cada 5 minutos sin que nadie lo notara.
//
// Que el guard exista no basta: tiene que estar ANTES del `fetch`. Un guard
// colocado después no evita nada — la llamada ya salió. Por eso este test
// compara posiciones en el fuente, no solo presencia.
//
// Se lee el fuente en vez de importar los módulos porque `lib/plantillas.ts`
// importa `@/lib/supabase` en runtime, y el alias `@/` no resuelve bajo
// vitest (trampa ya documentada del repo).
// ============================================================

// Anclado al propio fichero, no a `process.cwd()`: el mismo motivo que en
// `numero-emisor.test.ts` — desde la raíz del repo, cwd rompe el test por un
// ENOENT que no tiene nada que ver con lo que vigila.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const FICHEROS_QUE_ENVIAN = [
  "apps/inbox/app/api/reply/route.ts",
  "apps/inbox/lib/plantillas.ts",
];

describe("ningún envío sale sin consultar antes si WhatsApp está caído", () => {
  for (const rel of FICHEROS_QUE_ENVIAN) {
    const fuente = readFileSync(resolve(RAIZ, rel), "utf8");

    it(`${rel} importa estadoWa`, () => {
      expect(fuente).toMatch(/import\s*\{[^}]*\bestadoWa\b[^}]*\}\s*from\s*["'][^"']*wa-estado["']/);
    });

    it(`${rel} consulta estadoWa antes de llamar a Kapso`, () => {
      const guard = fuente.indexOf("estadoWa(");
      // El fetch que sale a Meta/Kapso. En los dos ficheros la URL se arma
      // con META_BASE justo antes de la llamada.
      const salida = fuente.indexOf("await fetch(");
      expect(guard).toBeGreaterThan(-1);
      expect(salida).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(salida);
    });
  }
});
