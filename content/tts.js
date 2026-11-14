// Text-to-speech + deterministic narration cache.
//
// Narration cache key = sha256(normalize(style) | sorted(type:label:raw_text) | lang | config fingerprint)
//   → <AUDIO_CACHE_DIR>/<key>.json  (served? no: M4 only serves *.mp3)
// Audio file name     = sha256(provider | voice | lang | text)  → <AUDIO_CACHE_DIR>/<hash>.mp3
//   → returned as "/audio/cache/<hash>.mp3" (contract §5, §9.1)
//
// Providers (TTS_PROVIDER): elevenlabs | openai | google | gtranslate | none.
// Empty TTS_PROVIDER → gtranslate (free, no key). A failing paid provider falls back to gtranslate
// unless TTS_FALLBACK=none. If every provider fails, audio_url is "" (contract: M1 uses speechSynthesis).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, stableStringify } from './lib/text.js';
import { concatMp3, mp3Duration } from './lib/mp3.js';

const CONTENT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CONTENT_DIR, '..');
const PUBLIC_PREFIX = '/audio/cache/';

export function cacheDir(env = process.env) {
  const v = env.AUDIO_CACHE_DIR || './.cache/audio';
  return isAbsolute(v) ? v : resolve(REPO_ROOT, v); // relative paths resolve against the repo root (CLAUDE.md §5)
}

export function ttsConfig(env = process.env) {
  const provider = (env.TTS_PROVIDER || 'gtranslate').toLowerCase();
  const voice = { ro: env.TTS_VOICE_RO || '', en: env.TTS_VOICE_EN || '' };
  const fallback = (env.TTS_FALLBACK || 'gtranslate').toLowerCase();
  const timeoutMs = Number(env.TTS_TIMEOUT_MS) || 7000;
  return { provider, voice, key: env.TTS_API_KEY || '', fallback, timeoutMs };
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function detailSignature(d) {
  return `${d.type}:${normalize(d.label)}:${d.raw_text ?? ''}`;
}

/** Deterministic narration cache key (see header). `fingerprint` captures config that changes output. */
export function narrationCacheKey({ style, details, lang }, fingerprint = {}) {
  const sigs = details.map(detailSignature).sort();
  return sha(`${normalize(style)}|${sigs.join('|')}|${lang}|${stableStringify(fingerprint)}`).slice(0, 32);
}

// ---------- narration cache (memory LRU + JSON on disk) ----------

const mem = new Map();
const MEM_MAX = 500;

export function readNarrationCache(key, env = process.env) {
  let entry = mem.get(key);
  if (!entry) {
    const p = join(cacheDir(env), `${key}.json`);
    if (!existsSync(p)) return null;
    try { entry = JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
  }
  // the mp3 may have been cleaned up; treat as a miss so it is regenerated
  if (entry.result.audio_url.startsWith(PUBLIC_PREFIX)) {
    const f = join(cacheDir(env), entry.result.audio_url.slice(PUBLIC_PREFIX.length));
    if (!existsSync(f)) { mem.delete(key); return null; }
  }
  mem.delete(key);
  mem.set(key, entry);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
  return entry;
}

export function writeNarrationCache(key, entry, env = process.env) {
  mem.set(key, entry);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
  try {
    const dir = cacheDir(env);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `${key}.json.tmp-${process.pid}`);
    writeFileSync(tmp, JSON.stringify(entry));
    renameSync(tmp, join(dir, `${key}.json`));
  } catch { /* disk cache is best-effort; memory cache still works */ }
}

export function clearMemoryCache() { mem.clear(); }

// ---------- providers ----------

function splitForTTS(text, max = 180) {
  const out = [];
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    let s = sentence.trim();
    while (s.length > max) {
      let cut = s.lastIndexOf(',', max);
      if (cut < max / 2) cut = s.lastIndexOf(' ', max);
      if (cut <= 0) cut = max;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

async function httpAudio(url, init, provider) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${provider} TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const PROVIDERS = {
  // Free, keyless Google Translate voice. Unofficial endpoint: fine for a hackathon demo, not for production.
  async gtranslate(text, lang, cfg) {
    const parts = splitForTTS(text);
    const bufs = await Promise.all(parts.map((q, idx) => {
      const u = new URL('https://translate.google.com/translate_tts');
      u.search = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: lang, q, total: String(parts.length), idx: String(idx), textlen: String(q.length) }).toString();
      return httpAudio(u, { signal: AbortSignal.timeout(cfg.timeoutMs), headers: { 'user-agent': 'Mozilla/5.0' } }, 'gtranslate');
    }));
    return { buffer: concatMp3(bufs), voice: `gtranslate-${lang}` };
  },

  async elevenlabs(text, lang, cfg) {
    if (!cfg.key) throw new Error('elevenlabs: TTS_API_KEY missing');
    const voice = cfg.voice[lang] || '21m00Tcm4TlvDq8ikWAM'; // premade multilingual voice
    const buffer = await httpAudio(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      signal: AbortSignal.timeout(cfg.timeoutMs),
      headers: { 'content-type': 'application/json', 'xi-api-key': cfg.key, accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', language_code: lang }),
    }, 'elevenlabs');
    return { buffer, voice };
  },

  async openai(text, lang, cfg) {
    if (!cfg.key) throw new Error('openai: TTS_API_KEY missing');
    const voice = cfg.voice[lang] || 'alloy';
    const buffer = await httpAudio('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      signal: AbortSignal.timeout(cfg.timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' }),
    }, 'openai');
    return { buffer, voice };
  },

  // Google Cloud Text-to-Speech with an API key.
  async google(text, lang, cfg) {
    if (!cfg.key) throw new Error('google: TTS_API_KEY missing');
    const languageCode = lang === 'ro' ? 'ro-RO' : 'en-GB';
    const voice = { languageCode, ...(cfg.voice[lang] ? { name: cfg.voice[lang] } : {}) };
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(cfg.key)}`, {
      method: 'POST',
      signal: AbortSignal.timeout(cfg.timeoutMs),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice, audioConfig: { audioEncoding: 'MP3' } }),
    });
    if (!res.ok) throw new Error(`google TTS HTTP ${res.status}`);
    const j = await res.json();
    return { buffer: Buffer.from(j.audioContent ?? '', 'base64'), voice: voice.name ?? languageCode };
  },
};

/** Synthesize with the configured provider, then the fallback. Throws if all fail. */
export async function synthesize(text, lang, cfg = ttsConfig()) {
  const chain = [cfg.provider, cfg.fallback].filter((p, i, a) => p && p !== 'none' && a.indexOf(p) === i);
  const errors = [];
  for (const name of chain) {
    const fn = PROVIDERS[name];
    if (!fn) { errors.push(`unknown TTS provider "${name}"`); continue; }
    try {
      const { buffer, voice } = await fn(text, lang, cfg);
      const duration = mp3Duration(buffer);
      if (!duration) throw new Error(`${name} returned no MPEG audio`);
      return { buffer, voice, provider: name, duration_s: duration };
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors.length ? errors.join('; ') : 'TTS disabled (TTS_PROVIDER=none)');
}

/**
 * Produce an audio_url for text. Never throws: on failure returns { audio_url: "", duration_s: estimate }.
 */
export async function textToAudio(text, lang, { env = process.env, estimate } = {}) {
  const cfg = ttsConfig(env);
  const dir = cacheDir(env);
  const primary = cfg.provider === 'none' ? null : cfg.provider;
  // Files already on disk for the primary voice are reused without a network call.
  const voiceKey = primary ? `${primary}|${cfg.voice[lang] || 'default'}` : null;
  const file = voiceKey ? `${sha(`${voiceKey}|${lang}|${text}`).slice(0, 24)}.mp3` : null;
  if (file && existsSync(join(dir, file))) {
    const duration = mp3Duration(readFileSync(join(dir, file)));
    return { audio_url: PUBLIC_PREFIX + file, duration_s: duration ?? estimate, tts: 'disk' };
  }
  let out;
  try {
    out = await synthesize(text, lang, cfg);
  } catch (err) {
    return { audio_url: '', duration_s: estimate, tts: 'failed', error: err.message };
  }
  const name = out.provider === primary ? file : `${sha(`${out.provider}|${out.voice}|${lang}|${text}`).slice(0, 24)}.mp3`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), out.buffer);
    return { audio_url: PUBLIC_PREFIX + name, duration_s: out.duration_s, tts: out.provider };
  } catch {
    // cache dir not writable: inline the audio instead (contract allows a data URL)
    return { audio_url: `data:audio/mpeg;base64,${out.buffer.toString('base64')}`, duration_s: out.duration_s, tts: out.provider };
  }
}
