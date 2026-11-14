# Architecture

> Owner: M4. Payload shapes live in [contracts.md](contracts.md). This file explains how the pieces run.

## Runtime topology

```
                 HTTPS (trycloudflare.com)
 Phone browser ─────────────────────────▶ cloudflared ──▶ Vite dev server :5173   (M1 /frontend)
   camera + AR overlay + audio                                │ proxy: /analyze /narrate /audio /health /demo
                                                              ▼
                                               M4 Express backend :3001  (/backend)
                                     ┌──────────────┬─────────┴───────────┬────────────────────┐
                                     ▼              ▼                     ▼                    ▼
                         analyzeImage()   generateNarration()    demo/fixtures/*.json   demo/offline-cache.json
                         /vision (M2)     /content (M3)          (demo_fixture_id)      (known-image fallback)
                         or built-in      or built-in stub
                         stub
```

The phone sees a **single HTTPS origin** (the tunnel). That gives it camera access, no CORS, and no mixed content.

## Request pipeline: `POST /analyze`

```
validate body ── bad ─────────────────────────────────────────▶ 400/413 INVALID_INPUT
   │
   ├─ demo_fixture_id / x-demo-fixture ─▶ demo/fixtures/<id>.<lang>.json ─▶ 200 or fixture error
   │
   ├─ OFFLINE_DEMO_MODE ─▶ hash match? ─ yes ─▶ 200 cached
   │                                   └ no ──▶ default fixture or 422 NO_MATCH
   │
   └─ live/stub pipeline ─────────────── races ───────────── OFFLINE_FALLBACK_AFTER_MS (7 s)
        analyzeImage   (VISION_TIMEOUT_MS)                       │
        sanitize: clamp bbox, drop junk, ≤6                      │ if live is still running, or
        style null → 422 NO_MATCH                                │ it ended with a 5xx, AND the
        confidence < VISION_MIN_CONFIDENCE → 422 LOW_CONFIDENCE  │ image matches a known demo
        generateNarration (CONTENT_TIMEOUT_MS)                   ▼ image → 200 cached response
        merge (§6 mapping) → 200                     otherwise wait for live → its result / 504
```

Design choices:

- **The fallback never invents a building.** The cache only answers for images that match a pre-recorded demo image: an exact sha256 match, or a perceptual dHash within `OFFLINE_HASH_MAX_DISTANCE` bits that beats the runner-up by at least 2 bits. A live `NO_MATCH` or `LOW_CONFIDENCE` is always passed through unchanged.
- **Every non-2xx is an `ErrorResponse`**, including 404s, malformed JSON, oversized bodies, and the rate limiter (429 with code `TIMEOUT`).
- **Stubs are first-class.** With `VISION_MODE=mock` / `CONTENT_MODE=mock` the backend never imports `/vision` or `/content`. In live mode, a missing or broken module falls back to the stub with a warning, and `/health` reports `vision_active` / `content_active` so nobody demos a stub by accident.
- **Failure injection** (stubs only): the `x-mock-scenario` header accepts `no_match`, `low_confidence`, `vision_throw`, `vision_invalid`, `vision_hang`, `messy_output`, `narration_throw`, and `narration_hang`. Real modules never receive it.

## Files

| Path | What |
|---|---|
| `backend/index.js` | Entry: loads `.env`, picks modules, listens on `PORT` |
| `backend/src/app.js` | Express app: routes, pipeline, fallback race, logging, rate limit |
| `backend/src/contract.js` | Contract constants + shape checks (used by runtime, tests, asset builder) |
| `backend/src/validate.js` | Request parsing, M2 sanitizer, M3 normalizer, §6 merge |
| `backend/src/modules.js` | Stub ↔ live module switch |
| `backend/src/stubs.js`, `style-narrations.js` | Contract mocks + generic RO/EN narration per style |
| `backend/src/offline.js`, `imagehash.js` | Offline cache + sha256 / dHash matching |
| `backend/tests/contracts.test.js` | Contract test suite (`npm test`) |
| `backend/scripts/build-demo-assets.js` | Generates test-set images, fixtures, offline cache (`npm run build:demo`) |
| `backend/scripts/record-demo-audio.js` | Pre-records hero mp3s from live M3 (`npm run record:demo-audio`) |
| `demo/test-set/manifest.json` | 24 labeled Timișoara cases (M2 benchmark ground truth, draft) |
| `demo/fixtures-src/narrations.json` | Hand-written hero narrations (source for fixtures) |
| `demo/fixtures/`, `demo/offline-cache.json` | **Generated.** Do not hand-edit |
| `demo/audio/` | Committed demo mp3s (`<fixture>-<lang>.mp3`) |

## Logging

One JSON line per request on stdout:

```json
{"ts":"…","level":"info","method":"POST","path":"/analyze","status":200,"latency_ms":7058.8,
 "source":"offline_cache","style":"Secession","confidence":0.89,"error_code":null,
 "offline_reason":"live_slow","offline_match":"sha256","fixture_id":"casa-bruck"}
```

`source` is one of `live`, `stub`, `fixture`, `offline_cache`, `offline_default`, `offline_generic`, or `static`. Pipe the log through `jq` during rehearsal to watch latency.

## Proposed M1 Vite config (for M1 to apply; M4 does not edit `/frontend`)

```js
// frontend/vite.config.js
export default defineConfig({
  envDir: '..',
  server: {
    host: true,
    allowedHosts: ['.trycloudflare.com'],   // Vite blocks unknown Host headers otherwise
    proxy: Object.fromEntries(
      ['/analyze', '/narrate', '/audio', '/health', '/demo'].map((p) => [p, 'http://localhost:3001'])
    ),
  },
});
```
