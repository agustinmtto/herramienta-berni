// ESLint flat config del OS (v3 M-09): `npm run lint` ahora es compuerta
// automática no interactiva (`eslint .`). Reglas de next/core-web-vitals +
// TypeScript, con tolerancias mínimas para el código preexistente del OS.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  { ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // El OS usa `any` intencionalmente en varios lugares heredados del
      // cliente REST tipado por postgrest; no es objetivo de este PR.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "react-hooks/exhaustive-deps": "warn",
      // La UI es es-AR: los textos llevan comillas literales — forzarlas a
      // entidades HTML no aporta valor en este proyecto.
      "react/no-unescaped-entities": "off",
    },
  },
  {
    // El OS nombra sus hooks en español (`usarAncho`) — la convención del
    // plugin react-hooks solo reconoce el prefijo `use` en inglés.
    files: ["components/usarAncho.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];
