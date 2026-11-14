/**
 * Benchmark metrics. Definitions:
 *  - Style accuracy:  predicted style === expected style (null is its own class). A thrown error is wrong.
 *  - Detail matching: per case, greedy one-to-one matching of predicted ↔ expected details of the SAME type,
 *                     highest IoU first. Matched pairs are true positives.
 *  - Type precision:  TP / predicted details.   Type recall: TP / expected details.
 *  - Mean IoU:        over matched pairs whose expected detail has a bbox.
 *  - IoU ≥ 0.5 rate:  share of those pairs with IoU ≥ 0.5.
 *  - Inscription CER: Levenshtein(pred, expected) / len(expected) per expected detail with raw_text,
 *                     capped at 1. A missed detail or null text counts as 1. Text is NFC-normalized and
 *                     whitespace-collapsed; comparison is case-sensitive.
 */
import { iou } from "../geometry.js";

export function normalizeText(s) {
  return String(s).normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Levenshtein distance over Unicode code points. */
export function levenshtein(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

/** Character error rate of `predicted` against `expected`, in [0, 1]. */
export function characterErrorRate(predicted, expected) {
  const exp = normalizeText(expected);
  if (typeof predicted !== "string") return 1;
  const pred = normalizeText(predicted);
  if (exp.length === 0) return pred.length === 0 ? 0 : 1;
  return Math.min(1, levenshtein(pred, exp) / Array.from(exp).length);
}

/**
 * Greedy same-type matching, highest IoU first. Pairs without boxes sort last.
 * @returns {{ e: number, p: number, iou: number|null }[]} indexes into expected / predicted
 */
export function matchDetails(expected, predicted) {
  const pairs = [];
  expected.forEach((e, i) =>
    predicted.forEach((p, j) => {
      if (e.type === p.type) pairs.push({ e: i, p: j, iou: e.bbox && p.bbox ? iou(e.bbox, p.bbox) : null });
    }),
  );
  pairs.sort((a, b) => (b.iou ?? -1) - (a.iou ?? -1));
  const usedE = new Set();
  const usedP = new Set();
  const matches = [];
  for (const pair of pairs) {
    if (usedE.has(pair.e) || usedP.has(pair.p)) continue;
    usedE.add(pair.e);
    usedP.add(pair.p);
    matches.push(pair);
  }
  return matches;
}

/** Score one case. `prediction` is a VisionResult, or null when analyzeImage threw. */
export function evaluateCase(expected, prediction) {
  const expDetails = expected.details ?? [];
  const predDetails = prediction?.details ?? [];
  const matches = matchDetails(expDetails, predDetails);
  const ious = matches.filter((m) => m.iou !== null).map((m) => m.iou);
  const text = [];
  expDetails.forEach((e, i) => {
    if (typeof e.raw_text !== "string" || e.raw_text.trim() === "") return;
    const m = matches.find((x) => x.e === i);
    const predicted = m ? predDetails[m.p].raw_text : null;
    text.push({
      expected: e.raw_text,
      predicted,
      cer: characterErrorRate(predicted, e.raw_text),
      exact: typeof predicted === "string" && normalizeText(predicted) === normalizeText(e.raw_text),
    });
  });
  return {
    expected_style: expected.style ?? null,
    predicted_style: prediction ? prediction.style : undefined,
    style_correct: prediction ? prediction.style === (expected.style ?? null) : false,
    n_expected: expDetails.length,
    n_predicted: predDetails.length,
    tp: matches.length,
    ious,
    text,
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratio = (num, den) => (den > 0 ? num / den : null);

function percentile(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

/**
 * Aggregate case results: { eval, latency_ms, ok, attempts: [{valid}] }[].
 * Rates are 0..1 or null when undefined (for example no predictions at all).
 */
export function aggregate(cases) {
  const evals = cases.map((c) => c.eval);
  const tp = evals.reduce((s, e) => s + e.tp, 0);
  const nPred = evals.reduce((s, e) => s + e.n_predicted, 0);
  const nExp = evals.reduce((s, e) => s + e.n_expected, 0);
  const ious = evals.flatMap((e) => e.ious);
  const text = evals.flatMap((e) => e.text);
  const responded = cases.filter((c) => c.attempts.length > 0);
  const latencies = cases.map((c) => c.latency_ms).filter((v) => Number.isFinite(v));
  const styleCorrect = evals.filter((e) => e.style_correct).length;

  return {
    n: cases.length,
    style_correct: styleCorrect,
    style_accuracy: ratio(styleCorrect, cases.length),
    tp,
    n_predicted: nPred,
    n_expected: nExp,
    type_precision: ratio(tp, nPred),
    type_recall: ratio(tp, nExp),
    iou_pairs: ious.length,
    mean_iou: mean(ious),
    iou_hit_rate_50: ratio(ious.filter((v) => v >= 0.5).length, ious.length),
    text_n: text.length,
    text_exact: text.filter((t) => t.exact).length,
    text_exact_rate: ratio(text.filter((t) => t.exact).length, text.length),
    mean_cer: mean(text.map((t) => t.cer)),
    responded: responded.length,
    first_attempt_valid: responded.filter((c) => c.attempts[0].valid).length,
    json_validity_rate: ratio(responded.filter((c) => c.attempts[0].valid).length, responded.length),
    retried: cases.filter((c) => c.attempts.length > 1).length,
    succeeded: cases.filter((c) => c.ok).length,
    success_rate: ratio(cases.filter((c) => c.ok).length, cases.length),
    avg_latency_ms: mean(latencies),
    p95_latency_ms: percentile(latencies, 0.95),
  };
}
