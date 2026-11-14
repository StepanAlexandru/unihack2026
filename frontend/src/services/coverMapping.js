// Maps normalized bboxes (relative to the captured frame) onto an element displayed with
// `object-fit: cover`. The captured frame keeps the source aspect ratio, so the same
// mapping applies to the live <video> / <canvas>.

/** @returns {{ scale: number, offsetX: number, offsetY: number, dispW: number, dispH: number }} */
export function coverTransform(srcW, srcH, viewW, viewH) {
  if (!srcW || !srcH || !viewW || !viewH) return { scale: 1, offsetX: 0, offsetY: 0, dispW: viewW, dispH: viewH };
  const scale = Math.max(viewW / srcW, viewH / srcH);
  const dispW = srcW * scale;
  const dispH = srcH * scale;
  return { scale, offsetX: (viewW - dispW) / 2, offsetY: (viewH - dispH) / 2, dispW, dispH };
}

/** Normalized [x, y, w, h] → view pixels { x, y, w, h } (top-left origin). */
export function bboxToView(bbox, t) {
  const [x, y, w, h] = bbox;
  return { x: t.offsetX + x * t.dispW, y: t.offsetY + y * t.dispH, w: w * t.dispW, h: h * t.dispH };
}
