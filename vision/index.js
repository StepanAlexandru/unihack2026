/**
 * Module 2: AI Vision. Public entry point (docs/contracts.md §4).
 *
 *   import { analyzeImage } from "../vision/index.js";
 *   const result = await analyzeImage(rawBase64);   // → { style, confidence, details }
 *
 * analyzeImage() resolves to the contract VisionResult. It rejects with a VisionError whose `code` is
 * "INVALID_INPUT" (bad image) or "TIMEOUT" (over budget); any other failure has no `code`, which Module 4
 * maps to TIMEOUT. See README.md for options and behaviour.
 */
import { performance } from "node:perf_hooks";
import { buildRepairPrompt, buildSystemPrompt, RESPONSE_JSON_SCHEMA, USER_PROMPT } from "./prompts.js";
import { VisionError } from "./src/errors.js";
import { decodeImage } from "./src/image.js";
import { getProvider, resolveProviderConfig } from "./src/providers/index.js";
import { DEFAULT_MIN_CONFIDENCE, parseAndValidate } from "./validator.js";

export { checkVisionResult, DETAIL_TYPES, STYLES } from "./validator.js";
export { VisionError } from "./src/errors.js";

export const DEFAULT_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2; // first try + one repair retry

/**
 * @param {string} imageBase64  raw base64 JPEG/PNG/WebP (a data URL is tolerated)
 * @param {object} [options]    see analyzeImageDetailed
 * @returns {Promise<{style: string|null, confidence: number, details: object[]}>}
 */
export async function analyzeImage(imageBase64, options = {}) {
  const { result } = await analyzeImageDetailed(imageBase64, options);
  return result;
}

/**
 * Same as analyzeImage, but also returns diagnostics for logging and the benchmark.
 *
 * @param {string} imageBase64
 * @param {object} [options]
 * @param {number}  [options.timeoutMs=8000]          overall budget, including the retry
 * @param {number}  [options.minConfidence=0.55]      below this, details are suppressed
 * @param {boolean} [options.nullStyleBelowThreshold=false] also set style to null below the threshold
 * @param {string|object} [options.provider]          "gemini" | "openai" | "anthropic" | "mock", or a provider object
 * @param {string}  [options.model]                   model id override
 * @param {boolean} [options.mock]                    force (true) or forbid (false) the mock provider
 * @param {string}  [options.mockScenario]            mock only: secession | baroque | low_confidence | no_match
 * @param {string}  [options.effort="low"]            Claude only: output_config.effort
 * @param {AbortSignal} [options.signal]              external cancellation (reported as TIMEOUT)
 * @param {object}  [options.env=process.env]         environment used for provider selection
 * @returns {Promise<{ result: object, meta: object }>}
 */
export async function analyzeImageDetailed(imageBase64, options = {}) {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const nullStyleBelowThreshold = options.nullStyleBelowThreshold === true;

  const image = decodeImage(imageBase64); // throws INVALID_INPUT before any provider call
  const provider =
    options.provider && typeof options.provider === "object"
      ? options.provider
      : await getProvider(resolveProviderConfig(options, options.env ?? process.env));

  const attempts = [];
  const baseMeta = () => ({
    provider: provider.name,
    model: provider.model,
    latency_ms: elapsed(),
    timeout_ms: timeoutMs,
    attempts: attempts.map((a) => ({ ...a })),
  });
  const fail = (error) => {
    error.meta = baseMeta();
    return error;
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const systemPrompt = buildSystemPrompt({ minConfidence });
    let userPrompt = USER_PROMPT;

    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const attemptStart = performance.now();
      let response;
      try {
        response = await withAbort(
          () =>
            provider.generate({
              systemPrompt,
              userPrompt,
              image,
              schema: RESPONSE_JSON_SCHEMA,
              signal: controller.signal,
              hints: { mockScenario: options.mockScenario },
            }),
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          throw fail(new VisionError(`Vision analysis exceeded ${timeoutMs} ms`, { code: "TIMEOUT", reason: "TIMEOUT" }));
        }
        if (err instanceof VisionError) throw fail(err);
        const detail = String(err?.message ?? err).slice(0, 300);
        throw fail(new VisionError(`${provider.name} request failed: ${detail}`, { reason: "PROVIDER_ERROR", cause: err }));
      }

      const text = typeof response === "string" ? response : response?.text;
      const checked = parseAndValidate(text, { minConfidence, nullStyleBelowThreshold });
      attempts.push({
        attempt: n,
        latency_ms: Math.round(performance.now() - attemptStart),
        valid: checked.ok,
        ...(checked.ok ? {} : { error: checked.error }),
      });

      if (checked.ok) {
        return {
          result: checked.result,
          meta: {
            ...baseMeta(),
            outcome: checked.outcome,
            first_attempt_valid: attempts[0].valid,
            min_confidence: minConfidence,
            image_assessment: checked.info.image_assessment,
            evidence: checked.info.evidence,
            warnings: checked.info.warnings,
          },
        };
      }

      const remaining = timeoutMs - (performance.now() - startedAt);
      if (n === MAX_ATTEMPTS || remaining < minRetryBudget(timeoutMs)) {
        const why = n === MAX_ATTEMPTS ? "after retry" : "and no time is left to retry";
        throw fail(new VisionError(`Model output failed validation ${why}: ${checked.error}`, { reason: "INVALID_MODEL_OUTPUT" }));
      }
      userPrompt = buildRepairPrompt(text, checked.error);
    }
    throw new Error("unreachable");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Don't start a retry that cannot finish: require 20% of the budget, capped at 1.5 s. */
function minRetryBudget(timeoutMs) {
  return Math.min(1500, timeoutMs * 0.2);
}

/** Run fn() but reject as soon as `signal` aborts, even if the provider ignores the signal. */
function withAbort(fn, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  const work = Promise.resolve().then(fn);
  work.catch(() => {}); // a late rejection after abort must not become an unhandled rejection
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
