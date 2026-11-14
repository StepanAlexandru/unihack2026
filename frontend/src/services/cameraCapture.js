// Rear-camera access + low-latency frame capture.
// Frames are downscaled (long edge 640 px) and JPEG-encoded on an offscreen canvas.
// Aspect ratio is preserved, so normalized bboxes from M2 map back onto the live frame.

export const CAPTURE_LONG_EDGE = 640;
export const CAPTURE_QUALITY = 0.72;

export const CAMERA_CONSTRAINTS = {
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

export function cameraSupported() {
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

/**
 * Start the rear camera into `videoEl`. Resolves once the first frame has dimensions.
 * Throws an Error with `.reason` in: 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'failed'.
 */
export async function startCamera(videoEl) {
  if (!window.isSecureContext) throw Object.assign(new Error('Camera needs HTTPS'), { reason: 'insecure' });
  if (!navigator.mediaDevices?.getUserMedia)
    throw Object.assign(new Error('getUserMedia unsupported'), { reason: 'unsupported' });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (e) {
    const reason =
      e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
        ? 'denied'
        : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError'
          ? 'notfound'
          : 'failed';
    throw Object.assign(new Error(e?.message || 'Camera failed'), { reason });
  }

  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  videoEl.srcObject = stream;
  await new Promise((resolve) => {
    if (videoEl.readyState >= 2 && videoEl.videoWidth) return resolve();
    videoEl.addEventListener('loadeddata', resolve, { once: true });
  });
  try {
    await videoEl.play();
  } catch {
    /* autoplay of a muted inline video is allowed; ignore spurious rejections */
  }
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Intrinsic pixel size of a <video>, <canvas> or <img>. */
export function sourceSize(el) {
  if (!el) return { width: 0, height: 0 };
  if (el instanceof HTMLVideoElement) return { width: el.videoWidth, height: el.videoHeight };
  if (el instanceof HTMLImageElement) return { width: el.naturalWidth, height: el.naturalHeight };
  return { width: el.width, height: el.height };
}

let captureCanvas = null;

/**
 * Grab the current frame of `sourceEl` as a JPEG data URL.
 * @returns {{ dataUrl: string, width: number, height: number } | null}
 */
export function captureFrame(sourceEl, longEdge = CAPTURE_LONG_EDGE, quality = CAPTURE_QUALITY) {
  const { width: sw, height: sh } = sourceSize(sourceEl);
  if (!sw || !sh) return null;
  const scale = Math.min(1, longEdge / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  captureCanvas ??= document.createElement('canvas');
  captureCanvas.width = w;
  captureCanvas.height = h;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(sourceEl, 0, 0, w, h);
  return { dataUrl: captureCanvas.toDataURL('image/jpeg', quality), width: w, height: h };
}

/** Draw a user-picked photo file onto `canvas` (fallback mode upload). */
export function drawFileToCanvas(file, canvas) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}
