import { ApiError } from './errors.js';
import { DETAIL_TYPES, FIXTURE_ID_RE, LANGS, MAX_DETAILS, STYLES, wordCount } from './contract.js';

const DATA_URL_RE = /^data:([a-z0-9.+/-]+)?;base64,/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkLang(lang) {
  if (!LANGS.includes(lang)) throw new ApiError('INVALID_INPUT', 'lang must be "ro" or "en".');
}

/**
 * §6 steps 1-3. Returns { lang, fixtureId } or { lang, image: Buffer, raw_base64 }.
 * `headerFixture` is the optional `x-demo-fixture` header (same rules as demo_fixture_id).
 */
export function parseAnalyzeRequest(body, { maxImageBytes, headerFixture }) {
  if (!isObj(body)) throw new ApiError('INVALID_INPUT', 'Request body must be a JSON object.');
  checkLang(body.lang);

  const fixtureId = body.demo_fixture_id ?? headerFixture;
  if (fixtureId !== undefined && fixtureId !== null) {
    if (typeof fixtureId !== 'string' || !FIXTURE_ID_RE.test(fixtureId)) {
      throw new ApiError('INVALID_INPUT', 'demo_fixture_id must match /^[a-z0-9_-]{1,64}$/.');
    }
    return { lang: body.lang, fixtureId };
  }

  if (typeof body.image_base64 !== 'string' || body.image_base64.length === 0) {
    throw new ApiError('INVALID_INPUT', 'image_base64 must be a non-empty base64 string.');
  }
  const raw = body.image_base64.replace(DATA_URL_RE, '').replace(/\s+/g, '');
  if (raw.length === 0 || raw.length % 4 === 1 || !BASE64_RE.test(raw)) {
    throw new ApiError('INVALID_INPUT', 'image_base64 is not valid base64.');
  }
  // Cheap size check before decoding: decoded bytes ~= 3/4 of the base64 length.
  if (Math.floor((raw.length * 3) / 4) > maxImageBytes + 2) {
    throw new ApiError('INVALID_INPUT', `Image is larger than the ${maxImageBytes}-byte limit.`, 413);
  }
  const image = Buffer.from(raw, 'base64');
  if (image.length > maxImageBytes) {
    throw new ApiError('INVALID_INPUT', `Image is larger than the ${maxImageBytes}-byte limit.`, 413);
  }
  const isJpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const isPng = image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (!isJpeg && !isPng) throw new ApiError('INVALID_INPUT', 'image_base64 must be a JPEG or PNG image.');
  return { lang: body.lang, image, raw_base64: raw };
}

/** §7 request. Accepts AnalyzedDetail too; translated_text and unknown fields are dropped. */
export function parseNarrateRequest(body) {
  if (!isObj(body)) throw new ApiError('INVALID_INPUT', 'Request body must be a JSON object.');
  if (!STYLES.includes(body.style)) throw new ApiError('INVALID_INPUT', `style must be one of ${STYLES.join(', ')}.`);
  checkLang(body.lang);
  if (!Array.isArray(body.details)) throw new ApiError('INVALID_INPUT', 'details must be an array.');
  if (body.details.length > 20) throw new ApiError('INVALID_INPUT', 'details must have at most 20 items.');
  const details = body.details.map((d, i) => {
    if (!isObj(d)) throw new ApiError('INVALID_INPUT', `details[${i}] must be an object.`);
    if (typeof d.id !== 'string' || !d.id || typeof d.label !== 'string' || !DETAIL_TYPES.includes(d.type)) {
      throw new ApiError('INVALID_INPUT', `details[${i}] must have string id, string label and a valid type.`);
    }
    if (!Array.isArray(d.bbox) || d.bbox.length !== 4 || !d.bbox.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new ApiError('INVALID_INPUT', `details[${i}].bbox must be [x, y, w, h] numbers.`);
    }
    const raw_text = d.raw_text ?? null;
    if (raw_text !== null && typeof raw_text !== 'string') throw new ApiError('INVALID_INPUT', `details[${i}].raw_text must be a string or null.`);
    return { id: d.id, label: d.label, type: d.type, bbox: d.bbox, raw_text };
  });
  return { style: body.style, lang: body.lang, details };
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** Clamp a bbox into the unit square; null if nothing visible is left. */
export function clampBBox(b) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, w, h] = b;
  const x0 = clamp01(x), y0 = clamp01(y), x1 = clamp01(x + w), y1 = clamp01(y + h);
  const rx = round4(x0), ry = round4(y0);
  // Floor the size so rounding can never push x+w or y+h past 1.
  // (+1e-7 absorbs float noise such as 1 - 0.8 = 0.19999999999999996)
  const rw = Math.floor((x1 - rx) * 1e4 + 1e-7) / 1e4, rh = Math.floor((y1 - ry) * 1e4 + 1e-7) / 1e4;
  if (rw <= 0 || rh <= 0) return null;
  return [rx, ry, rw, rh];
}

/**
 * §6 step 5: clamp bboxes, drop non-conforming details, keep at most 6.
 * Throws a plain Error (→ 504 TIMEOUT) only if the result is unusable as a whole.
 */
export function sanitizeVisionResult(r) {
  if (!isObj(r)) throw new Error('vision returned a non-object');
  if (!(r.style === null || STYLES.includes(r.style))) throw new Error(`vision returned an unknown style: ${String(r.style).slice(0, 40)}`);
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? clamp01(r.confidence) : 0;
  const seen = new Set();
  const details = [];
  for (const d of Array.isArray(r.details) ? r.details : []) {
    if (details.length >= MAX_DETAILS) break;
    if (!isObj(d) || typeof d.id !== 'string' || !d.id || seen.has(d.id)) continue;
    if (typeof d.label !== 'string' || !DETAIL_TYPES.includes(d.type)) continue;
    const bbox = clampBBox(d.bbox);
    if (!bbox) continue;
    const raw_text = typeof d.raw_text === 'string' && d.raw_text.trim() ? d.raw_text : null;
    seen.add(d.id);
    details.push({ id: d.id, label: d.label, type: d.type, bbox, raw_text });
  }
  return { style: r.style, confidence, details };
}

/** Tolerant normalization of M3 output; fills missing optional parts, rejects missing text. */
export function normalizeNarration(r) {
  if (!isObj(r) || typeof r.text !== 'string' || !r.text.trim()) throw new Error('content returned no narration text');
  const e = isObj(r.enrichments) ? r.enrichments : {};
  const str = (v) => (typeof v === 'string' ? v : '');
  const strOrNull = (v) => (typeof v === 'string' ? v : null);
  return {
    text: r.text,
    audio_url: typeof r.audio_url === 'string' ? r.audio_url : '',
    duration_s: typeof r.duration_s === 'number' && Number.isFinite(r.duration_s) ? r.duration_s : Math.round((wordCount(r.text) / 2.5) * 10) / 10,
    enrichments: {
      building_name: strOrNull(e.building_name),
      architect: strOrNull(e.architect),
      historical_context: str(e.historical_context),
      why_it_matters: str(e.why_it_matters),
      translations: Array.isArray(e.translations) ? e.translations.filter((t) => isObj(t) && typeof t.detail_id === 'string' && typeof t.translated === 'string') : [],
    },
  };
}

/** §6 merge mapping. */
export function mergeAnalyze(vision, narration) {
  const tr = new Map(narration.enrichments.translations.map((t) => [t.detail_id, t.translated]));
  return {
    style: vision.style,
    confidence: vision.confidence,
    details: vision.details.map((d) => ({ ...d, translated_text: d.raw_text === null ? null : tr.get(d.id) ?? null })),
    narration: {
      text: narration.text,
      audio_url: narration.audio_url,
      duration_s: narration.duration_s,
      building_name: narration.enrichments.building_name,
      history: narration.enrichments.historical_context,
      why_it_matters: narration.enrichments.why_it_matters,
    },
  };
}

export function toNarrateResponse(n) {
  return { text: n.text, audio_url: n.audio_url, duration_s: n.duration_s, history: n.enrichments.historical_context, why_it_matters: n.enrichments.why_it_matters };
}
