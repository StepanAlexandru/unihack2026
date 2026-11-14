/**
 * Provider selection. A provider is { name, model, generate(args) → Promise<{ text }> } where args are
 * { systemPrompt, userPrompt, image: { base64, mimeType }, schema, signal, hints }.
 *
 * Selection order (first match wins):
 *   1. options.mock === true, or env MOCK_VISION=true          → "mock"
 *   2. options.provider / env VISION_PROVIDER                  → that provider (its key must be set)
 *   3. options.model / env VISION_MODEL names a provider whose key is set → that provider + model
 *   4. first provider with a key, in order GEMINI → OPENAI → ANTHROPIC
 */
import { VisionError } from "../errors.js";

export const PROVIDER_NAMES = Object.freeze(["gemini", "openai", "anthropic"]);

export const DEFAULT_MODELS = Object.freeze({
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5-5",
  mock: "mock-v1",
});

export const API_KEY_ENV = Object.freeze({
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
});

export function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

/** Infer the provider from a model id, or null if unrecognized. */
export function providerForModel(model) {
  if (typeof model !== "string") return null;
  const m = model.trim().toLowerCase();
  if (m.startsWith("claude-")) return "anthropic";
  if (m.startsWith("gemini-")) return "gemini";
  if (/^(gpt-|o\d|chatgpt-)/.test(m)) return "openai";
  return null;
}

function keyFor(name, env) {
  const v = env[API_KEY_ENV[name]];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Resolve which provider + model to use. Pure: reads only `options` and `env`.
 * @returns {{ name: string, model: string, apiKey?: string, effort?: string }}
 * @throws {VisionError} reason NO_PROVIDER
 */
export function resolveProviderConfig(options = {}, env = process.env) {
  const effort = options.effort ?? "low";
  if (options.mock === true || (options.mock !== false && isTruthy(env.MOCK_VISION))) {
    return { name: "mock", model: DEFAULT_MODELS.mock, latencyMs: options.mockLatencyMs ?? 0 };
  }

  const explicit = typeof options.provider === "string" ? options.provider : env.VISION_PROVIDER?.trim() || null;
  const modelHint = options.model ?? (env.VISION_MODEL?.trim() || null);
  const hintedProvider = providerForModel(modelHint);

  let name;
  if (explicit) {
    name = explicit.toLowerCase();
    if (name === "mock") return { name: "mock", model: DEFAULT_MODELS.mock, latencyMs: options.mockLatencyMs ?? 0 };
    if (!PROVIDER_NAMES.includes(name)) {
      throw new VisionError(`Unknown vision provider "${explicit}" (expected ${PROVIDER_NAMES.join(", ")} or mock)`, {
        reason: "NO_PROVIDER",
      });
    }
    if (!keyFor(name, env)) {
      throw new VisionError(`Vision provider "${name}" selected but ${API_KEY_ENV[name]} is not set`, {
        reason: "NO_PROVIDER",
      });
    }
  } else if (hintedProvider && keyFor(hintedProvider, env)) {
    name = hintedProvider;
  } else {
    name = PROVIDER_NAMES.find((p) => keyFor(p, env));
  }

  if (!name) {
    throw new VisionError(
      "No vision provider configured: set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY, or MOCK_VISION=true",
      { reason: "NO_PROVIDER" },
    );
  }
  const model = hintedProvider === name ? modelHint : DEFAULT_MODELS[name];
  return { name, model, apiKey: keyFor(name, env), effort };
}

const cache = new Map();

/** Create (or reuse) a provider instance for a resolved config. SDKs are imported lazily. */
export async function getProvider(config) {
  const key = [config.name, config.model, config.apiKey ?? "", config.effort ?? "", config.latencyMs ?? 0].join("|");
  if (!cache.has(key)) cache.set(key, createProvider(config));
  try {
    return await cache.get(key);
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

async function createProvider(config) {
  switch (config.name) {
    case "mock":
      return (await import("./mock.js")).createMockProvider(config);
    case "gemini":
      return (await import("./gemini.js")).createGeminiProvider(config);
    case "openai":
      return (await import("./openai.js")).createOpenAIProvider(config);
    case "anthropic":
      return (await import("./anthropic.js")).createAnthropicProvider(config);
    default:
      throw new VisionError(`Unknown vision provider "${config.name}"`, { reason: "NO_PROVIDER" });
  }
}
