import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { analyzeImageDetailed } from "../../index.js";
import { DETAIL_TYPES, STYLES } from "../../validator.js";
import { REPO_ROOT, VISION_DIR } from "../paths.js";
import { aggregate, evaluateCase } from "./metrics.js";

export const TEST_SET_MANIFEST = path.join(REPO_ROOT, "demo", "test-set", "manifest.json");
export const SAMPLE_MANIFEST = path.join(VISION_DIR, "fixtures", "sample-manifest.json");

/** Validate and normalize a manifest object. Throws with every problem listed. */
export function validateManifest(json) {
  const problems = [];
  if (!json || !Array.isArray(json.cases)) throw new Error('manifest must be an object with a "cases" array');
  const ids = new Set();
  const cases = json.cases.map((c, i) => {
    const at = `cases[${i}]${c?.id ? ` (${c.id})` : ""}`;
    if (!c || typeof c !== "object") {
      problems.push(`${at}: must be an object`);
      return null;
    }
    if (typeof c.id !== "string" || !c.id) problems.push(`${at}: "id" is required`);
    else if (ids.has(c.id)) problems.push(`${at}: duplicate id`);
    ids.add(c.id);
    if (typeof c.image !== "string" && typeof c.image_base64 !== "string") {
      problems.push(`${at}: "image" (path) or "image_base64" is required`);
    }
    const expected = c.expected ?? {};
    if (!("style" in expected)) problems.push(`${at}: "expected.style" is required (use null for rejections)`);
    else if (!(expected.style === null || STYLES.includes(expected.style))) {
      problems.push(`${at}: expected.style must be one of ${STYLES.join(", ")} or null`);
    }
    const details = expected.details ?? [];
    if (!Array.isArray(details)) problems.push(`${at}: expected.details must be an array`);
    else {
      details.forEach((d, j) => {
        if (!DETAIL_TYPES.includes(d?.type)) problems.push(`${at}: expected.details[${j}].type invalid`);
        if (d?.bbox !== undefined) {
          const ok = Array.isArray(d.bbox) && d.bbox.length === 4 && d.bbox.every((v) => typeof v === "number" && v >= 0 && v <= 1);
          if (!ok) problems.push(`${at}: expected.details[${j}].bbox must be [x, y, w, h] in 0..1`);
        }
      });
    }
    return { ...c, expected: { style: expected.style ?? null, details: Array.isArray(details) ? details : [] } };
  });
  if (problems.length) throw new Error(`Invalid manifest:\n  - ${problems.join("\n  - ")}`);
  return cases;
}

/** Load a manifest. Without an explicit path, uses /demo/test-set if it has cases, else the sample. */
export async function loadManifest(explicitPath) {
  const candidates = explicitPath
    ? [{ path: path.resolve(explicitPath), source: "cli" }]
    : [
        { path: TEST_SET_MANIFEST, source: "test-set" },
        { path: SAMPLE_MANIFEST, source: "sample" },
      ];
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      if (candidate.source === "cli") throw new Error(`Manifest not found: ${candidate.path}`);
      continue;
    }
    const json = JSON.parse(await readFile(candidate.path, "utf8"));
    const cases = validateManifest(json);
    if (cases.length === 0 && candidate.source === "test-set") continue; // not populated yet
    return {
      path: candidate.path,
      dir: path.dirname(candidate.path),
      source: candidate.source,
      description: json.description ?? "",
      synthetic: json.synthetic === true,
      cases,
    };
  }
  throw new Error("No manifest found");
}

async function loadCaseImage(manifest, c) {
  if (typeof c.image_base64 === "string") return c.image_base64;
  return (await readFile(path.resolve(manifest.dir, c.image))).toString("base64");
}

/**
 * Run every case sequentially (keeps latency numbers honest and avoids rate limits).
 * @returns {Promise<{ manifest, config, cases, summary }>}
 */
export async function runBenchmark({
  manifestPath,
  mock = false,
  provider,
  model,
  timeoutMs,
  limit,
  nullStyleBelowThreshold = false,
  onCase,
} = {}) {
  const manifest = await loadManifest(manifestPath);
  const selected = Number.isFinite(limit) && limit > 0 ? manifest.cases.slice(0, limit) : manifest.cases;
  const results = [];
  let used = null;

  for (const c of selected) {
    const started = performance.now();
    const record = { id: c.id, expected: c.expected, prediction: null, error: null, attempts: [], meta: null };
    try {
      const imageBase64 = await loadCaseImage(manifest, c);
      const { result, meta } = await analyzeImageDetailed(imageBase64, {
        mock: mock ? true : undefined,
        provider,
        model,
        timeoutMs,
        nullStyleBelowThreshold,
        mockScenario: mock ? c.mock_scenario : undefined,
      });
      record.prediction = result;
      record.attempts = meta.attempts;
      record.meta = { outcome: meta.outcome, warnings: meta.warnings, evidence: meta.evidence };
      used ??= { provider: meta.provider, model: meta.model };
    } catch (err) {
      record.error = { code: err.code ?? null, reason: err.reason ?? "ERROR", message: err.message };
      record.attempts = err.meta?.attempts ?? [];
      if (err.meta) used ??= { provider: err.meta.provider, model: err.meta.model };
    }
    record.latency_ms = Math.round(performance.now() - started);
    record.ok = record.error === null;
    record.eval = evaluateCase(c.expected, record.prediction);
    results.push(record);
    onCase?.(record, results.length, selected.length);
  }

  return {
    manifest: {
      path: manifest.path,
      source: manifest.source,
      description: manifest.description,
      synthetic: manifest.synthetic,
      total_cases: manifest.cases.length,
    },
    config: { ...(used ?? { provider: mock ? "mock" : "unknown", model: null }), mock, timeout_ms: timeoutMs ?? null },
    cases: results,
    summary: aggregate(results),
  };
}
