// Shape checks against docs/contracts.md §3 and §5, so drift shows up before integration.
import { STYLES, DETAIL_TYPES, LANGS } from '../kb/loader.js';
import { wordCount } from './text.js';

export function inputProblems(input) {
  const p = [];
  if (!input || typeof input !== 'object') return ['input must be an object'];
  if (!STYLES.includes(input.style)) p.push(`style must be one of ${STYLES.join(', ')}`);
  if (!LANGS.includes(input.lang)) p.push('lang must be "ro" or "en"');
  if (!Array.isArray(input.details)) p.push('details must be an array');
  else input.details.forEach((d, i) => {
    if (!d || typeof d !== 'object') return p.push(`details[${i}] must be an object`);
    if (typeof d.id !== 'string' || !d.id) p.push(`details[${i}].id must be a non-empty string`);
    if (typeof d.label !== 'string') p.push(`details[${i}].label must be a string`);
    if (!DETAIL_TYPES.includes(d.type)) p.push(`details[${i}].type invalid`);
    if (d.raw_text !== null && d.raw_text !== undefined && typeof d.raw_text !== 'string') p.push(`details[${i}].raw_text must be string|null`);
  });
  return p;
}

export function resultProblems(r, input) {
  const p = [];
  const str = (v) => typeof v === 'string';
  if (!str(r?.text) || !r.text.trim()) p.push('text must be a non-empty string');
  else {
    const wc = wordCount(r.text);
    if (wc < 35 || wc > 40) p.push(`text has ${wc} words (contract: 35–40)`);
  }
  if (!str(r?.audio_url)) p.push('audio_url must be a string');
  else if (r.audio_url && !/^\/audio\/cache\/[A-Za-z0-9_-]+\.mp3$/.test(r.audio_url) && !r.audio_url.startsWith('data:audio/mpeg;base64,')) p.push(`audio_url has bad form: ${r.audio_url.slice(0, 60)}`);
  if (typeof r?.duration_s !== 'number' || !(r.duration_s > 0)) p.push('duration_s must be a positive number');
  const e = r?.enrichments;
  if (!e || typeof e !== 'object') return [...p, 'enrichments missing'];
  for (const k of ['building_name', 'architect']) if (!(k in e) || (e[k] !== null && !str(e[k]))) p.push(`enrichments.${k} must be string|null (and present)`);
  for (const k of ['historical_context', 'why_it_matters']) if (!str(e[k]) || !e[k].trim()) p.push(`enrichments.${k} must be a non-empty string`);
  if (!Array.isArray(e.translations)) p.push('enrichments.translations must be an array');
  else {
    for (const t of e.translations) if (!str(t.detail_id) || !str(t.original) || !str(t.translated)) p.push('translation entry malformed');
    if (input) {
      const want = input.details.filter((d) => d.raw_text != null).map((d) => d.id).sort().join(',');
      const got = e.translations.map((t) => t.detail_id).sort().join(',');
      if (want !== got) p.push(`translations detail_ids [${got}] != details with raw_text [${want}]`);
    }
  }
  return p;
}
