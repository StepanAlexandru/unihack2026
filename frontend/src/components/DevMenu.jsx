import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { MOCK_SCENARIOS } from '../mocks/contractExamples.js';
import { health, API_BASE } from '../services/apiClient.js';

const FIXTURE_RE = /^[a-z0-9_-]{1,64}$/;

export default function DevMenu({ open, onClose, mock, setMock, demoFixtureId, setDemoFixtureId, cameraMode, onUseCamera, onUseSamples }) {
  const [h, setH] = useState(undefined);
  const [fixture, setFixture] = useState(demoFixtureId);

  useEffect(() => {
    if (!open) return;
    setFixture(demoFixtureId);
    setH(undefined);
    let alive = true;
    health().then((r) => alive && setH(r));
    return () => {
      alive = false;
    };
  }, [open, demoFixtureId]);

  if (!open) return null;
  const fixtureValid = fixture === '' || FIXTURE_RE.test(fixture);

  return (
    <div className="dev-backdrop" onClick={onClose}>
      <div className="dev-panel" role="dialog" aria-label="Developer and demo settings" onClick={(e) => e.stopPropagation()}>
        <div className="dev-head">
          <strong>Dev / Demo</strong>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="dev-section">
          <div className="dev-label">API</div>
          <div className="seg wide">
            <button type="button" className={mock.enabled ? 'on' : ''} onClick={() => setMock({ ...mock, enabled: true })}>
              Mock Mode: ON
            </button>
            <button type="button" className={!mock.enabled ? 'on' : ''} onClick={() => setMock({ ...mock, enabled: false })}>
              Live API
            </button>
          </div>
          <div className="dev-hint">
            Backend {API_BASE || '(same origin via proxy)'}:{' '}
            {h === undefined ? 'checking…' : h ? `ok · vision ${h.vision_mode} · content ${h.content_mode}` : 'unreachable'}
          </div>
        </div>

        <div className={`dev-section ${mock.enabled ? '' : 'disabled'}`}>
          <div className="dev-label">Mock scenario</div>
          <div className="dev-list">
            <label className={mock.scenario === 'auto' ? 'on' : ''}>
              <input type="radio" name="scn" checked={mock.scenario === 'auto'} onChange={() => setMock({ ...mock, scenario: 'auto' })} />
              Auto (follows sample facade)
            </label>
            {Object.entries(MOCK_SCENARIOS).map(([id, s]) => (
              <label key={id} className={mock.scenario === id ? 'on' : ''}>
                <input type="radio" name="scn" checked={mock.scenario === id} onChange={() => setMock({ ...mock, scenario: id })} />
                {s.label}
              </label>
            ))}
          </div>
          <div className="dev-row">
            <span>Latency</span>
            <div className="seg">
              {[400, 1500].map((ms) => (
                <button key={ms} type="button" className={mock.latencyMs === ms ? 'on' : ''} onClick={() => setMock({ ...mock, latencyMs: ms })}>
                  {ms} ms
                </button>
              ))}
            </div>
          </div>
          <div className="dev-row">
            <span>BBox jitter (tests lerp)</span>
            <div className="seg">
              {[0, 0.015].map((j) => (
                <button key={j} type="button" className={mock.jitter === j ? 'on' : ''} onClick={() => setMock({ ...mock, jitter: j })}>
                  {j ? 'on' : 'off'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="dev-section">
          <div className="dev-label">Demo fixture (safety net, sent to backend)</div>
          <form
            className="dev-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (fixtureValid) setDemoFixtureId(fixture);
            }}
          >
            <input
              className={`dev-input ${fixtureValid ? '' : 'bad'}`}
              placeholder="fixture id (empty = off)"
              value={fixture}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setFixture(e.target.value.trim())}
            />
            <button type="submit" className="chip" disabled={!fixtureValid}>
              Apply
            </button>
          </form>
          <div className="dev-hint">Overrides mock mode. Backend serves demo/fixtures/&lt;id&gt;.&lt;lang&gt;.json.</div>
        </div>

        <div className="dev-section">
          <div className="dev-label">Image source</div>
          <div className="seg wide">
            <button type="button" className={cameraMode === 'live' ? 'on' : ''} onClick={onUseCamera}>
              Camera
            </button>
            <button type="button" className={cameraMode === 'fallback' ? 'on' : ''} onClick={onUseSamples}>
              Sample facades
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
