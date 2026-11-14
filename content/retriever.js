// Grounded retrieval: maps M2's { style, details } onto verified KB entries.
// Output is the ONLY material the narrator may use for factual claims.
import { loadKB } from './kb/loader.js';
import { phraseScore, tokens, normalize } from './lib/text.js';
import { translateInscription, translateWithLLM } from './translator.js';

const BUILDING_THRESHOLD = 0.85;
const MAX_DETAILS = 3;

/** Fuzzy alias score that refuses near-misses on short words ("bruck" must not match "brick"). */
function aliasScore(alias, hay) {
  const kw = tokens(alias);
  if (!kw.length) return 0;
  if (kw.length === 1 && kw[0].length < 6) return hay.includes(kw[0]) ? 1 : 0;
  const s = phraseScore(alias, hay);
  return s >= 0.85 ? s : 0;
}

export function identifyBuilding(style, details, kb = loadKB()) {
  const hay = tokens(details.map((d) => `${d.label ?? ''} ${d.raw_text ?? ''}`).join(' '));
  if (!hay.length) return { building: null, score: 0 };
  let best = { building: null, score: 0 };
  for (const b of kb.buildings) {
    let s = Math.max(0, ...b.aliases.map((a) => aliasScore(a, hay)));
    if (s && !b.styles.includes(style)) s *= 0.9; // text evidence still wins over a style mismatch
    if (s > best.score) best = { building: b, score: s };
  }
  return best.score >= BUILDING_THRESHOLD ? best : { building: null, score: best.score };
}

export function matchOrnament(detail, kb = loadKB()) {
  const hay = tokens(`${detail.label ?? ''} ${detail.raw_text ?? ''}`);
  let best = null;
  for (const o of kb.ornaments) {
    const typeMatch = o.detail_types.includes(detail.type);
    const kw = Math.max(0, ...o.keywords.map((k) => phraseScore(k, hay)));
    if (!typeMatch && kw < 0.85) continue;
    // primary type (first listed) is the default for that type when no keyword hits
    const score = kw + (typeMatch ? 0.3 : 0) + (o.detail_types[0] === detail.type ? 0.1 : 0);
    if (!best || score > best.score) best = { ornament: o, score };
  }
  return best?.ornament ?? kb.ornaments.find((o) => o.id === 'generic_element');
}

function ornamentSentence(ornament, style, lang) {
  const n = ornament.narration[style] ?? ornament.narration.default;
  return n[lang] ?? ornament.narration.default[lang];
}

function quoteSentence(detail, translation, lang) {
  const raw = String(detail.raw_text).trim().replace(/\s+/g, ' ');
  if (raw.split(' ').length > 8) return null; // too long to speak; it is on screen anyway
  const same = !translation || normalize(translation.translated) === normalize(raw);
  const isPlaque = detail.type === 'plaque';
  if (lang === 'ro') {
    const subj = isPlaque ? 'Placa' : 'Inscripția';
    return same ? `${subj} spune „${raw}”.` : `${subj} spune „${raw}”, adică „${translation.translated}”.`;
  }
  const subj = isPlaque ? 'The plaque' : 'The inscription';
  return same ? `${subj} reads “${raw}”.` : `${subj} reads “${raw}”, meaning “${translation.translated}”.`;
}

/**
 * @param {{ style: string, details: object[], lang: 'ro'|'en' }} input
 * @param {{ llm?: object|null }} [opts]
 */
export async function retrieve({ style, details, lang }, { llm = null } = {}) {
  const kb = loadKB();
  const st = kb.styles[style];

  // translations: one per detail with non-null raw_text (contract §5)
  const translations = [];
  for (const d of details) {
    if (d.raw_text == null) continue;
    let t = translateInscription(d.raw_text, lang);
    if (t.method === 'identity' && llm) t = (await translateWithLLM(d.raw_text, lang, llm)) ?? t;
    translations.push({ detail_id: d.id, original: d.raw_text, translated: t.translated, method: t.method, note: t.note, source_lang: t.source_lang });
  }
  const trById = new Map(translations.map((t) => [t.detail_id, t]));

  const { building, score } = identifyBuilding(style, details, kb);
  const district = building ? kb.index.districts.get(building.district) ?? null : null;

  const detailFacts = details.slice(0, MAX_DETAILS + 3).map((d) => {
    const ornament = matchOrnament(d, kb);
    const sentences = [];
    if (d.raw_text != null && String(d.raw_text).trim()) {
      const q = quoteSentence(d, trById.get(d.id), lang);
      if (q) sentences.push(q);
    }
    sentences.push(...ornamentSentence(ornament, style, lang));
    return { detail_id: d.id, type: d.type, label: d.label, ornament_id: ornament.id, ornament_name: ornament.name[lang], meaning: ornament.meaning[lang], sentences };
  });
  // Avoid narrating the same ornament twice (e.g. two masks).
  const seen = new Set();
  const uniqueDetailFacts = detailFacts.filter((f) => {
    const k = f.sentences.join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_DETAILS);

  const narr = st.narration[lang];
  const bNarr = building?.narration[lang];
  return {
    style,
    lang,
    style_name: st.names[lang],
    building: building
      ? { id: building.id, name: building.name[lang], architect: building.architect, confidence: building.confidence, score, sources: building.sources }
      : null,
    district: district ? { id: district.id, name: district.name[lang], fact: district.facts[lang] } : null,
    leads: bNarr ? bNarr.leads : narr.leads,
    building_facts: bNarr?.facts ?? [],
    style_facts: narr.facts ?? [],
    style_leads: narr.leads,
    closers: narr.closers ?? [],
    pads: kb.pads[lang],
    detail_facts: uniqueDetailFacts,
    translations,
    historical_context: building ? building.history[lang] : st.history[lang],
    why_it_matters: building ? building.why_it_matters[lang] : st.why_it_matters[lang],
  };
}

/** All grounded text, used by the LLM prompt and by the hallucination check. */
export function contextCorpus(ctx) {
  return [
    ...ctx.leads, ...ctx.style_leads, ...ctx.building_facts, ...ctx.style_facts, ...ctx.closers,
    ...ctx.detail_facts.flatMap((d) => [...d.sentences, d.meaning, d.ornament_name]),
    ...ctx.translations.flatMap((t) => [t.original, t.translated]),
    ctx.historical_context, ctx.why_it_matters, ctx.district?.fact ?? '', ctx.building?.name ?? '', ctx.style_name,
  ].join('\n');
}
