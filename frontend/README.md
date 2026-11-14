# M1: WebAR Frontend

Vite + React + Three.js (`@react-three/fiber`, `drei`) phone app. Point the rear camera at a facade, get a glowing blueprint overlay on detected details, a style/confidence pill, and a ~15 s narration in RO/EN.

Talks to M4 **over HTTP only** (`POST /analyze`, `POST /narrate`, `GET /audio/*`, `GET /health`), per [docs/contracts.md](../docs/contracts.md) v1.0.0.

## Run

```bash
cd frontend
npm install
npm run dev              # http://localhost:5173 (also on your LAN IP)
npm run build            # production build → dist/
npm run check:contract   # validates every mock against the contract shapes
```

- Env comes from the **repo-root** `.env` (`envDir: '..'`). Used: `VITE_USE_MOCK_API` (default `true`), `VITE_API_BASE_URL` (leave empty to use the proxy).
- The dev server proxies `/analyze`, `/narrate`, `/audio`, `/health` → `http://localhost:3001`. Override with the shell var `BACKEND_ORIGIN=http://host:port npm run dev`.
- **Phone testing:** the camera needs HTTPS. Run an HTTPS tunnel to port 5173 (e.g. `cloudflared tunnel --url http://localhost:5173`). `allowedHosts: true` is set, and the phone sees one origin, so there's no CORS or mixed content.

## Dev / Demo pill (top right)

| Setting | What it does |
|---|---|
| Mock Mode ON / Live API | Mock serves contract-shaped payloads locally (no backend). Persisted per browser. |
| Mock scenario | `auto` follows the sample facade; or force Secession, Baroque, `audio_url: ""`, the contract §6 example, `LOW_CONFIDENCE`, `NO_MATCH`, `TIMEOUT` (504), client-side hang (exercises the 6 s timeout), `INVALID_INPUT`. |
| Latency | 400 ms or 1.5 s fake latency. |
| BBox jitter | Randomly nudges boxes on each response to exercise the lerp smoothing. |
| Demo fixture | Sends `demo_fixture_id` to the backend (stage safety net, §9.3). Overrides mock mode. |
| Image source | Camera, or the 3 built-in sample facades (also used automatically when the camera is denied or unavailable). You can upload a photo in sample mode. |

## How it works

| File | Role |
|---|---|
| `src/services/cameraCapture.js` | `getUserMedia` (rear camera, 1280×720 ideal), frame capture: long edge **640 px**, JPEG q **0.72**, aspect preserved. |
| `src/services/apiClient.js` | `/analyze` + `/narrate` client, mock transport, 6 s client timeout. Network error / non-JSON / unknown code → `TIMEOUT` (§8). |
| `src/services/coverMapping.js` | Normalized bbox → screen px under `object-fit: cover`. |
| `src/components/BlueprintOverlay.jsx` | Orthographic R3F scene in screen pixels: shader glow brackets, mid-edge ticks, scanline/grid fill, animated dashed leaders, drei `<Html>` badges. Boxes lerp between frames (frame-rate independent) and fade out on exit. |
| `src/services/useNarrationPlayer.js` | `<audio>` playback → `speechSynthesis` fallback when `audio_url` is `""` or fails to load. `prime()` unlocks audio inside the Scan tap (iOS). |
| `src/App.jsx` | Orchestration: manual scan and Live Scan (~1.75 s cadence, never overlapping), RO/EN switch via `/narrate` (keeps `building_name` / `translated_text` from `/analyze`, §7), error HUD states. |
| `src/mocks/contractExamples.js` | Mock payloads (contract §6 example verbatim, plus scenarios). Narration copy in mocks is placeholder, not KB facts. |
| `src/services/contractShape.js` | Runtime shape checks. Drift is logged as `[contract] … drift` in dev. |

Live Scan only restarts narration when the recognized building changes. Refreshes of the same building just move the boxes.
