# Module 2: AI Vision

`analyzeImage()` takes a phone photo of a Timișoara facade and returns the architectural style, a calibrated confidence score, and up to 6 located details (masks, lion heads, guild symbols, plaques, inscriptions, other elements), with verbatim inscription text. The output follows **[docs/contracts.md §4](../docs/contracts.md#4-m2-vision-analyzeimage)** exactly.

## Quick start

```bash
cd vision
npm install
npm test                                  # 95 unit tests, offline
npm run try -- path/to/facade.jpg         # one photo → VisionResult JSON (live provider)
npm run try -- photo.jpg --mock --meta    # offline, plus diagnostics on stderr
npm run benchmark -- --mock               # offline benchmark on the sample set
npm run benchmark                         # live benchmark (reads the repo-root .env)
```

The CLI scripts load the repo-root `.env` automatically. The library itself never loads `.env`.

## Using it from Module 4

```js
import { analyzeImage } from "../vision/index.js";

const result = await analyzeImage(rawBase64); // { style, confidence, details }
```

| Outcome | What `analyzeImage` does | M4 maps it to |
|---|---|---|
| Facade recognized, confidence ≥ 0.55 | resolves with style + details | `200` |
| Confidence < 0.55 | resolves with **style kept**, `details: []` | `422 LOW_CONFIDENCE` (once below `VISION_MIN_CONFIDENCE`) |
| Not a facade / too blurry | resolves with `style: null`, `details: []` | `422 NO_MATCH` |
| Bad image | rejects, `err.code === "INVALID_INPUT"` | `400 INVALID_INPUT` |
| Over 8 s budget | rejects, `err.code === "TIMEOUT"` | `504 TIMEOUT` |
| Provider error, refusal, invalid output twice, no key | rejects, `err.code` undefined (`err.reason` says why) | `504 TIMEOUT` |

`analyzeImageDetailed(image, options)` returns `{ result, meta }`. `meta` has `outcome` (`match` / `low_confidence` / `no_match`), `provider`, `model`, `latency_ms`, `attempts`, `evidence` and `warnings`, which are useful for logs. Errors carry `err.meta` with the same diagnostics.

### Options (second argument, all optional)

| Option | Default | Meaning |
|---|---|---|
| `timeoutMs` | `8000` | Total budget, including the one retry |
| `minConfidence` | `0.55` | Below this, details are suppressed |
| `nullStyleBelowThreshold` | `false` | Also return `style: null` below the threshold. This turns `LOW_CONFIDENCE` into `NO_MATCH` at M4. |
| `provider` | auto | `"gemini"`, `"openai"`, `"anthropic"`, `"mock"`, or a provider object (tests) |
| `model` | per provider | Model id override |
| `mock` / `mockScenario` | off | Deterministic mock: `secession`, `baroque`, `low_confidence`, `no_match` |
| `effort` | `"low"` | Claude only: `output_config.effort` (latency vs. depth) |
| `signal` | — | External `AbortSignal`, reported as `TIMEOUT` |

## Providers and environment

Selection order:
1. `MOCK_VISION=true` (or `mock: true`)
2. `VISION_PROVIDER`
3. the provider of `VISION_MODEL`, if its key is set
4. the first key present, in the order `GEMINI_API_KEY` → `OPENAI_API_KEY` → `ANTHROPIC_API_KEY`

| Provider | Default model | Request details |
|---|---|---|
| Gemini | `gemini-2.5-flash` | JSON mode, thinking budget 0, native `box_2d` boxes |
| OpenAI | `gpt-4o-mini` | strict `json_schema`, `detail: "high"` image |
| Claude | `claude-sonnet-5-5` | structured output (`json_schema`), effort `low`, cached system prompt, server-side refusal fallbacks (`fallbacks: "default"`) on models that support them |

All three ask for `box_2d: [ymin, xmin, ymax, xmax]` on a 0–1000 scale. `validator.js` converts that to the contract's `[x, y, w, h]` on 0–1.

**Env vars read by this module.** Only `ANTHROPIC_API_KEY` and `VISION_MODEL` exist in `.env.example` today (M4 owns that file). The others are a request to M4:

```
GEMINI_API_KEY=
OPENAI_API_KEY=
VISION_PROVIDER=        # optional: gemini | openai | anthropic | mock
MOCK_VISION=false       # true = deterministic offline answers
```

Note: `.env.example` sets `VISION_MODEL=claude-opus-5-5`, so with an Anthropic key, Opus is used instead of the Sonnet default. Clear `VISION_MODEL` or set it to the model you want.

## How it works

```
image_base64 → decodeImage (JPEG/PNG/WebP sniffing → INVALID_INPUT)
             → provider.generate(system prompt + few-shot, image)      ┐ 8 s deadline,
             → parseAndValidate: strip fences → JSON → schema →         │ AbortSignal
               normalize (aliases, box_2d → bbox, clamp) → guardrails   │
             → invalid? one repair retry with the validation error ─────┘
             → VisionResult (checked against the contract before returning)
```

- **[prompts.js](prompts.js):** style cues for Secession, Austrian Baroque, Neoclassical, Eclectic/Historicist and socialist Brutalism, plus how to tell close styles apart; detail definitions; verbatim transcription rules (Hungarian, German, Latin, Serbian, Romanian; lines joined with `" / "`); a confidence calibration scale; and two few-shot examples (a Secession facade and a non-architecture rejection).
- **[validator.js](validator.js):**
  - Every problem the model can fix (unparseable JSON, a bad `style`/`confidence`/`details`, or every box in the wrong format) returns an error that triggers the repair retry.
  - A single bad detail is fixed or dropped without a retry.
  - Style aliases are accepted: Historicist/Neo-Renaissance → `Eclectic`, Art Nouveau → `Secession`.
  - Detail type aliases are accepted: `ornament` → `architectural_element`.
  - Boxes are clipped so that `x + w ≤ 1` and `y + h ≤ 1`, and boxes with `w` or `h ≤ 0.01` are dropped.
  - Duplicates are removed and the list is capped at 6.

## Benchmark

`npm run benchmark` reads `/demo/test-set/manifest.json` when it has cases, and otherwise the synthetic [fixtures/sample-manifest.json](fixtures/sample-manifest.json). Each run is saved to `benchmark-results/` (gitignored). Flags: `--manifest`, `--mock`, `--provider`, `--model`, `--limit`, `--timeout-ms`, `--out`, `--no-save`.

**Manifest format.** Image paths are relative to the manifest. `bbox` is optional. `raw_text` is the verbatim ground truth, with lines joined by `" / "`.

```json
{
  "version": 1,
  "description": "Real photos, Piața Victoriei walk, Nov 2026",
  "cases": [
    {
      "id": "victoriei_01",
      "image": "images/victoriei_01.jpg",
      "expected": {
        "style": "Secession",
        "details": [
          { "type": "mask", "bbox": [0.32, 0.18, 0.14, 0.16] },
          { "type": "inscription", "bbox": [0.40, 0.62, 0.22, 0.06], "raw_text": "ÉPÜLT 1911" }
        ]
      }
    },
    { "id": "selfie_01", "image": "images/selfie_01.jpg", "expected": { "style": null, "details": [] } }
  ]
}
```

**Metrics:**

| Metric | How it is computed |
|---|---|
| Style accuracy | `null` counts as a class; an error counts as wrong |
| Detail type precision / recall | Greedy same-type matching, highest IoU first |
| Mean IoU and IoU ≥ 0.5 rate | Over matched pairs |
| Inscription exact match and CER | Levenshtein distance / length of the expected text, capped at 1; a missed text counts as 1 |
| JSON validity | First attempt only |
| Success rate | After at most one retry |
| Latency | Average and p95 |

A style confusion matrix is printed too. Include rejection cases (selfies, interiors, blurry shots) in the test set: they measure the hallucination guardrail.

## Files

| Path | Purpose |
|---|---|
| `index.js` | Public API: `analyzeImage`, `analyzeImageDetailed`, `checkVisionResult`, `VisionError` |
| `prompts.js` | System prompt, few-shot examples, repair prompt, response JSON schema |
| `validator.js` | Parsing, normalization, coordinate conversion, guardrails, contract check |
| `benchmark.js` | Benchmark CLI (logic lives in `src/benchmark/`) |
| `src/providers/` | Gemini, OpenAI, Claude and mock providers, plus selection |
| `scripts/try.js` | Single-image CLI |
| `scripts/make-sample-images.js` | Regenerates the synthetic fixture PNGs |
| `test/` | `node:test` suites |
