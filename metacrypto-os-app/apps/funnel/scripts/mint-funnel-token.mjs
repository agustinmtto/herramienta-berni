// Genera un JWT HS256 con role=funnel para PostgREST (Supabase) — la clave
// que usa la app pública del funnel (privilegio mínimo: EXECUTE de
// registrar_diagnostico y nada más, migración 0069).
//
// Uso (SOLO desarrollo local):
//   node scripts/mint-funnel-token.mjs [JWT_SECRET]
// El secreto por defecto es el de supabase/config.toml local; NUNCA pasar un
// secreto de producción por línea de comandos: en producción lo genera el
// operador con el JWT_SECRET del proyecto. VALIDEZ: 10 años (local no rota).
import { createHmac } from "node:crypto";

const SECRET = process.argv[2] ?? "super-secret-jwt-token-with-at-least-32-characters-long";
const b64u = (value) => Buffer.from(value).toString("base64url");
const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = b64u(JSON.stringify({
  role: "funnel",
  iss: "supabase",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
}));
const input = `${header}.${payload}`;
const signature = createHmac("sha256", SECRET).update(input).digest("base64url");
console.log(`${input}.${signature}`);
