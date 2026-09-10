// Unit tests — lib/progressFor and lib/question-config invariants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wizardConfig, questions, progressFor } from "../lib/question-config.js";
import { buildDiagnosis } from "../lib/engine.js";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "../lib/whatsapp.js";

test("config: every question has unique id, title and options", () => {
  const ids = new Set();
  for (const q of questions) {
    assert.equal(typeof q.id, "string", "id present");
    assert.ok(!ids.has(q.id), `duplicate question id: ${q.id}`);
    ids.add(q.id);
    assert.ok(q.title.startsWith("¿"), `question ${q.id} missing title`);
  }
});

test("config: every option has a label and at least one tag", () => {
  for (const q of questions.filter((q) => q.type !== "contact")) {
    assert.ok(q.options.length >= 3, `question ${q.id} needs >= 3 options`);
    for (const opt of q.options) {
      assert.ok(opt.label, `question ${q.id}: missing label`);
      assert.ok(Array.isArray(opt.tags) && opt.tags.length >= 1, `question ${q.id} option '${opt.label}' missing tags`);
    }
  }
});

test("config: contact question is last and typed", () => {
  const last = questions[questions.length - 1];
  assert.equal(last.type, "contact");
});

test("config: segment question maps each option to an existing video", () => {
  const videoIds = new Set(wizardConfig.videos.items.map((v) => v.id));
  assert.equal(videoIds.size, 3, "three videos expected (2 generic + 1 variable)");
  for (const opt of wizardConfig.segmentQuestion.options) {
    assert.ok(videoIds.has(opt.video), `segment option "${opt.label}" points to unknown video ${opt.video}`);
  }
});

test("engine: hot lead flag only for high capital tags", () => {
  const hotLead = [{ tags: ["hot-cap"] }];
  const coldLead = [{ tags: ["cap-low"] }];
  assert.equal(buildDiagnosis(hotLead).hot, true);
  assert.equal(buildDiagnosis(coldLead).hot, false);
});

test("engine: diagnosis produces the 4 canonical sections", () => {
  const d = buildDiagnosis([{ tags: ["risk-low", "alloc-alts", "spread-high"] }]);
  const titles = d.sections.map((s) => s.title);
  assert.deepEqual(titles, [
    "Tu situación real",
    "El desajuste principal",
    "El coste de tu liquidez parada",
    "Tu plan de acción",
  ]);
});

test("engine: mismatch rule flags conservative profile with alt-heavy portfolio", () => {
  const d = buildDiagnosis([{ tags: ["risk-low", "alloc-alts"] }]);
  assert.match(d.sections[1].body.text, /peleados/i);
});

test("engine: action plan non-empty even with empty tags", () => {
  const d = buildDiagnosis([]);
  assert.ok(d.sections[3].items.length >= 1, "always at least one action");
});

test("progress: misleading bar, first answer = 33", () => {
  assert.equal(progressFor(0, 9), 0);
  assert.equal(progressFor(1, 9), 33);
});

test("progress: never reaches 100 before the end", () => {
  for (let i = 1; i <= 8; i++) {
    const pct = progressFor(i, 9);
    assert.ok(pct > 0 && pct <= 93, `answered ${i} => ${pct} must be in (0,93]`);
    assert.ok(pct >= progressFor(Math.max(i - 1, 1), 9), "bar is monotonic");
  }
});

test("whatsapp: message includes lead name, answers and segment", () => {
  const message = buildWhatsAppMessage({
    name: "Ana",
    answers: [{ pregunta: "¿Cuál es tu perfil?", respuesta: "Moderado" }],
    segment: { pregunta: "¿Qué te interesa?", respuesta: "Proteger lo que tengo" },
  });
  assert.match(message, /Nombre: Ana/);
  assert.match(message, /¿Cuál es tu perfil\?: Moderado/);
  assert.match(message, /¿Qué te interesa\?: Proteger lo que tengo/);
  assert.doesNotMatch(message, /email|teléfono/i);
});

test("whatsapp: URL targets configured number and preserves accents", () => {
  const url = buildWhatsAppUrl({
    number: "+54 9 3585 401429",
    name: "Álvaro",
    answers: [],
  });
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "wa.me");
  assert.equal(parsed.pathname, "/5493585401429");
  assert.match(parsed.searchParams.get("text"), /Nombre: Álvaro/);
});
