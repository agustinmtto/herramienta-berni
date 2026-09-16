import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// Guarda de regresión — el número emisor de WhatsApp NUNCA va literal.
//
// Hasta el 2-sep-2026 los tres sitios que envían WhatsApp tenían
// `KAPSO_PHONE_NUMBER_ID ?? "597907523413541"`. Ese id no es de MetaCrypto:
// es el sandbox de Kapso, COMPARTIDO con el proyecto de otro cliente. Con la
// env var ausente, los mensajes de MCC salían con la identidad de otra
// empresa ante Meta — quedando en SU historial, con el nombre y el teléfono
// del cliente de MCC dentro — y las respuestas entraban por el webhook del
// otro proyecto. Fuga en las dos direcciones, sin un solo error visible.
//
// Este test existe porque el fallback es exactamente la línea que alguien
// reañade sin pensar cuando "no le funciona en local". Que falle aquí es más
// barato que descubrirlo en el historial de otro cliente.
//
// Lee el fuente en vez de importar los módulos a propósito: importarlos
// ejecutaría su código de arranque y aquí lo que se vigila es el TEXTO.
// ============================================================

// Anclado al PROPIO fichero, no a `process.cwd()`. Con cwd, esto solo acertaba
// lanzando vitest desde `apps/inbox`: desde la raíz del repo el "../.." se
// salía del proyecto y el test moría con un ENOENT en /Users.
//
// Y eso en un test de seguridad es peor que un fallo normal: falla por un
// motivo que no tiene NADA que ver con lo que vigila, así que el reflejo de
// quien se lo encuentre —sobre todo en CI, que suele lanzar desde la raíz— es
// marcarlo como inestable y silenciarlo. Silenciado, el `?? "<sandbox>"` puede
// volver sin que salte nada, que es justo lo que este fichero existe para
// impedir. Desde aquí: __tests__ → lib → inbox → apps → raíz.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Los que viven EN este repositorio. Si falta uno, el test tiene que fallar:
// un fichero de envío que desaparece de la lista es precisamente cómo esta
// vigilancia se pierde sin que nadie lo note.
const FICHEROS_QUE_ENVIAN = [
  "apps/inbox/app/api/reply/route.ts",
  "apps/inbox/lib/plantillas.ts",
];

// 🔴 Los que viven FUERA de este repositorio.
//
// `scripts/goteo_anuncio_numero.mjs` también manda WhatsApp y también tiene
// que cumplir la regla, pero `scripts/` no forma parte de este repo: vive en
// el espacio de trabajo del operador. Cuando este test corre allí, el fichero
// está y se comprueba; aquí no está y se salta.
//
// Se salta AVISANDO, no en silencio. La cabecera de este fichero explica por
// qué importa: un test de seguridad que falla por un motivo ajeno a lo que
// vigila acaba silenciado, y silenciado no vigila nada. Un `it.skip` mudo
// tiene el mismo final. Por eso el aviso sale por consola y el fichero sigue
// nombrado aquí: quien lea esta lista ve que la regla es más ancha que este
// repositorio.
const FICHEROS_FUERA_DEL_REPO = ["scripts/goteo_anuncio_numero.mjs"];

const presentes = (lista: string[]) =>
  lista.filter((rel) => {
    const hay = existsSync(resolve(RAIZ, rel));
    if (!hay) console.warn(`[numero-emisor] fuera de este repo, sin comprobar: ${rel}`);
    return hay;
  });

const A_COMPROBAR = [...FICHEROS_QUE_ENVIAN, ...presentes(FICHEROS_FUERA_DEL_REPO)];

// Un id de phone_number de Meta es una ristra larga de dígitos. Se busca
// cualquier literal así usado como valor por defecto — `?? "…"` o `|| "…"` —
// que es la forma exacta que tenía el fallback.
const FALLBACK_LITERAL = /(\?\?|\|\|)\s*["'`]\d{10,}["'`]/;

describe("el número emisor de WhatsApp nunca va literal en el código", () => {
  for (const rel of A_COMPROBAR) {
    it(`${rel} no tiene un número por defecto`, () => {
      const fuente = readFileSync(resolve(RAIZ, rel), "utf8");
      // Fuera los comentarios: los tres ficheros documentan el incidente
      // citando el id viejo, y esa cita debe seguir permitida.
      const sinComentarios = fuente
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(sinComentarios).not.toMatch(FALLBACK_LITERAL);
    });
  }

  it("el sandbox compartido no aparece como código en ningún fichero de envío", () => {
    for (const rel of A_COMPROBAR) {
      const sinComentarios = readFileSync(resolve(RAIZ, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(sinComentarios, `${rel} vuelve a llevar el sandbox`).not.toContain("597907523413541");
    }
  });
});
