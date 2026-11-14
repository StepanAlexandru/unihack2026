import { FlaskConical, Radio } from 'lucide-react';
import { styleName } from '../i18n.js';
import { MOCK_SCENARIOS } from '../mocks/contractExamples.js';

export default function TopBar({ lang, onLang, result, stale, mock, demoFixtureId, onOpenDev }) {
  const isMock = mock.enabled && !demoFixtureId;
  const devLabel = demoFixtureId
    ? `FIXTURE · ${demoFixtureId}`
    : isMock
      ? `MOCK · ${mock.scenario in MOCK_SCENARIOS ? mock.scenario : 'auto'}`
      : 'LIVE API';
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="seg" role="group" aria-label="Language">
          {['ro', 'en'].map((l) => (
            <button key={l} type="button" className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => onLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <button type="button" className={`dev-pill ${isMock ? 'mock' : 'live'}`} onClick={onOpenDev}>
          {isMock ? <FlaskConical size={13} /> : <Radio size={13} />}
          <span>{devLabel}</span>
        </button>
      </div>
      {result && (
        <div className={`style-pill ${stale ? 'stale' : ''}`} key={result.style + (result.narration.building_name ?? '')}>
          <span className="style-pill-main">
            {styleName(result.style, lang).toUpperCase()} · {Math.round(result.confidence * 100)}%
          </span>
          {result.narration.building_name && <span className="style-pill-sub">{result.narration.building_name}</span>}
        </div>
      )}
    </header>
  );
}
