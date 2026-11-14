// Runtime configuration. Every value comes from the repo-root `.env` (see .env.example).
// Relative paths resolve against the REPO ROOT, never the process cwd (CLAUDE.md §5).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(BACKEND_DIR, '..');

const fromRoot = (p) => path.resolve(REPO_ROOT, p);

function num(v, fallback) {
  const n = Number(v);
  return v === undefined || v === '' || !Number.isFinite(n) ? fallback : n;
}

function bool(v, fallback = false) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function mode(v) {
  return String(v || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
}

/** Build a config object from an env-like map. Tests pass overrides directly. */
export function loadConfig(env = process.env, overrides = {}) {
  const corsRaw = (env.CORS_ORIGINS ?? '*').trim();
  return {
    port: num(env.PORT, 3001),
    corsOrigins: corsRaw === '' || corsRaw === '*' ? '*' : corsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    visionMode: mode(env.VISION_MODE),
    contentMode: mode(env.CONTENT_MODE),
    useStubs: bool(env.USE_STUBS),
    minConfidence: num(env.VISION_MIN_CONFIDENCE, 0.55),
    visionTimeoutMs: num(env.VISION_TIMEOUT_MS, 15000),
    contentTimeoutMs: num(env.CONTENT_TIMEOUT_MS, 15000),
    maxImageBytes: num(env.MAX_IMAGE_BYTES, 6_000_000),
    bodyLimit: env.BODY_LIMIT || '15mb',
    fixturesDir: fromRoot(env.DEMO_FIXTURES_DIR || './demo/fixtures'),
    audioCacheDir: fromRoot(env.AUDIO_CACHE_DIR || './.cache/audio'),
    demoAudioDir: fromRoot('./demo/audio'),
    offlineCachePath: fromRoot(env.OFFLINE_CACHE_PATH || './demo/offline-cache.json'),
    offlineDemoMode: bool(env.OFFLINE_DEMO_MODE),
    offlineDefaultFixture: env.OFFLINE_DEMO_DEFAULT_FIXTURE || '',
    offlineFallbackAfterMs: num(env.OFFLINE_FALLBACK_AFTER_MS, 7000),
    offlineHashMaxDistance: num(env.OFFLINE_HASH_MAX_DISTANCE, 4),
    demoAdminToken: env.DEMO_ADMIN_TOKEN || '',
    rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 60),
    logRequests: bool(env.LOG_REQUESTS, true),
    ...overrides,
  };
}
