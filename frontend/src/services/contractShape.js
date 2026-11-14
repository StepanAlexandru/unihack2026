// Runtime shape checks against docs/contracts.md v1.0.0. They return a list of problems
// (empty = OK). Used by the API client (dev warnings) and scripts/check-contract.mjs.

export const STYLES = ['Secession', 'Baroque', 'Brutalist', 'Eclectic', 'Neoclassical'];
export const DETAIL_TYPES = ['mask', 'lion_head', 'guild_symbol', 'plaque', 'inscription', 'architectural_element'];
export const ERROR_CODES = ['NO_MATCH', 'LOW_CONFIDENCE', 'TIMEOUT', 'INVALID_INPUT'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isNullableStr = (v) => v === null || isStr(v);

function checkBBox(b, path, out) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum)) {
    out.push(`${path}: must be [x, y, w, h] numbers`);
    return;
  }
  const [x, y, w, h] = b;
  const eps = 1e-6;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 + eps || y + h > 1 + eps) {
    out.push(`${path}: out of range ${JSON.stringify(b)}`);
  }
}

function checkDetail(d, path, out, analyzed) {
  if (!d || typeof d !== 'object') return out.push(`${path}: not an object`);
  if (!isStr(d.id)) out.push(`${path}.id: string required`);
  if (!isStr(d.label)) out.push(`${path}.label: string required`);
  if (!DETAIL_TYPES.includes(d.type)) out.push(`${path}.type: unknown "${d.type}"`);
  checkBBox(d.bbox, `${path}.bbox`, out);
  if (!('raw_text' in d) || !isNullableStr(d.raw_text)) out.push(`${path}.raw_text: string|null required`);
  if (analyzed) {
    if (!('translated_text' in d) || !isNullableStr(d.translated_text))
      out.push(`${path}.translated_text: string|null required`);
    if (d.raw_text === null && d.translated_text !== null)
      out.push(`${path}.translated_text: must be null when raw_text is null`);
  }
}

export function checkAnalyzeResponse(r) {
  const out = [];
  if (!r || typeof r !== 'object') return ['response: not an object'];
  if (!STYLES.includes(r.style)) out.push(`style: unknown "${r.style}"`);
  if (!isNum(r.confidence) || r.confidence < 0 || r.confidence > 1) out.push('confidence: number 0..1 required');
  if (!Array.isArray(r.details)) out.push('details: array required');
  else {
    if (r.details.length > 6) out.push('details: at most 6');
    r.details.forEach((d, i) => checkDetail(d, `details[${i}]`, out, true));
    const ids = r.details.map((d) => d?.id);
    if (new Set(ids).size !== ids.length) out.push('details: ids must be unique');
  }
  const n = r.narration;
  if (!n || typeof n !== 'object') out.push('narration: object required');
  else {
    if (!isStr(n.text)) out.push('narration.text: string required');
    if (!isStr(n.audio_url)) out.push('narration.audio_url: string required ("" allowed)');
    if (!isNum(n.duration_s)) out.push('narration.duration_s: number required');
    if (!('building_name' in n) || !isNullableStr(n.building_name)) out.push('narration.building_name: string|null required');
    if (!isStr(n.history)) out.push('narration.history: string required');
    if (!isStr(n.why_it_matters)) out.push('narration.why_it_matters: string required');
  }
  return out;
}

export function checkNarrateResponse(r) {
  const out = [];
  if (!r || typeof r !== 'object') return ['response: not an object'];
  if (!isStr(r.text)) out.push('text: string required');
  if (!isStr(r.audio_url)) out.push('audio_url: string required');
  if (!isNum(r.duration_s)) out.push('duration_s: number required');
  if (!isStr(r.history)) out.push('history: string required');
  if (!isStr(r.why_it_matters)) out.push('why_it_matters: string required');
  return out;
}

export function checkErrorResponse(r) {
  const out = [];
  if (!r?.error || typeof r.error !== 'object') return ['error: object required'];
  if (!ERROR_CODES.includes(r.error.code)) out.push(`error.code: unknown "${r.error.code}"`);
  if (!isStr(r.error.message)) out.push('error.message: string required');
  return out;
}
