import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  applyGuardrails,
  box2dToBbox,
  checkVisionResult,
  clampBbox,
  MAX_DETAILS,
  normalizeConfidence,
  normalizeDetailType,
  normalizeStyle,
  parseAndValidate,
  parseModelJson,
  stripCodeFences,
  validateModelOutput,
} from "../validator.js";

const detail = (overrides = {}) => ({ label: "Mask", type: "mask", box_2d: [100, 200, 300, 400], raw_text: null, ...overrides });
const raw = (overrides = {}) => ({ image_assessment: "facade", style: "Secession", confidence: 0.9, details: [detail()], ...overrides });

describe("JSON parsing", () => {
  test("strips ```json fences", () => {
    assert.equal(stripCodeFences('```json\n{"a":1}\n```'), '{"a":1}');
  });
  test("strips bare ``` fences", () => {
    assert.equal(stripCodeFences('```\n{"a":1}\n```'), '{"a":1}');
  });
  test("leaves unfenced text alone", () => {
    assert.equal(stripCodeFences(' {"a":1} '), '{"a":1}');
  });
  test("extracts one JSON object surrounded by prose", () => {
    const r = parseModelJson('Sure! Here it is: {"style": null} Hope that helps.');
    assert.deepEqual(r, { ok: true, value: { style: null } });
  });
  test("rejects empty, non-JSON and truncated output", () => {
    assert.equal(parseModelJson("").ok, false);
    assert.equal(parseModelJson("I think it is Secession.").ok, false);
    assert.equal(parseModelJson('{"style": "Secession", "details": [').ok, false);
    assert.equal(parseModelJson(undefined).ok, false);
  });
});

describe("field normalization", () => {
  test("style: exact labels, aliases and null words", () => {
    assert.equal(normalizeStyle("Secession"), "Secession");
    assert.equal(normalizeStyle("Art Nouveau"), "Secession");
    assert.equal(normalizeStyle("historicist"), "Eclectic");
    assert.equal(normalizeStyle("Neo-Renaissance"), "Eclectic");
    assert.equal(normalizeStyle("Socialist_Brutalism"), "Brutalist");
    assert.equal(normalizeStyle("Austrian Baroque"), "Baroque");
    assert.equal(normalizeStyle(null), null);
    assert.equal(normalizeStyle("none"), null);
  });
  test("style: unknown values are invalid", () => {
    assert.equal(normalizeStyle("Gothic"), undefined);
    assert.equal(normalizeStyle(42), undefined);
  });
  test("confidence: clamps, accepts strings and percentages", () => {
    assert.equal(normalizeConfidence(0.8734), 0.873);
    assert.equal(normalizeConfidence("0.8"), 0.8);
    assert.equal(normalizeConfidence(87), 0.87);
    assert.equal(normalizeConfidence("87%"), 0.87);
    assert.equal(normalizeConfidence(1.2), 1);
    assert.equal(normalizeConfidence(-0.3), 0);
  });
  test("confidence: non-numbers are invalid", () => {
    assert.equal(normalizeConfidence("high"), null);
    assert.equal(normalizeConfidence(NaN), null);
    assert.equal(normalizeConfidence(undefined), null);
    assert.equal(normalizeConfidence(""), null);
  });
  test("detail type: contract values, aliases, fallback", () => {
    assert.deepEqual(normalizeDetailType("mask"), { type: "mask", mapped: false });
    assert.deepEqual(normalizeDetailType("lion-head"), { type: "lion_head", mapped: false });
    assert.deepEqual(normalizeDetailType("ornament"), { type: "architectural_element", mapped: true });
    assert.deepEqual(normalizeDetailType("Mascaron"), { type: "mask", mapped: true });
    assert.deepEqual(normalizeDetailType("balcony"), { type: "architectural_element", mapped: true });
    assert.deepEqual(normalizeDetailType(undefined), { type: "architectural_element", mapped: true });
  });
});

describe("coordinate conversion and clamping", () => {
  test("box_2d [ymin, xmin, ymax, xmax] on 0-1000 → [x, y, w, h] on 0-1", () => {
    assert.deepEqual(clampBbox(box2dToBbox([180, 320, 340, 460])).bbox, [0.32, 0.18, 0.14, 0.16]);
    assert.deepEqual(clampBbox(box2dToBbox([620, 400, 680, 620])).bbox, [0.4, 0.62, 0.22, 0.06]);
  });
  test("swapped min/max values are reordered", () => {
    assert.deepEqual(clampBbox(box2dToBbox([340, 460, 180, 320])).bbox, [0.32, 0.18, 0.14, 0.16]);
  });
  test("box_2d beyond 1000 is clipped to the image", () => {
    assert.deepEqual(clampBbox(box2dToBbox([0, 0, 1200, 500])).bbox, [0, 0, 0.5, 1]);
  });
  test("box_2d must be 4 numbers", () => {
    assert.equal(box2dToBbox([1, 2, 3]), null);
    assert.equal(box2dToBbox([1, 2, "3", 4]), null);
  });
  test("overflowing boxes are clipped so x + w <= 1 and y + h <= 1", () => {
    assert.deepEqual(clampBbox([0.9, 0.5, 0.3, 0.2]).bbox, [0.9, 0.5, 0.1, 0.2]);
    assert.deepEqual(clampBbox([-0.1, 0.2, 0.3, 0.3]).bbox, [0, 0.2, 0.2, 0.3]);
    assert.deepEqual(clampBbox([0.5, 0.95, 0.2, 0.2]).bbox, [0.5, 0.95, 0.2, 0.05]);
  });
  test("boxes with w or h <= 0.01, or entirely outside the image, are rejected as tiny", () => {
    assert.equal(clampBbox([0.5, 0.5, 0.005, 0.2]).problem, "tiny");
    assert.equal(clampBbox([0.5, 0.5, 0.01, 0.2]).problem, "tiny");
    assert.equal(clampBbox([1.2, 0.2, 0.1, 0.1]).problem, "tiny");
  });
  test("non-numeric or non-positive boxes are invalid", () => {
    assert.equal(clampBbox([0.1, "a", 0.2, 0.2]).problem, "invalid");
    assert.equal(clampBbox([0.1, 0.1, -0.2, 0.2]).problem, "invalid");
    assert.equal(clampBbox([0.1, 0.1, Infinity, 0.2]).problem, "invalid");
  });
});

describe("validateModelOutput (schema)", () => {
  test("rejects non-objects and missing or invalid top-level fields", () => {
    assert.equal(validateModelOutput([]).ok, false);
    assert.equal(validateModelOutput("x").ok, false);
    const { style, ...noStyle } = raw();
    assert.match(validateModelOutput(noStyle).error, /Missing required key "style"/);
    assert.match(validateModelOutput(raw({ style: "Gothic" })).error, /must be one of Secession/);
    assert.match(validateModelOutput(raw({ confidence: "high" })).error, /"confidence" must be a number/);
    assert.match(validateModelOutput(raw({ details: "none" })).error, /"details" must be an array/);
  });
  test("a systematic box-format error fails (so it can be retried)", () => {
    const r = validateModelOutput(raw({ details: [detail({ box_2d: undefined }), detail({ box_2d: "big" })] }));
    assert.equal(r.ok, false);
    assert.match(r.error, /box_2d/);
  });
  test("individual bad details are dropped with a warning", () => {
    const r = validateModelOutput(raw({ details: [detail(), detail({ box_2d: [1, 2] }), "junk"] }));
    assert.equal(r.ok, true);
    assert.equal(r.candidate.details.length, 1);
    assert.equal(r.info.warnings.length, 2);
  });
  test("accepts bbox [x, y, w, h] in 0-1 or on a 0-1000 scale", () => {
    const a = validateModelOutput(raw({ details: [{ type: "mask", bbox: [0.32, 0.18, 0.14, 0.16] }] }));
    const b = validateModelOutput(raw({ details: [{ type: "mask", bbox: [320, 180, 140, 160] }] }));
    assert.deepEqual(a.candidate.details[0].bbox, [0.32, 0.18, 0.14, 0.16]);
    assert.deepEqual(b.candidate.details[0].bbox, [0.32, 0.18, 0.14, 0.16]);
  });
  test("fills default labels, trims raw_text, maps type aliases", () => {
    const r = validateModelOutput(raw({ details: [detail({ label: " ", type: "ornament", raw_text: "  ANNO 1910 " }), detail({ raw_text: "" })] }));
    assert.equal(r.candidate.details[0].label, "Architectural detail");
    assert.equal(r.candidate.details[0].type, "architectural_element");
    assert.equal(r.candidate.details[0].raw_text, "ANNO 1910");
    assert.equal(r.candidate.details[1].raw_text, null);
  });
  test("missing details is treated as []", () => {
    const { details, ...rest } = raw();
    const r = validateModelOutput(rest);
    assert.equal(r.ok, true);
    assert.deepEqual(r.candidate.details, []);
  });
});

describe("guardrails (low confidence / no match)", () => {
  const candidate = (overrides = {}) => ({
    style: "Secession",
    confidence: 0.9,
    details: [{ label: "Mask", type: "mask", bbox: [0.1, 0.1, 0.2, 0.2], raw_text: null }],
    ...overrides,
  });

  test("confidence below threshold: details suppressed, style kept for LOW_CONFIDENCE", () => {
    const g = applyGuardrails(candidate({ confidence: 0.5 }), { minConfidence: 0.55 });
    assert.deepEqual(g.result, { style: "Secession", confidence: 0.5, details: [] });
    assert.equal(g.outcome, "low_confidence");
  });
  test("nullStyleBelowThreshold also nulls the style", () => {
    const g = applyGuardrails(candidate({ confidence: 0.5 }), { minConfidence: 0.55, nullStyleBelowThreshold: true });
    assert.deepEqual(g.result, { style: null, confidence: 0.5, details: [] });
    assert.equal(g.outcome, "low_confidence");
  });
  test("confidence exactly at the threshold is a match", () => {
    const g = applyGuardrails(candidate({ confidence: 0.55 }), { minConfidence: 0.55 });
    assert.equal(g.outcome, "match");
    assert.equal(g.result.details.length, 1);
  });
  test("style null always means details []", () => {
    const g = applyGuardrails(candidate({ style: null, confidence: 0.95 }));
    assert.deepEqual(g.result.details, []);
    assert.equal(g.outcome, "no_match");
  });
  test("not_architecture / too_blurry assessment overrides a hallucinated style", () => {
    for (const imageAssessment of ["not_architecture", "too_blurry"]) {
      const g = applyGuardrails(candidate(), { imageAssessment });
      assert.equal(g.result.style, null);
      assert.deepEqual(g.result.details, []);
    }
  });
  test("caps details at 6, assigns det_1..det_n, dedupes same-type overlaps", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ label: `D${i}`, type: "mask", bbox: [i * 0.12, 0, 0.1, 0.1], raw_text: null }));
    const g = applyGuardrails(candidate({ details: many }));
    assert.equal(g.result.details.length, MAX_DETAILS);
    assert.deepEqual(g.result.details.map((d) => d.id), ["det_1", "det_2", "det_3", "det_4", "det_5", "det_6"]);

    const dupes = [
      { label: "A", type: "mask", bbox: [0.1, 0.1, 0.2, 0.2], raw_text: null },
      { label: "B", type: "mask", bbox: [0.1, 0.1, 0.2, 0.21], raw_text: null },
      { label: "C", type: "plaque", bbox: [0.1, 0.1, 0.2, 0.2], raw_text: null },
    ];
    assert.deepEqual(applyGuardrails(candidate({ details: dupes })).result.details.map((d) => d.label), ["A", "C"]);
  });
});

describe("checkVisionResult (contract shape)", () => {
  const valid = {
    style: "Secession",
    confidence: 0.87,
    details: [{ id: "det_1", label: "Mask", type: "mask", bbox: [0.32, 0.18, 0.14, 0.16], raw_text: null }],
  };
  test("accepts a valid result and the null result", () => {
    assert.deepEqual(checkVisionResult(valid), []);
    assert.deepEqual(checkVisionResult({ style: null, confidence: 0.3, details: [] }), []);
  });
  test("flags extra keys, bad enums, out-of-range boxes, duplicate ids", () => {
    assert.ok(checkVisionResult({ ...valid, extra: 1 }).length);
    assert.ok(checkVisionResult({ ...valid, style: "Historicist" }).length);
    assert.ok(checkVisionResult({ ...valid, details: [{ ...valid.details[0], type: "ornament" }] }).length);
    assert.ok(checkVisionResult({ ...valid, details: [{ ...valid.details[0], bbox: [0.9, 0, 0.2, 0.1] }] }).length);
    assert.ok(checkVisionResult({ ...valid, details: [valid.details[0], valid.details[0]] }).length);
    assert.ok(checkVisionResult({ ...valid, style: null }).length);
  });
});

describe("parseAndValidate (end to end)", () => {
  test("fenced model output with box_2d → contract VisionResult", () => {
    const text = "```json\n" + JSON.stringify(raw({ details: [detail({ label: "Lion", type: "lion_head", box_2d: [180, 320, 340, 460] })] })) + "\n```";
    const r = parseAndValidate(text);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result, {
      style: "Secession",
      confidence: 0.9,
      details: [{ id: "det_1", label: "Lion", type: "lion_head", bbox: [0.32, 0.18, 0.14, 0.16], raw_text: null }],
    });
    assert.equal(r.outcome, "match");
  });
  test("strips the model's own ids and extra keys", () => {
    const r = parseAndValidate(JSON.stringify(raw({ details: [detail({ id: "x9", score: 0.3 })] })));
    assert.deepEqual(Object.keys(r.result.details[0]).sort(), ["bbox", "id", "label", "raw_text", "type"]);
    assert.equal(r.result.details[0].id, "det_1");
  });
});
