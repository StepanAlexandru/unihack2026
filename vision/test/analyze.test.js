import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { analyzeImage, analyzeImageDetailed, checkVisionResult, VisionError } from "../index.js";
import { rawOutput, scriptedProvider } from "../src/dev/fake-provider.js";
import { syntheticPng } from "../src/dev/png.js";

const IMG = syntheticPng(1).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** docs/contracts.md §4 example output. */
const CONTRACT_EXAMPLE = {
  style: "Secession",
  confidence: 0.87,
  details: [
    { id: "det_1", label: "Secession Mask (Mascaron)", type: "mask", bbox: [0.32, 0.18, 0.14, 0.16], raw_text: null },
    { id: "det_2", label: "Dated Inscription", type: "inscription", bbox: [0.4, 0.62, 0.22, 0.06], raw_text: "ANNO 1910" },
  ],
};

describe("analyzeImage: happy path", () => {
  test("returns a contract-valid VisionResult", async () => {
    const provider = scriptedProvider([rawOutput()]);
    const result = await analyzeImage(IMG, { provider });
    assert.deepEqual(checkVisionResult(result), []);
    assert.equal(result.style, "Secession");
    assert.deepEqual(result.details[0].bbox, [0.2, 0.1, 0.2, 0.2]);
    assert.equal(provider.calls.length, 1);
  });

  test("sends the image, system prompt and schema to the provider", async () => {
    const provider = scriptedProvider([rawOutput()]);
    await analyzeImage(IMG, { provider });
    const call = provider.calls[0];
    assert.equal(call.image.mimeType, "image/png");
    assert.equal(call.image.base64, IMG);
    assert.match(call.systemPrompt, /Timișoara/);
    assert.equal(call.schema.type, "object");
  });

  test("accepts a data URL", async () => {
    const result = await analyzeImage(`data:image/png;base64,${IMG}`, { provider: scriptedProvider([rawOutput()]) });
    assert.equal(result.style, "Secession");
  });

  test("detailed variant reports meta", async () => {
    const { meta } = await analyzeImageDetailed(IMG, { provider: scriptedProvider([rawOutput()]) });
    assert.equal(meta.outcome, "match");
    assert.equal(meta.first_attempt_valid, true);
    assert.equal(meta.attempts.length, 1);
    assert.equal(meta.provider, "fake");
  });
});

describe("analyzeImage: retry on malformed output", () => {
  test("malformed JSON → one repair retry that includes the error and previous answer", async () => {
    const provider = scriptedProvider(["I think this is a Secession building!", rawOutput()]);
    const { result, meta } = await analyzeImageDetailed(IMG, { provider });
    assert.equal(result.style, "Secession");
    assert.equal(provider.calls.length, 2);
    assert.equal(meta.first_attempt_valid, false);
    assert.equal(meta.attempts[0].valid, false);
    assert.match(provider.calls[1].userPrompt, /could not be used/);
    assert.match(provider.calls[1].userPrompt, /I think this is a Secession building!/);
    assert.match(provider.calls[1].userPrompt, /not JSON/);
  });

  test("schema violation → retry with the validation error", async () => {
    const provider = scriptedProvider([rawOutput({ style: "Gothic" }), rawOutput()]);
    const result = await analyzeImage(IMG, { provider });
    assert.equal(result.style, "Secession");
    assert.match(provider.calls[1].userPrompt, /"style" must be one of/);
  });

  test("malformed twice → INVALID_MODEL_OUTPUT with no contract code (M4 maps to TIMEOUT)", async () => {
    const provider = scriptedProvider(["nope", "still nope"]);
    await assert.rejects(analyzeImage(IMG, { provider }), (err) => {
      assert.ok(err instanceof VisionError);
      assert.equal(err.reason, "INVALID_MODEL_OUTPUT");
      assert.equal(err.code, undefined);
      assert.equal(err.meta.attempts.length, 2);
      return true;
    });
    assert.equal(provider.calls.length, 2);
  });

  test("no retry when the remaining budget is too small", async () => {
    const provider = scriptedProvider([async () => (await sleep(850), "garbage"), rawOutput()]);
    await assert.rejects(analyzeImage(IMG, { provider, timeoutMs: 1000 }), { reason: "INVALID_MODEL_OUTPUT" });
    assert.equal(provider.calls.length, 1);
  });
});

describe("analyzeImage: low-confidence and rejection fallback", () => {
  test("confidence < 0.55 → details [] and style kept (M4 returns LOW_CONFIDENCE)", async () => {
    const { result, meta } = await analyzeImageDetailed(IMG, { provider: scriptedProvider([rawOutput({ confidence: 0.4 })]) });
    assert.deepEqual(result, { style: "Secession", confidence: 0.4, details: [] });
    assert.equal(meta.outcome, "low_confidence");
  });

  test("nullStyleBelowThreshold option → { style: null, confidence, details: [] }", async () => {
    const result = await analyzeImage(IMG, {
      provider: scriptedProvider([rawOutput({ confidence: 0.4 })]),
      nullStyleBelowThreshold: true,
    });
    assert.deepEqual(result, { style: null, confidence: 0.4, details: [] });
  });

  test("custom minConfidence is honored", async () => {
    const result = await analyzeImage(IMG, { provider: scriptedProvider([rawOutput({ confidence: 0.7 })]), minConfidence: 0.8 });
    assert.deepEqual(result.details, []);
  });

  test("non-architecture image → style null, details []", async () => {
    const result = await analyzeImage(IMG, {
      provider: scriptedProvider([rawOutput({ image_assessment: "not_architecture", style: "Baroque" })]),
    });
    assert.equal(result.style, null);
    assert.deepEqual(result.details, []);
  });
});

describe("analyzeImage: timeouts and failures", () => {
  test("hanging provider → TIMEOUT within the budget, even if it ignores the abort signal", async () => {
    const started = Date.now();
    await assert.rejects(analyzeImage(IMG, { provider: scriptedProvider(["hang"]), timeoutMs: 150 }), (err) => {
      assert.equal(err.code, "TIMEOUT");
      assert.equal(err.reason, "TIMEOUT");
      return true;
    });
    assert.ok(Date.now() - started < 1500);
  });

  test("timeout during the retry → TIMEOUT", async () => {
    const provider = scriptedProvider(["bad", "hang"]);
    await assert.rejects(analyzeImage(IMG, { provider, timeoutMs: 300 }), { code: "TIMEOUT" });
    assert.equal(provider.calls.length, 2);
  });

  test("provider receives an AbortSignal that fires at the deadline", async () => {
    let seen;
    const provider = scriptedProvider([
      ({ signal }) =>
        new Promise((_, reject) => {
          seen = signal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ]);
    await assert.rejects(analyzeImage(IMG, { provider, timeoutMs: 100 }), { code: "TIMEOUT" });
    assert.equal(seen.aborted, true);
  });

  test("external abort signal → TIMEOUT", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(analyzeImage(IMG, { provider: scriptedProvider(["hang"]), signal: ac.signal }), { code: "TIMEOUT" });
  });

  test("provider error → PROVIDER_ERROR, no contract code", async () => {
    await assert.rejects(analyzeImage(IMG, { provider: scriptedProvider([new Error("503 overloaded")]) }), (err) => {
      assert.equal(err.reason, "PROVIDER_ERROR");
      assert.equal(err.code, undefined);
      assert.match(err.message, /503 overloaded/);
      return true;
    });
  });

  test("provider VisionError (refusal) passes through", async () => {
    const refusal = new VisionError("declined", { reason: "REFUSAL" });
    await assert.rejects(analyzeImage(IMG, { provider: scriptedProvider([refusal]) }), { reason: "REFUSAL" });
  });
});

describe("analyzeImage: input validation", () => {
  for (const [name, input] of [
    ["empty string", ""],
    ["non-string", 42],
    ["invalid base64", "%%% not base64 %%%"],
    ["base64 of text, not an image", Buffer.from("hello world ".repeat(10)).toString("base64")],
    ["image too small", Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")],
  ]) {
    test(`${name} → INVALID_INPUT without calling the provider`, async () => {
      const provider = scriptedProvider([rawOutput()]);
      await assert.rejects(analyzeImage(input, { provider }), { code: "INVALID_INPUT" });
      assert.equal(provider.calls.length, 0);
    });
  }

  test("no provider configured → NO_PROVIDER", async () => {
    await assert.rejects(analyzeImage(IMG, { env: {} }), (err) => {
      assert.equal(err.reason, "NO_PROVIDER");
      assert.equal(err.code, undefined);
      return true;
    });
  });
});

describe("analyzeImage: deterministic mock (MOCK_VISION=true)", () => {
  test("same image → same result, contract-valid", async () => {
    const a = await analyzeImage(IMG, { env: { MOCK_VISION: "true" } });
    const b = await analyzeImage(IMG, { env: { MOCK_VISION: "true" } });
    assert.deepEqual(a, b);
    assert.deepEqual(checkVisionResult(a), []);
  });

  test('"secession" scenario is exactly the contract §4 example', async () => {
    const result = await analyzeImage(IMG, { mock: true, mockScenario: "secession" });
    assert.deepEqual(result, CONTRACT_EXAMPLE);
  });

  test("no_match and low_confidence scenarios", async () => {
    assert.equal((await analyzeImage(IMG, { mock: true, mockScenario: "no_match" })).style, null);
    const low = await analyzeImageDetailed(IMG, { mock: true, mockScenario: "low_confidence" });
    assert.equal(low.meta.outcome, "low_confidence");
    assert.deepEqual(low.result.details, []);
  });

  test("mock latency respects the timeout", async () => {
    await assert.rejects(analyzeImage(IMG, { mock: true, mockLatencyMs: 500, timeoutMs: 100 }), { code: "TIMEOUT" });
  });
});
