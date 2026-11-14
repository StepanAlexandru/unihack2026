// Contract constants + shape checks for docs/contracts.md v1.x.
// Every check returns an array of problems ([] = valid) so tests, the demo-asset
// builder and the runtime can all share it and drift shows up early (CLAUDE.md §6).

export const LANGS = ['ro', 'en'];
export const STYLES = ['Secession', 'Baroque', 'Brutalist', 'Eclectic', 'Neoclassical'];
export const DETAIL_TYPES = ['mask', 'lion_head', 'guild_symbol', 'plaque', 'inscription', 'architectural_element'];
export const ERROR_CODES = ['NO_MATCH', 'LOW_CONFIDENCE', 'TIMEOUT', 'INVALID_INPUT'];
export const ERROR_STATUS = { INVALID_INPUT: 400, NO_MATCH: 422, LOW_CONFIDENCE: 422, TIMEOUT: 504 };
export const FIXTURE_ID_RE = /^[a-z0-9_-]{1,64}$/;
export const AUDIO_FILE_RE = /^[A-Za-z0-9_-]+\.mp3$/;
export const MAX_DETAILS = 6;

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStrOrNull = (v) => v === null || isStr(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

export function checkBBox(b, where = 'bbox') {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum)) return [`${where} must be [x,y,w,h] numbers`];
  const [x, y, w, h] = b;
  const p = [];
  if (x < 0 || y < 0) p.push(`${where}: x,y must be >= 0`);
  if (w <= 0 || h <= 0) p.push(`${where}: w,h must be > 0`);
  if (x + w > 1 + 1e-9 || y + h > 1 + 1e-9) p.push(`${where}: x+w and y+h must be <= 1`);
  return p;
}

export function checkDetail(d, where = 'detail', { analyzed = false } = {}) {
  if (!isObj(d)) return [`${where} must be an object`];
  const p = [];
  if (!isStr(d.id) || !d.id) p.push(`${where}.id must be a non-empty string`);
  if (!isStr(d.label)) p.push(`${where}.label must be a string`);
  if (!DETAIL_TYPES.includes(d.type)) p.push(`${where}.type must be one of ${DETAIL_TYPES.join('|')}`);
  p.push(...checkBBox(d.bbox, `${where}.bbox`));
  if (!('raw_text' in d) || !isStrOrNull(d.raw_text)) p.push(`${where}.raw_text must be string|null`);
  if (analyzed) {
    if (!('translated_text' in d) || !isStrOrNull(d.translated_text)) p.push(`${where}.translated_text must be string|null`);
    else if (d.raw_text === null && d.translated_text !== null) p.push(`${where}.translated_text must be null when raw_text is null`);
  }
  return p;
}

function checkDetails(list, where, opts) {
  if (!Array.isArray(list)) return [`${where} must be an array`];
  const p = list.flatMap((d, i) => checkDetail(d, `${where}[${i}]`, opts));
  const ids = list.map((d) => d && d.id);
  if (new Set(ids).size !== ids.length) p.push(`${where}: ids must be unique`);
  return p;
}

/** §4 VisionResult (M2 output). */
export function checkVisionResult(r) {
  if (!isObj(r)) return ['VisionResult must be an object'];
  const p = [];
  if (!(r.style === null || STYLES.includes(r.style))) p.push('style must be a Style or null');
  if (!isNum(r.confidence) || r.confidence < 0 || r.confidence > 1) p.push('confidence must be a number in 0..1');
  p.push(...checkDetails(r.details, 'details'));
  if (Array.isArray(r.details) && r.details.length > MAX_DETAILS) p.push(`details must have at most ${MAX_DETAILS} items`);
  return p;
}

/** §5 NarrationResult (M3 output). */
export function checkNarrationResult(r) {
  if (!isObj(r)) return ['NarrationResult must be an object'];
  const p = [];
  if (!isStr(r.text) || !r.text) p.push('text must be a non-empty string');
  if (!isStr(r.audio_url)) p.push('audio_url must be a string');
  if (!isNum(r.duration_s)) p.push('duration_s must be a number');
  const e = r.enrichments;
  if (!isObj(e)) return [...p, 'enrichments must be an object'];
  if (!isStrOrNull(e.building_name)) p.push('enrichments.building_name must be string|null');
  if (!isStrOrNull(e.architect)) p.push('enrichments.architect must be string|null');
  if (!isStr(e.historical_context)) p.push('enrichments.historical_context must be a string');
  if (!isStr(e.why_it_matters)) p.push('enrichments.why_it_matters must be a string');
  if (!Array.isArray(e.translations)) p.push('enrichments.translations must be an array');
  else e.translations.forEach((t, i) => {
    if (!isObj(t) || !isStr(t.detail_id) || !isStr(t.original) || !isStr(t.translated)) p.push(`enrichments.translations[${i}] must be {detail_id, original, translated}`);
  });
  return p;
}

/** §6 AnalyzeResponse. */
export function checkAnalyzeResponse(r) {
  if (!isObj(r)) return ['AnalyzeResponse must be an object'];
  const p = [];
  if (!STYLES.includes(r.style)) p.push('style must be a Style (never null in a 200)');
  if (!isNum(r.confidence) || r.confidence < 0 || r.confidence > 1) p.push('confidence must be a number in 0..1');
  p.push(...checkDetails(r.details, 'details', { analyzed: true }));
  const n = r.narration;
  if (!isObj(n)) return [...p, 'narration must be an object'];
  if (!isStr(n.text) || !n.text) p.push('narration.text must be a non-empty string');
  if (!isStr(n.audio_url)) p.push('narration.audio_url must be a string');
  if (!isNum(n.duration_s)) p.push('narration.duration_s must be a number');
  if (!isStrOrNull(n.building_name)) p.push('narration.building_name must be string|null');
  if (!isStr(n.history)) p.push('narration.history must be a string');
  if (!isStr(n.why_it_matters)) p.push('narration.why_it_matters must be a string');
  return p;
}

/** §7 NarrateResponse. */
export function checkNarrateResponse(r) {
  if (!isObj(r)) return ['NarrateResponse must be an object'];
  const p = [];
  if (!isStr(r.text) || !r.text) p.push('text must be a non-empty string');
  if (!isStr(r.audio_url)) p.push('audio_url must be a string');
  if (!isNum(r.duration_s)) p.push('duration_s must be a number');
  if (!isStr(r.history)) p.push('history must be a string');
  if (!isStr(r.why_it_matters)) p.push('why_it_matters must be a string');
  return p;
}

/** §8 ErrorResponse: exactly { error: { code, message } }. */
export function checkErrorResponse(r) {
  if (!isObj(r) || !isObj(r.error)) return ['ErrorResponse must be { error: {...} }'];
  const p = [];
  if (!ERROR_CODES.includes(r.error.code)) p.push(`error.code must be one of ${ERROR_CODES.join('|')}`);
  if (!isStr(r.error.message) || !r.error.message) p.push('error.message must be a non-empty string');
  return p;
}
