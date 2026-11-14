// Contract tests for docs/contracts.md v1.1.0. Run: npm test  (node:test, no extra deps)
// Every test spins up a real HTTP server on a random port and talks to it with fetch,
// exactly the way M1 will.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { createApp, createLogger } from '../src/app.js';
import { loadConfig, REPO_ROOT } from '../src/config.js';
import { loadModules, tagStub } from '../src/modules.js';
import { stubAnalyzeImage, stubGenerateNarration } from '../src/stubs.js';
import { STYLE_NARRATIONS } from '../src/style-narrations.js';
import {
  ERROR_CODES, ERROR_STATUS, STYLES, checkAnalyzeResponse, checkBBox, checkErrorResponse,
  checkNarrateResponse, checkNarrationResult, checkVisionResult, wordCount,
} from '../src/contract.js';

const silent = createLogger(false);
const TINY_JPEG = (() => {
  const data = Buffer.alloc(8 * 8 * 4, 200);
  return jpeg.encode({ data, width: 8, height: 8 }, 80).data.toString('base64');
})();
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const heroJpeg = (id) => readFileSync(path.join(REPO_ROOT, 'demo', 'test-set', 'images', `${id}.jpg`));

const stubs = () => ({ analyzeImage: tagStub(stubAnalyzeImage), generateNarration: tagStub(stubGenerateNarration), visionActive: 'stub', contentActive: 'stub' });

async function start({ config = {}, modules = stubs() } = {}) {
  const cfg = loadConfig({}, { logRequests: false, rateLimitPerMin: 0, visionTimeoutMs: 300, contentTimeoutMs: 300, offlineFallbackAfterMs: 150, ...config });
  const { app, state } = createApp({ config: cfg, modules, log: silent });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* binary or empty */ }
    return { status: res.status, json, headers: res.headers, text };
  };
  return { base, state, call, close: () => new Promise((r) => server.close(r)) };
}

function assertError(res, code, status = ERROR_STATUS[code]) {
  assert.equal(res.status, status, `expected HTTP ${status}, got ${res.status}: ${res.text}`);
  assert.deepEqual(checkErrorResponse(res.json), []);
  assert.equal(res.json.error.code, code);
  assert.deepEqual(Object.keys(res.json), ['error'], 'ErrorResponse has only `error`');
  assert.deepEqual(Object.keys(res.json.error).sort(), ['code', 'message']);
  assert.doesNotMatch(res.json.error.message, /at .+\.js:\d+|sk-ant|stack/i, 'message must not leak internals');
}

// ---------------------------------------------------------------------------------------------
describe('mocks match the contract (§10 shape check)', () => {
  test('stub analyzeImage returns a valid VisionResult', async () => {
    assert.deepEqual(checkVisionResult(await stubAnalyzeImage(TINY_JPEG)), []);
  });
  test('stub generateNarration returns a valid NarrationResult in both languages, 35-40 words', async () => {
    for (const style of STYLES) for (const lang of ['ro', 'en']) {
      const n = await stubGenerateNarration({ style, details: [], lang });
      assert.deepEqual(checkNarrationResult(n), [], `${style}/${lang}`);
      const wc = wordCount(n.text);
      assert.ok(wc >= 35 && wc <= 40, `${style}/${lang} has ${wc} words`);
    }
  });
  test('generic style narrations: every style x lang has text/history/why_it_matters', () => {
    for (const style of STYLES) for (const lang of ['ro', 'en']) {
      const g = STYLE_NARRATIONS[style][lang];
      assert.ok(g.text && g.history && g.why_it_matters, `${style}/${lang}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('POST /analyze (§6)', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.close());

  test('valid payload returns the exact AnalyzeResponse schema', async () => {
    const r = await s.call('POST', '/analyze', { image_base64: TINY_JPEG, lang: 'en' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(checkAnalyzeResponse(r.json), []);
    assert.deepEqual(Object.keys(r.json).sort(), ['confidence', 'details', 'narration', 'style']);
    assert.deepEqual(Object.keys(r.json.narration).sort(), ['audio_url', 'building_name', 'duration_s', 'history', 'text', 'why_it_matters']);
    for (const d of r.json.details) {
      assert.equal(d.bbox.length, 4);
      assert.ok(d.bbox.every((n) => n >= 0 && n <= 1), `bbox in 0..1: ${d.bbox}`);
      assert.deepEqual(checkBBox(d.bbox), []);
    }
    // §6 merge mapping
    assert.equal(r.json.details.find((d) => d.id === 'det_2').translated_text, 'In the year 1910');
    assert.equal(r.json.details.find((d) => d.id === 'det_1').translated_text, null);
  });

  test('accepts a data: URL prefix and PNG input', async () => {
    const r1 = await s.call('POST', '/analyze', { image_base64: `data:image/jpeg;base64,${TINY_JPEG}`, lang: 'ro' });
    assert.equal(r1.status, 200, r1.text);
    const r2 = await s.call('POST', '/analyze', { image_base64: TINY_PNG, lang: 'en' });
    assert.equal(r2.status, 200, r2.text);
  });

  test('narration language follows `lang`', async () => {
    const ro = await s.call('POST', '/analyze', { image_base64: TINY_JPEG, lang: 'ro' });
    assert.equal(ro.json.narration.text, STYLE_NARRATIONS.Secession.ro.text);
    assert.equal(ro.json.details.find((d) => d.id === 'det_2').translated_text, 'În anul 1910');
  });

  test('sanitizes M2 output: clamps bboxes, drops bad details, keeps at most 6', async () => {
    const r = await s.call('POST', '/analyze', { image_base64: TINY_JPEG, lang: 'en' }, { 'x-mock-scenario': 'messy_output' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(checkAnalyzeResponse(r.json), []);
    assert.ok(r.json.details.length <= 6);
    const ids = r.json.details.map((d) => d.id);
    assert.ok(!ids.includes('det_3'), 'unknown type dropped');
    assert.ok(!ids.includes('det_4'), 'zero-width box dropped');
    assert.deepEqual(r.json.details.find((d) => d.id === 'det_1').bbox, [0.8, 0.9, 0.2, 0.1]);
    assert.deepEqual(r.json.details.find((d) => d.id === 'det_2').bbox, [0, 0.1, 0.1, 0.2]);
  });

  test('empty details is allowed (contract: details [] is valid)', async () => {
    const mods = { ...stubs(), analyzeImage: async () => ({ style: 'Baroque', confidence: 0.9, details: [] }) };
    const t = await start({ modules: mods });
    const r = await t.call('POST', '/analyze', { image_base64: TINY_JPEG, lang: 'en' });
    await t.close();
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.details, []);
  });
});

// ---------------------------------------------------------------------------------------------
describe('errors (§8): every code returns { error: { code, message } }', () => {
  let s;
  before(async () => { s = await start({ config: { maxImageBytes: 2000 } }); });
  after(() => s.close());
  const img = { image_base64: TINY_JPEG, lang: 'en' };

  test('INVALID_INPUT: missing image', async () => assertError(await s.call('POST', '/analyze', { lang: 'en' }), 'INVALID_INPUT'));
  test('INVALID_INPUT: bad lang', async () => assertError(await s.call('POST', '/analyze', { ...img, lang: 'de' }), 'INVALID_INPUT'));
  test('INVALID_INPUT: missing lang', async () => assertError(await s.call('POST', '/analyze', { image_base64: TINY_JPEG }), 'INVALID_INPUT'));
  test('INVALID_INPUT: not base64', async () => assertError(await s.call('POST', '/analyze', { ...img, image_base64: '%%%not-base64%%%' }), 'INVALID_INPUT'));
  test('INVALID_INPUT: base64 of a non-image', async () => assertError(await s.call('POST', '/analyze', { ...img, image_base64: Buffer.from('hello world, not an image').toString('base64') }), 'INVALID_INPUT'));
  test('INVALID_INPUT: malformed JSON', async () => assertError(await s.call('POST', '/analyze', '{"lang": "en",'), 'INVALID_INPUT'));
  test('INVALID_INPUT: body is not an object', async () => assertError(await s.call('POST', '/analyze', '[1,2]'), 'INVALID_INPUT'));
  test('INVALID_INPUT 413: image over MAX_IMAGE_BYTES', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5000)]).toString('base64');
    assertError(await s.call('POST', '/analyze', { ...img, image_base64: big }), 'INVALID_INPUT', 413);
  });
  test('INVALID_INPUT: demo_fixture_id with bad format', async () => assertError(await s.call('POST', '/analyze', { image_base64: '', lang: 'en', demo_fixture_id: '../etc/passwd' }), 'INVALID_INPUT'));
  test('INVALID_INPUT: unknown demo_fixture_id', async () => assertError(await s.call('POST', '/analyze', { image_base64: '', lang: 'en', demo_fixture_id: 'does-not-exist' }), 'INVALID_INPUT'));
  test('INVALID_INPUT: M2 throws err.code = INVALID_INPUT', async () => assertError(await s.call('POST', '/analyze', img, { 'x-mock-scenario': 'vision_invalid' }), 'INVALID_INPUT'));

  test('NO_MATCH: M2 returns style null', async () => assertError(await s.call('POST', '/analyze', img, { 'x-mock-scenario': 'no_match' }), 'NO_MATCH'));
  test('LOW_CONFIDENCE: confidence below VISION_MIN_CONFIDENCE', async () => {
    const r = await s.call('POST', '/analyze', img, { 'x-mock-scenario': 'low_confidence' });
    assertError(r, 'LOW_CONFIDENCE');
    assert.match(r.json.error.message, /0\.41 is below the 0\.55 threshold/);
  });

  test('TIMEOUT: M2 hangs past VISION_TIMEOUT_MS', async () => assertError(await s.call('POST', '/analyze', img, { 'x-mock-scenario': 'vision_hang' }), 'TIMEOUT'));
  test('TIMEOUT: M2 throws a plain Error', async () => assertError(await s.call('POST', '/analyze', img, { 'x-mock-scenario': 'vision_throw' }), 'TIMEOUT'));
  test('TIMEOUT: M3 throws', async () => assertError(await s.call('POST', '/analyze', img, { 'x-mock-scenario': 'narration_throw' }), 'TIMEOUT'));
  test('TIMEOUT: M3 hangs past CONTENT_TIMEOUT_MS', async () => assertError(await s.call('POST', '/analyze', img, { 'x-mock-scenario': 'narration_hang' }), 'TIMEOUT'));
  test('TIMEOUT: M2 returns garbage', async () => {
    const t = await start({ modules: { ...stubs(), analyzeImage: async () => ({ style: 'Gothic', confidence: 'high' }) } });
    assertError(await t.call('POST', '/analyze', img), 'TIMEOUT');
    await t.close();
  });

  test('unknown route is an ErrorResponse too', async () => {
    const r = await s.call('GET', '/nope');
    assert.equal(r.status, 404);
    assert.deepEqual(checkErrorResponse(r.json), []);
  });

  test('all 4 error codes are covered by fixtures as well', () => {
    const codes = readdirSync(path.join(REPO_ROOT, 'demo', 'fixtures'))
      .map((f) => JSON.parse(readFileSync(path.join(REPO_ROOT, 'demo', 'fixtures', f), 'utf8')))
      .filter((b) => b.error).map((b) => b.error.code);
    assert.deepEqual([...new Set(codes)].sort(), [...ERROR_CODES].sort());
  });
});

// ---------------------------------------------------------------------------------------------
describe('POST /narrate (§7)', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.close());
  const details = [{ id: 'det_1', label: 'Secession Mask (Mascaron)', type: 'mask', bbox: [0.32, 0.18, 0.14, 0.16], raw_text: null }];

  test('switches RO <-> EN cleanly with a valid NarrateResponse', async () => {
    const ro = await s.call('POST', '/narrate', { style: 'Secession', details, lang: 'ro' });
    const en = await s.call('POST', '/narrate', { style: 'Secession', details, lang: 'en' });
    for (const r of [ro, en]) {
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(checkNarrateResponse(r.json), []);
      assert.deepEqual(Object.keys(r.json).sort(), ['audio_url', 'duration_s', 'history', 'text', 'why_it_matters']);
    }
    assert.notEqual(ro.json.text, en.json.text);
    assert.match(ro.json.text, /[ăâîșț]/i, 'Romanian text has Romanian diacritics');
  });

  test('accepts AnalyzedDetail (translated_text ignored)', async () => {
    const r = await s.call('POST', '/narrate', { style: 'Baroque', details: [{ ...details[0], translated_text: 'x' }], lang: 'en' });
    assert.equal(r.status, 200, r.text);
  });

  test('INVALID_INPUT: null / unknown style', async () => {
    assertError(await s.call('POST', '/narrate', { style: null, details, lang: 'en' }), 'INVALID_INPUT');
    assertError(await s.call('POST', '/narrate', { style: 'Gothic', details, lang: 'en' }), 'INVALID_INPUT');
  });
  test('INVALID_INPUT: details not an array / malformed detail / bad lang', async () => {
    assertError(await s.call('POST', '/narrate', { style: 'Secession', details: {}, lang: 'en' }), 'INVALID_INPUT');
    assertError(await s.call('POST', '/narrate', { style: 'Secession', details: [{ id: 'x' }], lang: 'en' }), 'INVALID_INPUT');
    assertError(await s.call('POST', '/narrate', { style: 'Secession', details, lang: 'fr' }), 'INVALID_INPUT');
  });
  test('TIMEOUT: M3 throws / hangs', async () => {
    assertError(await s.call('POST', '/narrate', { style: 'Eclectic', details: [], lang: 'en' }, { 'x-mock-scenario': 'narration_throw' }), 'TIMEOUT');
    assertError(await s.call('POST', '/narrate', { style: 'Eclectic', details: [], lang: 'en' }, { 'x-mock-scenario': 'narration_hang' }), 'TIMEOUT');
  });
});

// ---------------------------------------------------------------------------------------------
describe('demo fixtures (§9.3)', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.close());
  const dir = path.join(REPO_ROOT, 'demo', 'fixtures');

  test('every fixture file is a valid AnalyzeResponse or ErrorResponse; narrations are 35-40 words', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 10);
    for (const f of files) {
      const b = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (b.error) { assert.deepEqual(checkErrorResponse(b), [], f); continue; }
      assert.deepEqual(checkAnalyzeResponse(b), [], f);
      const wc = wordCount(b.narration.text);
      assert.ok(wc >= 35 && wc <= 40, `${f}: ${wc} words`);
      assert.ok(b.narration.audio_url === '' || b.narration.audio_url.startsWith('/audio/demo/') || b.narration.audio_url.startsWith('data:'), `${f}: audio_url`);
    }
  });

  test('demo_fixture_id returns the per-language fixture verbatim, with image_base64 ""', async () => {
    for (const lang of ['ro', 'en']) {
      const r = await s.call('POST', '/analyze', { image_base64: '', lang, demo_fixture_id: 'casa-bruck' });
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(r.json, JSON.parse(readFileSync(path.join(dir, `casa-bruck.${lang}.json`), 'utf8')));
    }
  });

  test('x-demo-fixture header works like demo_fixture_id', async () => {
    const r = await s.call('POST', '/analyze', { image_base64: '', lang: 'en' }, { 'x-demo-fixture': 'palatul-lloyd' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.narration.building_name, 'Palatul Lloyd');
  });

  test('error fixtures return the §8 status for their code', async () => {
    for (const [id, code] of [['error-no-match', 'NO_MATCH'], ['error-low-confidence', 'LOW_CONFIDENCE'], ['error-timeout', 'TIMEOUT'], ['error-invalid-input', 'INVALID_INPUT']]) {
      assertError(await s.call('POST', '/analyze', { image_base64: '', lang: 'ro', demo_fixture_id: id }), code);
    }
  });

  test('fixtures never call the AI modules', async () => {
    const boom = async () => { throw new Error('must not be called'); };
    const t = await start({ modules: { analyzeImage: boom, generateNarration: boom, visionActive: 'live', contentActive: 'live' } });
    const r = await t.call('POST', '/analyze', { image_base64: '', lang: 'en', demo_fixture_id: 'domul-catolic' });
    await t.close();
    assert.equal(r.status, 200, r.text);
  });

  test('GET /demo/fixtures lists buildings and error fixtures', async () => {
    const r = await s.call('GET', '/demo/fixtures');
    assert.equal(r.status, 200);
    const ids = r.json.fixtures.map((f) => f.id);
    for (const id of ['casa-bruck', 'palatul-lloyd', 'error-no-match', 'contract-example']) assert.ok(ids.includes(id), id);
    assert.deepEqual(r.json.fixtures.find((f) => f.id === 'casa-bruck').langs, ['en', 'ro']);
    assert.ok(r.json.offline_cache.length >= 6);
  });
});

// ---------------------------------------------------------------------------------------------
describe('offline demo fallback', () => {
  const bruck = () => heroJpeg('casa-bruck').toString('base64');

  test('OFFLINE_DEMO_MODE: known test image -> pre-recorded response, no AI calls', async () => {
    const boom = async () => { throw new Error('must not be called'); };
    const s = await start({ config: { offlineDemoMode: true }, modules: { analyzeImage: boom, generateNarration: boom, visionActive: 'live', contentActive: 'live' } });
    const r = await s.call('POST', '/analyze', { image_base64: bruck(), lang: 'ro' });
    const h = await s.call('GET', '/health');
    await s.close();
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(checkAnalyzeResponse(r.json), []);
    assert.equal(r.json.narration.building_name, 'Casa Brück');
    assert.match(r.json.narration.text, /Priviți/);
    assert.equal(h.json.mode, 'offline_fallback');
  });

  test('OFFLINE_DEMO_MODE: perceptual match survives re-encoding (different bytes)', async () => {
    const dec = jpeg.decode(heroJpeg('domul-catolic'), { useTArray: true });
    const reencoded = jpeg.encode(dec, 55).data.toString('base64');
    const s = await start({ config: { offlineDemoMode: true } });
    const r = await s.call('POST', '/analyze', { image_base64: reencoded, lang: 'en' });
    await s.close();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.narration.building_name, 'Domul Romano-Catolic Sfântul Gheorghe');
  });

  test('OFFLINE_DEMO_MODE: unknown image -> NO_MATCH, or the default fixture if configured', async () => {
    const s1 = await start({ config: { offlineDemoMode: true } });
    assertError(await s1.call('POST', '/analyze', { image_base64: TINY_JPEG, lang: 'en' }), 'NO_MATCH');
    await s1.close();
    const s2 = await start({ config: { offlineDemoMode: true, offlineDefaultFixture: 'palatul-baroc' } });
    const r = await s2.call('POST', '/analyze', { image_base64: TINY_JPEG, lang: 'en' });
    await s2.close();
    assert.equal(r.status, 200);
    assert.equal(r.json.narration.building_name, 'Palatul Baroc');
  });

  test('live vision too slow + known image -> pre-recorded response after OFFLINE_FALLBACK_AFTER_MS', async () => {
    const s = await start({ config: { visionTimeoutMs: 5000 } });
    const t0 = Date.now();
    const r = await s.call('POST', '/analyze', { image_base64: bruck(), lang: 'en' }, { 'x-mock-scenario': 'vision_hang' });
    await s.close();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.narration.building_name, 'Casa Brück');
    assert.ok(Date.now() - t0 < 2000, 'answered well before the 5 s vision budget');
  });

  test('live vision fails + known image -> pre-recorded response', async () => {
    const s = await start();
    const r = await s.call('POST', '/analyze', { image_base64: bruck(), lang: 'en' }, { 'x-mock-scenario': 'vision_throw' });
    await s.close();
    assert.equal(r.status, 200, r.text);
  });

  test('live failure + unknown image -> still the honest TIMEOUT', async () => {
    const s = await start();
    assertError(await s.call('POST', '/analyze', { image_base64: TINY_JPEG, lang: 'en' }, { 'x-mock-scenario': 'vision_throw' }), 'TIMEOUT');
    await s.close();
  });

  test('live NO_MATCH on a known image is returned as-is (no fake success)', async () => {
    const s = await start();
    assertError(await s.call('POST', '/analyze', { image_base64: bruck(), lang: 'en' }, { 'x-mock-scenario': 'no_match' }), 'NO_MATCH');
    await s.close();
  });

  test('/narrate offline: pre-recorded hero text when details match, generic style text otherwise', async () => {
    const s = await start({ config: { offlineDemoMode: true } });
    const hero = JSON.parse(readFileSync(path.join(REPO_ROOT, 'demo', 'fixtures', 'palatul-lloyd.en.json'), 'utf8'));
    const r1 = await s.call('POST', '/narrate', { style: hero.style, details: hero.details, lang: 'ro' });
    const r2 = await s.call('POST', '/narrate', { style: 'Brutalist', details: [], lang: 'en' });
    await s.close();
    assert.equal(r1.status, 200);
    assert.match(r1.json.text, /Palatul Lloyd/);
    assert.deepEqual(checkNarrateResponse(r2.json), []);
    assert.equal(r2.json.text, STYLE_NARRATIONS.Brutalist.en.text);
  });

  test('POST /demo/offline toggles at runtime only with the admin token', async () => {
    const s0 = await start();
    assert.equal((await s0.call('POST', '/demo/offline', { enabled: true })).status, 404, 'disabled without DEMO_ADMIN_TOKEN');
    await s0.close();
    const s = await start({ config: { demoAdminToken: 'secret' } });
    assert.equal((await s.call('POST', '/demo/offline', { enabled: true }, { 'x-demo-admin-token': 'nope' })).status, 403);
    const r = await s.call('POST', '/demo/offline', { enabled: true }, { 'x-demo-admin-token': 'secret' });
    assert.equal(r.json.offline_demo_mode, true);
    assert.equal((await s.call('GET', '/health')).json.mode, 'offline_fallback');
    await s.close();
  });
});

// ---------------------------------------------------------------------------------------------
describe('supporting endpoints (§9)', () => {
  test('GET /health mirrors modes', async () => {
    const s = await start({ config: { visionMode: 'mock', contentMode: 'live' } });
    const r = await s.call('GET', '/health');
    await s.close();
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.vision_mode, 'mock');
    assert.equal(r.json.content_mode, 'live');
    assert.ok(['live', 'stub', 'offline_fallback'].includes(r.json.mode));
  });

  test('live mode with no /vision or /content module falls back to stubs and says so', async () => {
    const warnings = [];
    const log = { info() {}, warn: (o) => warnings.push(o), error() {} };
    const cfg = loadConfig({ VISION_MODE: 'live', CONTENT_MODE: 'live' });
    const mods = await loadModules({ ...cfg, }, log);
    // Until M2/M3 merge, both are stubs; after they merge, both are live. Either way it must not crash.
    for (const k of ['visionActive', 'contentActive']) assert.ok(['live', 'stub'].includes(mods[k]));
    if (mods.visionActive === 'stub') assert.ok(warnings.some((w) => /vision/.test(w.msg)));
    const stubbed = await loadModules({ ...cfg, useStubs: true }, log);
    assert.equal(stubbed.visionActive, 'stub');
    assert.equal(stubbed.contentActive, 'stub');
  });

  test('static audio: valid file served as audio/mpeg, bad names 404', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'm4-audio-'));
    writeFileSync(path.join(dir, 'abc_123.mp3'), Buffer.from([0x49, 0x44, 0x33, 3, 0]));
    const s = await start({ config: { audioCacheDir: dir } });
    const ok = await s.call('GET', '/audio/cache/abc_123.mp3');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
    for (const bad of ['/audio/cache/missing.mp3', '/audio/cache/..%2F..%2Fpackage.json', '/audio/cache/x.wav', '/audio/other/abc_123.mp3']) {
      const r = await s.call('GET', bad);
      assert.equal(r.status, 404, bad);
      assert.deepEqual(checkErrorResponse(r.json), [], bad);
    }
    await s.close();
  });

  test('rate limit returns 429 with an ErrorResponse', async () => {
    const s = await start({ config: { rateLimitPerMin: 2 } });
    const body = { image_base64: '', lang: 'en', demo_fixture_id: 'casa-bruck' };
    await s.call('POST', '/analyze', body);
    await s.call('POST', '/analyze', body);
    const r = await s.call('POST', '/analyze', body);
    await s.close();
    assertError(r, 'TIMEOUT', 429);
  });

  test('CORS allows any origin by default', async () => {
    const s = await start();
    const res = await fetch(`${s.base}/health`, { headers: { origin: 'https://example.trycloudflare.com' } });
    await s.close();
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});

// ---------------------------------------------------------------------------------------------
describe('test-set manifest', () => {
  const m = JSON.parse(readFileSync(path.join(REPO_ROOT, 'demo', 'test-set', 'manifest.json'), 'utf8'));
  test('20+ labeled cases across Cetate, Fabric and Iosefin, every style covered, with negatives', () => {
    assert.ok(m.cases.length >= 20);
    for (const d of ['Cetate', 'Fabric', 'Iosefin']) assert.ok(m.cases.some((c) => c.district === d), d);
    for (const st of STYLES) assert.ok(m.cases.some((c) => c.expected_style === st), st);
    assert.ok(m.cases.filter((c) => c.expected_style === null).length >= 2);
  });
  test('every expected detail has a valid bbox and type', () => {
    for (const c of m.cases) for (const d of c.expected_details) assert.deepEqual(checkBBox(d.bbox), [], `${c.id}/${d.id}`);
  });
});
