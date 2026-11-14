import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildRepairPrompt, buildSystemPrompt, FEW_SHOT_EXAMPLES, RESPONSE_JSON_SCHEMA, USER_PROMPT } from "../prompts.js";
import { DETAIL_TYPES, IMAGE_ASSESSMENTS, parseAndValidate, STYLES } from "../validator.js";

describe("system prompt", () => {
  const prompt = buildSystemPrompt();

  test("names every contract style, detail type and assessment", () => {
    for (const s of STYLES) assert.ok(prompt.includes(`"${s}"`), s);
    for (const t of DETAIL_TYPES) assert.ok(prompt.includes(`"${t}"`), t);
    for (const a of IMAGE_ASSESSMENTS) assert.ok(prompt.includes(`"${a}"`), a);
  });

  test("specifies the box format, verbatim transcription and the threshold", () => {
    assert.match(prompt, /\[ymin, xmin, ymax, xmax\] as integers 0–1000/);
    assert.match(prompt, /VERBATIM/);
    assert.match(prompt, /Do not translate/);
    assert.match(prompt, /below 0\.55/);
    assert.match(buildSystemPrompt({ minConfidence: 0.6 }), /below 0\.60/);
  });

  test("embeds both few-shot outputs verbatim", () => {
    assert.equal(FEW_SHOT_EXAMPLES.length, 2);
    for (const ex of FEW_SHOT_EXAMPLES) assert.ok(prompt.includes(JSON.stringify(ex.output)));
  });
});

describe("few-shot examples", () => {
  test("the Secession example passes the validator as a match with 3 details", () => {
    const r = parseAndValidate(JSON.stringify(FEW_SHOT_EXAMPLES[0].output));
    assert.equal(r.ok, true);
    assert.equal(r.outcome, "match");
    assert.equal(r.result.style, "Secession");
    assert.equal(r.result.details.length, 3);
    assert.equal(r.result.details[2].raw_text, "ÉPÜLT 1911");
  });
  test("the rejection example passes the validator as no_match", () => {
    const r = parseAndValidate(JSON.stringify(FEW_SHOT_EXAMPLES[1].output));
    assert.equal(r.ok, true);
    assert.equal(r.outcome, "no_match");
    assert.deepEqual(r.result.details, []);
  });
});

describe("response schema", () => {
  test("enums match the validator", () => {
    assert.deepEqual(RESPONSE_JSON_SCHEMA.properties.style.anyOf[0].enum, [...STYLES]);
    assert.deepEqual(RESPONSE_JSON_SCHEMA.properties.details.items.properties.type.enum, [...DETAIL_TYPES]);
    assert.deepEqual(RESPONSE_JSON_SCHEMA.properties.image_assessment.enum, [...IMAGE_ASSESSMENTS]);
  });
  test("is strict-mode compatible: every object closed, every property required", () => {
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      }
      for (const v of Object.values(node)) visit(v);
    };
    visit(RESPONSE_JSON_SCHEMA);
  });
});

describe("repair prompt", () => {
  test("includes the error and the previous answer, and truncates long output", () => {
    const p = buildRepairPrompt("x".repeat(5000), '"style" must be one of ...');
    assert.ok(p.startsWith(USER_PROMPT));
    assert.match(p, /"style" must be one of/);
    assert.ok(p.length < 2500);
    assert.match(p, /x…/);
  });
});
