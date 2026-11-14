import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aggregate, characterErrorRate, evaluateCase, levenshtein, matchDetails } from "../src/benchmark/metrics.js";
import { iou } from "../src/geometry.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe("IoU", () => {
  test("identical, disjoint, partial", () => {
    close(iou([0.1, 0.1, 0.2, 0.2], [0.1, 0.1, 0.2, 0.2]), 1);
    close(iou([0, 0, 0.1, 0.1], [0.5, 0.5, 0.1, 0.1]), 0);
    close(iou([0, 0, 0.5, 0.5], [0.25, 0, 0.5, 0.5]), 1 / 3);
  });
});

describe("text metrics", () => {
  test("Levenshtein over code points", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
    assert.equal(levenshtein("ÉPÜLT", "EPULT"), 2);
    assert.equal(levenshtein("", "abc"), 3);
  });
  test("CER: normalized, capped at 1, misses count as 1", () => {
    close(characterErrorRate("ANNO 1910", "ANNO 1911"), 1 / 9);
    close(characterErrorRate("  ANNO   1911 ", "ANNO 1911"), 0);
    close(characterErrorRate("épült", "épült"), 0); // NFC
    close(characterErrorRate(null, "ANNO"), 1);
    close(characterErrorRate("a completely different and long text", "ab"), 1);
  });
});

describe("detail matching", () => {
  test("same type only, highest IoU first, one-to-one", () => {
    const expected = [
      { type: "mask", bbox: [0.1, 0.1, 0.2, 0.2] },
      { type: "mask", bbox: [0.6, 0.6, 0.2, 0.2] },
    ];
    const predicted = [
      { type: "mask", bbox: [0.62, 0.6, 0.2, 0.2] },
      { type: "plaque", bbox: [0.1, 0.1, 0.2, 0.2] },
      { type: "mask", bbox: [0.12, 0.1, 0.2, 0.2] },
    ];
    const m = matchDetails(expected, predicted).sort((a, b) => a.e - b.e);
    assert.deepEqual(m.map((x) => [x.e, x.p]), [[0, 2], [1, 0]]);
  });
  test("expected details without a bbox still match by type", () => {
    const m = matchDetails([{ type: "plaque" }], [{ type: "plaque", bbox: [0, 0, 0.1, 0.1] }]);
    assert.deepEqual(m, [{ e: 0, p: 0, iou: null }]);
  });
});

describe("case evaluation and aggregation", () => {
  const expected = {
    style: "Secession",
    details: [
      { type: "mask", bbox: [0.1, 0.1, 0.2, 0.2] },
      { type: "inscription", bbox: [0.5, 0.5, 0.2, 0.1], raw_text: "ANNO 1911" },
    ],
  };
  const prediction = {
    style: "Secession",
    confidence: 0.9,
    details: [
      { id: "det_1", type: "mask", bbox: [0.1, 0.1, 0.2, 0.2], raw_text: null, label: "m" },
      { id: "det_2", type: "inscription", bbox: [0.5, 0.5, 0.2, 0.1], raw_text: "ANNO 1910", label: "i" },
      { id: "det_3", type: "lion_head", bbox: [0.8, 0.1, 0.1, 0.1], raw_text: null, label: "l" },
    ],
  };

  test("evaluateCase", () => {
    const e = evaluateCase(expected, prediction);
    assert.equal(e.style_correct, true);
    assert.equal(e.tp, 2);
    assert.equal(e.n_predicted, 3);
    assert.equal(e.n_expected, 2);
    assert.equal(e.ious.length, 2);
    for (const v of e.ious) close(v, 1, 1e-12);
    close(e.text[0].cer, 1 / 9);
    assert.equal(e.text[0].exact, false);
  });

  test("an errored case is a style miss with no predictions", () => {
    const e = evaluateCase({ style: null, details: [] }, null);
    assert.equal(e.style_correct, false);
    assert.equal(e.n_predicted, 0);
  });

  test("aggregate", () => {
    const cases = [
      { eval: evaluateCase(expected, prediction), latency_ms: 100, ok: true, attempts: [{ valid: true }] },
      { eval: evaluateCase({ style: "Baroque", details: [{ type: "mask" }] }, null), latency_ms: 300, ok: false, attempts: [{ valid: false }, { valid: false }] },
      { eval: evaluateCase({ style: null, details: [] }, { style: null, confidence: 0.9, details: [] }), latency_ms: 200, ok: true, attempts: [{ valid: false }, { valid: true }] },
    ];
    const s = aggregate(cases);
    assert.equal(s.n, 3);
    close(s.style_accuracy, 2 / 3);
    close(s.type_precision, 2 / 3);
    close(s.type_recall, 2 / 3);
    close(s.mean_iou, 1);
    close(s.json_validity_rate, 1 / 3);
    close(s.success_rate, 2 / 3);
    assert.equal(s.retried, 2);
    close(s.avg_latency_ms, 200);
    assert.equal(s.p95_latency_ms, 300);
    assert.equal(s.text_n, 1);
  });

  test("rates are null when undefined", () => {
    const s = aggregate([{ eval: evaluateCase({ style: null, details: [] }, null), latency_ms: 5, ok: false, attempts: [] }]);
    assert.equal(s.type_precision, null);
    assert.equal(s.type_recall, null);
    assert.equal(s.mean_iou, null);
    assert.equal(s.json_validity_rate, null);
  });
});
