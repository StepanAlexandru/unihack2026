// Grounded ~15 s narration (35–40 words, contract §5) from retrieved KB context.
// 1) Deterministic template engine: picks verified KB sentences whose total lands in 35–40 words.
// 2) Optional LLM rewrite of that same material; rejected unless it passes the grounding check.
import { contextCorpus } from './retriever.js';
import { wordCount, normalize } from './lib/text.js';

export const MIN_WORDS = 35;
export const MAX_WORDS = 40;
const TARGET = 38;

/**
 * Choose at most one option per slot (slots keep output order) so that the total word count is in
 * [MIN_WORDS, MAX_WORDS]. Maximises slot weights, then closeness to TARGET. Exhaustive DFS with pruning.
 */
export function fitSentences(slots) {
  const prepared = slots.map((s) => ({ ...s, options: (s.options ?? []).filter(Boolean).map((t) => ({ t, w: wordCount(t) })) }))
    .filter((s) => s.options.length || s.required);
  let best = null;
  let fallback = null;
  const pick = [];
  const dfs = (i, words, weight) => {
    if (words > MAX_WORDS) return;
    if (i === prepared.length) {
      const cand = { picks: [...pick], words, weight };
      const better = (a, b) => !b || a.weight > b.weight || (a.weight === b.weight && Math.abs(a.words - TARGET) < Math.abs(b.words - TARGET));
      if (words >= MIN_WORDS) { if (better(cand, best)) best = cand; }
      else if (!fallback || words > fallback.words) fallback = cand;
      return;
    }
    const s = prepared[i];
    s.options.forEach((o, k) => { pick.push(o.t); dfs(i + 1, words + o.w, weight + s.weight - k * 0.01); pick.pop(); });
    if (!s.required) dfs(i + 1, words, weight);
  };
  dfs(0, 0, 0);
  const chosen = best ?? fallback;
  return chosen ? { text: chosen.picks.join(' '), words: chosen.words, in_range: Boolean(best) } : { text: '', words: 0, in_range: false };
}

export function templateNarration(ctx) {
  const d = ctx.detail_facts;
  const slots = [
    { options: ctx.leads, weight: 20, required: true },
    ...ctx.building_facts.slice(0, 2).map((f, i) => ({ options: [f], weight: 6 - i })),
    // Visible details dominate: the visitor is pointing at them.
    ...d.map((f, i) => ({ options: f.sentences, weight: [30, 20, 15][i] ?? 10 })),
    // With a known building, style facts are a lower-priority filler; without one they carry the story.
    ...ctx.style_facts.slice(0, 3).map((f, i) => ({ options: [f], weight: (ctx.building ? 2 : 4) - i * 0.5 })),
    { options: ctx.closers, weight: 2 },
    { options: ctx.pads, weight: -1 },
    { options: ctx.pads, weight: -2 },
  ];
  return fitSentences(slots);
}

// ---------- grounding check ----------

const ALLOWED_CAPS = new Set(['i', 'look', 'notice', 'here', 'this', 'it', 'its']);

/**
 * Rejects text with any number, or any capitalised (proper-noun-like) word that is not in the context.
 * @returns {string[]} list of problems; empty = grounded
 */
export function groundingProblems(text, corpus) {
  const problems = [];
  const ctxNorm = ` ${normalize(corpus)} `;
  const ctxNums = new Set(corpus.match(/\d+/g) ?? []);
  for (const n of text.match(/\d+/g) ?? []) if (!ctxNums.has(n)) problems.push(`number ${n} not in KB context`);
  const sentences = text.split(/(?<=[.!?:;])\s+/);
  for (const s of sentences) {
    const words = s.split(/\s+/).slice(1); // first word of a sentence is capitalised anyway
    for (const raw of words) {
      const w = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (!w || !/^\p{Lu}/u.test(w)) continue;
      const nw = normalize(w);
      if (ALLOWED_CAPS.has(nw)) continue;
      if (!ctxNorm.includes(` ${nw} `) && !ctxNorm.includes(` ${nw.replace(/s$/, '')}`)) problems.push(`name "${w}" not in KB context`);
    }
  }
  const wc = wordCount(text);
  if (wc < MIN_WORDS || wc > MAX_WORDS) problems.push(`word count ${wc} outside ${MIN_WORDS}-${MAX_WORDS}`);
  return problems;
}

// ---------- LLM path ----------

export function buildPrompt(ctx, draft) {
  const language = ctx.lang === 'ro' ? 'Romanian (with correct diacritics ă â î ș ț)' : 'English';
  const system = [
    'You are the voice of a museum audio guide for heritage facades in Timișoara, Romania.',
    'STRICT RULES:',
    `1. Write ONE spoken paragraph in ${language}, between ${MIN_WORDS} and ${MAX_WORDS} words (about 15 seconds).`,
    '2. Use ONLY facts stated in FACTS. Never add dates, numbers, names, architects, owners or events that are not in FACTS.',
    '3. If FACTS name no building, do not name or guess one: talk about the style and the visible details.',
    '4. Mention the visible details listed under DETAILS, in that order of importance.',
    '5. Legends must stay framed as legends.',
    '6. Output only the paragraph: no title, no quotes around it, no lists, no markdown.',
  ].join('\n');
  const facts = [
    ctx.building ? `BUILDING: ${ctx.building.name}` : 'BUILDING: not identified',
    `STYLE: ${ctx.style_name}`,
    ...ctx.leads.map((s) => `- ${s}`),
    ...ctx.building_facts.map((s) => `- ${s}`),
    ...ctx.style_facts.map((s) => `- ${s}`),
    ctx.district ? `- ${ctx.district.fact}` : '',
    `- ${ctx.historical_context}`,
  ].filter(Boolean).join('\n');
  const details = ctx.detail_facts.length
    ? ctx.detail_facts.map((d, i) => `${i + 1}. ${d.ornament_name}: ${d.meaning}${d.sentences.length > 1 ? ` (${d.sentences[0]})` : ''}`).join('\n')
    : 'none';
  const user = `FACTS:\n${facts}\n\nDETAILS:\n${details}\n\nA valid draft you may improve (keep it grounded):\n${draft}\n\nWrite the ${MIN_WORDS}-${MAX_WORDS} word narration now.`;
  return { system, user };
}

/**
 * @returns {Promise<{ text: string, source: 'template'|'llm:<provider>', words: number, rejected?: string[] }>}
 */
export async function narrate(ctx, { llm = null } = {}) {
  const tpl = templateNarration(ctx);
  const base = { text: tpl.text, source: 'template', words: tpl.words };
  if (!llm) return base;
  try {
    const { system, user } = buildPrompt(ctx, tpl.text);
    const out = (await llm.complete({ system, user, maxTokens: 250 })).replace(/\s+/g, ' ').replace(/^["„“]|["”]$/g, '').trim();
    const problems = groundingProblems(out, contextCorpus(ctx));
    if (problems.length) return { ...base, rejected: problems };
    return { text: out, source: `llm:${llm.name}`, words: wordCount(out) };
  } catch (err) {
    return { ...base, rejected: [`llm error: ${err.message}`] };
  }
}
