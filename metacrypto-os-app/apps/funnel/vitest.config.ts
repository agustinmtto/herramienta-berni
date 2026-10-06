import { defineConfig } from "vitest/config";
import path from "node:path";

// Config mínima de vitest para apps/funnel.
// - alias "@": igual que tsconfig paths.
// - "server-only": stub — lib/db.ts lo importa; sin el alias, importar la
//   ruta /api/lead en un test revienta porque vitest resuelve el paquete
//   real (que tira error fuera de RSC).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "lib/__tests__/server-only-stub.ts"),
    },
  },
  test: { environment: "node" },
});
