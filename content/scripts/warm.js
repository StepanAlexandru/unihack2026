// Pre-warm the narration + audio cache for common Timișoara scans (both languages).
//   npm run warm            (uses ../.env; writes to AUDIO_CACHE_DIR, default <repo>/.cache/audio)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(HERE, '..', '..', '.env')); } catch { /* optional */ }

const { generateNarration } = await import('../index.js');
const { cacheDir } = await import('../tts.js');
const D = (id, type, label, raw_text = null) => ({ id, type, label, bbox: [0.1, 0.1, 0.2, 0.2], raw_text });

export const FIXTURES = [
  { name: 'contract M2 example', style: 'Secession', details: [D('det_1', 'mask', 'Secession Mask (Mascaron)'), D('det_2', 'inscription', 'Dated Inscription', 'ANNO 1910')] },
  { name: 'Secession, no details', style: 'Secession', details: [] },
  { name: 'Secession mask', style: 'Secession', details: [D('det_1', 'mask', 'Secession Mask (Mascaron)')] },
  { name: 'Secession peacock', style: 'Secession', details: [D('det_1', 'architectural_element', 'Peacock relief')] },
  { name: 'Baroque lion head', style: 'Baroque', details: [D('det_1', 'lion_head', 'Lion head')] },
  { name: 'Baroque, no details', style: 'Baroque', details: [] },
  { name: 'Iron guild tree', style: 'Baroque', details: [D('det_1', 'guild_symbol', 'Iron Guild Tree')] },
  { name: 'Eclectic, no details', style: 'Eclectic', details: [] },
  { name: 'Neoclassical, no details', style: 'Neoclassical', details: [] },
  { name: 'Brutalist, no details', style: 'Brutalist', details: [] },
];

console.log(`Warming ${FIXTURES.length * 2} narrations into ${cacheDir()}`);
for (const f of FIXTURES) for (const lang of ['en', 'ro']) {
  const t0 = performance.now();
  const r = await generateNarration({ style: f.style, details: f.details, lang });
  console.log(`  ${lang} ${f.name.padEnd(26)} ${r.audio_url || '(no audio: TTS failed)'}  ${r.duration_s}s  ${(performance.now() - t0).toFixed(0)} ms`);
}
