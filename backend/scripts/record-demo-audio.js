#!/usr/bin/env node
// Pre-record hero narration audio for the offline demo, once M3 (CONTENT_MODE=live) has working TTS.
//   1. Start the backend with CONTENT_MODE=live   (npm start)
//   2. node scripts/record-demo-audio.js [--base http://localhost:3001]
// For every hero in demo/fixtures-src/narrations.json and each language it calls POST /narrate,
// copies the resulting mp3 from AUDIO_CACHE_DIR into demo/audio/<id>-<lang>.mp3, and stores M3's
// (knowledge-base grounded) text so the recorded audio and the fixture text always match.
// It then rebuilds fixtures + offline cache (npm run build:demo). Review the diff before committing.
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, BACKEND_DIR, loadConfig } from '../src/config.js';
import { wordCount } from '../src/contract.js';

try { process.loadEnvFile(path.join(REPO_ROOT, '.env')); } catch { /* optional */ }
const config = loadConfig();
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : `http://localhost:${config.port}`;
const srcFile = path.join(REPO_ROOT, 'demo', 'fixtures-src', 'narrations.json');
const src = JSON.parse(readFileSync(srcFile, 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'demo', 'test-set', 'manifest.json'), 'utf8'));
const outDir = path.join(REPO_ROOT, 'demo', 'audio');
mkdirSync(outDir, { recursive: true });

const health = await (await fetch(`${base}/health`)).json();
if (health.content_active !== 'live') {
  console.error(`✗ backend at ${base} reports content_active=${health.content_active}. Start it with CONTENT_MODE=live.`);
  process.exit(1);
}

let recorded = 0;
for (const [id, hero] of Object.entries(src.heroes)) {
  const c = manifest.cases.find((x) => x.id === id);
  const details = c.expected_details.map(({ id: did, label, type, bbox, raw_text }) => ({ id: did, label, type, bbox, raw_text }));
  for (const lang of ['ro', 'en']) {
    const res = await fetch(`${base}/narrate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: c.expected_style, details, lang }) });
    const body = await res.json();
    const m = /^\/audio\/cache\/([A-Za-z0-9_-]+\.mp3)$/.exec(body.audio_url ?? '');
    if (!res.ok || !m) { console.warn(`! ${id}.${lang}: no cached mp3 (${res.status} ${body.error?.code ?? body.audio_url})`); continue; }
    const from = path.join(config.audioCacheDir, m[1]);
    if (!existsSync(from)) { console.warn(`! ${id}.${lang}: ${from} missing`); continue; }
    if (wordCount(body.text) < 35 || wordCount(body.text) > 40) console.warn(`! ${id}.${lang}: M3 text has ${wordCount(body.text)} words`);
    copyFileSync(from, path.join(outDir, `${id}-${lang}.mp3`));
    hero[lang] = { text: body.text, history: body.history, why_it_matters: body.why_it_matters };
    recorded++;
    console.log(`✓ ${id}.${lang}`);
  }
}
writeFileSync(srcFile, JSON.stringify(src, null, 2) + '\n');
execFileSync(process.execPath, [path.join(BACKEND_DIR, 'scripts', 'build-demo-assets.js')], { stdio: 'inherit' });
console.log(`Recorded ${recorded} clip(s) into demo/audio/. Review \`git diff demo/\` before committing.`);
