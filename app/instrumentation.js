// Log de arranque del servidor — docs/03 §6: trazabilidad en la terminal.
// Next lo llama una vez al boot; imprime modo, versión de Node y qué módulos hay activos.
export async function register() {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`\n[${ts}] ── metacrypto diagnostic tool ─────────────────────────`);
  console.log(`[${ts}] mode:     ${process.env.NODE_ENV || "development"}`);
  console.log(`[${ts}] node:     ${process.version}`);
  console.log(`[${ts}] lead api: POST /api/lead (stub, console-backed until Supabase)`);
  console.log(`[${ts}] tracking: session_id + dropoff (docs/03 §6)`);
  console.log(`──────────────────────────────────────────────────────────\n`);
}
