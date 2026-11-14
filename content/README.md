# M3: Audio + Content (`/content`)

Grounded narration for Timișoara facades: knowledge base → retrieval → 35–40-word narration (RO/EN) → cached TTS.
Implements `generateNarration({ style, details, lang })` from [docs/contracts.md §5](../docs/contracts.md). No npm dependencies (Node ≥ 20.12, uses `fetch` and `process.loadEnvFile`).

```bash
cd content
npm test                 # offline, deterministic: template engine, TTS disabled, temp cache
npm run test:live        # real TTS (free Google voice if no key) + LLM if a key is set
npm run try              # contract M2 example → NarrationResult (EN)
npm run try -- ../path/vision.json --lang ro
npm run try -- --style Baroque --detail "lion_head:Lion head" --detail "inscription:Date:ANNO 1745" --lang ro
npm run warm             # pre-generate 10 common scans × RO/EN into AUDIO_CACHE_DIR
```

## Pipeline

| File | Role |
|---|---|
| `kb/timisoara_kb.json` | The only source of facts: 5 contract styles, 6 districts, 13 buildings, architects, 18 ornament types, inscription phrases, patterns and a glossary. Every building entry lists its sources. |
| `kb/loader.js` | Loads the KB once, validates it (fails loudly at startup), and builds the indexes. |
| `retriever.js` | Matches `style`, `details[].type`, `label` and `raw_text` against the KB using fuzzy keywords. It identifies a building **only** from text evidence (an alias in a label or `raw_text`), so it never guesses one from style alone. |
| `translator.js` | Deterministic inscription translation (Latin/HU/DE/SR/RO): exact phrase → regex pattern (dates, roman numerals, "ÉPÜLT 1911", "ERBAUT 1898"…) → glossary → verbatim. It never invents. An LLM fallback is used only when a key is set, and it is rejected if it adds digits. |
| `narrator.js` | The template engine picks verified KB sentences to land in 35–40 words, with visible details weighted highest. An optional LLM rewrite is accepted **only** if `groundingProblems()` finds no number or proper name outside the KB context and the word count is in range. Otherwise the template text is used. |
| `tts.js` | Narration cache, TTS providers and the mp3 cache. |
| `lib/shape.js` | Contract shape checks for input and output (used by the tests). |

## Cache

- **Narration key:** `sha256(normalize(style) | sorted(type:label:raw_text) | lang | fingerprint)`. The fingerprint is the KB version, LLM provider/model and TTS provider/voice, so a config change never serves stale output. Stored as `<AUDIO_CACHE_DIR>/<key>.json` plus an in-memory LRU. A hit takes about 0.03 ms from memory and 0.2–0.3 ms from disk.
- **Audio file:** `sha256(provider|voice|lang|text)` → `<AUDIO_CACHE_DIR>/<hash>.mp3`, returned as `/audio/cache/<hash>.mp3`. If the directory is not writable, it falls back to a `data:audio/mpeg;base64,…` URL.
- A cached entry whose mp3 was deleted counts as a miss. An entry cached with `audio_url: ""` retries TTS on the next hit.
- Detail ids are not part of the key. On a hit, translations are re-attached to the caller's ids.

## Configuration

Already in `.env.example`: `ANTHROPIC_API_KEY`, `CONTENT_MODEL`, `AUDIO_CACHE_DIR`, `TTS_PROVIDER`, `TTS_API_KEY`, `TTS_VOICE_RO`, `TTS_VOICE_EN`.

| `TTS_PROVIDER` | Needs | Notes |
|---|---|---|
| *(empty)* / `gtranslate` | nothing | Free Google Translate voice, unofficial endpoint. Fine for a demo. Slow pace: about 19 s EN and about 24–28 s RO for 38 words. `duration_s` is measured from the mp3, not guessed. |
| `elevenlabs` | `TTS_API_KEY`, optional voice id | `eleven_multilingual_v2`, good Romanian. **Recommended for the demo.** |
| `openai` | `TTS_API_KEY` | `gpt-4o-mini-tts`, voice default `alloy` |
| `google` | `TTS_API_KEY` (Cloud TTS) | `ro-RO` / `en-GB`, optional voice name |
| `none` | — | always `audio_url: ""` (M1 uses `speechSynthesis`) |

**Optional variables read by M3 that are not yet in `.env.example`** (M4: please add them):

```
# LLM for narration rewrite: auto | anthropic | openai | gemini | template (auto = first key present)
CONTENT_LLM=auto
CONTENT_LLM_TIMEOUT_MS=6000
OPENAI_API_KEY=
OPENAI_CONTENT_MODEL=gpt-4o-mini
GEMINI_API_KEY=
GEMINI_CONTENT_MODEL=gemini-2.0-flash
# TTS: fallback provider when the main one fails (gtranslate | none), per-request timeout
TTS_FALLBACK=gtranslate
TTS_TIMEOUT_MS=7000
# print per-request diagnostics to stderr
CONTENT_DEBUG=
```

With no keys at all the module still works: template narration plus the free voice. Worst case is the text with `audio_url: ""`.

## Editing the KB

- Every date, name or event that can be spoken must be in `timisoara_kb.json` with a source. The grounding check uses the KB itself, so a fact you add becomes speakable.
- Uncertain facts: hedge them in `history` (see the Baroque Palace) and keep them out of `narration.*.leads`.
- After editing, run `npm test`. The sweep test checks that every style × language × detail combination still lands in 35–40 words and stays grounded.
