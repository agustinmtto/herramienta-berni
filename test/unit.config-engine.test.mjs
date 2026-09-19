import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAllocationResponse,
  progressFor,
  progressMessageFor,
  questions,
  wizardConfig,
} from "../lib/question-config.js";
import { buildDiagnosis } from "../lib/engine.js";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "../lib/whatsapp.js";

test("config: definitive questions have unique ids and tracking stages", () => {
  assert.equal(questions.length, 9, "eight diagnostic questions plus contact");
  assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
  assert.equal(new Set(questions.map((question) => question.trackingId)).size, questions.length);
  assert.deepEqual(questions.slice(0, 8).map((question) => question.trackingId), ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
});

test("config: standard options have labels and deterministic tags", () => {
  for (const question of questions.filter((item) => !item.type)) {
    assert.ok(question.options.length >= 4, `${question.id} needs at least four options`);
    for (const option of question.options) {
      assert.ok(option.label, `${question.id}: missing label`);
      assert.ok(Array.isArray(option.tags) && option.tags.length >= 1, `${question.id}: missing tags`);
    }
  }
});

test("config: portfolio composition exposes four assets and six ranges", () => {
  const allocation = questions.find((question) => question.id === "allocation");
  assert.equal(allocation.type, "allocation");
  assert.deepEqual(allocation.assets.map((asset) => asset.id), ["btc", "eth", "alts", "stables"]);
  for (const asset of allocation.assets) assert.equal(asset.ranges.length, 6);
});

test("config: allocation response stays compatible with textual API contract", () => {
  const allocation = questions.find((question) => question.id === "allocation");
  const selections = Object.fromEntries(allocation.assets.map((asset, index) => [asset.id, asset.ranges[index]]));
  const response = buildAllocationResponse(allocation, selections);
  assert.equal(response.answer, "BTC: 0% · ETH: 1-10% · ALT: 10-25% · USD: 25-50%");
  assert.deepEqual(response.tags, ["btc-zero", "eth-minimal", "alts-low", "stables-medium"]);
  assert.equal(buildAllocationResponse(allocation, { btc: allocation.assets[0].ranges[0] }), null);
});

test("config: challenge options map to existing videos", () => {
  const videoIds = new Set(wizardConfig.videos.items.map((video) => video.id));
  const challenge = questions.find((question) => question.id === wizardConfig.videoSelectorQuestionId);
  assert.equal(videoIds.size, 3);
  for (const option of challenge.options) assert.ok(videoIds.has(option.video));
});

test("config: contact question is last", () => {
  assert.equal(questions.at(-1).type, "contact");
  assert.equal(questions.at(-1).trackingId, "contact");
});

test("engine: capital ranges from 10k are qualified as hot", () => {
  assert.equal(buildDiagnosis([{ tags: ["hot-cap"] }]).hot, true);
  assert.equal(buildDiagnosis([{ tags: ["cap-low"] }]).hot, false);
});

test("engine: diagnosis produces the four canonical sections", () => {
  const diagnosis = buildDiagnosis([{ tags: ["decision-social", "rules-none"] }]);
  assert.deepEqual(diagnosis.sections.map((section) => section.title), [
    "Tu situación real",
    "El desajuste principal",
    "La señal que no conviene ignorar",
    "Tu plan de acción",
  ]);
  assert.match(diagnosis.sections[1].body.text, /sin un sistema estable/i);
});

test("engine: action plan is deterministic and never empty", () => {
  const diagnosis = buildDiagnosis([{ tags: ["rules-none", "pain-risk", "decision-news"] }]);
  assert.ok(diagnosis.sections[3].items.length >= 3);
  assert.ok(buildDiagnosis([]).sections[3].items.length >= 1);
});

test("progress: psychological curve reaches 50 percent after first three answers", () => {
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => progressFor(index, 8)), [18, 34, 46, 52, 62, 73, 86, 93, 97]);
  assert.equal(progressMessageFor(6, 8), "Casi terminamos");
  assert.equal(progressMessageFor(7, 8), "Última pregunta");
});

test("config: final CTA promises the personalized video", () => {
  assert.equal(wizardConfig.finalCta.whatsappNumber, "5493585401429");
  assert.equal(wizardConfig.finalCta.button, "Recibir mi video por WhatsApp");
  assert.match(wizardConfig.finalCta.text, /video.*WhatsApp/i);
  assert.match(wizardConfig.diagnosisDocument.disclaimer, /no constituye asesoramiento financiero/i);
});

test("whatsapp: message includes name, answers and requested video without contact data", () => {
  const message = buildWhatsAppMessage({
    name: "Ana",
    answers: [{ pregunta: "¿Qué te cuesta?", respuesta: "Gestionar el riesgo" }],
    requestedVideo: "Cómo invertir con reglas",
  });
  assert.match(message, /Nombre: Ana/);
  assert.match(message, /Gestionar el riesgo/);
  assert.match(message, /video: Cómo invertir con reglas/i);
  assert.doesNotMatch(message, /email|teléfono/i);
});

test("whatsapp: URL targets configured number and preserves accents", () => {
  const url = buildWhatsAppUrl({ number: "+54 9 3585 401429", name: "Álvaro", answers: [] });
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "wa.me");
  assert.equal(parsed.pathname, "/5493585401429");
  assert.match(parsed.searchParams.get("text"), /Nombre: Álvaro/);
});
