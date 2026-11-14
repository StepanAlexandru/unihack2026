// Exact MP3 duration by walking MPEG audio frames (no dependencies).

const BITRATES = {
  // [versionKey][layer] → kbps table indexed by bitrate index
  1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], 2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
  2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] },
};
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function skipId3(buf) {
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  return 0;
}

/** @returns {number|null} seconds, or null if no MPEG frames found */
export function mp3Duration(buf) {
  let i = skipId3(buf);
  let seconds = 0;
  let frames = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layerBits = (buf[i + 1] >> 1) & 3;
    const brIdx = buf[i + 2] >> 4;
    const srIdx = (buf[i + 2] >> 2) & 3;
    const pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const layer = 4 - layerBits;
    const kbps = BITRATES[ver === 3 ? 1 : 2][layer][brIdx];
    const sr = SAMPLE_RATES[ver][srIdx];
    let len;
    let samples;
    if (layer === 1) { len = (Math.floor((12 * kbps * 1000) / sr) + pad) * 4; samples = 384; }
    else if (layer === 3 && ver !== 3) { len = Math.floor((72 * kbps * 1000) / sr) + pad; samples = 576; }
    else { len = Math.floor((144 * kbps * 1000) / sr) + pad; samples = 1152; }
    if (len < 4) { i++; continue; }
    seconds += samples / sr;
    frames++;
    i += len;
  }
  return frames ? Math.round(seconds * 10) / 10 : null;
}

/** Concatenate MP3 chunks (e.g. several TTS requests), dropping ID3 headers of all but the first. */
export function concatMp3(chunks) {
  return Buffer.concat(chunks.map((c, k) => (k === 0 ? c : c.subarray(skipId3(c)))));
}
