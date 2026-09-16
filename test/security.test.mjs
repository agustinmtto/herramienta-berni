// Security unit tests — docs/09-security checklist pre-production.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isRateLimited, resetRateLimiter, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "../lib/rate-limit.js";
import { buildWhatsAppUrl, buildWhatsAppMessage } from "../lib/whatsapp.js";

describe("rate limiter", () => {
  test("allows requests below the configured maximum", () => {
    resetRateLimiter();
    for (let i = 0; i < 3; i++) {
      const r = isRateLimited("unit-ip", { max: 3, windowMs: 1000 });
      assert.equal(r.limited, false, `request ${i + 1} should pass`);
    }
  });

  test("blocks requests after the maximum and recovers after the window", async () => {
    resetRateLimiter();
    for (let i = 0; i < 3; i++) isRateLimited("burst-ip", { max: 3, windowMs: 50 });
    assert.equal(isRateLimited("burst-ip", { max: 3, windowMs: 50 }).limited, true);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(isRateLimited("burst-ip", { max: 3, windowMs: 50 }).limited, false);
  });

  test("rate limits are isolated per key (per IP)", () => {
    resetRateLimiter();
    for (let i = 0; i < 3; i++) isRateLimited("ip-a", { max: 3, windowMs: 1000 });
    assert.equal(isRateLimited("ip-a", { max: 3, windowMs: 1000 }).limited, true);
    assert.equal(isRateLimited("ip-b", { max: 3, windowMs: 1000 }).limited, false);
  });
});

describe("whatsapp link injection", () => {
  test("destination is digits-only regardless of attacker input", () => {
    const url = buildWhatsAppUrl({ number: "+549&?foo=bar https://evil.com#x 115851234", name: "x" });
    assert.equal(new URL(url).origin, "https://wa.me");
    // Only the sanitized digits survive in the destination path.
    assert.equal(new URL(url).pathname.split("/")[1].replace(/\D/g, ""), "549115851234".replace(/\D/g, ""));
  });

  test("message is fully URL-encoded: no bare ?, &, #, %, <script> or newlines in URL params", () => {
    const url = buildWhatsAppUrl({
      number: "549115851234",
      name: 'Ana "<img onerror=alert(1)>" & ? # %\njavascript:',
      answers: [{ pregunta: "<script>alert(1)</script>?", respuesta: '<img src=x onerror="&?#">' }],
    });
    assert.equal(new URL(url).origin, "https://wa.me");
    const text = new URL(url).searchParams.get("text");
    assert.ok(!/[\r\n]/.test(new URL(url).search), "no newlines in the query string");
    assert.ok(text.includes("Ana"), "name survives encoding");
  });
});
