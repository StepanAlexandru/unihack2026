// Loads and validates the Timișoara knowledge base once, and builds lookup indexes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalize } from '../lib/text.js';

const KB_PATH = join(dirname(fileURLToPath(import.meta.url)), 'timisoara_kb.json');

/** The 5 styles of docs/contracts.md §3. */
export const STYLES = ['Secession', 'Baroque', 'Brutalist', 'Eclectic', 'Neoclassical'];
export const DETAIL_TYPES = ['mask', 'lion_head', 'guild_symbol', 'plaque', 'inscription', 'architectural_element'];
export const LANGS = ['ro', 'en'];

let cached = null;

export function loadKB() {
  if (cached) return cached;
  const kb = JSON.parse(readFileSync(KB_PATH, 'utf8'));
  validateKB(kb);

  const ornamentsByType = new Map(DETAIL_TYPES.map((t) => [t, []]));
  for (const o of kb.ornaments) for (const t of o.detail_types) ornamentsByType.get(t)?.push(o);

  const glossary = new Map(Object.entries(kb.inscriptions.glossary).map(([k, v]) => [normalize(k), v]));
  const phrases = kb.inscriptions.phrases.flatMap((p) => p.src.map((s) => ({ key: normalize(s), ...p })));
  const patterns = kb.inscriptions.patterns.map((p) => ({ ...p, re: new RegExp(p.regex, 'iu') }));
  const districts = new Map(kb.districts.map((d) => [d.id, d]));

  cached = { ...kb, index: { ornamentsByType, glossary, phrases, patterns, districts } };
  return cached;
}

/** Throws on a structurally broken KB so mistakes surface at startup, not on stage. */
export function validateKB(kb) {
  const errs = [];
  const bi = (o, path) => {
    for (const l of LANGS) if (typeof o?.[l] !== 'string' || !o[l].trim()) errs.push(`${path}.${l} missing`);
  };
  for (const s of STYLES) {
    const st = kb.styles?.[s];
    if (!st) { errs.push(`styles.${s} missing`); continue; }
    bi(st.history, `styles.${s}.history`);
    bi(st.why_it_matters, `styles.${s}.why_it_matters`);
    for (const l of LANGS) {
      const n = st.narration?.[l];
      if (!n?.leads?.length) errs.push(`styles.${s}.narration.${l}.leads empty`);
    }
  }
  for (const b of kb.buildings ?? []) {
    bi(b.name, `buildings.${b.id}.name`);
    bi(b.history, `buildings.${b.id}.history`);
    bi(b.why_it_matters, `buildings.${b.id}.why_it_matters`);
    if (!b.styles?.every((s) => STYLES.includes(s))) errs.push(`buildings.${b.id}.styles has non-contract style`);
    if (!b.sources?.length) errs.push(`buildings.${b.id} has no sources`);
    for (const l of LANGS) if (!b.narration?.[l]?.leads?.length) errs.push(`buildings.${b.id}.narration.${l}.leads empty`);
  }
  for (const o of kb.ornaments ?? []) {
    if (!o.detail_types?.every((t) => DETAIL_TYPES.includes(t))) errs.push(`ornaments.${o.id} bad detail_types`);
    for (const l of LANGS) if (!o.narration?.default?.[l]?.length) errs.push(`ornaments.${o.id}.narration.default.${l} empty`);
  }
  for (const t of DETAIL_TYPES) {
    if (!(kb.ornaments ?? []).some((o) => o.detail_types.includes(t))) errs.push(`no ornament covers type ${t}`);
  }
  for (const l of LANGS) if (!kb.pads?.[l]?.length) errs.push(`pads.${l} empty`);
  if (errs.length) throw new Error(`Invalid Timișoara KB:\n - ${errs.join('\n - ')}`);
}
