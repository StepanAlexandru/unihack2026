// M4 orchestrator. Implements docs/contracts.md §6-§9 plus the offline demo safety net.
import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ApiError, StageTimeoutError, delay, errorBody, sendError, withTimeout } from './errors.js';
import { AUDIO_FILE_RE, ERROR_STATUS } from './contract.js';
import { mergeAnalyze, normalizeNarration, parseAnalyzeRequest, parseNarrateRequest, sanitizeVisionResult, toNarrateResponse } from './validate.js';
import { listFixtures, loadFixture } from './fixtures.js';
import { cachedAnalyze, loadOfflineCache, matchImage, matchNarration } from './offline.js';
import { fingerprint } from './imagehash.js';
import { STYLE_NARRATIONS } from './style-narrations.js';
import { wordCount } from './contract.js';

export const CONTRACT_VERSION = '1.1.0';

export function createLogger(enabled = true) {
  const out = (level) => (obj) => {
    if (!enabled && level !== 'error') return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, ...obj });
    (level === 'info' ? console.log : console.error)(line);
  };
  return { info: out('info'), warn: out('warn'), error: out('error') };
}

/**
 * @param {object} opts
 * @param {object} opts.config    from loadConfig()
 * @param {object} opts.modules   from loadModules(): { analyzeImage, generateNarration, visionActive, contentActive }
 * @param {object} [opts.log]
 */
export function createApp({ config, modules, log = createLogger(config.logRequests) }) {
  const state = {
    offline: config.offlineDemoMode,
    cache: loadOfflineCache(config.offlineCachePath, log),
    startedAt: Date.now(),
  };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // Vite dev proxy / tunnel run on the same machine

  // ---------- structured request log ----------
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (!config.logRequests) return;
      log.info({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        latency_ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10,
        source: res.locals.source ?? null,
        style: res.locals.style ?? null,
        confidence: res.locals.confidence ?? null,
        error_code: res.locals.errorCode ?? null,
        ...(res.locals.extra ?? {}),
      });
    });
    next();
  });

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: config.bodyLimit }));

  if (config.rateLimitPerMin > 0) {
    app.use(['/analyze', '/narrate'], rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMin,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // The contract has no rate-limit code; TIMEOUT gives M1 the right "tap to retry" UX.
      handler: (req, res) => sendError(res, new ApiError('TIMEOUT', 'Too many requests; retry in a few seconds.', 429)),
    }));
  }

  const stubOpts = (fn, req) => (fn.isStub ? [{ scenario: String(req.get('x-mock-scenario') || '') }] : []);
  const activeMode = () => (state.offline ? 'offline_fallback' : modules.visionActive === 'live' && modules.contentActive === 'live' ? 'live' : 'stub');

  function send(res, { status, body }, source) {
    res.locals.source = source;
    if (body?.error) res.locals.errorCode = body.error.code;
    else if (body?.style) Object.assign(res.locals, { style: body.style, confidence: body.confidence });
    res.status(status).json(body);
  }

  function sendFixture(res, id, lang, source = 'fixture') {
    send(res, loadFixture(config.fixturesDir, id, lang), source);
  }

  // ---------- §9.2 health ----------
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      vision_mode: config.visionMode,
      content_mode: config.contentMode,
      // additive (contract v1.1.0)
      mode: activeMode(),
      vision_active: modules.visionActive,
      content_active: modules.contentActive,
      offline_demo_mode: state.offline,
      offline_cache_entries: state.cache.entries.length,
      fixtures: listFixtures(config.fixturesDir).length,
      contract_version: CONTRACT_VERSION,
      uptime_s: Math.round((Date.now() - state.startedAt) / 1000),
    });
  });

  // ---------- demo helpers ----------
  app.get('/demo/fixtures', (req, res) => {
    res.json({
      fixtures: listFixtures(config.fixturesDir),
      offline_cache: state.cache.entries.map((e) => ({ fixture_id: e.fixture_id, building_name: e.building_name, style: e.style, image: e.image })),
    });
  });

  // Flip offline mode at runtime (e.g. venue Wi-Fi died). Disabled unless DEMO_ADMIN_TOKEN is set.
  app.post('/demo/offline', (req, res) => {
    if (!config.demoAdminToken) throw new ApiError('INVALID_INPUT', 'Not found.', 404);
    if (req.get('x-demo-admin-token') !== config.demoAdminToken) throw new ApiError('INVALID_INPUT', 'Bad or missing x-demo-admin-token.', 403);
    if (typeof req.body?.enabled !== 'boolean') throw new ApiError('INVALID_INPUT', 'Body must be { "enabled": true|false }.');
    state.offline = req.body.enabled;
    log.warn({ msg: `offline demo mode ${state.offline ? 'ENABLED' : 'disabled'} at runtime` });
    res.json({ ok: true, offline_demo_mode: state.offline, mode: activeMode() });
  });

  // ---------- §6 POST /analyze ----------
  async function runPipeline({ raw_base64, lang, req }) {
    try {
      let raw;
      try {
        raw = await withTimeout(modules.analyzeImage(raw_base64, ...stubOpts(modules.analyzeImage, req)), config.visionTimeoutMs, 'vision');
      } catch (err) {
        if (err?.code === 'INVALID_INPUT') throw new ApiError('INVALID_INPUT', 'Could not decode the image.');
        log.warn({ msg: 'vision stage failed', error: String(err?.message ?? err) });
        throw new ApiError('TIMEOUT', err instanceof StageTimeoutError ? `Vision analysis exceeded its ${config.visionTimeoutMs} ms budget.` : 'Vision analysis failed upstream.');
      }

      let vision;
      try {
        vision = sanitizeVisionResult(raw);
      } catch (err) {
        log.warn({ msg: 'vision output rejected', error: err.message });
        throw new ApiError('TIMEOUT', 'Vision analysis returned malformed output.');
      }
      if (vision.style === null) throw new ApiError('NO_MATCH', 'No recognizable architectural heritage facade found.');
      if (vision.confidence < config.minConfidence) {
        throw new ApiError('LOW_CONFIDENCE', `Style confidence ${vision.confidence.toFixed(2)} is below the ${config.minConfidence.toFixed(2)} threshold.`);
      }

      let narration;
      try {
        const input = { style: vision.style, details: vision.details, lang };
        narration = normalizeNarration(await withTimeout(modules.generateNarration(input, ...stubOpts(modules.generateNarration, req)), config.contentTimeoutMs, 'content'));
      } catch (err) {
        log.warn({ msg: 'content stage failed', error: String(err?.message ?? err) });
        throw new ApiError('TIMEOUT', err instanceof StageTimeoutError ? `Narration exceeded its ${config.contentTimeoutMs} ms budget.` : 'Narration failed upstream.');
      }
      return { status: 200, body: mergeAnalyze(vision, narration) };
    } catch (err) {
      if (err instanceof ApiError) return { status: err.status, body: errorBody(err.code, err.message) };
      log.error({ msg: 'unexpected pipeline error', error: String(err?.message ?? err) });
      return { status: 504, body: errorBody('TIMEOUT', 'Unexpected server error.') };
    }
  }

  function sendCached(res, match, lang, reason) {
    const body = cachedAnalyze(match.entry, lang);
    if (!body) return false;
    res.locals.extra = { offline_reason: reason, offline_match: match.how, offline_distance: match.distance, fixture_id: match.entry.fixture_id };
    send(res, { status: 200, body }, 'offline_cache');
    return true;
  }

  app.post('/analyze', async (req, res) => {
    const parsed = parseAnalyzeRequest(req.body, { maxImageBytes: config.maxImageBytes, headerFixture: req.get('x-demo-fixture') });
    const { lang } = parsed;

    if (parsed.fixtureId) return sendFixture(res, parsed.fixtureId, lang);

    const findMatch = () => (state.cache.entries.length ? matchImage(state.cache, fingerprint(parsed.image), config.offlineHashMaxDistance) : null);

    if (state.offline) {
      const match = findMatch();
      if (match && sendCached(res, match, lang, 'offline_mode')) return;
      if (config.offlineDefaultFixture) return sendFixture(res, config.offlineDefaultFixture, lang, 'offline_default');
      throw new ApiError('NO_MATCH', 'Offline demo mode: this image is not in the pre-recorded cache.');
    }

    const source = modules.visionActive === 'live' ? 'live' : 'stub';
    const live = runPipeline({ raw_base64: parsed.raw_base64, lang, req });
    if (!state.cache.entries.length) return send(res, await live, source);

    // Safety net: if live is slow (> OFFLINE_FALLBACK_AFTER_MS) or fails upstream (5xx), and this
    // image is a known demo image, answer from the pre-recorded cache instead.
    const early = await Promise.race([live, delay(config.offlineFallbackAfterMs).then(() => null)]);
    if (early && early.status < 500) return send(res, early, source);
    const match = findMatch();
    if (match && sendCached(res, match, lang, early ? 'live_error' : 'live_slow')) return;
    send(res, early ?? (await live), source);
  });

  // ---------- §7 POST /narrate ----------
  function offlineNarrate(input) {
    const entry = matchNarration(state.cache, input);
    const cached = entry && cachedAnalyze(entry, input.lang);
    if (cached) {
      const n = cached.narration;
      return { body: { text: n.text, audio_url: n.audio_url, duration_s: n.duration_s, history: n.history, why_it_matters: n.why_it_matters }, source: 'offline_cache' };
    }
    const g = STYLE_NARRATIONS[input.style][input.lang];
    return {
      body: { text: g.text, audio_url: '', duration_s: Math.round((wordCount(g.text) / 2.5) * 10) / 10, history: g.history, why_it_matters: g.why_it_matters },
      source: 'offline_generic',
    };
  }

  app.post('/narrate', async (req, res) => {
    const input = parseNarrateRequest(req.body);
    res.locals.style = input.style;
    if (state.offline) {
      const { body, source } = offlineNarrate(input);
      res.locals.source = source;
      return res.json(body);
    }
    try {
      const n = normalizeNarration(await withTimeout(modules.generateNarration(input, ...stubOpts(modules.generateNarration, req)), config.contentTimeoutMs, 'content'));
      res.locals.source = modules.contentActive === 'live' ? 'live' : 'stub';
      res.json(toNarrateResponse(n));
    } catch (err) {
      log.warn({ msg: 'narrate failed', error: String(err?.message ?? err) });
      const entry = matchNarration(state.cache, input);
      if (entry) {
        const { body } = offlineNarrate(input);
        res.locals.source = 'offline_cache';
        return res.json(body);
      }
      throw new ApiError('TIMEOUT', err instanceof StageTimeoutError ? `Narration exceeded its ${config.contentTimeoutMs} ms budget.` : 'Narration failed upstream.');
    }
  });

  // ---------- §9.1 static audio ----------
  app.get('/audio/:bucket/:file', (req, res) => {
    const dir = { cache: config.audioCacheDir, demo: config.demoAudioDir }[req.params.bucket];
    const file = req.params.file;
    const full = dir && AUDIO_FILE_RE.test(file) ? path.join(dir, file) : null;
    if (!full || !existsSync(full)) throw new ApiError('INVALID_INPUT', 'Audio file not found.', 404);
    res.locals.source = 'static';
    res.sendFile(full, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' } });
  });

  // ---------- 404 + error handler: every non-2xx is an ErrorResponse (§8) ----------
  app.use((req, res) => sendError(res, new ApiError('INVALID_INPUT', `No route for ${req.method} ${req.path}.`, 404)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return sendError(res, err);
    if (err?.type === 'entity.too.large') return sendError(res, new ApiError('INVALID_INPUT', `Request body exceeds the ${config.bodyLimit} limit.`, 413));
    if (err?.type === 'entity.parse.failed' || err?.type === 'encoding.unsupported' || err?.type === 'charset.unsupported') {
      return sendError(res, new ApiError('INVALID_INPUT', 'Request body is not valid JSON.'));
    }
    log.error({ msg: 'unhandled error', path: req.path, error: String(err?.message ?? err) });
    sendError(res, new ApiError('TIMEOUT', 'Unexpected server error.', ERROR_STATUS.TIMEOUT));
  });

  return { app, state };
}
