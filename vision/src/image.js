import { invalidInput } from "./errors.js";

const DATA_URL_PREFIX = /^data:([a-z0-9.+/-]*)?((?:;[a-z0-9-]+=[^;,]*)*)(;base64)?,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

export const MIN_IMAGE_BYTES = 64;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // sanity cap; M4 enforces MAX_IMAGE_BYTES first

/** Detect the image type from magic bytes. Returns a MIME type or null. */
export function sniffMimeType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  return null;
}

/**
 * Decode and validate the contract's `image_base64` (raw base64; a data URL is tolerated).
 * @returns {{ base64: string, mimeType: string, byteLength: number }}
 * @throws {VisionError} code "INVALID_INPUT"
 */
export function decodeImage(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw invalidInput("image_base64 must be a non-empty base64 string");
  }
  let body = input.trim();
  const prefix = DATA_URL_PREFIX.exec(body);
  if (prefix) {
    if (!prefix[3]) throw invalidInput("data URL must be base64-encoded");
    body = body.slice(prefix[0].length);
  }
  body = body.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"); // tolerate URL-safe base64
  if (!BASE64_BODY.test(body)) throw invalidInput("image_base64 is not valid base64");

  const bytes = Buffer.from(body, "base64");
  if (bytes.length < MIN_IMAGE_BYTES) throw invalidInput(`image is too small (${bytes.length} bytes)`);
  if (bytes.length > MAX_IMAGE_BYTES) throw invalidInput(`image is too large (${bytes.length} bytes)`);

  const mimeType = sniffMimeType(bytes);
  if (!mimeType) throw invalidInput("unsupported image format: expected JPEG, PNG or WebP");

  return { base64: bytes.toString("base64"), mimeType, byteLength: bytes.length };
}
