import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildAnthropicRequest, createAnthropicProvider } from "../src/providers/anthropic.js";
import { buildGeminiRequest, createGeminiProvider } from "../src/providers/gemini.js";
import { getProvider, providerForModel, resolveProviderConfig } from "../src/providers/index.js";
import { buildOpenAIRequest, createOpenAIProvider } from "../src/providers/openai.js";
import { RESPONSE_JSON_SCHEMA } from "../prompts.js";

const KEY = "test-key-not-real";
const pick = (env, options) => {
  const { name, model } = resolveProviderConfig(options, env);
  return `${name}/${model}`;
};

describe("provider selection", () => {
  test("defaults per key", () => {
    assert.equal(pick({ GEMINI_API_KEY: KEY }), "gemini/gemini-2.5-flash");
    assert.equal(pick({ OPENAI_API_KEY: KEY }), "openai/gpt-4o-mini");
    assert.equal(pick({ ANTHROPIC_API_KEY: KEY }), "anthropic/claude-sonnet-5-5");
  });
  test("several keys: Gemini → OpenAI → Anthropic", () => {
    assert.equal(pick({ GEMINI_API_KEY: KEY, OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: KEY }), "gemini/gemini-2.5-flash");
    assert.equal(pick({ OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: KEY }), "openai/gpt-4o-mini");
  });
  test("VISION_MODEL picks its provider when that key is present", () => {
    assert.equal(
      pick({ ANTHROPIC_API_KEY: KEY, GEMINI_API_KEY: KEY, VISION_MODEL: "claude-opus-5-5" }),
      "anthropic/claude-opus-5-5",
    );
    assert.equal(pick({ GEMINI_API_KEY: KEY, VISION_MODEL: "claude-opus-5-5" }), "gemini/gemini-2.5-flash");
  });
  test("explicit VISION_PROVIDER / options.provider win", () => {
    assert.equal(pick({ ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: KEY, VISION_PROVIDER: "openai" }), "openai/gpt-4o-mini");
    assert.equal(pick({ ANTHROPIC_API_KEY: KEY }, { provider: "anthropic", model: "claude-haiku-5-5" }), "anthropic/claude-haiku-5-5");
  });
  test("mock switches", () => {
    assert.equal(pick({ MOCK_VISION: "true", GEMINI_API_KEY: KEY }), "mock/mock-v1");
    assert.equal(pick({}, { mock: true }), "mock/mock-v1");
    assert.equal(pick({ MOCK_VISION: "1", GEMINI_API_KEY: KEY }, { mock: false }), "gemini/gemini-2.5-flash");
  });
  test("missing or blank keys and unknown providers throw NO_PROVIDER", () => {
    assert.throws(() => resolveProviderConfig({}, {}), { reason: "NO_PROVIDER" });
    assert.throws(() => resolveProviderConfig({}, { ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "  " }), { reason: "NO_PROVIDER" });
    assert.throws(() => resolveProviderConfig({}, { VISION_PROVIDER: "openai", GEMINI_API_KEY: KEY }), /OPENAI_API_KEY/);
    assert.throws(() => resolveProviderConfig({ provider: "llava" }, { GEMINI_API_KEY: KEY }), { reason: "NO_PROVIDER" });
  });
  test("providerForModel", () => {
    assert.equal(providerForModel("claude-sonnet-5-5"), "anthropic");
    assert.equal(providerForModel("gemini-2.5-flash"), "gemini");
    assert.equal(providerForModel("gpt-4o-mini"), "openai");
    assert.equal(providerForModel("o4-mini"), "openai");
    assert.equal(providerForModel("llava-13b"), null);
  });
});

const image = { base64: "AAAA", mimeType: "image/jpeg" };
const args = { systemPrompt: "SYS", userPrompt: "USER", image, schema: RESPONSE_JSON_SCHEMA };

describe("request builders", () => {
  test("Anthropic (Sonnet 5.5): structured output, low effort, cached system, refusal fallbacks", () => {
    const { params, useBeta } = buildAnthropicRequest({ model: "claude-sonnet-5-5", ...args });
    assert.equal(useBeta, true);
    assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(params.fallbacks, "default");
    assert.equal(params.output_config.effort, "low");
    assert.equal(params.output_config.format.type, "json_schema");
    assert.equal(params.output_config.format.schema, RESPONSE_JSON_SCHEMA);
    assert.deepEqual(params.system[0], { type: "text", text: "SYS", cache_control: { type: "ephemeral" } });
    assert.deepEqual(params.messages[0].content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    assert.equal("temperature" in params, false);
    assert.equal("thinking" in params, false);
  });
  test("Anthropic: no fallbacks for Haiku 5.5, no effort for Haiku 4.5", () => {
    const haiku55 = buildAnthropicRequest({ model: "claude-haiku-5-5", ...args });
    assert.equal(haiku55.useBeta, false);
    assert.equal("fallbacks" in haiku55.params, false);
    assert.equal(haiku55.params.output_config.effort, "low");
    assert.equal("effort" in buildAnthropicRequest({ model: "claude-haiku-4-5", ...args }).params.output_config, false);
  });
  test("OpenAI: strict json_schema, data-URL image, temperature only for gpt-4*", () => {
    const p = buildOpenAIRequest({ model: "gpt-4o-mini", ...args });
    assert.equal(p.response_format.type, "json_schema");
    assert.equal(p.response_format.json_schema.strict, true);
    assert.equal(p.messages[1].content[1].image_url.url, "data:image/jpeg;base64,AAAA");
    assert.equal(p.temperature, 0);
    assert.equal("temperature" in buildOpenAIRequest({ model: "o4-mini", ...args }), false);
  });
  test("Gemini: JSON mode, inline image, thinking off for 2.5 Flash, abort signal wired", () => {
    const signal = new AbortController().signal;
    const r = buildGeminiRequest({ model: "gemini-2.5-flash", ...args, signal });
    assert.equal(r.config.responseMimeType, "application/json");
    assert.deepEqual(r.config.thinkingConfig, { thinkingBudget: 0 });
    assert.equal(r.config.abortSignal, signal);
    assert.equal(r.config.systemInstruction, "SYS");
    assert.deepEqual(r.contents[0].parts[0], { inlineData: { mimeType: "image/jpeg", data: "AAAA" } });
    assert.equal("thinkingConfig" in buildGeminiRequest({ model: "gemini-3-flash", ...args }).config, false);
  });
});

describe("provider construction (no network)", () => {
  test("SDK-backed providers construct with a key", () => {
    for (const p of [
      createAnthropicProvider({ apiKey: KEY, model: "claude-sonnet-5-5", effort: "low" }),
      createOpenAIProvider({ apiKey: KEY, model: "gpt-4o-mini" }),
      createGeminiProvider({ apiKey: KEY, model: "gemini-2.5-flash" }),
    ]) {
      assert.equal(typeof p.generate, "function");
    }
  });
  test("getProvider caches instances", async () => {
    const config = { name: "mock", model: "mock-v1" };
    assert.equal(await getProvider(config), await getProvider({ ...config }));
  });
});
