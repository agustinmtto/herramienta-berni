// Stub para vitest: lib/supabase.ts importa "server-only" y los tests de la
// ruta /api/lead importan lib/supabase. En runtime real de Next este paquete
// garantiza que el módulo no llegue a un Client Component; en vitest basta
// con que exista como módulo vacío (ver vitest.config.ts).
export default {};
