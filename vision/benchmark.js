#!/usr/bin/env node
/**
 * Vision accuracy benchmark.
 *
 *   npm run benchmark                         # live provider from the repo-root .env
 *   npm run benchmark -- --mock               # offline, deterministic
 *   npm run benchmark -- --manifest path/to/manifest.json --limit 10 --provider gemini
 *
 * Manifest: /demo/test-set/manifest.json if it has cases, else fixtures/sample-manifest.json.
 * Results are saved to benchmark-results/<timestamp>.json (gitignored) unless --no-save.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { runBenchmark } from "./src/benchmark/run.js";
import { renderCaseTable, renderConfusionMatrix, renderSummaryTable } from "./src/benchmark/report.js";
import { loadRootEnv, resolveUserPath, VISION_DIR } from "./src/paths.js";
import { resolveProviderConfig } from "./src/providers/index.js";

const HELP = `Usage: npm run benchmark -- [options]

  --manifest <path>   labeled test set (default: /demo/test-set/manifest.json, else the sample)
  --mock              use the deterministic mock provider (no API key needed)
  --provider <name>   gemini | openai | anthropic
  --model <id>        model id override
  --limit <n>         only run the first n cases
  --timeout-ms <ms>   per-image budget (default 8000)
  --null-style-below-threshold   set style to null below the confidence threshold
  --out <path>        write JSON results here
  --no-save           do not write a results file
  -h, --help          show this help`;

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      mock: { type: "boolean", default: false },
      provider: { type: "string" },
      model: { type: "string" },
      limit: { type: "string" },
      "timeout-ms": { type: "string" },
      "null-style-below-threshold": { type: "boolean", default: false },
      out: { type: "string" },
      "no-save": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return console.log(HELP);

  loadRootEnv();
  const mock = values.mock;
  try {
    resolveProviderConfig({ mock: mock || undefined, provider: values.provider, model: values.model });
  } catch (err) {
    console.error(`✗ ${err.message}\n  Add a key to the repo-root .env, or run offline: npm run benchmark -- --mock`);
    process.exitCode = 1;
    return;
  }

  const run = await runBenchmark({
    manifestPath: values.manifest ? resolveUserPath(values.manifest) : undefined,
    mock,
    provider: values.provider,
    model: values.model,
    limit: values.limit ? Number(values.limit) : undefined,
    timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
    nullStyleBelowThreshold: values["null-style-below-threshold"],
    onCase: (c, i, n) => {
      const mark = !c.ok ? "!" : c.eval.style_correct ? "✓" : "✗";
      process.stdout.write(`  [${String(i).padStart(String(n).length)}/${n}] ${mark} ${c.id} (${c.latency_ms} ms)\n`);
    },
  });

  const { manifest, config, summary } = run;
  console.log(`\nManifest: ${path.relative(process.cwd(), manifest.path)} (${manifest.source}, ${run.cases.length}/${manifest.total_cases} cases)`);
  console.log(`Provider: ${config.provider}${config.model ? ` / ${config.model}` : ""}${mock ? " (mock)" : ""}`);
  if (manifest.synthetic && !mock) {
    console.log("⚠ This manifest uses synthetic images. Live accuracy numbers are meaningless; populate /demo/test-set.");
  }
  console.log(`\n${renderCaseTable(run.cases)}`);
  console.log(`\nStyle confusion matrix\n${renderConfusionMatrix(run.cases)}`);
  console.log(`\nSummary\n${renderSummaryTable(summary)}`);

  const failures = run.cases.filter((c) => !c.ok);
  if (failures.length) {
    console.log("\nErrors");
    for (const f of failures) console.log(`  ${f.id}: [${f.error.code ?? f.error.reason}] ${f.error.message}`);
  }

  if (!values["no-save"]) {
    const outPath = values.out
      ? resolveUserPath(values.out)
      : path.join(VISION_DIR, "benchmark-results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(run, null, 2));
    console.log(`\nResults saved to ${path.relative(process.cwd(), outPath)}`);
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
