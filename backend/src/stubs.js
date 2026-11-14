// Built-in, contract-compliant stand-ins for M2 analyzeImage() and M3 generateNarration().
// Used when VISION_MODE / CONTENT_MODE = mock (or USE_STUBS=true, or a live module failed
// to load). They never import /vision or /content (CLAUDE.md §6).
//
// Failure paths can be exercised with the `x-mock-scenario` request header, which the app
// forwards ONLY to these stubs (real modules never see it):
//   no_match | low_confidence | vision_throw | vision_invalid | vision_hang | messy_output
//   narration_throw | narration_hang
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BACKEND_DIR } from './config.js';
import { STYLE_NARRATIONS, translatePhrase } from './style-narrations.js';
import { wordCount } from './contract.js';

const examples = JSON.parse(readFileSync(path.join(BACKEND_DIR, 'mocks', 'contract-examples.json'), 'utf8'));
const clone = (v) => structuredClone(v);
const hang = () => new Promise(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function stubAnalyzeImage(image_base64, { scenario = '', latencyMs = 0 } = {}) {
  if (latencyMs) await sleep(latencyMs);
  switch (scenario) {
    case 'no_match':
      return { style: null, confidence: 0.12, details: [] };
    case 'low_confidence':
      return { ...clone(examples.vision_result), confidence: 0.41 };
    case 'vision_throw':
      throw new Error('stub: simulated provider failure');
    case 'vision_invalid': {
      const err = new Error('stub: undecodable image');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    case 'vision_hang':
      return hang();
    case 'messy_output': // exercises the §6 step-5 sanitizer
      return {
        style: 'Baroque',
        confidence: 0.91,
        details: [
          { id: 'det_1', label: 'Overflowing Portal', type: 'architectural_element', bbox: [0.8, 0.9, 0.5, 0.4], raw_text: null },
          { id: 'det_2', label: 'Negative Box', type: 'plaque', bbox: [-0.2, 0.1, 0.3, 0.2], raw_text: 'ANNO 1774' },
          { id: 'det_3', label: 'Bad Type', type: 'gargoyle', bbox: [0.1, 0.1, 0.1, 0.1], raw_text: null },
          { id: 'det_4', label: 'Zero Width', type: 'mask', bbox: [0.1, 0.1, 0, 0.1], raw_text: null },
          'not-an-object',
          ...Array.from({ length: 6 }, (_, i) => ({ id: `det_x${i}`, label: `Window ${i}`, type: 'architectural_element', bbox: [0.05 * i, 0.5, 0.05, 0.1], raw_text: null })),
        ],
      };
    default:
      return clone(examples.vision_result);
  }
}

export async function stubGenerateNarration({ style, details, lang }, { scenario = '', latencyMs = 0 } = {}) {
  if (latencyMs) await sleep(latencyMs);
  if (scenario === 'narration_throw') throw new Error('stub: simulated TTS/LLM failure');
  if (scenario === 'narration_hang') return hang();

  // Exact contract example for the exact contract input, so M1 sees identical text either way.
  const ex = examples.narration_result_en;
  const isContractInput = lang === 'en' && style === 'Secession' && details.some((d) => d.raw_text === 'ANNO 1910') && details.some((d) => d.type === 'mask');
  const base = STYLE_NARRATIONS[style][lang];
  const text = isContractInput ? ex.text : base.text;
  return {
    text,
    audio_url: '', // stubs have no TTS: M1 falls back to speechSynthesis (contract §5)
    duration_s: Math.round((wordCount(text) / 2.5) * 10) / 10,
    enrichments: {
      building_name: null,
      architect: null,
      historical_context: isContractInput ? ex.enrichments.historical_context : base.history,
      why_it_matters: isContractInput ? ex.enrichments.why_it_matters : base.why_it_matters,
      translations: details
        .filter((d) => typeof d.raw_text === 'string')
        .map((d) => ({ detail_id: d.id, original: d.raw_text, translated: translatePhrase(d.raw_text, lang) })),
    },
  };
}
