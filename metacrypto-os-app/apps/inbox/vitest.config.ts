import { defineConfig } from "vitest/config";
import path from "node:path";

// Config mínima de vitest para apps/inbox.
// - alias "@": igual que tsconfig paths, para importar lib/ y app/ en tests.
// - "server-only": stub — lib/supabase.ts lo importa y la ruta /api/lead lo
//   usa; sin el alias, importar la ruta en un test revienta porque vitest
//   resuelve el paquete real (que tira error fuera de RSC). Con el alias,
//   los tests de la ruta corren en node como cualquier otro.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "lib/__tests__/server-only-stub.ts"),
    },
  },
  test: { environment: "node" },
});
