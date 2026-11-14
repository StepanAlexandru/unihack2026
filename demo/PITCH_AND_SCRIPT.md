# Pitch Deck + 3-Minute Live Demo Script

> Owner: M4. Rehearse this at least twice with the real phone, the real tunnel, and venue Wi-Fi **off** once.

---

## 1. Pitch deck: slide by slide (≈ 7 slides, 3 min with the demo)

| # | Slide | On screen | Say (gist) | Time |
|---|---|---|---|---|
| 1 | **Title** | "Timișoara Heritage Lens", a facade photo, team names | "Timișoara has thousands of protected facades. Most people walk past them." | 0:10 |
| 2 | **Problem** | 3 photos: mask, lion head, inscription in Hungarian/German | "The stories are carved into the walls, in languages and styles most visitors can't read. Plaques are rare, and guides are expensive and scheduled." | 0:20 |
| 3 | **Solution** | Phone mockup: AR boxes + play button | "Point your phone. In seconds you get the style, highlighted details, translated inscriptions, and a 15-second story in Romanian or English. No app install." | 0:15 |
| 4 | **Live demo** | (switch to phone mirror) | see §2 | 1:30 |
| 5 | **How it works** | Diagram from `docs/architecture.md`: camera → vision AI → grounded narration KB → TTS | "The vision model finds the style and details. Narration only uses facts from our curated Timișoara knowledge base: no invented history." | 0:20 |
| 6 | **Why it matters / MuseumsQuartier fit** | Cetate · Fabric · Iosefin map, 24 labeled buildings | "It turns the whole city into a museum without walls. It's bilingual from day one and works in any browser." | 0:15 |
| 7 | **Next steps + ask** | Roadmap: more buildings, HU/DE/SR languages, guided routes, museum partnerships | "We'd love to pilot it with the city's heritage institutions." | 0:10 |

**Backup slide (hidden, after 7):** a 30-second screen recording of a perfect scan. Use it only if the phone is dead (see Rung 4).

---

## 2. Live demo script (1:30)

**Before going on stage** (see checklist §4): the phone is on the app page, the scan target is ready, and the volume is up.

| t | Action | Say |
|---|---|---|
| 0:00 | Hold up the phone, camera live, pointed at the **Casa Brück** target (printed card, laptop screen, or the real building if outdoors). | "This is Casa Brück on Piața Unirii. Let's ask it about itself." |
| 0:05 | Tap **Scan**. | "One tap. That also unlocks audio on iPhone." |
| 0:08 | Boxes appear on the ornament, gable, and inscription. | "It recognized the Secession style and found three details. This inscription is Hungarian: *ÉPÜLT 1910*, 'Built in 1910'. Translated on the spot." |
| 0:20 | Narration plays (~15 s). Stay quiet and let it play. | *(silence)* |
| 0:38 | Tap **RO** to switch language. | "Same building, now in Romanian. We don't re-scan, we only re-narrate." |
| 0:55 | Point at a second target (**Palatul Lloyd** or **Domul Catolic**) and tap Scan. | "Different era, different style: Eclectic / Baroque." |
| 1:15 | Point at the floor or a hand and tap Scan. | "And if it isn't heritage, it says so instead of making something up." (NO_MATCH screen) |
| 1:30 | Back to slides. | |

---

## 3. When something breaks: the fallback ladder

Rule: **never debug on stage.** Drop one rung, keep talking, and say the same sentences.

### Rung 1: AI is slow or failing (Wi-Fi is up)

If the request carries one of the 6 hero demo images (byte-identical, or re-encoded/resized), the backend answers from `demo/offline-cache.json` after **7 s** (`OFFLINE_FALLBACK_AFTER_MS`). **A live camera photo of a card or screen usually will *not* match** (perspective, glare, and background change the hash), so don't count on this rung for camera scans. For anything that doesn't match, the honest `TIMEOUT` screen appears: tap retry once, then go to Rung 2.

### Rung 2: Force offline mode without restarting

On the laptop (set `DEMO_ADMIN_TOKEN` in `.env` before the pitch):

```bash
curl -X POST localhost:3001/demo/offline -H 'content-type: application/json' \
     -H "x-demo-admin-token: $DEMO_ADMIN_TOKEN" -d '{"enabled":true}'
```

No AI calls are made from that point on. To make *every* scan succeed regardless of what the camera sees, start the backend with `OFFLINE_DEMO_MODE=true OFFLINE_DEMO_DEFAULT_FIXTURE=casa-bruck`. Then point the phone at the Casa Brück card so what the audience sees matches what the app says.

### Rung 3: Use the demo-fixture path (always works)

If M1 ships a hidden demo picker (long-press on the logo → list from `GET /demo/fixtures`), choose **casa-bruck**. The app sends `demo_fixture_id` and gets a pre-recorded response with no AI and no image processing. The `x-demo-fixture` header does the same thing for scripted clients.

### Rung 4: Venue Wi-Fi is down

> ⚠️ The Cloudflare quick tunnel **needs internet**. If venue Wi-Fi dies, the phone can't reach the laptop through `trycloudflare.com` at all, and no backend fallback can fix that alone.

- **4a. Mobile-data hotspot (preferred).** Turn on the hotspot from a *second* phone with mobile data, join the laptop to it, restart `cloudflared`, and reload the new URL on the demo phone. Takes about 60 s; rehearse it.
- **4b. No internet at all.** Join the demo phone and laptop to the same hotspot (data not required) and enable `OFFLINE_DEMO_MODE=true`. The phone needs HTTPS on the LAN: M1 runs Vite with `@vitejs/plugin-basic-ssl` and opens `https://<laptop-LAN-IP>:5173` on the phone, accepting the certificate warning *before* the pitch. Prepare this in advance; don't improvise it.
- **4c. Nothing works.** Play the backup screen recording (hidden slide) and narrate over it.

### What to say while dropping a rung

"Venue Wi-Fi, classic. Good thing we built for it: this is our offline mode, which a museum could also use underground or abroad." Then continue the script.

---

## 4. Pre-flight checklist (T-15 min)

- [ ] `cd backend && npm test` is green on the demo laptop.
- [ ] `.env` has `VISION_MODE=live`, `CONTENT_MODE=live`, `DEMO_ADMIN_TOKEN=<something>`, and a valid API key.
- [ ] `curl localhost:3001/health` shows `"mode":"live"` and `vision_active` / `content_active` both `"live"`.
- [ ] The tunnel is running and the URL is open on the phone. Camera permission is granted and **the page was reloaded once since granting it**.
- [ ] Hero fixtures work through the phone: `casa-bruck`, `palatul-lloyd`, `domul-catolic` (RO + EN).
- [ ] Phone: volume up, silent switch off, Do Not Disturb on, auto-lock off, brightness max, charger nearby.
- [ ] Targets printed **or** open full-screen on a second device: `demo/test-set/images/casa-bruck.jpg`, `palatul-lloyd.jpg`, `domul-catolic.jpg`.
- [ ] Hotspot phone is charged and has data (Rung 4a).
- [ ] Backup recording is in the deck.
- [ ] Laptop terminal shows the backend log (`npm start | jq -c '{path,status,latency_ms,source,style}'`) so you can see the source (live vs. cached) at a glance.

## 5. Facts used in the demo

Hero narrations live in `demo/fixtures-src/narrations.json`. They use only widely documented facts (names, approximate dates, architects). Before the pitch, M3 should confirm them against the knowledge base, or run `npm run record:demo-audio` with live M3 so the fixture text *is* M3's grounded output. Inscriptions on the synthetic test cards are illustrative. If a judge asks, the honest answer is "the live path reads real inscriptions; these cards are our test targets."
