// Deterministic inscription translator (Latin, Hungarian, German, Serbian, Romanian → ro | en).
// Order: exact phrase → regex pattern (dates, "built in", ...) → contained phrase → glossary → identity.
// Never invents: anything it cannot translate is returned verbatim (method "identity").
import { loadKB } from './kb/loader.js';
import { normalize } from './lib/text.js';

const ROMAN = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };

export function romanToInt(s) {
  const up = String(s).toUpperCase();
  if (!/^[MDCLXVI]+$/.test(up)) return null;
  let total = 0;
  for (let i = 0; i < up.length; i++) {
    const v = ROMAN[up[i]];
    const next = ROMAN[up[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  // Reject non-canonical numerals (e.g. "IIII", "VX") by round-tripping.
  return intToRoman(total) === up ? total : null;
}

function intToRoman(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out;
}

function fmtYear(y) {
  if (/^\d+$/.test(y)) return y;
  const n = romanToInt(y);
  return n ? `${y.toUpperCase()} (${n})` : y;
}

function fill(template, groups) {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = groups?.[k] ?? '';
    return /year|y\d/.test(k) ? fmtYear(v) : v.trim();
  });
}

function translateSegment(seg, lang, kb) {
  const text = seg.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const key = normalize(text);

  // 1. exact known phrase
  const phrase = kb.index.phrases.find((p) => p.key === key);
  if (phrase) return { translated: phrase[lang], source_lang: phrase.lang, method: 'phrase', note: phrase.note?.[lang] ?? null };

  // 2. structural pattern (dates, built/renovated/founded in ...)
  for (const p of kb.index.patterns) {
    const m = text.toUpperCase().match(p.re) || text.match(p.re);
    if (m) return { translated: fill(p[lang], m.groups), source_lang: null, method: 'pattern', note: null };
  }

  // 3. a known phrase contained in a longer text (e.g. motto + year)
  const contained = kb.index.phrases
    .filter((p) => p.key.length >= 6 && ` ${key} `.includes(` ${p.key} `))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (contained) {
    const rest = ` ${key} `.replace(` ${contained.key} `, ' ').trim();
    const restT = rest ? translateSegment(rest, lang, kb) : null;
    const tail = restT && restT.method !== 'identity' ? `, ${restT.translated}` : rest ? ` ${rest.toUpperCase()}` : '';
    return { translated: `${contained[lang]}${tail}`, source_lang: contained.lang, method: 'phrase', note: contained.note?.[lang] ?? null };
  }

  // 4. word-by-word glossary; unknown words (usually names) are kept verbatim
  const words = text.split(/\s+/);
  const mapped = words.map((w) => {
    const g = kb.index.glossary.get(normalize(w));
    if (g) return { w, t: g[lang], lang: g.lang, pos: g.pos, known: true };
    const yr = w.replace(/\.$/, '');
    if (/^\d{4}$/.test(yr) || romanToInt(yr)) return { w, t: fmtYear(yr), known: true, num: true };
    return { w, t: w, known: false };
  });
  const known = mapped.filter((m) => m.known && !m.num);
  // already in the target language (e.g. a Romanian plaque narrated in Romanian): keep verbatim
  if (known.length && known.every((m) => m.lang === lang)) return { translated: text, source_lang: lang, method: 'identity', note: null };
  if (known.length) {
    let parts = mapped;
    // Hungarian/German/Serbian put modifiers first; Romanian puts adjectives and "din …" phrases after the noun.
    if (lang === 'ro') {
      const post = (m) => /^(din|de) /.test(m.t);
      parts = [...mapped.filter((m) => !post(m) && m.pos !== 'adj'), ...mapped.filter((m) => m.pos === 'adj'), ...mapped.filter(post)];
    }
    return { translated: parts.map((m) => m.t).join(' '), source_lang: known[0].lang ?? null, method: 'glossary', note: null };
  }

  return { translated: text, source_lang: null, method: 'identity', note: null };
}

/**
 * Translate one raw_text into `lang`.
 * @returns {{ translated: string, source_lang: string|null, method: 'phrase'|'pattern'|'glossary'|'identity'|'llm', note: string|null }}
 */
export function translateInscription(raw, lang) {
  const kb = loadKB();
  const segments = String(raw ?? '').split(/\s*(?:\n|\r|\||•|·|;)\s*/).filter((s) => s.trim());
  if (!segments.length) return { translated: String(raw ?? ''), source_lang: null, method: 'identity', note: null };
  const results = segments.map((s) => translateSegment(s, lang, kb));
  const methods = results.map((r) => r.method);
  return {
    translated: results.map((r) => r.translated).join('. '),
    source_lang: results.find((r) => r.source_lang)?.source_lang ?? null,
    method: methods.every((m) => m === 'identity') ? 'identity' : methods.find((m) => m !== 'identity'),
    note: results.find((r) => r.note)?.note ?? null,
  };
}

/**
 * Optional LLM fallback for text the deterministic translator does not know.
 * The result is rejected if it introduces digits that are not in the original.
 */
export async function translateWithLLM(raw, lang, llm) {
  if (!llm) return null;
  const target = lang === 'ro' ? 'Romanian' : 'English';
  const out = await llm.complete({
    system: 'You translate short facade inscriptions from Timișoara (Hungarian, German, Latin, Serbian, Romanian). Reply with the translation only: no quotes, no commentary, no added facts. Keep personal and company names unchanged.',
    user: `Translate into ${target}:\n${raw}`,
    maxTokens: 120,
  }).catch(() => null);
  if (!out) return null;
  const t = out.trim().replace(/^["„“]|["”]$/g, '').split('\n')[0].trim();
  const digitsIn = new Set(String(raw).match(/\d+/g) ?? []);
  if (!t || t.length > 200 || (t.match(/\d+/g) ?? []).some((d) => !digitsIn.has(d))) return null;
  return { translated: t, source_lang: null, method: 'llm', note: null };
}
