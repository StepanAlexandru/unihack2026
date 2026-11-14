import OpenAI from "openai";
import { VisionError } from "../errors.js";

/** Build the Chat Completions request. Pure, so it can be unit-tested. */
export function buildOpenAIRequest({ model, systemPrompt, userPrompt, image, schema }) {
  const params = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          // "high" detail: ornaments are small relative to a full facade
          { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}`, detail: "high" } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "heritage_vision_result", strict: true, schema },
    },
    max_completion_tokens: 4096,
  };
  if (/^gpt-4/.test(model)) params.temperature = 0; // non-reasoning models only
  return params;
}

export function createOpenAIProvider({ apiKey, model }) {
  const client = new OpenAI({ apiKey, maxRetries: 1 });
  return {
    name: "openai",
    model,
    async generate({ systemPrompt, userPrompt, image, schema, signal }) {
      const response = await client.chat.completions.create(
        buildOpenAIRequest({ model, systemPrompt, userPrompt, image, schema }),
        { signal },
      );
      const message = response.choices?.[0]?.message;
      if (message?.refusal) throw new VisionError(`Model declined to analyze the image`, { reason: "REFUSAL" });
      return { text: message?.content ?? "", usage: response.usage };
    },
  };
}
