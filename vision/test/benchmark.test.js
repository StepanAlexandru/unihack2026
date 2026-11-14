import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import { renderCaseTable, renderSummaryTable } from "../src/benchmark/report.js";
import { loadManifest, runBenchmark, SAMPLE_MANIFEST, TEST_SET_MANIFEST, validateManifest } from "../src/benchmark/run.js";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe("benchmark on the sample manifest (mock provider)", () => {
  test("computes every metric", async () => {
    const run = await runBenchmark({ manifestPath: SAMPLE_MANIFEST, mock: true });
    const s = run.summary;
    assert.equal(run.config.provider, "mock");
    assert.equal(s.n, 5);
    assert.equal(s.style_correct, 4); // sample_confusion expects Neoclassical, mock says Baroque
    close(s.type_precision, 5 / 6);
    close(s.type_recall, 5 / 7);
    assert.equal(s.iou_pairs, 5);
    assert.ok(s.mean_iou > 0.9 && s.mean_iou < 1);
    close(s.iou_hit_rate_50, 1);
    assert.equal(s.text_n, 2);
    assert.equal(s.text_exact, 0);
    close(s.mean_cer, (1 / 9 + 1) / 2);
    close(s.json_validity_rate, 1);
    close(s.success_rate, 1);
    assert.ok(Number.isFinite(s.avg_latency_ms));
  });

  test("renders tables", async () => {
    const run = await runBenchmark({ manifestPath: SAMPLE_MANIFEST, mock: true, limit: 2 });
    assert.equal(run.cases.length, 2);
    assert.match(renderCaseTable(run.cases), /sample_secession/);
    assert.match(renderSummaryTable(run.summary), /Style classification accuracy/);
  });
});

describe("manifest loading", () => {
  test("falls back to the sample manifest when /demo/test-set is absent", { skip: existsSync(TEST_SET_MANIFEST) }, async () => {
    const m = await loadManifest();
    assert.equal(m.source, "sample");
    assert.equal(m.synthetic, true);
  });

  test("rejects invalid manifests with every problem listed", () => {
    assert.throws(
      () =>
        validateManifest({
          cases: [
            { id: "a", image: "x.jpg", expected: { style: "Gothic" } },
            { id: "a", expected: { style: null, details: [{ type: "ornament", bbox: [0, 0, 2, 1] }] } },
          ],
        }),
      (err) => {
        assert.match(err.message, /expected.style must be one of/);
        assert.match(err.message, /duplicate id/);
        assert.match(err.message, /"image" \(path\) or "image_base64" is required/);
        assert.match(err.message, /type invalid/);
        assert.match(err.message, /bbox must be/);
        return true;
      },
    );
  });
});
