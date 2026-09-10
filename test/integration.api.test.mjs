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
  lead: { name: "Test User", email: "test@example.com", phone: "+54 9 3585 000000", consent: true },
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

before(async () => {
  if (!existsSync(join(ROOT, ".next"))) {
    throw new Error("Run `npm run build` before executing integration tests");
  }
  server = spawn(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, LEAD_RATE_LIMIT_MAX: "1000" },
    stdio: "ignore",
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("next start did not come up in time");
}, { timeout: 120_000 });

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

test("security: completed lead without phone rejected with 422", async () => {
  const payload = JSON.parse(validPayload);
  delete payload.lead.phone;
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

test("security: wrong Content-Type rejected with 415", async () => {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain" }, body: validPayload });
  assert.equal(res.status, 415);
});

test("security: missing Content-Type rejected with 415", async () => {
  const res = await fetch(API, { method: "POST", body: validPayload });
  assert.equal(res.status, 415);
});

test("security: cross-origin request rejected with 403", async () => {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
    body: validPayload,
  });
  assert.equal(res.status, 403);
});

test("security: malformed Origin rejected with 403", async () => {
  // undici (fetch) refuses to send invalid header values, so use raw http.
  const http = await import("node:http");
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: "/api/lead", method: "POST", headers: { "Content-Type": "application/json", Origin: "not a url" } },
      (res) => { res.resume(); resolve(res.statusCode); }
    );
    req.on("error", reject);
    req.end(validPayload);
  });
  assert.equal(status, 403);
});

test("security: unexpected top-level field rejected with 422", async () => {
  const payload = JSON.parse(validPayload);
  payload.attacker_field = { x: "y".repeat(50000) };
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 422);
});

test("security: honeypot filled returns fake success", async () => {
  const payload = JSON.parse(validPayload);
  payload.lead.website = "https://spam.example.com";
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.ok === true && !body.session_id, "generic body, no echo");
});

test("security: malformed session_id format rejected with 422", async () => {
  const payload = JSON.parse(validPayload);
  payload.session_id = "weird id(space)";
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(res.status, 422);
});

test("security: too many answers rejected with 422", async () => {
  const payload = JSON.parse(validPayload);
  payload.answers = Array.from({ length: 65 }, () => ({ pregunta: "p", respuesta: "r" }));
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(res.status, 422);
});

test("security: oversized field value rejected with 422", async () => {
  const payload = JSON.parse(validPayload);
  payload.answers[0].respuesta = "x".repeat(2000);
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal(res.status, 422);
});

test("security: nulls and wrong types in fields rejected with 422", async () => {
  for (const mutation of [
    { lead: "string-not-object" },
    { signals: "bad" },
    { answers: "not-array" },
    { answers: [{ pregunta: null, respuesta: "r" }] },
    { answers: [{ pregunta: "p", respuesta: 123 }] },
  ]) {
    const payload = { ...JSON.parse(validPayload), ...mutation };
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(res.status, 422, JSON.stringify(mutation));
  }
});

test("security: PUT / PATCH / DELETE rejected with 405", async () => {
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    const res = await fetch(API, { method, headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 405, method);
  }
});

test("security: security headers present on responses", async () => {
  const res = await fetch(BASE);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.ok(res.headers.get("content-security-policy")?.includes("default-src"));
  assert.ok(res.headers.get("permissions-policy"));
});

