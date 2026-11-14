# Timișoara Heritage Lens: WebAR Architectural Scanner & Audio Guide

UniHack 2026 · MuseumsQuartier track. Point your phone at a Timișoara facade. The app recognizes its architectural style, highlights details (masks, lion heads, guild symbols, plaques, inscriptions) as AR overlays, and narrates a ~15-second story in **Romanian or English**.

| Module | Folder | Owner role |
|---|---|---|
| M1 | [`frontend/`](frontend/) | WebAR frontend: camera, AR overlay, audio player |
| M2 | [`vision/`](vision/) | AI vision: `analyzeImage()` |
| M3 | [`content/`](content/) | Narration, TTS, Timișoara knowledge base: `generateNarration()` |
| M4 | [`backend/`](backend/), [`demo/`](demo/), [`docs/`](docs/) | API, infra, demo safety net |

**Read first:** [CLAUDE.md](CLAUDE.md) (team rules), then [docs/contracts.md](docs/contracts.md) (frozen API) and [docs/architecture.md](docs/architecture.md).

## Quick start

Requires Node.js ≥ 20.12 (22 LTS recommended).

```bash
cp .env.example .env            # fill ANTHROPIC_API_KEY etc. only when going live

# Backend (M4): built-in stubs, works with no other module and no API key
cd backend && npm install && npm start          # http://localhost:3001
curl localhost:3001/health

# Contract tests
npm test
```

Switch to the real modules one at a time (halfway-integration order, CLAUDE.md §6). Set these in `.env` and restart:

```
VISION_MODE=live      # step 2
CONTENT_MODE=live     # step 3
```

`GET /health` shows what is *actually* running (`vision_active` / `content_active`).

## Try the API

```bash
# Real image (JPEG/PNG, raw base64 or data URL)
IMG=$(base64 -w0 demo/test-set/images/casa-bruck.jpg)
printf '{"image_base64":"%s","lang":"en"}' "$IMG" > /tmp/req.json
curl -s -H 'content-type: application/json' --data @/tmp/req.json localhost:3001/analyze

# Demo fixture (no AI, works offline)
curl -s -H 'content-type: application/json' \
  -d '{"image_base64":"","lang":"ro","demo_fixture_id":"casa-bruck"}' localhost:3001/analyze

# Re-narrate in the other language without re-scanning
curl -s -H 'content-type: application/json' \
  -d '{"style":"Baroque","details":[],"lang":"ro"}' localhost:3001/narrate

# Error paths in stub mode
curl -s -H 'content-type: application/json' -H 'x-mock-scenario: low_confidence' \
  --data @/tmp/req.json localhost:3001/analyze

# What can the demo show?
curl -s localhost:3001/demo/fixtures
```

## HTTPS on a real phone

Phones only grant camera access on HTTPS. Run three terminals on the demo laptop:

```bash
cd backend  && npm start                                 # :3001
cd frontend && npm run dev                               # :5173, proxies API paths to :3001
npx cloudflared tunnel --url http://localhost:5173       # prints https://<random>.trycloudflare.com
```

Open the printed `https://…trycloudflare.com` URL on the phone. M1's Vite config needs `allowedHosts: ['.trycloudflare.com']` and a proxy for `/analyze`, `/narrate`, `/audio`, `/health`, and `/demo` (snippet in [docs/architecture.md](docs/architecture.md#proposed-m1-vite-config-for-m1-to-apply-m4-does-not-edit-frontend)).

The quick-tunnel URL changes on every restart. Start the tunnel early and leave it running.

## Demo safety net

See [demo/PITCH_AND_SCRIPT.md](demo/PITCH_AND_SCRIPT.md). In short:

1. `demo_fixture_id` always works, with no network or AI needed.
2. `OFFLINE_DEMO_MODE=true` answers known demo images from `demo/offline-cache.json`.
3. In live mode, a known demo image falls back to the cache after 7 s or on an upstream failure.

## Regenerating demo assets

```bash
cd backend
npm run build:demo          # test-set images, fixtures, offline cache from manifest + narrations
npm run check:demo          # CI: fails if generated files are stale or invalid
npm run record:demo-audio   # once M3 TTS is live: pre-record hero mp3s into demo/audio/
```
