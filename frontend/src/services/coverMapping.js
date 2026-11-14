// Maps normalized bboxes (relative to the captured frame) onto a media element displayed with
// `object-fit: cover` (live camera) or `object-fit: contain` (samples / uploaded photos).
// The captured frame keeps the source aspect ratio, so the same mapping applies to the
// live <video> / <canvas>.

/**
 * @param {'cover'|'contain'} [fit='cover']
 * @returns {{ scale: number, offsetX: number, offsetY: number, dispW: number, dispH: number }}
 */
export function fitTransform(srcW, srcH, viewW, viewH, fit = 'cover') {
  if (!srcW || !srcH || !viewW || !viewH) return { scale: 1, offsetX: 0, offsetY: 0, dispW: viewW, dispH: viewH };
  const pick = fit === 'contain' ? Math.min : Math.max;
  const scale = pick(viewW / srcW, viewH / srcH);
  const dispW = srcW * scale;
  const dispH = srcH * scale;
  return { scale, offsetX: (viewW - dispW) / 2, offsetY: (viewH - dispH) / 2, dispW, dispH };
}

/** Backwards-compatible `object-fit: cover` mapping. */
export function coverTransform(srcW, srcH, viewW, viewH) {
  return fitTransform(srcW, srcH, viewW, viewH, 'cover');
}

/** Normalized [x, y, w, h] → view pixels { x, y, w, h } (top-left origin). */
export function bboxToView(bbox, t) {
  const [x, y, w, h] = bbox;
  return { x: t.offsetX + x * t.dispW, y: t.offsetY + y * t.dispH, w: w * t.dispW, h: h * t.dispH };
}
