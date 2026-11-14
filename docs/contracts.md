# API & Module Contracts: v1.0.0 (FROZEN)

> **Status:** FROZEN as of 2026-11-14. **Owner:** Module 4.
> This file is the single source of truth for every payload that crosses a module boundary. If code and this file disagree, the code is wrong.
>
> **How to change it:**
> - *Additive* (a new **optional** response field): M4 may add it after telling the team. Consumers already ignore unknown fields (§1).
> - *Anything else* (rename, removal, type change, new required field, new enum value): all 4 owners agree, M4 edits this file and bumps the version, and everyone updates their mocks.
> - Never "fix" a mismatch by quietly diverging in your own module. Stop and raise it.

## Contents

1. [Conventions](#1-conventions)
2. [Data flow](#2-data-flow)
3. [Shared types](#3-shared-types)
4. [M2 Vision: `analyzeImage()`](#4-m2-vision-analyzeimage)
5. [M3 Content: `generateNarration()`](#5-m3-content-generatenarration)
6. [`POST /analyze`](#6-post-analyze)
7. [`POST /narrate`](#7-post-narrate)
8. [Errors](#8-errors)
9. [Supporting endpoints: audio, health, demo fixtures](#9-supporting-endpoints)
10. [Mocks](#10-mocks)
11. [Changelog](#11-changelog)

---

## 1. Conventions

- JSON over HTTP, UTF-8, `Content-Type: application/json`.
- **Field names are `snake_case`** on the wire **and** in module function inputs/outputs, even inside JavaScript. Only function names are camelCase.
- **Tolerant reader:** every consumer MUST ignore fields it does not know.
- **Complete writer:** every producer MUST send every field listed here. Nullable fields are sent as `null`, never omitted.
- Numbers are JSON numbers (`0.87`, `14.5`), never strings.
- `lang` is required wherever it appears. All user-facing text a module *generates* is in that language. **Exception:** `details[].label` is English in v1 (M1 may localize it via `type`).
- Relative URLs such as `/audio/cache/...` are relative to the **backend origin**.

## 2. Data flow

```
 Phone camera frame (JPEG, base64)
        │
        ▼
┌────────────────┐   POST /analyze    ┌──────────────────────────────────────────┐
│  M1 Frontend   │ ─────────────────▶ │  M4 Backend (orchestrator)   /backend    │
│  /frontend     │ ◀───────────────── │                                          │
│                │  AnalyzeResponse   │  1. analyzeImage(image_base64) ──▶ M2    │  /vision
│  AR overlay    │  or ErrorResponse  │  2. gates: NO_MATCH / LOW_CONFIDENCE     │
│  audio player  │                    │  3. generateNarration({...})   ──▶ M3    │  /content
│                │   GET /audio/...   │  4. merge → AnalyzeResponse              │
│                │ ─────────────────▶ │  static: /audio/cache, /audio/demo       │
└────────────────┘                    └──────────────────────────────────────────┘
```

M1 talks to M4 over **HTTP only**. M4 calls M2 and M3 as **in-process async functions**.

## 3. Shared types

TypeScript notation, for precision only. Modules may be plain JavaScript.

```ts
type Lang = "ro" | "en";

type Style = "Secession" | "Baroque" | "Brutalist" | "Eclectic" | "Neoclassical";

type DetailType =
  | "mask"                   // mascaron / carved face
  | "lion_head"              // lion-head ornament, incl. door knockers
  | "guild_symbol"           // craft or guild emblem, house sign
  | "plaque"                 // commemorative or information plaque
  | "inscription"            // text carved or painted into the facade (date, name, motto)
  | "architectural_element"; // catch-all: portal, balcony, gable, column, ironwork, tower, ...

/** [x, y, w, h], normalized 0.0–1.0, (x, y) = TOP-LEFT corner. */
type BBox = [number, number, number, number];

/** Produced by M2. */
interface Detail {
  id: string;              // "det_1", "det_2", ... unique within one response
  label: string;           // short display label, English in v1
  type: DetailType;
  bbox: BBox;
  raw_text: string | null; // text read verbatim from the facade (any language), else null
}

/** Returned to M1. */
interface AnalyzedDetail extends Detail {
  translated_text: string | null; // raw_text translated into `lang`; null when raw_text is null
}

type ErrorCode = "NO_MATCH" | "LOW_CONFIDENCE" | "TIMEOUT" | "INVALID_INPUT";

interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string; // human-readable explanation
  };
}
```

### BBox rules

- `x ≥ 0`, `y ≥ 0`, `w > 0`, `h > 0`, `x + w ≤ 1`, `y + h ≤ 1`.
- Coordinates are relative to **the image exactly as sent** in `image_base64`: pixel x = `x * imageWidth`.
- If M1 downscales a frame before sending, it keeps the aspect ratio, so normalized boxes still map onto the live frame.
- M1 maps boxes onto the displayed `<video>` element and must account for `object-fit: cover` cropping.

---

## 4. M2 Vision: `analyzeImage()`

**Owner:** M2. **Entry point:** `vision/index.js` (ES module). **Caller:** M4 only.

```ts
export async function analyzeImage(image_base64: string): Promise<VisionResult>;

interface VisionResult {
  style: Style | null; // null = no heritage facade recognized, or none of the 5 styles
  confidence: number;  // 0.0–1.0, confidence in `style`; ignored when style is null
  details: Detail[];   // 0–6 items, ordered most interesting first; [] is allowed
}
```

**Input:** raw base64 of a JPEG (preferred) or PNG, **without** a `data:` prefix (M4 strips it). Detect the format from magic bytes if needed: `/9j/` = JPEG, `iVBOR` = PNG.

**Behaviour:**
- Return `style: null` (do **not** throw) when the photo is not a recognizable facade. M4 turns that into `NO_MATCH`.
- Do **not** apply a confidence threshold. M4 does that with `VISION_MIN_CONFIDENCE`.
- Throw only on real failure:
  - undecodable image → `throw` an `Error` with `err.code = "INVALID_INPUT"`
  - anything else (provider error, bad model output) → plain `Error`. M4 maps it to `TIMEOUT`.
- No side effects outside `/vision` except reading env vars.

**Example output:**

```json
{
  "style": "Secession",
  "confidence": 0.87,
  "details": [
    {
      "id": "det_1",
      "label": "Secession Mask (Mascaron)",
      "type": "mask",
      "bbox": [0.32, 0.18, 0.14, 0.16],
      "raw_text": null
    },
    {
      "id": "det_2",
      "label": "Dated Inscription",
      "type": "inscription",
      "bbox": [0.40, 0.62, 0.22, 0.06],
      "raw_text": "ANNO 1910"
    }
  ]
}
```

---

## 5. M3 Content: `generateNarration()`

**Owner:** M3. **Entry point:** `content/index.js` (ES module). **Caller:** M4 only.

```ts
export async function generateNarration(input: {
  style: Style;
  details: Detail[]; // as produced by M2; may be []; extra fields are ignored
  lang: Lang;
}): Promise<NarrationResult>;

interface NarrationResult {
  text: string;        // 35–40 words in `lang`, ~15 s spoken
  audio_url: string;   // "/audio/cache/<hash>.mp3" | "data:audio/mpeg;base64,..." | "" (TTS failed)
  duration_s: number;  // audio length in seconds; if unknown, estimate as word_count / 2.5
  enrichments: {
    building_name: string | null;
    architect: string | null;
    historical_context: string; // in `lang`, 1–3 sentences
    why_it_matters: string;     // in `lang`, 1–2 sentences
    translations: Array<{
      detail_id: string;        // matches Detail.id
      original: string;         // = Detail.raw_text
      translated: string;       // in `lang`
    }>;
  };
}
```

**Behaviour:**
- **Grounded, never invented.** Every factual claim (building names, dates, architects) must come from the M3 knowledge base in `/content`. If the building cannot be identified, set `building_name` and `architect` to `null` and narrate the style and the visible details instead.
- `translations`: one entry for each input detail whose `raw_text` is non-null.
- **Audio:** write the mp3 to `AUDIO_CACHE_DIR` and return `/audio/cache/<file>.mp3` (M4 serves that directory), or return a data URL. Use a deterministic file name (for example a hash of `lang + voice + text`) so repeat requests hit the cache.
- **A TTS failure does not fail the request.** Return the text with `audio_url: ""` and an estimated `duration_s`. M1 then falls back to the browser's `speechSynthesis`.
- Errors follow the M2 convention: `err.code = "INVALID_INPUT"` for bad input, plain `Error` for everything else.

**Example output** (`lang: "en"`, for the M2 example above):

```json
{
  "text": "This facade belongs to the Secession style that reshaped Timișoara in the early twentieth century. Look for the carved mask above the window: Secession architects used faces and flowing plant motifs to give buildings personality and civic pride.",
  "audio_url": "/audio/cache/3f9a1c7e.mp3",
  "duration_s": 14.5,
  "enrichments": {
    "building_name": null,
    "architect": null,
    "historical_context": "In the early 1900s, as Timișoara grew beyond its old fortress walls, many new apartment buildings adopted the Secession style that was popular across Austria-Hungary.",
    "why_it_matters": "Secession facades are a defining part of Timișoara's architectural identity.",
    "translations": [
      { "detail_id": "det_2", "original": "ANNO 1910", "translated": "In the year 1910" }
    ]
  }
}
```

---

## 6. `POST /analyze`

**Owner:** M4. **Caller:** M1.

### Request

```ts
interface AnalyzeRequest {
  image_base64: string;     // raw base64 OR data URL ("data:image/jpeg;base64,...")
  lang: Lang;
  demo_fixture_id?: string; // optional; must match /^[a-z0-9_-]{1,64}$/
}
```

- M1 SHOULD send a JPEG frame captured from the camera via `<canvas>`: long edge ≤ 1280 px, quality ≈ 0.8 (a few hundred KB).
- If the decoded image is larger than `MAX_IMAGE_BYTES`, M4 returns `413` + `INVALID_INPUT`.
- When `demo_fixture_id` is present, `image_base64` may be `""`.

```json
{ "image_base64": "/9j/4AAQSkZJRgABAQAAAQABAAD...", "lang": "en" }
```

### Response `200`

```ts
interface AnalyzeResponse {
  style: Style;              // never null in a 200 (null → NO_MATCH error)
  confidence: number;
  details: AnalyzedDetail[];
  narration: {
    text: string;            // 35–40 words, ~15 s spoken
    audio_url: string;       // may be "" → M1 uses speechSynthesis(text)
    duration_s: number;
    building_name: string | null;
    history: string;
    why_it_matters: string;
  };
}
```

```json
{
  "style": "Secession",
  "confidence": 0.87,
  "details": [
    {
      "id": "det_1",
      "label": "Secession Mask (Mascaron)",
      "type": "mask",
      "bbox": [0.32, 0.18, 0.14, 0.16],
      "raw_text": null,
      "translated_text": null
    },
    {
      "id": "det_2",
      "label": "Dated Inscription",
      "type": "inscription",
      "bbox": [0.40, 0.62, 0.22, 0.06],
      "raw_text": "ANNO 1910",
      "translated_text": "In the year 1910"
    }
  ],
  "narration": {
    "text": "This facade belongs to the Secession style that reshaped Timișoara in the early twentieth century. Look for the carved mask above the window: Secession architects used faces and flowing plant motifs to give buildings personality and civic pride.",
    "audio_url": "/audio/cache/3f9a1c7e.mp3",
    "duration_s": 14.5,
    "building_name": null,
    "history": "In the early 1900s, as Timișoara grew beyond its old fortress walls, many new apartment buildings adopted the Secession style that was popular across Austria-Hungary.",
    "why_it_matters": "Secession facades are a defining part of Timișoara's architectural identity."
  }
}
```

### Pipeline (inside M4)

1. Validate the body. On failure: `400 INVALID_INPUT`.
2. If `demo_fixture_id` is set, return the fixture (§9.3) and skip steps 3–8.
3. Strip any `data:<mime>;base64,` prefix.
4. `analyzeImage(raw_base64)` with a `VISION_TIMEOUT_MS` budget. Over budget or thrown error: `504 TIMEOUT` (or `400` if `err.code === "INVALID_INPUT"`).
5. Sanitize M2 output: clamp bbox values into `[0, 1]`, drop details that don't match the `Detail` shape, keep at most 6.
6. `style === null` → `422 NO_MATCH`. `confidence < VISION_MIN_CONFIDENCE` → `422 LOW_CONFIDENCE`.
7. `generateNarration({ style, details, lang })` with a `CONTENT_TIMEOUT_MS` budget. Over budget or thrown error: `504 TIMEOUT`.
8. Merge using the mapping below and return `200`.

### Merge mapping (M2 + M3 → AnalyzeResponse)

| AnalyzeResponse field | Source |
|---|---|
| `style`, `confidence` | M2 `style`, `confidence` |
| `details[].id / label / type / bbox / raw_text` | M2 `details[]` (after sanitizing) |
| `details[].translated_text` | M3 `enrichments.translations[]` entry whose `detail_id` matches, `.translated`; otherwise `null` |
| `narration.text` | M3 `text` |
| `narration.audio_url` | M3 `audio_url` |
| `narration.duration_s` | M3 `duration_s` |
| `narration.building_name` | M3 `enrichments.building_name` |
| `narration.history` | M3 `enrichments.historical_context` |
| `narration.why_it_matters` | M3 `enrichments.why_it_matters` |
| *(not forwarded in v1)* | M3 `enrichments.architect` |

---

## 7. `POST /narrate`

**Owner:** M4 (it calls M3's `generateNarration`). **Caller:** M1.
**Purpose:** narrate details that were already detected again, without re-scanning. Used for the RO/EN language toggle and for replay.

### Request

```ts
interface NarrateRequest {
  style: Style;      // must be one of the 5 styles (not null)
  details: Detail[]; // AnalyzedDetail is accepted too; translated_text is ignored
  lang: Lang;
}
```

```json
{
  "style": "Secession",
  "details": [
    { "id": "det_1", "label": "Secession Mask (Mascaron)", "type": "mask", "bbox": [0.32, 0.18, 0.14, 0.16], "raw_text": null }
  ],
  "lang": "ro"
}
```

### Response `200`

```ts
interface NarrateResponse {
  text: string;
  audio_url: string;      // may be "" → speechSynthesis fallback
  duration_s: number;
  history: string;        // ← M3 enrichments.historical_context
  why_it_matters: string; // ← M3 enrichments.why_it_matters
}
```

```json
{
  "text": "<35–40 words in Romanian>",
  "audio_url": "/audio/cache/8b21d04f.mp3",
  "duration_s": 15,
  "history": "<1–3 sentences in Romanian>",
  "why_it_matters": "<1–2 sentences in Romanian>"
}
```

**v1 limitation:** `/narrate` returns no `building_name` and no `translated_text`. M1 keeps those from the original `/analyze` response.

**Errors:** `400 INVALID_INPUT`, `504 TIMEOUT`.

---

## 8. Errors

Every non-2xx response body from every endpoint is an `ErrorResponse`:

```json
{
  "error": {
    "code": "LOW_CONFIDENCE",
    "message": "Style confidence 0.41 is below the 0.50 threshold."
  }
}
```

| `code` | HTTP | When | Suggested M1 UX |
|---|---|---|---|
| `INVALID_INPUT` | `400` (`413` if image too large) | Malformed JSON, missing or invalid field, bad or unknown `demo_fixture_id`, undecodable image | "Couldn't read that photo. Try again." |
| `NO_MATCH` | `422` | M2 returned `style: null` | "No heritage facade recognized. Point at a building." |
| `LOW_CONFIDENCE` | `422` | `confidence < VISION_MIN_CONFIDENCE` | "Move closer, hold steady, or find better light." |
| `TIMEOUT` | `504` | A stage exceeded its time budget, **or** an upstream provider or unexpected error occurred (v1 has no catch-all code) | "Taking too long. Tap to retry." |

**Rules:**
- `message` is English, safe to log, and never contains API keys, prompts, or stack traces. M1 shows its own localized copy chosen by `code`, not `message`.
- M1 MUST treat a network failure, a non-JSON body, or an unknown `code` as `TIMEOUT`.

---

## 9. Supporting endpoints

All owned by M4.

### 9.1 Static audio

| Route | Serves | Written by |
|---|---|---|
| `GET /audio/cache/<file>.mp3` | `AUDIO_CACHE_DIR` (runtime, gitignored) | M3 at runtime |
| `GET /audio/demo/<file>.mp3` | `/demo/audio/` (committed) | M4 |

Served with `Content-Type: audio/mpeg`. File names must match `/^[A-Za-z0-9_-]+\.mp3$/`; anything else returns `404`.

### 9.2 `GET /health`

```json
{ "ok": true, "vision_mode": "mock", "content_mode": "live" }
```

`vision_mode` and `content_mode` are `"mock" | "live"` and mirror `VISION_MODE` / `CONTENT_MODE`.

### 9.3 Demo fixtures (`demo_fixture_id`)

- `demo_fixture_id: "<id>"` → M4 reads `demo/fixtures/<id>.<lang>.json`, falling back to `demo/fixtures/<id>.json`. If neither exists: `400 INVALID_INPUT`.
- A fixture file contains **either** an `AnalyzeResponse` (returned with `200`) **or** an `ErrorResponse` (returned with the status from §8), so the error screens can be demoed too.
- The fixture's `narration.audio_url` is `""`, a data URL, or `/audio/demo/<file>.mp3`.
- Fixtures are returned verbatim with **no AI calls**, so they work offline. This is the on-stage safety net: keep it working at all times.

---

## 10. Mocks

- **The JSON examples in this file are the canonical mocks.** Copy them into your own folder (`frontend/src/mocks/`, `backend/mocks/`, ...). Do not import mocks across module folders.
- Mock the **failure paths** you consume as well as the happy path. M1: every error code plus `audio_url: ""`. M4: an `analyzeImage` that throws or hangs, and `style: null`.
- Keep a small shape check (a test or a runtime assertion) against the types in §3–§7 so drift shows up before integration, not during it.
- The only cross-folder imports allowed: M4 imports `vision/index.js` and `content/index.js`, and only when `VISION_MODE=live` / `CONTENT_MODE=live`.

---

## 11. Changelog

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-11-14 | Initial frozen contract. |
