// Security + integration tests against the real Next.js server (build required).
// Boots its own `next start` on port 3399, runs HTTP checks, shuts it down.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api/lead`;

let server;

const validPayload = JSON.stringify({
  session_id: "sess-00000000-0000-4000-8000-000000000000",
  lead: { name: "Test User", email: "test@example.com", consent: true },
  signals: { dropoff_question: null, finished_at: new Date().toISOString() },
  answers: [{ pregunta: "¿Cuánto capital total tenés invertido en cripto?", respuesta: "5k a 15k" }],
});

async function reachable() {
  try {
    const r = await fetch(BASE);
    return r.status === 200;
  } catch {
    return false;
  }
}

before({ timeout: 120_000 }, async () => {
  if (!existsSync(join(ROOT, ".next"))) {
    throw new Error("Run `npm run build` before executing integration tests");
  }
  server = spawn(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("next start did not come up in time");
});

after(() => {
  if (server) server.kill();
});

test("integration: home page renders the hero", async () => {
  const res = await fetch(BASE);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /bajo la lupa/i);
  assert.match(html, /Metacrypto/i);
});

test("integration: valid lead payload accepted", async () => {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: validPayload });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).session_id, JSON.parse(validPayload).session_id);
});

test("security: malformed JSON rejected with 400", async () => {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not-json" });
  assert.equal(res.status, 400);
});

test("security: payload that breaks the shape rejected with 422", async () => {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hola: "mundo" }),
  });
  assert.equal(res.status, 422);
});

test("security: oversized payload rejected with 413", async () => {
  const big = JSON.stringify({ session_id: "x", answers: [{ pregunta: "p".repeat(80_000), respuesta: "r" }] });
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: big });
  assert.equal(res.status, 413);
});

test("security: GET is not allowed on the lead endpoint", async () => {
  const res = await fetch(API);
  assert.equal(res.status, 405);
});

test("security: secrets or env values never leak in the response", async () => {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: validPayload });
  const body = await res.text();
  assert.ok(!/supabase|resend|api[_-]?key|token|secret/i.test(body));
});
