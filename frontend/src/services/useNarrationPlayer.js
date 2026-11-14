// Narration playback: <audio> for narration.audio_url, with a window.speechSynthesis
// fallback when audio_url is "" or fails to load (contracts §5 / §6).
// iOS Safari only plays audio started by a tap, so `prime()` must be called synchronously
// inside the Scan button's click handler.
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveUrl } from './apiClient.js';

function makeSilentWav(seconds = 0.05, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  let bin = '';
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}
const SILENT = makeSilentWav();

const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice(lang) {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  const want = lang === 'ro' ? 'ro' : 'en';
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith(`${want}-`) && v.localService) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(want)) ||
    null
  );
}

/**
 * @returns {{ status: 'idle'|'loading'|'playing'|'paused'|'ended', progress: number, mode: 'audio'|'speech'|null,
 *   load: Function, play: Function, pause: Function, toggle: Function, replay: Function, stop: Function, prime: Function }}
 */
export function useNarrationPlayer() {
  const audioRef = useRef(null);
  const trackRef = useRef(null); // { text, lang, duration_s, url }
  const speechRef = useRef({ startedAt: 0, elapsedBefore: 0, charProgress: 0 });
  const resetSpeech = () => {
    speechRef.current = { startedAt: 0, elapsedBefore: 0, charProgress: 0 };
  };
  const modeRef = useRef(null);
  const statusRef = useRef('idle');
  const genRef = useRef(0); // invalidates stale async callbacks on each load
  const utterRef = useRef(null); // the only utterance whose events we honour
  const [status, setStatusState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [mode, setModeState] = useState(null);

  const setStatus = (s) => {
    statusRef.current = s;
    setStatusState(s);
  };
  const setMode = (m) => {
    modeRef.current = m;
    setModeState(m);
  };

  if (!audioRef.current && typeof Audio !== 'undefined') {
    const a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    audioRef.current = a;
  }

  // ---- progress loop
  useEffect(() => {
    let raf;
    const tick = () => {
      const tr = trackRef.current;
      if (statusRef.current === 'playing' && tr) {
        if (modeRef.current === 'audio') {
          const a = audioRef.current;
          const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : tr.duration_s;
          setProgress(dur ? Math.min(1, a.currentTime / dur) : 0);
        } else if (modeRef.current === 'speech') {
          const sp = speechRef.current;
          const elapsed = sp.elapsedBefore + (performance.now() - sp.startedAt) / 1000;
          const timeP = tr.duration_s ? elapsed / tr.duration_s : 0;
          // prefer real word-boundary progress when the engine reports it
          setProgress(Math.min(0.99, Math.max(sp.charProgress, sp.charProgress > 0 ? 0 : timeP)));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- audio element events
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnded = () => {
      if (modeRef.current !== 'audio' || a.src === SILENT) return;
      setProgress(1);
      setStatus('ended');
    };
    a.addEventListener('ended', onEnded);
    return () => a.removeEventListener('ended', onEnded);
  }, []);

  useEffect(() => {
    // voices load asynchronously in Chrome
    if (speechSupported()) window.speechSynthesis.onvoiceschanged = () => {};
    return () => {
      if (speechSupported()) window.speechSynthesis.cancel();
      audioRef.current?.pause();
    };
  }, []);

  const speak = useCallback((fromStart = true) => {
    const tr = trackRef.current;
    if (!tr || !speechSupported()) {
      setStatus('idle');
      return;
    }
    window.speechSynthesis.cancel();
    if (fromStart) resetSpeech();
    const sp = speechRef.current;
    // Resume = speak the remaining text from the last known position, snapped back to a word start.
    // (Position comes from word-boundary events, or from elapsed time when the voice sends none.)
    let offset = 0;
    if (!fromStart && tr.text.length) {
      const frac = sp.charProgress > 0 ? sp.charProgress : tr.duration_s ? sp.elapsedBefore / tr.duration_s : 0;
      const idx = Math.min(tr.text.length - 1, Math.floor(Math.min(0.99, frac) * tr.text.length));
      offset = tr.text.lastIndexOf(' ', idx) + 1;
    }
    const u = new SpeechSynthesisUtterance(tr.text.slice(offset));
    utterRef.current = u;
    u.lang = tr.lang === 'ro' ? 'ro-RO' : 'en-GB';
    const voice = pickVoice(tr.lang);
    if (voice) u.voice = voice;
    u.rate = 1;
    sp.startedAt = performance.now();
    u.onboundary = (e) => {
      if (u !== utterRef.current) return;
      if (typeof e.charIndex === 'number' && tr.text.length) sp.charProgress = (offset + e.charIndex) / tr.text.length;
    };
    u.onend = () => {
      if (u !== utterRef.current || modeRef.current !== 'speech') return;
      setProgress(1);
      setStatus('ended');
    };
    u.onerror = (e) => {
      if (u !== utterRef.current || e.error === 'interrupted' || e.error === 'canceled') return;
      setStatus('idle');
    };
    setMode('speech');
    setStatus('playing');
    window.speechSynthesis.speak(u);
  }, []);

  const playAudio = useCallback(
    async (fromStart) => {
      const a = audioRef.current;
      const gen = genRef.current;
      if (fromStart) a.currentTime = 0;
      setMode('audio');
      setStatus('playing');
      try {
        await a.play();
      } catch (e) {
        if (gen !== genRef.current) return;
        if (e?.name === 'NotAllowedError') setStatus('paused'); // needs a tap
        else speak(true); // unsupported / failed source → speech fallback
      }
    },
    [speak],
  );

  /** Must be called synchronously inside a user gesture (Scan tap). */
  const prime = useCallback(() => {
    const a = audioRef.current;
    if (a && statusRef.current !== 'playing') {
      try {
        a.muted = true;
        a.src = SILENT;
        const p = a.play();
        p?.then(() => {
          a.pause();
          a.muted = false;
        }).catch(() => {
          a.muted = false;
        });
      } catch {
        a.muted = false;
      }
    }
    if (speechSupported() && statusRef.current !== 'playing') {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }, []);

  const stop = useCallback(() => {
    genRef.current++;
    utterRef.current = null;
    audioRef.current?.pause();
    if (speechSupported()) window.speechSynthesis.cancel();
    resetSpeech();
    setStatus('idle');
    setProgress(0);
  }, []);

  /** Load a narration ({ text, audio_url, duration_s }) in `lang`. */
  const load = useCallback(
    (narration, lang, { autoplay = true } = {}) => {
      stop();
      const gen = genRef.current;
      const url = resolveUrl(narration.audio_url);
      trackRef.current = { text: narration.text, lang, duration_s: narration.duration_s || 15, url };
      const a = audioRef.current;
      if (url && a) {
        setMode('audio');
        setStatus('loading');
        a.muted = false;
        a.src = url;
        a.onerror = () => {
          if (gen !== genRef.current || modeRef.current !== 'audio') return;
          // missing mp3 / unsupported format → speechSynthesis
          if (statusRef.current === 'playing' || statusRef.current === 'loading' || autoplay) speak(true);
        };
        if (autoplay) playAudio(true);
        else setStatus('paused');
      } else {
        a?.removeAttribute('src');
        setMode('speech');
        if (autoplay) speak(true);
        else setStatus('paused');
      }
    },
    [playAudio, speak, stop],
  );

  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return;
    if (modeRef.current === 'audio') audioRef.current.pause();
    else if (speechSupported()) {
      const sp = speechRef.current;
      sp.elapsedBefore += (performance.now() - sp.startedAt) / 1000;
      // speechSynthesis.pause() is ignored by some Chrome voices (the voice keeps talking), so
      // cancel for real and resume later from the saved position (see speak(false)).
      utterRef.current = null; // ignore events from the cancelled utterance
      window.speechSynthesis.cancel();
    }
    setStatus('paused');
  }, []);

  const play = useCallback(() => {
    if (!trackRef.current) return;
    const s = statusRef.current;
    if (s === 'ended' || s === 'idle') return replay();
    if (modeRef.current === 'audio') return playAudio(false);
    if (speechSupported()) speak(false); // continue from where pause() stopped
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playAudio, speak]);

  const replay = useCallback(() => {
    if (!trackRef.current) return;
    if (speechSupported()) window.speechSynthesis.cancel();
    setProgress(0);
    if (modeRef.current === 'audio' && trackRef.current.url) {
      const a = audioRef.current;
      if (!a.src || a.src === SILENT) a.src = trackRef.current.url;
      playAudio(true);
    } else speak(true);
  }, [playAudio, speak]);

  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') pause();
    else play();
  }, [pause, play]);

  return { status, progress, mode, load, play, pause, toggle, replay, stop, prime };
}
