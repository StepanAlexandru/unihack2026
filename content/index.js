// M3 public entry point. Contract: docs/contracts.md §5.
//   export async function generateNarration({ style, details, lang }): Promise<NarrationResult>
import { loadKB } from './kb/loader.js';
import { retrieve } from './retriever.js';
import { narrate } from './narrator.js';
import { pickLLM } from './lib/llm.js';
import { inputProblems } from './lib/shape.js';
import { wordCount } from './lib/text.js';
import {
  narrationCacheKey, readNarrationCache, writeNarrationCache, textToAudio, ttsConfig, detailSignature,
} from './tts.js';

const inflight = new Map();

function invalid(message) {
  const err = new Error(message);
  err.code = 'INVALID_INPUT';
  return err;
}

const estimate = (text) => Math.round((wordCount(text) / 2.5) * 10) / 10;

function fingerprint(llm) {
  const t = ttsConfig();
  return { kb: loadKB().version, llm: llm ? `${llm.name}:${llm.model}` : 'template', tts: `${t.provider}|${t.voice.ro}|${t.voice.en}|${t.fallback}` };
}

/** Re-attach cached translations to the caller's detail ids (the cache key ignores ids). */
function withCurrentIds(entry, details) {
  const bySig = new Map(entry.translations.map((t) => [t.sig, t]));
  const translations = details
    .filter((d) => d.raw_text != null)
    .map((d) => ({ detail_id: d.id, original: d.raw_text, translated: bySig.get(detailSignature(d))?.translated ?? d.raw_text }));
  return { ...entry.result, enrichments: { ...entry.result.enrichments, translations } };
}

async function build(input, key, llm) {
  const ctx = await retrieve(input, { llm });
  const narration = await narrate(ctx, { llm });
  const audio = await textToAudio(narration.text, input.lang, { estimate: estimate(narration.text) });

  const result = {
    text: narration.text,
    audio_url: audio.audio_url,
    duration_s: audio.duration_s,
    enrichments: {
      building_name: ctx.building?.name ?? null,
      architect: ctx.building?.architect ?? null,
      historical_context: ctx.historical_context,
      why_it_matters: ctx.why_it_matters,
      translations: ctx.translations.map((t) => ({ detail_id: t.detail_id, original: t.original, translated: t.translated })),
    },
  };
  const sigById = new Map(input.details.map((d) => [d.id, detailSignature(d)]));
  writeNarrationCache(key, {
    result,
    translations: ctx.translations.map((t) => ({ sig: sigById.get(t.detail_id), translated: t.translated })),
    meta: { source: narration.source, tts: audio.tts, created_at: new Date().toISOString(), rejected: narration.rejected ?? null },
  });
  if (process.env.CONTENT_DEBUG) console.error('[content]', { key, source: narration.source, tts: audio.tts, rejected: narration.rejected, tts_error: audio.error });
  return result;
}

/**
 * @param {{ style: string, details: object[], lang: 'ro'|'en' }} input
 */
export async function generateNarration(input) {
  const problems = inputProblems(input);
  if (problems.length) throw invalid(`Invalid narration input: ${problems.join('; ')}`);
  const { style, lang } = input;
  const details = input.details.map((d) => ({ id: d.id, label: d.label ?? '', type: d.type, raw_text: d.raw_text ?? null }));

  const llm = pickLLM();
  const key = narrationCacheKey({ style, details, lang }, fingerprint(llm));

  const hit = readNarrationCache(key);
  if (hit) {
    // text cached but TTS failed last time: retry audio only (still grounded, still deterministic text)
    if (hit.result.audio_url === '' && ttsConfig().provider !== 'none') {
      const audio = await textToAudio(hit.result.text, lang, { estimate: estimate(hit.result.text) });
      if (audio.audio_url) {
        hit.result = { ...hit.result, audio_url: audio.audio_url, duration_s: audio.duration_s };
        writeNarrationCache(key, hit);
      }
    }
    return withCurrentIds(hit, details);
  }

  // collapse concurrent identical requests (e.g. double taps, RO/EN prefetch)
  if (!inflight.has(key)) inflight.set(key, build({ style, details, lang }, key, llm).finally(() => inflight.delete(key)));
  await inflight.get(key);
  return withCurrentIds(readNarrationCache(key), details);
}

export default generateNarration;
