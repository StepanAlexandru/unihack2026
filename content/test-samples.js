// M3 standalone tests: `npm test` (offline, deterministic) or `npm run test:live` (real TTS + LLM if keyed).
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes('--live');
try { process.loadEnvFile(join(HERE, '..', '.env')); } catch { /* no .env: fine */ }

const TMP = mkdtempSync(join(tmpdir(), 'm3-test-'));
process.env.AUDIO_CACHE_DIR = TMP;
if (!LIVE) Object.assign(process.env, { CONTENT_LLM: 'template', TTS_PROVIDER: 'none', TTS_FALLBACK: 'none' });

const { generateNarration } = await import('./index.js');
const { resultProblems } = await import('./lib/shape.js');
const { translateInscription, romanToInt } = await import('./translator.js');
const { retrieve, contextCorpus, identifyBuilding } = await import('./retriever.js');
const { narrate, groundingProblems } = await import('./narrator.js');
const { loadKB, STYLES, DETAIL_TYPES } = await import('./kb/loader.js');
const { clearMemoryCache } = await import('./tts.js');
const { wordCount } = await import('./lib/text.js');

let pass = 0;
let fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✔ ${name}`); }
  catch (err) { fail++; console.log(`  ✘ ${name}\n      ${err.message}`); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function valid(r, input) { const p = resultProblems(r, input); ok(!p.length, p.join('; ')); }
const D = (id, type, label, raw_text = null) => ({ id, type, label, bbox: [0.1, 0.1, 0.2, 0.2], raw_text });
const show = (r) => console.log(`      “${r.text}” (${wordCount(r.text)} w, ${r.duration_s}s, audio=${r.audio_url ? r.audio_url.slice(0, 40) : '""'})`);

const M2_EXAMPLE = JSON.parse(readFileSync(join(HERE, 'mocks', 'm2_example.json'), 'utf8'));

console.log(`\nM3 content tests (${LIVE ? 'LIVE' : 'offline: template + no TTS'}), cache dir ${TMP}\n`);

console.log('Required samples');
await test('1. Secession + Hungarian inscription (EN)', async () => {
  const input = { style: 'Secession', lang: 'en', details: [D('det_1', 'mask', 'Secession Mask (Mascaron)'), D('det_2', 'inscription', 'Bank name', 'TEMESVÁRI TAKARÉKPÉNZTÁR')] };
  const r = await generateNarration(input);
  valid(r, input); show(r);
  eq(r.enrichments.translations[0].translated, 'Timișoara Savings Bank', 'Hungarian translation');
  ok(/mask/i.test(r.text), 'narration should mention the mask (first detail)');
  eq(r.enrichments.building_name, null, 'no building should be guessed');
});

await test('2. Baroque + lion head (RO)', async () => {
  const input = { style: 'Baroque', lang: 'ro', details: [D('det_1', 'lion_head', 'Lion head keystone'), D('det_2', 'architectural_element', 'Stone portal')] };
  const r = await generateNarration(input);
  valid(r, input); show(r);
  ok(/leu/i.test(r.text), 'Romanian narration should mention the lion (leu)');
  ok(/[ăâîșț]/.test(r.text), 'Romanian text should have diacritics');
  ok(/1716|baroc/i.test(r.text), 'should speak about Baroque');
});

await test('3. Guild symbol: iron guild tree identifies the building (EN)', async () => {
  const input = { style: 'Baroque', lang: 'en', details: [D('det_1', 'guild_symbol', 'Iron Guild Tree')] };
  const r = await generateNarration(input);
  valid(r, input); show(r);
  eq(r.enrichments.building_name, 'House with the Iron Tree (Guild Tree)', 'building');
  ok(/legend/i.test(r.text) || /Trandaphil/.test(r.text), 'should use the grounded building story');
});

await test('4. RO vs EN on the contract M2 example', async () => {
  const en = await generateNarration({ ...M2_EXAMPLE, lang: 'en' });
  const ro = await generateNarration({ ...M2_EXAMPLE, lang: 'ro' });
  valid(en, M2_EXAMPLE); valid(ro, M2_EXAMPLE); show(en); show(ro);
  eq(en.enrichments.translations[0].translated, 'In the year 1910', 'EN translation (matches contract example)');
  eq(ro.enrichments.translations[0].translated, 'În anul 1910', 'RO translation');
  ok(en.text !== ro.text, 'texts differ by language');
  ok(/[ăâîșț]/.test(ro.enrichments.historical_context), 'RO history is Romanian');
});

await test('5. Cache hit < 5 ms and identical output', async () => {
  const input = { ...M2_EXAMPLE, lang: 'en' };
  const first = await generateNarration(input);
  const times = [];
  for (let i = 0; i < 25; i++) {
    const t0 = process.hrtime.bigint();
    const r = await generateNarration(input);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    eq(r.text, first.text, 'cached text');
  }
  clearMemoryCache(); // disk hit path
  const t0 = process.hrtime.bigint();
  await generateNarration(input);
  const disk = Number(process.hrtime.bigint() - t0) / 1e6;
  times.sort((a, b) => a - b);
  console.log(`      memory hit median ${times[12].toFixed(3)} ms, disk hit ${disk.toFixed(3)} ms`);
  ok(times[12] < 5 && disk < 5, 'cache hit should be < 5 ms');
});

console.log('\nContract & robustness');
await test('cache hit re-maps translations to the caller’s detail ids', async () => {
  const input = { ...M2_EXAMPLE, lang: 'en', details: M2_EXAMPLE.details.map((d, i) => ({ ...d, id: `x_${i}` })) };
  const r = await generateNarration(input);
  valid(r, input);
  eq(r.enrichments.translations[0].detail_id, 'x_1', 'detail id');
});

await test('TTS failure path → audio_url "" and duration = words / 2.5', async () => {
  if (LIVE) return;
  const r = await generateNarration({ style: 'Neoclassical', lang: 'en', details: [] });
  eq(r.audio_url, '', 'audio_url');
  eq(r.duration_s, Math.round((wordCount(r.text) / 2.5) * 10) / 10, 'estimated duration');
});

await test('INVALID_INPUT for bad style / lang / details', async () => {
  for (const bad of [{ style: null, details: [], lang: 'en' }, { style: 'Gothic', details: [], lang: 'en' }, { style: 'Baroque', details: [], lang: 'de' }, { style: 'Baroque', details: 'x', lang: 'en' }, null]) {
    let code = null;
    try { await generateNarration(bad); } catch (e) { code = e.code; }
    eq(code, 'INVALID_INPUT', `input ${JSON.stringify(bad)}`);
  }
});

await test('no false building match ("Brick" ≠ "Brück", plain labels)', async () => {
  eq(identifyBuilding('Secession', [D('a', 'architectural_element', 'Brick facade')]).building, null, 'brick');
  eq(identifyBuilding('Secession', [D('a', 'mask', 'Female face'), D('b', 'architectural_element', 'Balcony')]).building, null, 'generic');
  eq(identifyBuilding('Secession', [D('a', 'plaque', 'Plaque', 'PALATUL LLOYD')]).building?.id, 'palatul_lloyd', 'Lloyd by raw_text');
});

await test('sweep: every style × lang × detail combo is 35–40 words and grounded', async () => {
  const kb = loadKB();
  const combos = [[], ...DETAIL_TYPES.map((t) => [t]), ['mask', 'inscription'], ['lion_head', 'guild_symbol', 'plaque'], ['architectural_element', 'mask', 'lion_head']];
  const labels = { mask: 'Carved mask', lion_head: 'Lion head', guild_symbol: 'Beehive emblem', plaque: 'Memorial plaque', inscription: 'Date', architectural_element: 'Wrought iron balcony' };
  const raws = { inscription: 'ANNO MDCCXL', plaque: 'ERBAUT 1898' };
  let n = 0;
  const bad = [];
  for (const style of STYLES) for (const lang of ['en', 'ro']) for (const combo of combos) {
    const details = combo.map((t, i) => D(`d${i}`, t, labels[t], raws[t] ?? null));
    const ctx = await retrieve({ style, details, lang });
    const out = await narrate(ctx);
    const probs = groundingProblems(out.text, contextCorpus(ctx));
    if (probs.length) bad.push(`${style}/${lang}/${combo}: ${probs.join(', ')} → ${out.text}`);
    n++;
  }
  for (const b of kb.buildings) for (const lang of ['en', 'ro']) {
    const details = [D('d0', 'plaque', 'Name plaque', b.aliases[0].toUpperCase()), D('d1', 'mask', 'Mask')];
    const ctx = await retrieve({ style: b.styles[0], details, lang });
    if (ctx.building?.id !== b.id) bad.push(`building ${b.id} not identified by alias "${b.aliases[0]}"`);
    const out = await narrate(ctx);
    const probs = groundingProblems(out.text, contextCorpus(ctx));
    if (probs.length) bad.push(`${b.id}/${lang}: ${probs.join(', ')} → ${out.text}`);
    n++;
  }
  console.log(`      ${n} combinations checked`);
  ok(!bad.length, `\n        ${bad.slice(0, 8).join('\n        ')}`);
});

await test('grounding guard rejects invented facts', async () => {
  const ctx = await retrieve({ style: 'Secession', details: [D('a', 'mask', 'Mask')], lang: 'en' });
  const fake = 'This palace was built in 1850 by Gustave Eiffel for the Habsburg emperor, who visited it often and admired the masks, the balconies and the gilded roof above the square every summer.';
  const probs = groundingProblems(fake, contextCorpus(ctx));
  ok(probs.some((p) => p.includes('1850')) && probs.some((p) => p.includes('Eiffel')), `expected 1850 and Eiffel to be flagged, got ${probs}`);
});

await test('LLM path: grounded rewrite accepted, hallucinated rewrite rejected (template fallback)', async () => {
  const ctx = await retrieve({ style: 'Secession', details: [D('a', 'mask', 'Mask')], lang: 'en' });
  const good = 'Here is Secession architecture, the Art Nouveau that transformed Timișoara between about 1900 and 1914. Notice the carved mask: Secession sculptors framed such faces with flowing hair and plants, symbols of youth and art, nature and beauty.';
  const fakeLLM = (reply) => ({ name: 'fake', model: 'fake', complete: async () => reply });
  const ok1 = await narrate(ctx, { llm: fakeLLM(good) });
  eq(ok1.source, 'llm:fake', `grounded LLM text should be used (rejected: ${ok1.rejected})`);
  const bad = await narrate(ctx, { llm: fakeLLM(good.replace('1914', '1923').replace('Notice', 'Architect Ödön Lechner designed it; notice')) });
  eq(bad.source, 'template', 'hallucinated text must fall back to template');
  const err = await narrate(ctx, { llm: { name: 'x', complete: async () => { throw new Error('timeout'); } } });
  eq(err.source, 'template', 'LLM error falls back to template');
});

await test('inscription translator (Latin / Hungarian / German / Serbian / unknown)', async () => {
  const cases = [
    ['ANNO MDCCXL', 'en', 'In the year MDCCXL (1740)'],
    ['ÉPÜLT 1911', 'ro', 'Construit în 1911'],
    ['ERBAUT IM JAHRE 1898', 'en', 'Built in 1898'],
    ['SOLI DEO GLORIA', 'ro', 'Slavă numai lui Dumnezeu'],
    ['СРПСКА ПРАВОСЛАВНА ЦРКВА', 'en', 'Serbian Orthodox Church'],
    ['PAX INTRANTIBUS SALUS EXEUNTIBUS 1890', 'en', 'Peace to those who enter, health to those who leave, 1890'],
    ['APOTHEKE ZUM GOLDENEN LÖWEN', 'en', 'Pharmacy At the Golden Lion'],
    ['XYZZY QWERTY', 'en', 'XYZZY QWERTY'],
  ];
  for (const [raw, lang, want] of cases) {
    eq(translateInscription(raw, lang).translated, want, raw);
  }
  eq(romanToInt('MCMX'), 1910, 'roman'); eq(romanToInt('IIII'), null, 'non-canonical roman');
});

if (LIVE) {
  console.log('\nLive TTS');
  await test('live TTS writes a playable mp3 into AUDIO_CACHE_DIR', async () => {
    const input = { ...M2_EXAMPLE, lang: 'ro' };
    const r = await generateNarration(input);
    valid(r, input); show(r);
    ok(r.audio_url.startsWith('/audio/cache/'), `audio_url ${r.audio_url}`);
    ok(existsSync(join(TMP, r.audio_url.replace('/audio/cache/', ''))), 'mp3 file exists');
    // Paid voices speak ~2.5 words/s (~15 s). The free gtranslate voice is slower (~1.4 words/s in RO).
    const slow = (process.env.TTS_PROVIDER || 'gtranslate') === 'gtranslate';
    ok(r.duration_s > 8 && r.duration_s < (slow ? 32 : 22), `duration ${r.duration_s}s out of range`);
  });
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
