/** Geometry helpers for normalized [x, y, w, h] boxes ((x, y) = top-left, values 0..1). */

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function round(v, decimals = 4) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Intersection over Union of two [x, y, w, h] boxes. Returns 0 when either box is empty. */
export function iou(a, b) {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? clamp(inter / union, 0, 1) : 0; // clamp float drift (identical boxes can give 1.0000000000000004)
}
