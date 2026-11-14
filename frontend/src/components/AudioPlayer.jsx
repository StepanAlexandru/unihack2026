import { useEffect, useMemo, useRef } from 'react';
import { Play, Pause, RotateCcw, LoaderCircle } from 'lucide-react';

const R = 26;
const C = 2 * Math.PI * R;

export function AudioButton({ player, disabled }) {
  const { status, progress, toggle, replay } = player;
  const Icon = status === 'playing' ? Pause : status === 'ended' ? RotateCcw : status === 'loading' ? LoaderCircle : Play;
  const label = status === 'playing' ? 'Pause narration' : status === 'ended' ? 'Replay narration' : 'Play narration';
  return (
    <div className="audio-btn-wrap">
      <button type="button" className={`audio-btn ${status}`} onClick={toggle} disabled={disabled} aria-label={label}>
        <svg viewBox="0 0 64 64" className="audio-ring" aria-hidden="true">
          <circle cx="32" cy="32" r={R} className="ring-bg" />
          <circle
            cx="32"
            cy="32"
            r={R}
            className="ring-fg"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - Math.min(1, Math.max(0, progress)))}
          />
        </svg>
        <Icon size={22} className={status === 'loading' ? 'spin' : ''} />
      </button>
      {(status === 'playing' || status === 'paused') && (
        <button type="button" className="audio-replay" onClick={replay} aria-label="Restart narration">
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
}

/** Subtitle ticker: words light up in step with playback progress. */
export function SubtitleTicker({ text, progress, active }) {
  const words = useMemo(() => (text ? text.split(/\s+/) : []), [text]);
  const boxRef = useRef(null);
  const idx = active ? Math.min(words.length - 1, Math.floor(progress * words.length)) : -1;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const el = box.querySelector(`[data-i="${idx}"]`);
    if (!el) {
      if (idx < 0) box.scrollTop = 0;
      return;
    }
    // keep the current word's line as the first visible line (box shows exactly two)
    box.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
  }, [idx, text]);

  if (!text) return null;
  return (
    <div className="ticker">
      <div className="ticker-inner" ref={boxRef}>
        {words.map((w, i) => (
          <span key={i} data-i={i} className={i < idx ? 'said' : i === idx ? 'now' : ''}>
            {w}{' '}
          </span>
        ))}
      </div>
    </div>
  );
}
