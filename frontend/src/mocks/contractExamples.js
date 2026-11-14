// Mock payloads for M1. Copied from / modelled on docs/contracts.md v1.0.0 (§6, §7, §8).
// Pure JS (no Vite imports) so `npm run check:contract` can validate them in Node.
//
// NOTE: narration copy here is placeholder demo text, not knowledge-base facts.
// Real, grounded text comes from M3 via the backend.

/** §6 example, verbatim. */
export const CONTRACT_ANALYZE_EXAMPLE = {
  style: 'Secession',
  confidence: 0.87,
  details: [
    {
      id: 'det_1',
      label: 'Secession Mask (Mascaron)',
      type: 'mask',
      bbox: [0.32, 0.18, 0.14, 0.16],
      raw_text: null,
      translated_text: null,
    },
    {
      id: 'det_2',
      label: 'Dated Inscription',
      type: 'inscription',
      bbox: [0.4, 0.62, 0.22, 0.06],
      raw_text: 'ANNO 1910',
      translated_text: 'In the year 1910',
    },
  ],
  narration: {
    text: 'This facade belongs to the Secession style that reshaped Timișoara in the early twentieth century. Look for the carved mask above the window: Secession architects used faces and flowing plant motifs to give buildings personality and civic pride.',
    audio_url: '/audio/cache/3f9a1c7e.mp3',
    duration_s: 14.5,
    building_name: null,
    history:
      'In the early 1900s, as Timișoara grew beyond its old fortress walls, many new apartment buildings adopted the Secession style that was popular across Austria-Hungary.',
    why_it_matters: "Secession facades are a defining part of Timișoara's architectural identity.",
  },
};

const SECESSION_DETAILS = [
  {
    id: 'det_1',
    label: 'Secession Mask (Mascaron)',
    type: 'mask',
    bbox: [0.36, 0.2, 0.16, 0.17],
    raw_text: null,
  },
  {
    id: 'det_2',
    label: 'Floral Stucco Frieze',
    type: 'architectural_element',
    bbox: [0.12, 0.43, 0.42, 0.1],
    raw_text: null,
  },
  {
    id: 'det_3',
    label: 'Hungarian Shop Inscription',
    type: 'inscription',
    bbox: [0.56, 0.66, 0.3, 0.07],
    raw_text: 'GYÓGYSZERTÁR',
  },
];

const BAROQUE_DETAILS = [
  {
    id: 'det_1',
    label: 'Baroque Portal',
    type: 'architectural_element',
    bbox: [0.38, 0.55, 0.24, 0.38],
    raw_text: null,
  },
  {
    id: 'det_2',
    label: 'Coat of Arms',
    type: 'guild_symbol',
    bbox: [0.43, 0.24, 0.14, 0.15],
    raw_text: null,
  },
  {
    id: 'det_3',
    label: 'Lion Head Keystone',
    type: 'lion_head',
    bbox: [0.46, 0.47, 0.08, 0.07],
    raw_text: null,
  },
];

const TRANSLATIONS = {
  GYÓGYSZERTÁR: { en: 'Pharmacy', ro: 'Farmacie' },
};

const NARRATION = {
  Secession: {
    en: {
      text: 'You are looking at a Secession facade, the Viennese-born style that swept Timișoara around 1900. Notice the carved mask watching the square and the stucco flowers climbing the wall, ornament meant to make everyday commerce feel modern and proud.',
      history:
        'Around 1900, Timișoara expanded rapidly and many merchants commissioned Secession buildings around its central squares, echoing trends from Vienna and Budapest.',
      why_it_matters:
        'These facades show how a prosperous, multilingual city announced its modern identity through ornament.',
    },
    ro: {
      text: 'Privești o fațadă Secession, stilul născut la Viena care a cucerit Timișoara în jurul anului 1900. Observă masca sculptată care veghează piața și florile din stuc ce urcă pe zid, ornamente menite să facă negoțul modern și mândru.',
      history:
        'În jurul anului 1900, Timișoara s-a extins rapid, iar mulți negustori au comandat clădiri în stil Secession în jurul piețelor centrale, după modelul Vienei și Budapestei.',
      why_it_matters:
        'Aceste fațade arată cum un oraș prosper și multilingv și-a afirmat identitatea modernă prin ornament.',
    },
  },
  Baroque: {
    en: {
      text: 'This is Baroque architecture, the style of Timișoara’s eighteenth-century rebuilding after the Habsburg conquest. Follow the grand portal upward to the coat of arms: symmetry, heavy stone frames and sculpted emblems were designed to project imperial order and authority.',
      history:
        'After 1716, the Habsburg administration rebuilt Timișoara as a planned fortress city, and Baroque palaces and churches rose around Piața Unirii.',
      why_it_matters:
        'Baroque buildings mark the moment Timișoara became a Central European city, shaping the squares visitors still walk today.',
    },
    ro: {
      text: 'Aceasta este arhitectură barocă, stilul reconstrucției Timișoarei din secolul al optsprezecelea, după cucerirea habsburgică. Urmărește portalul impunător până la blazon: simetria, ancadramentele grele de piatră și emblemele sculptate trebuiau să transmită ordine și autoritate imperială.',
      history:
        'După 1716, administrația habsburgică a reconstruit Timișoara ca oraș-cetate planificat, iar palate și biserici baroce s-au ridicat în jurul Pieței Unirii.',
      why_it_matters:
        'Clădirile baroce marchează momentul în care Timișoara a devenit un oraș central-european, modelând piețele pe care le parcurgem și azi.',
    },
  },
};

const BUILDINGS = {
  Secession: 'Palatul Brück',
  Baroque: 'Palatul Baroc',
};

function withTranslations(details, lang) {
  return details.map((d) => ({
    ...d,
    translated_text: d.raw_text ? (TRANSLATIONS[d.raw_text]?.[lang] ?? null) : null,
  }));
}

function wordCount(s) {
  return s.trim().split(/\s+/).length;
}

export function mockNarrate(style, lang, { audio = true } = {}) {
  const n = NARRATION[style]?.[lang] ?? NARRATION.Secession[lang] ?? NARRATION.Secession.en;
  return {
    text: n.text,
    // "/audio/demo/..." only exists when the backend is running; the player falls back to
    // speechSynthesis if it fails to load, so both paths are exercised.
    audio_url: audio ? `/audio/demo/${style.toLowerCase()}_${lang}.mp3` : '',
    duration_s: Math.round((wordCount(n.text) / 2.5) * 10) / 10,
    history: n.history,
    why_it_matters: n.why_it_matters,
  };
}

function analyze(style, confidence, details, lang, opts) {
  const n = mockNarrate(style, lang, opts);
  return {
    style,
    confidence,
    details: withTranslations(details, lang),
    narration: {
      text: n.text,
      audio_url: n.audio_url,
      duration_s: n.duration_s,
      building_name: BUILDINGS[style] ?? null,
      history: n.history,
      why_it_matters: n.why_it_matters,
    },
  };
}

const err = (code, message) => ({ error: { code, message } });

/**
 * Mock scenarios selectable from the dev menu.
 * `respond(lang)` returns { status, body }. `hang: true` never answers, which exercises
 * the real 6 s client timeout.
 */
export const MOCK_SCENARIOS = {
  secession: {
    label: 'Secession · Palatul Brück',
    respond: (lang) => ({ status: 200, body: analyze('Secession', 0.92, SECESSION_DETAILS, lang) }),
  },
  baroque: {
    label: 'Baroque · Palatul Baroc',
    respond: (lang) => ({ status: 200, body: analyze('Baroque', 0.88, BAROQUE_DETAILS, lang) }),
  },
  no_audio: {
    label: 'Secession · audio_url ""',
    respond: (lang) => ({
      status: 200,
      body: analyze('Secession', 0.92, SECESSION_DETAILS, lang, { audio: false }),
    }),
  },
  contract_example: {
    label: 'Contract §6 example',
    respond: () => ({ status: 200, body: structuredClone(CONTRACT_ANALYZE_EXAMPLE) }),
  },
  low_confidence: {
    label: 'Error · LOW_CONFIDENCE',
    respond: () => ({
      status: 422,
      body: err('LOW_CONFIDENCE', 'Style confidence 0.41 is below the 0.50 threshold.'),
    }),
  },
  no_match: {
    label: 'Error · NO_MATCH',
    respond: () => ({ status: 422, body: err('NO_MATCH', 'No heritage facade recognized.') }),
  },
  timeout: {
    label: 'Error · TIMEOUT (504)',
    respond: () => ({ status: 504, body: err('TIMEOUT', 'Vision stage exceeded its time budget.') }),
  },
  hang: {
    label: 'Error · client timeout (hang)',
    hang: true,
  },
  invalid_input: {
    label: 'Error · INVALID_INPUT',
    respond: () => ({ status: 400, body: err('INVALID_INPUT', 'Image could not be decoded.') }),
  },
};

export const DEFAULT_MOCK_SCENARIO = 'secession';
