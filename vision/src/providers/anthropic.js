import Anthropic from "@anthropic-ai/sdk";
import { VisionError } from "../errors.js";

// Models that accept server-side refusal fallbacks (beta server-side-fallback-2026-07-01).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5-2"]);
// Older models that reject output_config.effort.
const NO_EFFORT_MODELS = /^claude-(sonnet-4-5|haiku-4-5|3)/;

/** Build the Messages API request. Pure, so it can be unit-tested. */
export function buildAnthropicRequest({ model, systemPrompt, userPrompt, image, schema, effort = "low" }) {
  const output_config = { format: { type: "json_schema", schema } };
  if (effort && !NO_EFFORT_MODELS.test(model)) output_config.effort = effort; // low effort keeps latency down

  const params = {
    model,
    max_tokens: 16000,
    // The system prompt is identical on every call; cache it (it is a no-op if below the minimum size).
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.base64 } },
          { type: "text", text: userPrompt },
        ],
      },
    ],
    output_config,
  };

  const useBeta = FALLBACK_MODELS.has(model);
  if (useBeta) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return { params, useBeta };
}

export function createAnthropicProvider({ apiKey, model, effort }) {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  return {
    name: "anthropic",
    model,
    async generate({ systemPrompt, userPrompt, image, schema, signal }) {
      const { params, useBeta } = buildAnthropicRequest({ model, systemPrompt, userPrompt, image, schema, effort });
      const response = useBeta
        ? await client.beta.messages.create(params, { signal })
        : await client.messages.create(params, { signal });
      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category ?? "unspecified";
        throw new VisionError(`Model declined to analyze the image (${category})`, { reason: "REFUSAL" });
      }
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      return { text, usage: response.usage };
    },
  };
}
