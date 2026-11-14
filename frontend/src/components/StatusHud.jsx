import { SearchX, Focus, WifiOff, TriangleAlert, CameraOff, RotateCcw, X } from 'lucide-react';
import { STRINGS } from '../i18n.js';

const ERROR_ICONS = { NO_MATCH: SearchX, LOW_CONFIDENCE: Focus, TIMEOUT: WifiOff, INVALID_INPUT: TriangleAlert };

export function ScanLaser({ active }) {
  return (
    <div className={`laser ${active ? 'on' : ''}`} aria-hidden="true">
      <div className="laser-line" />
      <div className="laser-grid" />
    </div>
  );
}

export function Reticle({ dim }) {
  return (
    <div className={`reticle ${dim ? 'dim' : ''}`} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export function ErrorCard({ code, lang, compact, onRetry, onDismiss }) {
  const t = STRINGS[lang];
  const known = t.errors[code];
  const copy = known ?? t.errors.TIMEOUT; // unknown code → TIMEOUT (contracts §8)
  const Icon = ERROR_ICONS[code] ?? WifiOff;
  const retryable = !known || code === 'TIMEOUT' || code === 'INVALID_INPUT';
  return (
    <div className={`hud-card ${compact ? 'compact' : ''} code-${code}`} role="status">
      <span className="hud-icon">
        <Icon size={compact ? 16 : 22} />
      </span>
      <span className="hud-text">
        <strong>{copy.title}</strong>
        {!compact && <span>{copy.body}</span>}
      </span>
      {retryable && onRetry ? (
        <button type="button" className="chip" onClick={onRetry}>
          <RotateCcw size={14} /> {t.retry}
        </button>
      ) : onDismiss ? (
        <button type="button" className="icon-btn" onClick={onDismiss} aria-label={t.dismiss}>
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

export function CameraBanner({ reason, lang, onRetry }) {
  const t = STRINGS[lang];
  const msg = t.cameraFallback[reason] ?? t.cameraFallback.failed;
  return (
    <div className="cam-banner">
      <CameraOff size={14} />
      <span>{msg}</span>
      {reason !== 'insecure' && reason !== 'unsupported' && reason !== 'manual' && onRetry && (
        <button type="button" className="link" onClick={onRetry}>
          {t.useCamera}
        </button>
      )}
    </div>
  );
}
