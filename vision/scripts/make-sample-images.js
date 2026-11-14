#!/usr/bin/env node
/** Regenerates the synthetic PNGs referenced by fixtures/sample-manifest.json. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { syntheticPng } from "../src/dev/png.js";
import { VISION_DIR } from "../src/paths.js";

const names = ["sample_secession", "sample_baroque", "sample_low_confidence", "sample_rejection", "sample_confusion"];
const dir = path.join(VISION_DIR, "fixtures", "images");
await mkdir(dir, { recursive: true });
for (const [i, name] of names.entries()) {
  await writeFile(path.join(dir, `${name}.png`), syntheticPng(i + 1, 160, 120));
  console.log(`wrote fixtures/images/${name}.png`);
}
