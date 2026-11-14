// CLI: print a NarrationResult for an M2 VisionResult.
//   npm run try                         → contract M2 example, EN
//   npm run try -- path/to/vision.json --lang ro
//   npm run try -- --style Baroque --detail "lion_head:Lion head" --detail "inscription:Date:ANNO 1745" --lang ro
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(HERE, '..', '..', '.env')); } catch { /* optional */ }
process.env.CONTENT_DEBUG ??= '1';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const lang = opt('lang') || 'en';
let input;
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (opt('style')) {
  const details = args.flatMap((a, i) => (a === '--detail' ? [args[i + 1]] : [])).map((spec, k) => {
    const [type, label, ...raw] = spec.split(':');
    return { id: `det_${k + 1}`, type, label, bbox: [0.1, 0.1, 0.2, 0.2], raw_text: raw.length ? raw.join(':') : null };
  });
  input = { style: opt('style'), details };
} else {
  input = JSON.parse(readFileSync(file || join(HERE, '..', 'mocks', 'm2_example.json'), 'utf8'));
}

const { generateNarration } = await import('../index.js');
const t0 = performance.now();
const result = await generateNarration({ style: input.style, details: input.details ?? [], lang });
console.log(JSON.stringify(result, (k, v) => (k === 'audio_url' && typeof v === 'string' && v.length > 120 ? `${v.slice(0, 60)}…(${v.length} chars)` : v), 2));
console.error(`\n${(performance.now() - t0).toFixed(1)} ms`);
