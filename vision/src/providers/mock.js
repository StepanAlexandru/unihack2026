/**
 * Deterministic offline provider (MOCK_VISION=true). It returns RAW model JSON, so mock runs still
 * exercise the full parse → validate → guardrail pipeline. The scenario is chosen by
 * hints.mockScenario, or else by a hash of the image bytes (same image → same answer).
 *
 * The "secession" scenario normalizes to exactly the docs/contracts.md §4 example.
 */
import { createHash } from "node:crypto";

export const MOCK_SCENARIOS = Object.freeze({
  secession: {
    image_assessment: "facade",
    evidence: ["undulating gable", "stylized floral reliefs", "maiden mascaron"],
    style: "Secession",
    confidence: 0.87,
    details: [
      { label: "Secession Mask (Mascaron)", type: "mask", box_2d: [180, 320, 340, 460], raw_text: null },
      { label: "Dated Inscription", type: "inscription", box_2d: [620, 400, 680, 620], raw_text: "ANNO 1910" },
    ],
  },
  baroque: {
    image_assessment: "facade",
    evidence: ["segmental pediment", "giant pilasters", "ochre render"],
    style: "Baroque",
    confidence: 0.78,
    details: [
      { label: "Lion-head keystone", type: "lion_head", box_2d: [400, 450, 480, 530], raw_text: null },
      { label: "Segmental pediment", type: "architectural_element", box_2d: [120, 300, 220, 700], raw_text: null },
    ],
  },
  low_confidence: {
    image_assessment: "partial_facade",
    evidence: ["cropped cornice", "mixed revival ornament"],
    style: "Eclectic",
    confidence: 0.42,
    details: [{ label: "Possible guild sign", type: "guild_symbol", box_2d: [600, 300, 700, 400], raw_text: null }],
  },
  no_match: {
    image_assessment: "not_architecture",
    evidence: ["no building exterior visible"],
    style: null,
    confidence: 0.95,
    details: [],
  },
});

const ORDER = Object.keys(MOCK_SCENARIOS);

export function pickScenario(imageBase64, requested) {
  if (requested) {
    if (!MOCK_SCENARIOS[requested]) {
      throw new Error(`Unknown mock scenario "${requested}" (expected ${ORDER.join(", ")})`);
    }
    return requested;
  }
  const digest = createHash("sha256").update(imageBase64).digest();
  return ORDER[digest[0] % ORDER.length];
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });
}

export function createMockProvider({ model = "mock-v1", latencyMs = 0 } = {}) {
  return {
    name: "mock",
    model,
    async generate({ image, signal, hints = {} }) {
      const scenario = pickScenario(image.base64, hints.mockScenario);
      if (latencyMs > 0) await delay(latencyMs, signal);
      return { text: JSON.stringify(MOCK_SCENARIOS[scenario]), scenario };
    },
  };
}
