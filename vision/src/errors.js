/**
 * Errors thrown by analyzeImage().
 *
 * `code` is set ONLY when it is a contract ErrorCode (docs/contracts.md §8):
 *   - "INVALID_INPUT": the image could not be decoded / is not JPEG, PNG or WebP
 *   - "TIMEOUT":       the analysis exceeded its time budget
 * Every other failure leaves `code` undefined, which Module 4 maps to TIMEOUT.
 *
 * `reason` is always set and is more specific (for logs and the benchmark):
 *   INVALID_IMAGE | TIMEOUT | NO_PROVIDER | PROVIDER_ERROR | REFUSAL | INVALID_MODEL_OUTPUT
 *
 * `meta` (when present) carries provider/model/attempt info for debugging.
 */
export class VisionError extends Error {
  constructor(message, { code, reason, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "VisionError";
    if (code) this.code = code;
    this.reason = reason ?? code ?? "UNKNOWN";
  }
}

export function invalidInput(message) {
  return new VisionError(message, { code: "INVALID_INPUT", reason: "INVALID_IMAGE" });
}
