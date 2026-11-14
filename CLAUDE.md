# CLAUDE.md: Team Constitution

**Project:** an AI-powered WebAR Architectural Scanner & Audio Guide for Timișoara's heritage buildings (UniHack 2026, MuseumsQuartier track). A visitor points a phone at a facade. The app recognizes the architectural style, highlights details (masks, lion heads, guild symbols, plaques, inscriptions) as AR overlays, and plays a ~15-second narration in Romanian or English.

Four people build this in parallel, each with their own Claude Code session. These rules exist so that we never get a merge conflict and so that integration at the halfway point is uneventful.

## 1. Read first, every session

1. **[docs/contracts.md](docs/contracts.md)** is the frozen API and module contract. Every payload that crosses a folder boundary is defined there. Code to it exactly.
2. Read your own module's `README.md`, if it exists.

If the contract seems wrong or incomplete, **stop and tell your human**. Do not work around it in code. Do not edit `docs/` unless you are Module 4.

## 2. Who am I?

Each teammate creates `CLAUDE.local.md` in the repo root. It is gitignored and loaded automatically. It contains one line, for example:

```
I am the Module 2 owner (AI Vision). I may only edit /vision/**.
```

If no module identity has been declared, **ask which module you own before editing any file.**

## 3. Architecture and ownership

```
Phone ──HTTP──▶ M4 /backend ──▶ M2 analyzeImage()      (/vision)
  M1 /frontend      │       └─▶ M3 generateNarration() (/content)
                    └── serves /analyze, /narrate, /audio/*, /health
```

| Module | Role | Writes ONLY in | Exposes |
|---|---|---|---|
| **M1** | WebAR Frontend | `/frontend/**` | The web app: camera, AR overlay, audio player |
| **M2** | AI Vision | `/vision/**` | `analyzeImage(image_base64)` in `vision/index.js` |
| **M3** | Audio + Content KB | `/content/**` | `generateNarration({ style, details, lang })` in `content/index.js`, plus the Timișoara knowledge base |
| **M4** | Backend/API + Infra + Demo | `/backend/**`, `/demo/**`, `/docs/**`, root files (`README.md`, `CLAUDE.md`, `.env.example`, `.gitignore`) | `POST /analyze`, `POST /narrate`, static audio, demo fixtures |

## 4. Folder ownership: HARD RULE

- **Write only inside your module's folders.** You may read anything.
- **Never edit another module's files.** That includes one-line fixes, typos, and formatter passes. Instead, write the exact proposed change in your reply and let your human send it to that owner.
- Root files and `docs/` belong to M4. Need a new env var, a `.gitignore` entry, or a contract change? Ask M4.
- Never run commands that rewrite files outside your folder: no repo-wide formatters or codemods, and no `npm init` or `npm install` at the repo root.
- **Stage only your folder**, for example `git add vision/`. Never use `git add -A` or `git add .`. Before every commit, `git status` must show changes only inside your folder(s).

## 5. Integration seams

- **Runtime:** Node.js ≥ 20.6 (22 LTS recommended), ES modules (`"type": "module"`).
- **One npm package per module folder**, each with its own `package.json` and lockfile. There is no root `package.json` and no workspaces, because a shared lockfile guarantees merge conflicts.
- **M2 → M4:** `vision/index.js` exports `async function analyzeImage(image_base64)`.
- **M3 → M4:** `content/index.js` exports `async function generateNarration({ style, details, lang })`.
- Those two entry points are the **only** cross-folder imports. Only M4 makes them, and only when `VISION_MODE=live` or `CONTENT_MODE=live`. M1 talks to M4 over HTTP only.
- Payload fields are `snake_case` everywhere (contracts §1).
- **Config:** one `.env` at the repo root, copied from `.env.example`. From your module folder, run Node with `node --env-file=../.env ...`. Relative paths in `.env` resolve against the **repo root**, not the current working directory. M1: set `envDir: '..'` in the Vite config.
- **Using another language** for a module (for example Python for vision) is allowed if the module exposes the same function as an HTTP `POST` on its own port, with identical JSON in and out. Agree it with M4 first. The contract shapes do not change.

## 6. Mock-first: MANDATORY

Every module must build, run, and be tested **standalone against mocks** before the halfway-point integration. No module may block on another module existing.

| Module | Standalone mode | Must prove before integration |
|---|---|---|
| M1 | `VITE_USE_MOCK_API=true` returns the contract examples after ~1.5 s of fake latency | Happy path, every error code, the `audio_url: ""` fallback, bbox overlay on a real camera frame |
| M2 | CLI: `npm run try -- <photo.jpg>` prints a `VisionResult` | Valid shape on 10+ real Timișoara facade photos; `style: null` for non-buildings |
| M3 | CLI: feed it the contract's M2 example; it prints a `NarrationResult` and writes the mp3 | RO and EN output, 35–40 words, no invented facts, the TTS-failure path |
| M4 | `VISION_MODE=mock CONTENT_MODE=mock` uses built-in stubs and never imports `/vision` or `/content` | `/analyze`, `/narrate`, every error path, and demo fixtures, all via `curl` |

- Mock data is the JSON examples in `docs/contracts.md`, copied into your own folder.
- Keep a small shape check (a test or a runtime assertion) against the contract types so drift shows up early.

**Halfway integration order**, changing one switch at a time:
1. M1 → M4 in mock mode
2. `VISION_MODE=live`
3. `CONTENT_MODE=live`
4. Full flow on a real phone over HTTPS

## 7. Git workflow

- Make small, frequent commits prefixed with the module, for example `m2: normalize bbox output`.
- Run `git pull --rebase` before `git push`. Folders are disjoint, so rebases should never conflict. If one does, someone broke rule 4: stop and find out who.
- Never commit `.env`, API keys, `node_modules/`, or generated audio.

## 8. Demo-critical gotchas

- **Phones only allow camera access over HTTPS** (`getUserMedia` needs a secure context). Expose the frontend dev server through an HTTPS tunnel and proxy `/analyze`, `/narrate`, and `/audio` to the backend. The phone then sees a single origin, with no CORS and no mixed content.
- **iOS Safari blocks audio that a tap did not start.** Unlock or prime the audio element inside the Scan button's click handler, before the request goes out.
- **`VITE_*` variables are shipped to the browser.** Never put a secret in one. API keys live only on the backend.
- **Keep the `demo_fixture_id` path working at all times.** It is the safety net if the Wi-Fi or an AI provider fails on stage.
