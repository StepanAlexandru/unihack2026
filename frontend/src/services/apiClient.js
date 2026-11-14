// HTTP client for M4 (docs/contracts.md §6–§8), with a mock mode that serves the
// contract examples locally so M1 runs with no backend at all.
import { MOCK_SCENARIOS, mockNarrate } from '../mocks/contractExamples.js';
import { checkAnalyzeResponse, checkNarrateResponse, ERROR_CODES } from './contractShape.js';

const env = import.meta.env;
export const API_BASE = (env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const MOCK_DEFAULT = String(env.VITE_USE_MOCK_API ?? env.VITE_USE_MOCKS ?? 'true') === 'true';
export const CLIENT_TIMEOUT_MS = 6000;

/** Resolve a contract URL ("/audio/cache/x.mp3", data URL, "") against the backend origin. */
export function resolveUrl(url) {
  if (!url) return '';
  if (/^(data:|blob:|https?:)/.test(url)) return url;
  return `${API_BASE}${url}`;
}

/** Uniform result type: { ok: true, data } | { ok: false, code, message, status }. */
const fail = (code, message, status = 0) => ({ ok: false, code, message, status });

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Combine the caller's signal with a client-side timeout. */
function withTimeout(signal, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('client timeout', 'TimeoutError')), ms);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function isUserAbort(e) {
  return e?.name === 'AbortError';
}

async function postJson(path, body, signal) {
  const t = withTimeout(signal, CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    let json;
    try {
      json = await res.json();
    } catch {
      return fail('TIMEOUT', `Non-JSON response (HTTP ${res.status})`, res.status); // §8 rule
    }
    if (res.ok) return { ok: true, data: json };
    const code = json?.error?.code;
    if (!ERROR_CODES.includes(code)) return fail('TIMEOUT', `Unknown error (HTTP ${res.status})`, res.status);
    return fail(code, json.error.message || code, res.status);
  } catch (e) {
    if (isUserAbort(e) && signal?.aborted) return fail('ABORTED', 'aborted');
    return fail('TIMEOUT', e?.name === 'TimeoutError' ? 'Client timeout' : 'Network error');
  } finally {
    t.done();
  }
}

function warnShape(name, problems) {
  if (problems.length && env.DEV) console.warn(`[contract] ${name} drift:`, problems);
}

// ---------- mock transport ----------

function jitterDetails(details, amount) {
  if (!amount) return details;
  return details.map((d) => {
    const [x, y, w, h] = d.bbox;
    const j = () => (Math.random() - 0.5) * 2 * amount;
    const nx = Math.min(Math.max(x + j(), 0), 1 - w);
    const ny = Math.min(Math.max(y + j(), 0), 1 - h);
    return { ...d, bbox: [nx, ny, w, h] };
  });
}

async function mockAnalyze({ lang, signal, mock }) {
  const scenario = MOCK_SCENARIOS[mock.scenario] ?? MOCK_SCENARIOS.secession;
  const t = withTimeout(signal, CLIENT_TIMEOUT_MS);
  try {
    if (scenario.hang) await abortableDelay(60_000, t.signal);
    await abortableDelay(mock.latencyMs, t.signal);
    const { status, body } = scenario.respond(lang);
    if (status !== 200) return fail(body.error.code, body.error.message, status);
    return { ok: true, data: { ...body, details: jitterDetails(body.details, mock.jitter) } };
  } catch (e) {
    if (signal?.aborted) return fail('ABORTED', 'aborted');
    return fail('TIMEOUT', e?.name === 'TimeoutError' ? 'Client timeout' : String(e));
  } finally {
    t.done();
  }
}

async function mockNarrateCall({ style, lang, signal, mock }) {
  try {
    await abortableDelay(mock.latencyMs, signal);
  } catch {
    return fail('ABORTED', 'aborted');
  }
  const noAudio = mock.scenario === 'no_audio';
  return { ok: true, data: mockNarrate(style, lang, { audio: !noAudio }) };
}

// ---------- public API ----------

/**
 * POST /analyze.
 * @param {{ image_base64: string, lang: 'ro'|'en', demo_fixture_id?: string, signal?: AbortSignal,
 *           mock?: { enabled: boolean, scenario: string, latencyMs: number, jitter: number } }} args
 */
export async function analyze({ image_base64, lang, demo_fixture_id, signal, mock }) {
  let r;
  if (mock?.enabled && !demo_fixture_id) r = await mockAnalyze({ lang, signal, mock });
  else {
    const body = { image_base64: demo_fixture_id ? '' : image_base64, lang };
    if (demo_fixture_id) body.demo_fixture_id = demo_fixture_id;
    r = await postJson('/analyze', body, signal);
  }
  if (r.ok) {
    const problems = checkAnalyzeResponse(r.data);
    warnShape('AnalyzeResponse', problems);
    if (!r.data || !Array.isArray(r.data.details) || !r.data.narration) {
      return fail('TIMEOUT', 'Malformed response');
    }
  }
  return r;
}

/** POST /narrate (language switch / replay without re-scanning). */
export async function narrate({ style, details, lang, signal, mock }) {
  let r;
  if (mock?.enabled) r = await mockNarrateCall({ style, lang, signal, mock });
  else {
    // Send plain Detail objects (translated_text is ignored by the backend anyway).
    const plain = details.map(({ id, label, type, bbox, raw_text }) => ({ id, label, type, bbox, raw_text }));
    r = await postJson('/narrate', { style, details: plain, lang }, signal);
  }
  if (r.ok) warnShape('NarrateResponse', checkNarrateResponse(r.data));
  return r;
}

export async function health() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
