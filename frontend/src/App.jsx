import { useCallback, useEffect, useRef, useState } from 'react';
import BlueprintOverlay from './components/BlueprintOverlay.jsx';
import TopBar from './components/TopBar.jsx';
import DevMenu from './components/DevMenu.jsx';
import DetailsSheet from './components/DetailsSheet.jsx';
import ScanControls from './components/ScanControls.jsx';
import { AudioButton, SubtitleTicker } from './components/AudioPlayer.jsx';
import { ScanLaser, Reticle, ErrorCard, CameraBanner } from './components/StatusHud.jsx';
import { analyze, narrate, MOCK_DEFAULT } from './services/apiClient.js';
import { startCamera, stopCamera, captureFrame, sourceSize, drawFileToCanvas } from './services/cameraCapture.js';
import { SAMPLE_FACADES, drawSample } from './services/sampleFacades.js';
import { useNarrationPlayer } from './services/useNarrationPlayer.js';
import { DEFAULT_MOCK_SCENARIO } from './mocks/contractExamples.js';
import { STRINGS } from './i18n.js';

const LIVE_SCAN_INTERVAL_MS = 1750;

// Per-viewer conveniences only; every read/write is guarded.
function usePersisted(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw);
      if (initial && typeof initial === 'object') return { ...initial, ...parsed };
      return typeof parsed === typeof initial ? parsed : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  }, [key, v]);
  return [v, setV];
}

const sameBuilding = (a, b) => a && b && a.style === b.style && a.narration.building_name === b.narration.building_name;

export default function App() {
  const [lang, setLang] = usePersisted('fs.lang', 'en');
  const [mock, setMock] = usePersisted('fs.mock', {
    enabled: MOCK_DEFAULT,
    scenario: 'auto',
    latencyMs: 400,
    jitter: 0.015,
  });
  const [demoFixtureId, setDemoFixtureId] = usePersisted('fs.fixture', '');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [camera, setCamera] = useState({ mode: 'starting', reason: null });
  const [sampleIndex, setSampleIndex] = useState(0);
  const [uploaded, setUploaded] = useState(false);
  const [srcSize, setSrcSize] = useState({ width: 0, height: 0 });

  const [result, setResult] = useState(null);
  const [overlayDetails, setOverlayDetails] = useState([]);
  const [error, setError] = useState(null); // { code, live: boolean }
  const [scanning, setScanning] = useState(false);
  const [liveScan, setLiveScan] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [narrationBusy, setNarrationBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const player = useNarrationPlayer();
  const t = STRINGS[lang];

  // Refs so the async scan loop always sees fresh values without re-subscribing.
  const inFlight = useRef(false);
  const abortRef = useRef(null);
  const live = useRef({});
  live.current = { lang, mock, demoFixtureId, camera, sampleIndex, uploaded, result, player };

  // ------------------------------------------------------------ camera

  const enterFallback = useCallback((reason) => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    setCamera({ mode: 'fallback', reason });
  }, []);

  const tryCamera = useCallback(async () => {
    setCamera({ mode: 'starting', reason: null });
    try {
      stopCamera(streamRef.current);
      streamRef.current = await startCamera(videoRef.current);
      setCamera({ mode: 'live', reason: null });
      setSrcSize(sourceSize(videoRef.current));
    } catch (e) {
      enterFallback(e.reason || 'failed');
    }
  }, [enterFallback]);

  useEffect(() => {
    tryCamera();
    return () => stopCamera(streamRef.current);
  }, [tryCamera]);

  // keep intrinsic video size in sync (rotation changes it)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onResize = () => setSrcSize(sourceSize(v));
    v.addEventListener('resize', onResize);
    v.addEventListener('loadedmetadata', onResize);
    return () => {
      v.removeEventListener('resize', onResize);
      v.removeEventListener('loadedmetadata', onResize);
    };
  }, []);

  // draw sample facade in fallback mode
  useEffect(() => {
    if (camera.mode !== 'fallback' || uploaded || !canvasRef.current) return;
    drawSample(canvasRef.current, sampleIndex);
    setSrcSize(sourceSize(canvasRef.current));
  }, [camera.mode, sampleIndex, uploaded]);

  const changeSample = (delta) => {
    setUploaded(false);
    setSampleIndex((i) => (i + delta + SAMPLE_FACADES.length) % SAMPLE_FACADES.length);
    clearResult();
  };

  const onUpload = async (file) => {
    try {
      await drawFileToCanvas(file, canvasRef.current);
      setUploaded(true);
      // From the live camera (e.g. a laptop webcam): switch to analysing the uploaded photo.
      if (camera.mode !== 'fallback') enterFallback('manual');
      setSrcSize(sourceSize(canvasRef.current));
      clearResult();
    } catch {
      setError({ code: 'INVALID_INPUT', live: false });
    }
  };

  // ------------------------------------------------------------ scanning

  function clearResult() {
    abortRef.current?.abort();
    live.current.player.stop();
    setResult(null);
    setOverlayDetails([]);
    setSelectedId(null);
    setError(null);
    setSheetOpen(false);
  }

  const doScan = useCallback(async ({ manual }) => {
    if (inFlight.current) return;
    const { lang, mock, demoFixtureId, camera, sampleIndex, uploaded, result: prev, player } = live.current;
    const sourceEl = camera.mode === 'live' ? videoRef.current : canvasRef.current;
    const frame = demoFixtureId ? null : captureFrame(sourceEl);
    if (!frame && !demoFixtureId) return;

    inFlight.current = true;
    setScanning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const scenario =
      mock.scenario === 'auto'
        ? camera.mode === 'fallback' && !uploaded
          ? SAMPLE_FACADES[sampleIndex].mockScenario
          : DEFAULT_MOCK_SCENARIO
        : mock.scenario;

    try {
      const r = await analyze({
        image_base64: frame?.dataUrl ?? '',
        lang,
        demo_fixture_id: demoFixtureId || undefined,
        signal: ctrl.signal,
        mock: { ...mock, scenario },
      });
      if (r.code === 'ABORTED') return;

      if (r.ok) {
        const data = r.data;
        const isNew = manual || !sameBuilding(prev, data);
        setError(null);
        setOverlayDetails(data.details);
        if (isNew) {
          setResult(data);
          setSelectedId(null);
          player.load(data.narration, lang, { autoplay: true });
        } else {
          // live-scan refresh of the same building: update boxes, keep narration running
          setResult((cur) => (cur ? { ...cur, confidence: data.confidence, details: mergeDetails(cur.details, data.details) } : data));
        }
      } else {
        setError({ code: r.code, live: !manual });
        setOverlayDetails([]);
        if (manual) {
          setResult(null);
          setSelectedId(null);
          setSheetOpen(false);
          player.stop();
        }
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      inFlight.current = false;
      setScanning(false);
    }
  }, []);

  // Live Scan loop: one request at a time, next frame ~1.75 s after the previous one started.
  useEffect(() => {
    if (!liveScan) return;
    let active = true;
    let timer;
    const loop = async () => {
      const started = performance.now();
      await doScan({ manual: false });
      if (!active) return;
      timer = setTimeout(loop, Math.max(150, LIVE_SCAN_INTERVAL_MS - (performance.now() - started)));
    };
    loop();
    return () => {
      active = false;
      clearTimeout(timer);
      // Turning Live Scan off must also cancel the request already in flight; otherwise its
      // result lands after the toggle and updates the overlay / starts narration.
      abortRef.current?.abort();
    };
  }, [liveScan, doScan]);

  const onScanTap = () => {
    player.prime(); // iOS: unlock audio inside the tap, before the request goes out
    if (inFlight.current) return;
    doScan({ manual: true });
  };

  // ------------------------------------------------------------ language

  const narrateAbort = useRef(null);
  const onLang = async (next) => {
    if (next === lang) return;
    setLang(next);
    const cur = live.current.result;
    if (!cur) return;
    narrateAbort.current?.abort();
    const ctrl = new AbortController();
    narrateAbort.current = ctrl;
    setNarrationBusy(true);
    const r = await narrate({ style: cur.style, details: cur.details, lang: next, signal: ctrl.signal, mock: { ...mock } });
    if (ctrl.signal.aborted) return;
    setNarrationBusy(false);
    if (!r.ok) {
      setToast(STRINGS[next].narrationError);
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const n = r.data;
    // /narrate has no building_name / translated_text in v1: keep them from /analyze (§7).
    setResult((prev) =>
      prev
        ? {
            ...prev,
            narration: {
              ...prev.narration,
              text: n.text,
              audio_url: n.audio_url,
              duration_s: n.duration_s,
              history: n.history,
              why_it_matters: n.why_it_matters,
            },
          }
        : prev,
    );
    player.load(n, next, { autoplay: true });
  };

  // ------------------------------------------------------------ render

  const fallback = camera.mode === 'fallback';
  const sampleName = uploaded ? '↑' : `${sampleIndex + 1}/${SAMPLE_FACADES.length}`;
  const showIdleHint = !result && !error && !scanning && camera.mode !== 'starting';
  const blockingError = error && !error.live;

  return (
    <div className="app">
      <div className="stage">
        <video ref={videoRef} className={`media ${camera.mode === 'live' ? '' : 'hidden'}`} playsInline muted autoPlay />
        <canvas ref={canvasRef} className={`media contain ${fallback ? '' : 'hidden'}`} />
        <div className="vignette" />
        <ScanLaser active={scanning} />
        <Reticle dim={overlayDetails.length > 0} />
        <BlueprintOverlay
          details={overlayDetails}
          sourceSize={srcSize}
          fit={fallback ? 'contain' : 'cover'}
          selectedId={selectedId}
          onSelect={setSelectedId}
          lang={lang}
        />
      </div>

      <TopBar
        lang={lang}
        onLang={onLang}
        result={result}
        stale={!!error && !!result}
        mock={mock}
        demoFixtureId={demoFixtureId}
        onOpenDev={() => setDevOpen(true)}
      />

      <div className="center-hud">
        {fallback && !uploaded && !result && !error && <CameraBanner reason={camera.reason} lang={lang} onRetry={tryCamera} />}
        {camera.mode === 'starting' && <div className="hint">…</div>}
        {showIdleHint && <div className="hint">{liveScan ? t.liveHint : t.point}</div>}
        {blockingError && (
          <ErrorCard
            code={error.code}
            lang={lang}
            onRetry={() => {
              player.prime();
              doScan({ manual: true });
            }}
            onDismiss={() => setError(null)}
          />
        )}
        {error?.live && <ErrorCard code={error.code} lang={lang} compact />}
        {toast && <div className="hint toast">{toast}</div>}
      </div>

      <div className={`bottom ${result ? 'has-sheet' : ''}`}>
        {result && (
          <div className="narration-row">
            <SubtitleTicker
              text={result.narration.text}
              progress={player.progress}
              active={player.status === 'playing' || player.status === 'paused' || player.status === 'ended'}
            />
            <AudioButton player={narrationBusy ? { ...player, status: 'loading' } : player} disabled={narrationBusy} />
          </div>
        )}
        <ScanControls
          lang={lang}
          scanning={scanning}
          liveScan={liveScan}
          setLiveScan={setLiveScan}
          onScan={onScanTap}
          fallback={fallback}
          sampleName={sampleName}
          onPrevSample={() => changeSample(-1)}
          onNextSample={() => changeSample(1)}
          onUpload={onUpload}
          onUseCamera={
            camera.reason === 'manual'
              ? () => {
                  setUploaded(false);
                  clearResult();
                  tryCamera();
                }
              : undefined
          }
        />
        <DetailsSheet
          result={result}
          lang={lang}
          open={sheetOpen}
          setOpen={setSheetOpen}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setSheetOpen(false); // reveal the highlighted box on the camera view
          }}
        />
      </div>

      <DevMenu
        open={devOpen}
        onClose={() => setDevOpen(false)}
        mock={mock}
        setMock={(m) => {
          setMock(m);
          clearResult();
        }}
        demoFixtureId={demoFixtureId}
        setDemoFixtureId={(id) => {
          setDemoFixtureId(id);
          clearResult();
        }}
        cameraMode={camera.mode}
        onUseCamera={tryCamera}
        onUseSamples={() => {
          setUploaded(false);
          enterFallback('manual');
          clearResult();
        }}
      />
    </div>
  );
}

/** Keep translated_text from the first response when a refresh lacks it (same building). */
function mergeDetails(prev, next) {
  const byId = new Map(prev.map((d) => [d.id, d]));
  return next.map((d) => ({ ...d, translated_text: d.translated_text ?? byId.get(d.id)?.translated_text ?? null }));
}
