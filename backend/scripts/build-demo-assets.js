#!/usr/bin/env node
// Generates every derived demo asset from two hand-edited sources:
//   demo/test-set/manifest.json        (labeled test set)
//   demo/fixtures-src/narrations.json  (hero narrations, RO + EN)
// Outputs:
//   demo/test-set/images/<id>.jpg  synthetic facade card (what gets sent / hashed)
//   demo/test-set/images/<id>.svg  same card, annotated with bboxes + labels (for humans)
//   demo/fixtures/*.json           contract §9.3 fixtures (heroes, contract example, every error code)
//   demo/offline-cache.json        fingerprints + complete RO/EN responses for the offline fallback
// Usage: node scripts/build-demo-assets.js [--check]   (--check = fail if anything is stale or invalid)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { REPO_ROOT } from '../src/config.js';
import { checkAnalyzeResponse, checkBBox, checkDetail, checkErrorResponse, STYLES, wordCount } from '../src/contract.js';
import { dhash, decodeImage, sha256 } from '../src/imagehash.js';

const CHECK = process.argv.includes('--check');
const DEMO = path.join(REPO_ROOT, 'demo');
const W = 480, H = 640;

const manifest = JSON.parse(readFileSync(path.join(DEMO, 'test-set', 'manifest.json'), 'utf8'));
const narr = JSON.parse(readFileSync(path.join(DEMO, 'fixtures-src', 'narrations.json'), 'utf8'));
const contractExamples = JSON.parse(readFileSync(path.join(REPO_ROOT, 'backend', 'mocks', 'contract-examples.json'), 'utf8'));

const outputs = new Map(); // abs path -> Buffer
const problems = [];
const emit = (rel, data) => outputs.set(path.join(DEMO, rel), Buffer.isBuffer(data) ? data : Buffer.from(data));
const emitJson = (rel, obj) => emit(rel, JSON.stringify(obj, null, 2) + '\n');

// ---------------------------------------------------------------- scene graph
function rng(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

const PALETTE = {
  Secession: { wall: [236, 214, 168], accent: [64, 138, 118], trim: [180, 120, 70] },
  Baroque: { wall: [226, 189, 118], accent: [246, 240, 224], trim: [150, 110, 60] },
  Eclectic: { wall: [214, 168, 148], accent: [150, 88, 68], trim: [235, 220, 200] },
  Neoclassical: { wall: [222, 222, 212], accent: [250, 250, 245], trim: [160, 160, 150] },
  Brutalist: { wall: [142, 142, 136], accent: [96, 96, 92], trim: [70, 70, 68] },
  null: { wall: [204, 170, 140], accent: [124, 60, 50], trim: [230, 200, 120] },
};
const DARK = [52, 58, 70], GLASS = [70, 96, 120], SKY_TOP = [150, 196, 235], SKY_BOT = [214, 232, 246];

function facadeScene(c) {
  const r = rng(c.id);
  const pal = PALETTE[c.expected_style] ?? PALETTE.null;
  const s = [];
  for (let i = 0; i < 16; i++) s.push({ k: 'rect', x: 0, y: i / 16, w: 1, h: 1 / 16 + 0.001, c: SKY_TOP.map((v, j) => Math.round(v + ((SKY_BOT[j] - v) * i) / 15)) });
  s.push({ k: 'rect', x: 0.06, y: 0.1, w: 0.88, h: 0.9, c: pal.wall });
  s.push({ k: 'rect', x: 0.05, y: 0.1, w: 0.9, h: 0.02, c: pal.trim }); // cornice
  s.push({ k: 'rect', x: 0.06, y: 0.68, w: 0.88, h: 0.012, c: pal.trim }); // string course
  const cols = 3 + Math.floor(r() * 3), rows = c.expected_style === 'Brutalist' ? 7 : 3 + Math.floor(r() * 2);
  const ww = 0.6 / cols / 1.4, top = 0.16, band = 0.5 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = 0.12 + ((x + 0.5) * 0.76) / cols;
      s.push({ k: 'rect', x: cx - ww / 2, y: top + y * band + band * 0.15, w: ww, h: band * 0.6, c: r() > 0.85 ? DARK : GLASS });
      if (c.expected_style === 'Baroque' || c.expected_style === 'Neoclassical') s.push({ k: 'rect', x: cx - ww / 2 - 0.005, y: top + y * band + band * 0.08, w: ww + 0.01, h: 0.012, c: pal.trim });
    }
  }
  s.push({ k: 'rect', x: 0.06, y: 0.97, w: 0.88, h: 0.03, c: [120, 116, 110] }); // pavement
  for (const d of c.expected_details) s.push(...detailShapes(d, pal));
  return s;
}

function detailShapes(d, pal) {
  const [x, y, w, h] = d.bbox;
  const L = d.label.toLowerCase();
  const tri = (c) => ({ k: 'poly', pts: [[x, y + h], [x + w / 2, y], [x + w, y + h]], c });
  switch (d.type) {
    case 'mask':
      return [{ k: 'ell', x, y, w, h, c: pal.trim }, { k: 'ell', x: x + w * 0.22, y: y + h * 0.3, w: w * 0.18, h: h * 0.16, c: DARK }, { k: 'ell', x: x + w * 0.6, y: y + h * 0.3, w: w * 0.18, h: h * 0.16, c: DARK }, { k: 'rect', x: x + w * 0.35, y: y + h * 0.68, w: w * 0.3, h: h * 0.08, c: DARK }];
    case 'lion_head':
      return [{ k: 'ell', x, y, w, h, c: [196, 150, 60] }, { k: 'ell', x: x + w * 0.2, y: y + h * 0.2, w: w * 0.6, h: h * 0.6, c: [150, 110, 40] }];
    case 'guild_symbol':
      return [{ k: 'poly', pts: [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], c: [170, 50, 40] }, { k: 'ell', x: x + w * 0.35, y: y + h * 0.35, w: w * 0.3, h: h * 0.3, c: [240, 200, 90] }];
    case 'plaque':
      return [{ k: 'rect', x, y, w, h, c: DARK }, { k: 'rect', x: x + w * 0.06, y: y + h * 0.12, w: w * 0.88, h: h * 0.76, c: [40, 80, 150] }];
    case 'inscription':
      return [{ k: 'rect', x, y, w, h, c: pal.trim }, ...[0.3, 0.6].map((f) => ({ k: 'rect', x: x + w * 0.08, y: y + h * f, w: w * 0.84, h: h * 0.14, c: DARK }))];
    default:
      if (/tower|dome|turret|lantern/.test(L)) return [{ k: 'rect', x: x + w * 0.15, y: y + h * 0.35, w: w * 0.7, h: h * 0.65, c: pal.trim }, { k: 'ell', x: x + w * 0.1, y, w: w * 0.8, h: h * 0.7, c: pal.accent }];
      if (/gable|pediment|roofline/.test(L)) return [tri(pal.trim), { k: 'poly', pts: [[x + w * 0.15, y + h * 0.9], [x + w / 2, y + h * 0.2], [x + w * 0.85, y + h * 0.9]], c: pal.accent }];
      if (/portal|entrance|gate|arch/.test(L)) return [{ k: 'rect', x, y, w, h, c: pal.trim }, { k: 'rect', x: x + w * 0.15, y: y + h * 0.35, w: w * 0.7, h: h * 0.65, c: DARK }, { k: 'ell', x: x + w * 0.15, y: y + h * 0.12, w: w * 0.7, h: h * 0.46, c: DARK }];
      if (/balcon/.test(L)) return [{ k: 'rect', x, y, w, h: h * 0.25, c: DARK }, { k: 'rect', x, y: y + h * 0.8, w, h: h * 0.2, c: DARK }, ...Array.from({ length: 8 }, (_, i) => ({ k: 'rect', x: x + (i * w) / 8, y, w: w * 0.03, h, c: DARK }))];
      return [{ k: 'rect', x, y, w, h, c: pal.accent }, ...Array.from({ length: 4 }, (_, i) => ({ k: 'ell', x: x + (i * w) / 4 + w * 0.03, y: y + h * 0.2, w: w * 0.19, h: h * 0.6, c: pal.trim }))];
  }
}

function nonBuildingScene(c) {
  const s = [{ k: 'rect', x: 0, y: 0, w: 1, h: 0.55, c: SKY_TOP }];
  if (c.id.includes('tram')) {
    s.push({ k: 'rect', x: 0, y: 0.55, w: 1, h: 0.45, c: [110, 110, 110] }, { k: 'rect', x: 0, y: 0.82, w: 1, h: 0.01, c: [200, 200, 200] });
    s.push({ k: 'rect', x: 0.05, y: 0.4, w: 0.9, h: 0.36, c: [230, 190, 40] }, { k: 'rect', x: 0.05, y: 0.62, w: 0.9, h: 0.05, c: [190, 40, 40] });
    for (let i = 0; i < 5; i++) s.push({ k: 'rect', x: 0.09 + i * 0.17, y: 0.45, w: 0.12, h: 0.12, c: GLASS });
    s.push({ k: 'ell', x: 0.15, y: 0.73, w: 0.1, h: 0.07, c: DARK }, { k: 'ell', x: 0.75, y: 0.73, w: 0.1, h: 0.07, c: DARK });
  } else {
    s.push({ k: 'rect', x: 0, y: 0.55, w: 1, h: 0.45, c: [96, 160, 80] });
    for (const [x, y, sz] of [[0.05, 0.25, 0.3], [0.4, 0.18, 0.36], [0.72, 0.28, 0.26]]) {
      s.push({ k: 'rect', x: x + sz * 0.45, y: y + sz * 0.7, w: sz * 0.1, h: sz * 0.6, c: [110, 80, 50] }, { k: 'ell', x, y, w: sz, h: sz * 0.9, c: [50, 120, 60] });
    }
  }
  return s;
}

// ---------------------------------------------------------------- renderers
function raster(shapes) {
  const data = Buffer.alloc(W * H * 4, 255);
  const put = (px, py, c) => { const i = (py * W + px) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  for (const s of shapes) {
    if (s.k === 'rect' || s.k === 'ell') {
      const x0 = Math.max(0, Math.round(s.x * W)), x1 = Math.min(W, Math.round((s.x + s.w) * W));
      const y0 = Math.max(0, Math.round(s.y * H)), y1 = Math.min(H, Math.round((s.y + s.h) * H));
      const cx = (s.x + s.w / 2) * W, cy = (s.y + s.h / 2) * H, rx = (s.w * W) / 2, ry = (s.h * H) / 2;
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
        if (s.k === 'rect' || ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2 <= 1) put(px, py, s.c);
      }
    } else {
      const pts = s.pts.map(([x, y]) => [x * W, y * H]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      for (let py = Math.max(0, Math.floor(Math.min(...ys))); py < Math.min(H, Math.ceil(Math.max(...ys))); py++) {
        for (let px = Math.max(0, Math.floor(Math.min(...xs))); px < Math.min(W, Math.ceil(Math.max(...xs))); px++) {
          let inside = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if (yi > py + 0.5 !== yj > py + 0.5 && px + 0.5 < ((xj - xi) * (py + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
          }
          if (inside) put(px, py, s.c);
        }
      }
    }
  }
  return jpeg.encode({ data, width: W, height: H }, 85).data;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const rgb = (c) => `rgb(${c.join(',')})`;
const f = (n, m) => +(n * m).toFixed(1);

function svg(c, shapes) {
  const body = shapes.map((s) => {
    if (s.k === 'rect') return `<rect x="${f(s.x, W)}" y="${f(s.y, H)}" width="${f(s.w, W)}" height="${f(s.h, H)}" fill="${rgb(s.c)}"/>`;
    if (s.k === 'ell') return `<ellipse cx="${f(s.x + s.w / 2, W)}" cy="${f(s.y + s.h / 2, H)}" rx="${f(s.w / 2, W)}" ry="${f(s.h / 2, H)}" fill="${rgb(s.c)}"/>`;
    return `<polygon points="${s.pts.map(([x, y]) => `${f(x, W)},${f(y, H)}`).join(' ')}" fill="${rgb(s.c)}"/>`;
  });
  const notes = c.expected_details.map((d) => {
    const [x, y, w, h] = d.bbox;
    const label = d.raw_text ? `${d.label}: “${d.raw_text}”` : d.label;
    const ty = y * H > 24 ? f(y, H) - 4 : f(y + h, H) + 13;
    return `<g><rect x="${f(x, W)}" y="${f(y, H)}" width="${f(w, W)}" height="${f(h, H)}" fill="none" stroke="#ff2d55" stroke-width="2" stroke-dasharray="6 3"/>` +
      `<text x="${f(x, W) + 2}" y="${ty}" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="#ff2d55" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(d.id)} · ${esc(d.type)} · ${esc(label)}</text></g>`;
  });
  const title = `${c.name} · ${c.district ?? 'n/a'} · expected: ${c.expected_style ?? 'null (NO_MATCH)'}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n<title>${esc(title)}</title>\n${body.join('\n')}\n${notes.join('\n')}\n` +
    `<rect x="0" y="${H - 26}" width="${W}" height="26" fill="rgba(0,0,0,0.6)"/><text x="8" y="${H - 9}" font-family="system-ui,sans-serif" font-size="12" fill="#fff">${esc(title)}</text>\n</svg>\n`;
}

// ---------------------------------------------------------------- build
if (!Array.isArray(manifest.cases) || manifest.cases.length < 20) problems.push(`manifest must have >= 20 cases (has ${manifest.cases?.length})`);
const ids = new Set();
const images = {};
for (const c of manifest.cases) {
  if (!/^[a-z0-9_-]{1,64}$/.test(c.id) || ids.has(c.id)) problems.push(`case id invalid or duplicate: ${c.id}`);
  ids.add(c.id);
  if (!(c.expected_style === null || STYLES.includes(c.expected_style))) problems.push(`${c.id}: bad expected_style`);
  if (!Array.isArray(c.acceptable_styles) || !c.acceptable_styles.includes(c.expected_style)) problems.push(`${c.id}: acceptable_styles must include expected_style`);
  c.expected_details.forEach((d, i) => problems.push(...checkDetail(d, `${c.id}.expected_details[${i}]`), ...checkBBox(d.bbox, `${c.id}.det[${i}]`)));
  const shapes = c.scene === 'facade' ? facadeScene(c) : nonBuildingScene(c);
  const jpg = raster(shapes);
  images[c.id] = jpg;
  emit(`test-set/${c.image}`, jpg);
  emit(`test-set/${c.card_svg}`, svg(c, shapes));
}

const duration = (t) => Math.round((wordCount(t) / 2.5) * 10) / 10;
const audioUrl = (id, lang) => (existsSync(path.join(DEMO, 'audio', `${id}-${lang}.mp3`)) ? `/audio/demo/${id}-${lang}.mp3` : '');
const checkWords = (where, t) => { const n = wordCount(t); if (n < 35 || n > 40) problems.push(`${where}: narration has ${n} words (need 35-40)`); };

const entries = [];
for (const [id, h] of Object.entries(narr.heroes)) {
  const c = manifest.cases.find((x) => x.id === id);
  if (!c) { problems.push(`narrations.json hero "${id}" not in manifest`); continue; }
  const responses = {};
  for (const lang of ['en', 'ro']) {
    const n = h[lang];
    checkWords(`${id}.${lang}`, n.text);
    const body = {
      style: c.expected_style,
      confidence: h.confidence,
      details: c.expected_details.map((d) => ({ id: d.id, label: d.label, type: d.type, bbox: d.bbox, raw_text: d.raw_text, translated_text: d.raw_text === null ? null : d.translations?.[lang] ?? null })),
      narration: { text: n.text, audio_url: audioUrl(id, lang), duration_s: duration(n.text), building_name: h.building_name, history: n.history, why_it_matters: n.why_it_matters },
    };
    problems.push(...checkAnalyzeResponse(body).map((p) => `${id}.${lang}: ${p}`));
    responses[lang] = body;
    emitJson(`fixtures/${id}.${lang}.json`, body);
  }
  const decoded = decodeImage(images[id]);
  entries.push({ fixture_id: id, building_name: h.building_name, style: c.expected_style, image: `test-set/${c.image}`, sha256: sha256(images[id]), dhash: dhash(decoded), responses });
}

// Contract §6 example, verbatim in EN + its RO counterpart.
{
  const v = contractExamples.vision_result, en = contractExamples.narration_result_en, ro = narr.contract_example.ro;
  checkWords('contract-example.ro', ro.text);
  const mk = (lang, n, hist, why, tr) => ({
    style: v.style,
    confidence: v.confidence,
    details: v.details.map((d) => ({ ...d, translated_text: d.raw_text === null ? null : tr })),
    narration: { text: n, audio_url: audioUrl('contract-example', lang), duration_s: lang === 'en' ? en.duration_s : duration(n), building_name: null, history: hist, why_it_matters: why },
  });
  emitJson('fixtures/contract-example.en.json', mk('en', en.text, en.enrichments.historical_context, en.enrichments.why_it_matters, en.enrichments.translations[0].translated));
  emitJson('fixtures/contract-example.ro.json', mk('ro', ro.text, ro.history, ro.why_it_matters, ro.translated_det_2));
}

// One fixture per error code, so M1 can demo every error screen (§9.3).
const ERRORS = {
  'error-no-match': ['NO_MATCH', 'No recognizable architectural heritage facade found.'],
  'error-low-confidence': ['LOW_CONFIDENCE', 'Style confidence 0.41 is below the 0.55 threshold.'],
  'error-timeout': ['TIMEOUT', 'Vision analysis exceeded its 15000 ms budget.'],
  'error-invalid-input': ['INVALID_INPUT', 'Could not decode the image.'],
};
for (const [id, [code, message]] of Object.entries(ERRORS)) {
  const body = { error: { code, message } };
  problems.push(...checkErrorResponse(body));
  emitJson(`fixtures/${id}.json`, body);
}

emitJson('offline-cache.json', {
  _readme: 'GENERATED by `cd backend && npm run build:demo` from demo/test-set/manifest.json + demo/fixtures-src/narrations.json. Do not edit by hand.',
  version: 1,
  hash: { exact: 'sha256 of the decoded image bytes', perceptual: '64-bit dHash (9x8 grayscale), match if Hamming distance <= OFFLINE_HASH_MAX_DISTANCE' },
  entries,
});

// ---------------------------------------------------------------- write / check
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
let stale = 0;
for (const [file, buf] of outputs) {
  // Text files are compared ignoring CR so a Windows checkout with core.autocrlf doesn't look stale.
  const norm = (b) => (file.endsWith('.jpg') ? b : Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n')));
  const same = existsSync(file) && norm(readFileSync(file)).equals(norm(buf));
  if (CHECK) { if (!same) { stale++; console.error(`stale: ${path.relative(REPO_ROOT, file)}`); } continue; }
  if (!same) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, buf); }
}
if (CHECK && stale) { console.error(`✗ ${stale} generated file(s) are stale. Run: cd backend && npm run build:demo`); process.exit(1); }
console.log(`✓ ${manifest.cases.length} test cases, ${entries.length} offline-cache entries, ${outputs.size} files ${CHECK ? 'up to date' : 'written'}.`);
