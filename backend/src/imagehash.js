// Image fingerprints for the offline cache.
//   sha256 - exact byte match (the demo laptop re-sends a known test image)
//   dhash  - 64-bit perceptual "difference hash": survives re-encoding, resizing and mild
//            brightness changes. It does NOT survive heavy perspective, cropping or a busy
//            background, so a phone photo of a printed card matches only when framed tightly.
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function decodeImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256, tolerantDecoding: true });
    return { width: img.width, height: img.height, data: img.data };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const img = PNG.sync.read(buf);
    return { width: img.width, height: img.height, data: img.data };
  }
  throw new Error('unsupported image format');
}

/** Area-average an RGBA image down to a w x h grayscale grid. */
function grayGrid({ width, height, data }, w, h) {
  const out = new Float64Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    const y0 = Math.floor((gy * height) / h), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / h));
    for (let gx = 0; gx < w; gx++) {
      const x0 = Math.floor((gx * width) / w), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / w));
      let sum = 0, n = 0;
      // Sample with a stride so a 12 MP frame stays fast.
      const sy = Math.max(1, Math.floor((y1 - y0) / 16)), sx = Math.max(1, Math.floor((x1 - x0) / 16));
      for (let y = y0; y < y1; y += sy) {
        for (let x = x0; x < x1; x += sx) {
          const i = (y * width + x) * 4;
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      out[gy * w + gx] = sum / n;
    }
  }
  return out;
}

export function dhash(img) {
  const g = grayGrid(img, 9, 8);
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** Never throws: returns { sha256, dhash|null }. */
export function fingerprint(buf) {
  let d = null;
  try { d = dhash(decodeImage(buf)); } catch { /* undecodable: exact match only */ }
  return { sha256: sha256(buf), dhash: d };
}
