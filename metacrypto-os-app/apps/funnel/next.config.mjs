import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fija la raíz de tracing a esta app (evita que Next detecte lockfiles
  // ajenos en el home como workspace root). Runtime Node.js por defecto.
  outputFileTracingRoot: __dirname,
  // Headers globales de seguridad: nosniff + referrer + permissions + HSTS.
  // La CSP quede para su propio ticket (necesita iteración contra los embeds
  // de video del CTA).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
