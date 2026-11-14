# M4 Backend

Express orchestrator for `POST /analyze`, `POST /narrate`, `GET /audio/{cache,demo}/*.mp3`, `GET /health`, `GET /demo/fixtures`, and `POST /demo/offline`. The spec is [docs/contracts.md](../docs/contracts.md) and the design is [docs/architecture.md](../docs/architecture.md).

```bash
npm install
npm start               # reads ../.env if present; defaults: port 3001, stubs
npm run mock            # force built-in stubs (same as USE_STUBS=true)
npm run dev             # restart on file change
npm test                # contract suite (node:test, ~7 s, no API keys)
npm run build:demo      # regenerate demo/ assets after editing manifest or narrations
npm run check:demo      # verify generated demo/ assets are current + valid (CI)
```

## Mock scenarios (stub mode only)

Send header `x-mock-scenario: <name>` to `/analyze` or `/narrate`:

| name | effect |
|---|---|
| `no_match` | M2 returns `style: null` → 422 NO_MATCH |
| `low_confidence` | confidence 0.41 → 422 LOW_CONFIDENCE |
| `vision_throw` / `vision_hang` | → 504 TIMEOUT |
| `vision_invalid` | M2 throws `err.code = "INVALID_INPUT"` → 400 |
| `messy_output` | out-of-range boxes and junk details → shows the sanitizer at work |
| `narration_throw` / `narration_hang` | → 504 TIMEOUT |

## Environment

All variables are documented in [`.env.example`](../.env.example). The ones that matter most on stage:

| var | default | meaning |
|---|---|---|
| `VISION_MODE`, `CONTENT_MODE` | `mock` | `live` imports `/vision` / `/content` |
| `VISION_MIN_CONFIDENCE` | `0.55` | LOW_CONFIDENCE gate |
| `VISION_TIMEOUT_MS`, `CONTENT_TIMEOUT_MS` | `15000` | stage budgets → TIMEOUT |
| `OFFLINE_DEMO_MODE` | `false` | no AI calls; known demo images only |
| `OFFLINE_FALLBACK_AFTER_MS` | `7000` | when a known image switches to the cache in live mode |
| `DEMO_ADMIN_TOKEN` | empty | enables `POST /demo/offline` |
