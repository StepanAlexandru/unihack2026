import { GoogleGenAI } from "@google/genai";
import { VisionError } from "../errors.js";

/**
 * Build the generateContent request. Pure, so it can be unit-tested.
 * Uses JSON mode without responseJsonSchema: the validator enforces the schema and retries once.
 * The prompt asks for box_2d [ymin, xmin, ymax, xmax] on 0-1000, Gemini's native box format.
 */
export function buildGeminiRequest({ model, systemPrompt, userPrompt, image, signal }) {
  const config = {
    systemInstruction: systemPrompt,
    responseMimeType: "application/json",
    temperature: 0,
    maxOutputTokens: 4096,
  };
  if (/^gemini-2\.5-flash/.test(model)) config.thinkingConfig = { thinkingBudget: 0 }; // lowest latency
  if (signal) config.abortSignal = signal;
  return {
    model,
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType: image.mimeType, data: image.base64 } }, { text: userPrompt }],
      },
    ],
    config,
  };
}

export function createGeminiProvider({ apiKey, model }) {
  const ai = new GoogleGenAI({ apiKey });
  return {
    name: "gemini",
    model,
    async generate({ systemPrompt, userPrompt, image, signal }) {
      const response = await ai.models.generateContent(
        buildGeminiRequest({ model, systemPrompt, userPrompt, image, signal }),
      );
      const blocked = response.promptFeedback?.blockReason;
      if (blocked) throw new VisionError(`Gemini blocked the request (${blocked})`, { reason: "REFUSAL" });
      return { text: response.text ?? "", usage: response.usageMetadata };
    },
  };
}
