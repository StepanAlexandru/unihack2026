// Generic, fact-light narration per style and language. Used by:
//   - the built-in M3 stub (CONTENT_MODE=mock), so /narrate can switch RO <-> EN
//   - offline mode /narrate when no pre-recorded fixture matches the request
// These make NO building-specific claims, so they are safe to say about any facade.
// Every `text` must be 35-40 words (checked by tests/contracts.test.js).

export const STYLE_NARRATIONS = {
  Secession: {
    en: {
      text: 'This facade belongs to the Secession style that reshaped Timișoara in the early twentieth century. Look for flowing lines, plant motifs and decorative details: Secession architects used them to give buildings personality and civic pride.',
      history: "In the early 1900s, as Timișoara grew beyond its old fortress walls, many new buildings adopted the Secession style that was popular across Austria-Hungary.",
      why_it_matters: "Secession facades are a defining part of Timișoara's architectural identity.",
    },
    ro: {
      text: 'Această fațadă aparține stilului Secession, care a transformat Timișoara la începutul secolului al douăzecilea. Căutați liniile curgătoare, motivele vegetale și detaliile decorative: arhitecții Secession le foloseau pentru a da noilor clădiri ale orașului personalitate și mândrie civică.',
      history: 'La începutul anilor 1900, când Timișoara a crescut dincolo de zidurile vechii cetăți, multe clădiri noi au adoptat stilul Secession, popular în întreaga Austro-Ungarie.',
      why_it_matters: 'Fațadele Secession sunt o parte definitorie a identității arhitecturale a Timișoarei.',
    },
  },
  Baroque: {
    en: {
      text: 'This facade follows the Baroque style that shaped Timișoara after 1716, when the Habsburgs rebuilt the city. Look for symmetry, tall windows, pilasters and a decorated portal: Baroque builders wanted architecture to express order and power.',
      history: 'After Habsburg troops took Timișoara in 1716, the city was rebuilt as a fortress town, and its main squares were framed by Baroque churches and palaces.',
      why_it_matters: "Baroque buildings form the oldest layer of Timișoara's historic centre.",
    },
    ro: {
      text: 'Această fațadă urmează stilul baroc care a modelat Timișoara după 1716, când habsburgii au reconstruit orașul. Căutați simetria, ferestrele înalte, pilaștrii și portalul decorat: constructorii baroci doreau ca întreaga arhitectură să exprime ordine, stabilitate și putere.',
      history: 'După ce trupele habsburgice au cucerit Timișoara în 1716, orașul a fost reconstruit ca oraș-cetate, iar piețele principale au fost înconjurate de biserici și palate baroce.',
      why_it_matters: 'Clădirile baroce formează cel mai vechi strat al centrului istoric al Timișoarei.',
    },
  },
  Eclectic: {
    en: {
      text: "This facade is Eclectic, a style that freely combined elements from different historical periods. Around 1900, Timișoara's builders mixed classical columns, Renaissance windows and rich ornament to show off the wealth of a growing city.",
      history: 'In the late nineteenth century Timișoara industrialised quickly, and new owners commissioned facades that borrowed freely from many historical styles.',
      why_it_matters: "Eclectic facades record the confidence and prosperity of the city's late nineteenth-century growth.",
    },
    ro: {
      text: 'Această fațadă este eclectică, un stil care combina liber elemente din diferite epoci istorice. În jurul anului 1900, constructorii Timișoarei amestecau coloane clasice, ferestre renascentiste și ornamente bogate pentru a arăta bogăția unui oraș în plină creștere.',
      history: 'La sfârșitul secolului al XIX-lea, Timișoara s-a industrializat rapid, iar noii proprietari au comandat fațade care împrumutau liber din multe stiluri istorice.',
      why_it_matters: 'Fațadele eclectice păstrează încrederea și prosperitatea creșterii orașului de la sfârșitul secolului al XIX-lea.',
    },
  },
  Neoclassical: {
    en: {
      text: 'This facade follows the Neoclassical style, inspired by the temples of ancient Greece and Rome. Look for columns, triangular pediments and calm, symmetrical proportions: Neoclassical architects wanted buildings to look rational, dignified and almost timeless.',
      history: 'Neoclassical design spread across the Habsburg lands in the late eighteenth and early nineteenth centuries, especially for public and administrative buildings.',
      why_it_matters: 'Neoclassical buildings show how classical ideals of order and reason reached cities like Timișoara.',
    },
    ro: {
      text: 'Această fațadă urmează stilul neoclasic, inspirat de templele Greciei și ale Romei antice. Căutați coloanele, frontoanele triunghiulare și proporțiile calme, simetrice: arhitecții neoclasici doreau ca fiecare clădire publică să pară rațională, demnă și aproape atemporală.',
      history: 'Arhitectura neoclasică s-a răspândit în teritoriile habsburgice la sfârșitul secolului al XVIII-lea și începutul secolului al XIX-lea, mai ales pentru clădiri publice și administrative.',
      why_it_matters: 'Clădirile neoclasice arată cum idealurile clasice de ordine și rațiune au ajuns în orașe precum Timișoara.',
    },
  },
  Brutalist: {
    en: {
      text: 'This building belongs to Brutalism, a post-war style built from raw, exposed concrete. Look for heavy geometric volumes, repeated windows and rough surfaces: Brutalist architects valued honesty of materials and fast construction for growing cities.',
      history: 'In the second half of the twentieth century, Romanian cities grew rapidly, and concrete buildings were raised quickly to house new residents and institutions.',
      why_it_matters: "Brutalist buildings are a newer, often debated layer of Timișoara's architectural history.",
    },
    ro: {
      text: 'Această clădire aparține brutalismului, un stil postbelic construit din beton aparent, neșlefuit. Căutați volumele geometrice grele, ferestrele repetitive și suprafețele aspre: arhitecții brutaliști prețuiau sinceritatea materialelor și construcția rapidă, potrivită pentru orașele aflate în plină creștere.',
      history: 'În a doua jumătate a secolului al XX-lea, orașele românești au crescut rapid, iar clădirile din beton au fost ridicate repede pentru noii locuitori și instituții.',
      why_it_matters: 'Clădirile brutaliste sunt un strat mai nou și adesea dezbătut al istoriei arhitecturale a Timișoarei.',
    },
  },
};

/** Tiny phrasebook so stub translations of common facade texts look real. Unknown text is echoed. */
const PHRASES = [
  [/^ANNO\s+(\d{3,4})$/i, { en: 'In the year $1', ro: 'În anul $1' }],
  [/^ÉPÜLT\s+(\d{3,4})$/i, { en: 'Built in $1', ro: 'Construit în $1' }],
  [/^ERBAUT\s+(\d{3,4})$/i, { en: 'Built in $1', ro: 'Construit în $1' }],
  [/^(?:A\.?\s*D\.?|ANNO DOMINI)\s+(\d{3,4})$/i, { en: 'In the year of the Lord $1', ro: 'În anul Domnului $1' }],
];

export function translatePhrase(original, lang) {
  for (const [re, out] of PHRASES) {
    const m = String(original).trim().match(re);
    if (m) return out[lang].replace('$1', m[1]);
  }
  return original;
}
