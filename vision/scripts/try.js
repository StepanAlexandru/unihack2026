#!/usr/bin/env node
/**
 * Analyze one photo and print the contract VisionResult.
 *
 *   npm run try -- path/to/facade.jpg            # live provider from the repo-root .env
 *   npm run try -- path/to/facade.jpg --mock --scenario baroque
 *   npm run try -- path/to/facade.jpg --meta     # also print diagnostics to stderr
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { analyzeImageDetailed } from "../index.js";
import { loadRootEnv, resolveUserPath } from "../src/paths.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mock: { type: "boolean", default: false },
    scenario: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    "timeout-ms": { type: "string" },
    meta: { type: "boolean", default: false },
  },
});

if (positionals.length !== 1) {
  console.error("Usage: npm run try -- <photo.jpg|png|webp> [--mock] [--scenario name] [--provider name] [--model id] [--meta]");
  process.exit(2);
}

loadRootEnv();
try {
  const imageBase64 = (await readFile(resolveUserPath(positionals[0]))).toString("base64");
  const { result, meta } = await analyzeImageDetailed(imageBase64, {
    mock: values.mock || undefined,
    mockScenario: values.scenario,
    provider: values.provider,
    model: values.model,
    timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  if (values.meta) console.error(JSON.stringify(meta, null, 2));
} catch (err) {
  console.error(`analyzeImage failed [code=${err.code ?? "-"} reason=${err.reason ?? "-"}]: ${err.message}`);
  if (values.meta && err.meta) console.error(JSON.stringify(err.meta, null, 2));
  process.exitCode = 1;
}
