import { STYLES } from "../../validator.js";

const width = (s) => Array.from(s).length;

/** Render a box-drawn table. align[i] = "right" right-aligns column i. */
export function renderTable(headers, rows, { align = [] } = {}) {
  const cells = [headers, ...rows].map((r) => r.map((c) => String(c ?? "")));
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => width(r[i] ?? ""))));
  const pad = (s, w, a) => (a === "right" ? " ".repeat(w - width(s)) + s : s + " ".repeat(w - width(s)));
  const rule = (l, m, r) => l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
  const line = (r) => "│" + r.map((c, i) => ` ${pad(c, widths[i], align[i])} `).join("│") + "│";
  return [rule("┌", "┬", "┐"), line(cells[0]), rule("├", "┼", "┤"), ...cells.slice(1).map(line), rule("└", "┴", "┘")].join("\n");
}

export const pct = (v) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
const num = (v, d = 3) => (v === null || v === undefined ? "n/a" : v.toFixed(d));
const ms = (v) => (v === null || v === undefined ? "n/a" : `${Math.round(v)} ms`);
const styleName = (s) => (s === null ? "∅ null" : s === undefined ? "error" : s);

export function renderCaseTable(cases) {
  const rows = cases.map((c) => {
    const e = c.eval;
    const status = c.ok ? (c.attempts.length > 1 ? "ok (retried)" : "ok") : `${c.error.code ?? c.error.reason}`;
    return [
      c.id,
      styleName(e.expected_style),
      styleName(e.predicted_style),
      c.prediction ? c.prediction.confidence.toFixed(2) : "-",
      e.style_correct ? "✓" : "✗",
      `${e.tp}/${e.n_predicted}/${e.n_expected}`,
      e.ious.length ? num(e.ious.reduce((a, b) => a + b, 0) / e.ious.length, 2) : "-",
      ms(c.latency_ms),
      status,
    ];
  });
  return renderTable(
    ["Case", "Expected", "Predicted", "Conf", "Style", "TP/Pred/Exp", "IoU", "Latency", "Status"],
    rows,
    { align: [, , , "right", , "right", "right", "right"] },
  );
}

export function renderSummaryTable(s) {
  const rows = [
    ["Style classification accuracy", pct(s.style_accuracy), `${s.style_correct}/${s.n} cases`],
    ["Detail type precision", pct(s.type_precision), `${s.tp}/${s.n_predicted} predicted details matched`],
    ["Detail type recall", pct(s.type_recall), `${s.tp}/${s.n_expected} expected details found`],
    ["Mean bbox IoU (matched pairs)", num(s.mean_iou), `${s.iou_pairs} pairs`],
    ["Boxes with IoU ≥ 0.5", pct(s.iou_hit_rate_50), "localization hit rate"],
    ["Inscription exact match", pct(s.text_exact_rate), `${s.text_exact}/${s.text_n} texts`],
    ["Inscription CER (mean, lower is better)", num(s.mean_cer), "misses count as 1.0"],
    ["JSON validity (first attempt)", pct(s.json_validity_rate), `${s.first_attempt_valid}/${s.responded} responses`],
    ["Success rate (≤ 1 retry)", pct(s.success_rate), `${s.succeeded}/${s.n} cases, ${s.retried} retried`],
    ["Average latency", ms(s.avg_latency_ms), `p95 ${ms(s.p95_latency_ms)}`],
  ];
  return renderTable(["Metric", "Value", "Detail"], rows, { align: [, "right"] });
}

/** Confusion matrix rows = expected, columns = predicted; only labels that occur are shown. */
export function renderConfusionMatrix(cases) {
  const labels = [...STYLES, null];
  const seenExpected = labels.filter((l) => cases.some((c) => c.eval.expected_style === l));
  const seenPredicted = [...labels, undefined].filter((l) => cases.some((c) => c.eval.predicted_style === l));
  const rows = seenExpected.map((exp) => [
    styleName(exp),
    ...seenPredicted.map((pred) => {
      const n = cases.filter((c) => c.eval.expected_style === exp && c.eval.predicted_style === pred).length;
      return n ? String(n) : "·";
    }),
  ]);
  return renderTable(
    ["expected \\ predicted", ...seenPredicted.map(styleName)],
    rows,
    { align: ["left", ...seenPredicted.map(() => "right")] },
  );
}
