// Text utilities shared by the retriever, translator and narrator.

/** Lowercase, strip diacritics (ș→s, ő→o, ü→u ...), collapse punctuation to spaces. Keeps Cyrillic. */
export function normalize(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokens(s) {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

export function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1.0 = identical. Tolerates OCR-ish noise ("BRUCK" vs "BRÜCK", "SZEKELY" vs "SZEKEIY"). */
export function similarity(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Fuzzy phrase match: does the (multi-word) keyword occur in the haystack tokens?
 * Short tokens (< 4 chars) must match exactly, longer ones with similarity ≥ 0.8.
 * Returns a score in [0, 1].
 */
export function phraseScore(keyword, haystackTokens) {
  const kw = tokens(keyword);
  if (!kw.length || !haystackTokens.length) return 0;
  let best = 0;
  for (let start = 0; start + kw.length <= haystackTokens.length; start++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < kw.length; k++) {
      const t = haystackTokens[start + k];
      const sim = kw[k].length < 4 ? (kw[k] === t ? 1 : 0) : similarity(kw[k], t);
      if (sim < 0.8) { ok = false; break; }
      sum += sim;
    }
    if (ok) best = Math.max(best, sum / kw.length);
  }
  return best;
}

/** Stable short hash helper input: JSON with sorted keys. */
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
