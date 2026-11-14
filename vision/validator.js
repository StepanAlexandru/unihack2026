/**
 * Turns raw model text into a contract-valid VisionResult (docs/contracts.md §4).
 *
 *   text ──parseModelJson──▶ object ──validateModelOutput──▶ candidate ──applyGuardrails──▶ VisionResult
 *
 * Hard failures (unparseable JSON, bad style/confidence/details shape, every box unusable) return
 * { ok: false, error } so index.js can retry once with a repair prompt. Problems with a single detail
 * are repaired or that detail is dropped, with a warning, so that one bad box does not cost a retry.
 */
import { clamp, iou, round } from "./src/geometry.js";

export const STYLES = Object.freeze(["Secession", "Baroque", "Brutalist", "Eclectic", "Neoclassical"]);
export const DETAIL_TYPES = Object.freeze([
  "mask",
  "lion_head",
  "guild_symbol",
  "plaque",
  "inscription",
  "architectural_element",
]);
export const IMAGE_ASSESSMENTS = Object.freeze(["facade", "partial_facade", "not_architecture", "too_blurry"]);
export const REJECTING_ASSESSMENTS = Object.freeze(["not_architecture", "too_blurry"]);

export const MAX_DETAILS = 6;
export const MIN_BOX_SIZE = 0.01; // w and h must be strictly greater than this
export const DEFAULT_MIN_CONFIDENCE = 0.55;
export const BOX_2D_SCALE = 1000;
const DUPLICATE_IOU = 0.8;
const MAX_LABEL_LENGTH = 60;
const EPS = 1e-6;

// ---------------------------------------------------------------------------------------------
// Aliases. Keys are normalized with aliasKey(): lower case, "_" and "-" become spaces.
// ---------------------------------------------------------------------------------------------

const STYLE_ALIASES = new Map(
  Object.entries({
    secession: "Secession",
    "art nouveau": "Secession",
    jugendstil: "Secession",
    "szecesszió": "Secession",
    szecesszio: "Secession",
    secesiune: "Secession",
    "hungarian secession": "Secession",
    "viennese secession": "Secession",
    "secession (art nouveau)": "Secession",
    baroque: "Baroque",
    "austrian baroque": "Baroque",
    "habsburg baroque": "Baroque",
    "late baroque": "Baroque",
    baroc: "Baroque",
    neoclassical: "Neoclassical",
    "neo classical": "Neoclassical",
    neoclassicism: "Neoclassical",
    classicism: "Neoclassical",
    classicist: "Neoclassical",
    eclectic: "Eclectic",
    eclecticism: "Eclectic",
    historicist: "Eclectic",
    historicism: "Eclectic",
    "eclectic / historicist": "Eclectic",
    "neo renaissance": "Eclectic",
    "neo gothic": "Eclectic",
    "neo baroque": "Eclectic",
    brutalist: "Brutalist",
    brutalism: "Brutalist",
    "socialist brutalism": "Brutalist",
    "socialist modernism": "Brutalist",
  }),
);
const NULL_STYLE_WORDS = new Set(["", "null", "none", "unknown", "n/a", "no match", "not architecture"]);

const TYPE_ALIASES = new Map(
  Object.entries({
    mascaron: "mask",
    face: "mask",
    "carved face": "mask",
    "green man": "mask",
    "maiden face": "mask",
    grotesque: "mask",
    lion: "lion_head",
    "lion head": "lion_head",
    lionhead: "lion_head",
    "door knocker": "lion_head",
    guild: "guild_symbol",
    "guild symbol": "guild_symbol",
    "guild sign": "guild_symbol",
    "guild emblem": "guild_symbol",
    "house sign": "guild_symbol",
    emblem: "guild_symbol",
    "commemorative plaque": "plaque",
    "memorial plaque": "plaque",
    text: "inscription",
    lettering: "inscription",
    date: "inscription",
    ornament: "architectural_element",
    "architectural element": "architectural_element",
    element: "architectural_element",
  }),
);

const DEFAULT_LABELS = {
  mask: "Carved mask",
  lion_head: "Lion head",
  guild_symbol: "Guild symbol",
  plaque: "Plaque",
  inscription: "Inscription",
  architectural_element: "Architectural detail",
};

function aliasKey(value) {
  return String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isNumberQuad(v) {
  return Array.isArray(v) && v.length === 4 && v.every(isFiniteNumber);
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/** Remove a surrounding ```json ... ``` (or bare ```) fence, if present. */
export function stripCodeFences(text) {
  const t = String(text).trim();
  const m = t.match(/^```[\w-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```$/);
  return m ? m[1].trim() : t;
}

/**
 * Parse model text into a JSON value. Tolerates code fences and prose around one JSON object.
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function parseModelJson(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, error: "Empty response; expected exactly one JSON object" };
  }
  const cleaned = stripCodeFences(text);
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) };
      } catch (innerError) {
        return { ok: false, error: `Invalid JSON: ${innerError.message}` };
      }
    }
    return { ok: false, error: `Response is not JSON (${firstError.message}); expected exactly one JSON object` };
  }
}

// ---------------------------------------------------------------------------------------------
// Field normalizers
// ---------------------------------------------------------------------------------------------

/** @returns {string|null|undefined} a Style, null for "no style", or undefined when invalid */
export function normalizeStyle(value) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (STYLES.includes(value)) return value;
  const key = aliasKey(value);
  if (NULL_STYLE_WORDS.has(key)) return null;
  return STYLE_ALIASES.get(key);
}

/** @returns {number|null} confidence rounded to 3 decimals and clamped to 0..1, or null when invalid */
export function normalizeConfidence(value) {
  let n = value;
  let percent = false;
  if (typeof value === "string") {
    const s = value.trim();
    percent = s.endsWith("%");
    n = s === "" ? NaN : Number(percent ? s.slice(0, -1) : s);
  }
  if (!isFiniteNumber(n)) return null;
  if (percent || (n > 1.5 && n <= 100)) n /= 100; // "87%" or 87 means 0.87
  return round(clamp(n, 0, 1), 3);
}

/** @returns {{ type: string, mapped: boolean }} always a valid DetailType */
export function normalizeDetailType(value) {
  if (typeof value === "string" && DETAIL_TYPES.includes(value)) return { type: value, mapped: false };
  if (typeof value === "string") {
    const key = aliasKey(value);
    const direct = DETAIL_TYPES.find((t) => aliasKey(t) === key);
    if (direct) return { type: direct, mapped: false };
    const alias = TYPE_ALIASES.get(key);
    if (alias) return { type: alias, mapped: true };
  }
  return { type: "architectural_element", mapped: true };
}

// ---------------------------------------------------------------------------------------------
// Bounding boxes
// ---------------------------------------------------------------------------------------------

/**
 * Convert Gemini-style box_2d [ymin, xmin, ymax, xmax] (0..scale) to unclamped [x, y, w, h] (0..1).
 * Swapped min/max values are reordered. Returns null if the input is not 4 finite numbers.
 */
export function box2dToBbox(box, scale = BOX_2D_SCALE) {
  if (!isNumberQuad(box)) return null;
  let [ymin, xmin, ymax, xmax] = box.map((v) => v / scale);
  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
  return [xmin, ymin, xmax - xmin, ymax - ymin];
}

/**
 * Clip an [x, y, w, h] box to the unit square and round to 4 decimals.
 * @returns {{ bbox: number[] } | { problem: "invalid" | "tiny", message: string }}
 */
export function clampBbox(bbox) {
  if (!isNumberQuad(bbox)) return { problem: "invalid", message: "bbox must be 4 finite numbers" };
  const [x, y, w, h] = bbox;
  if (w <= 0 || h <= 0) return { problem: "invalid", message: "bbox width and height must be positive" };
  const x1 = clamp(x, 0, 1);
  const y1 = clamp(y, 0, 1);
  const x2 = clamp(x + w, 0, 1);
  const y2 = clamp(y + h, 0, 1);
  const rx = round(x1);
  const ry = round(y1);
  const rw = Math.min(round(x2 - x1), round(1 - rx));
  const rh = Math.min(round(y2 - y1), round(1 - ry));
  if (rw <= MIN_BOX_SIZE || rh <= MIN_BOX_SIZE) {
    return { problem: "tiny", message: `box is outside the image or smaller than ${MIN_BOX_SIZE}` };
  }
  return { bbox: [rx, ry, rw, rh] };
}

/** Read a detail's box from `box_2d` (preferred) or `bbox`, then clamp it. */
export function detailBbox(detail) {
  if (detail.box_2d !== undefined) {
    const converted = box2dToBbox(detail.box_2d);
    if (!converted) return { problem: "invalid", message: "box_2d must be [ymin, xmin, ymax, xmax] numbers 0-1000" };
    return clampBbox(converted);
  }
  if (detail.bbox !== undefined) {
    if (!isNumberQuad(detail.bbox)) return { problem: "invalid", message: "bbox must be [x, y, w, h] numbers" };
    // [x, y, w, h] in 0..1, or on a 0..1000 scale if any value is clearly larger than 1
    const scaled = detail.bbox.some((v) => v > 1.5) ? detail.bbox.map((v) => v / BOX_2D_SCALE) : detail.bbox;
    return clampBbox(scaled);
  }
  return { problem: "invalid", message: "missing box_2d" };
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

function normalizeRawText(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" || t.toLowerCase() === "null" ? null : t;
}

function normalizeLabel(value, type) {
  const t = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (t === "") return DEFAULT_LABELS[type];
  return t.length > MAX_LABEL_LENGTH ? `${t.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…` : t;
}

/**
 * Validate a parsed model object (before guardrails).
 * @returns {{ ok: true, candidate: {style, confidence, details}, info: {image_assessment, evidence, warnings} }
 *         | { ok: false, error: string }}
 */
export function validateModelOutput(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: "Top-level value must be a JSON object" };

  if (!("style" in raw)) return { ok: false, error: 'Missing required key "style"' };
  const style = normalizeStyle(raw.style);
  if (style === undefined) {
    return {
      ok: false,
      error: `"style" must be one of ${STYLES.join(", ")} or null (got ${JSON.stringify(raw.style)})`,
    };
  }

  const confidence = normalizeConfidence(raw.confidence);
  if (confidence === null) {
    return { ok: false, error: `"confidence" must be a number from 0.0 to 1.0 (got ${JSON.stringify(raw.confidence)})` };
  }

  const warnings = [];
  let rawDetails = raw.details;
  if (rawDetails === undefined || rawDetails === null) {
    rawDetails = [];
    if (style !== null) warnings.push('missing "details"; treated as []');
  } else if (!Array.isArray(rawDetails)) {
    return { ok: false, error: '"details" must be an array' };
  }

  const details = [];
  let invalidBoxes = 0;
  let firstBoxError = null;
  rawDetails.forEach((d, i) => {
    if (!isPlainObject(d)) {
      warnings.push(`details[${i}] dropped: not an object`);
      return;
    }
    const box = detailBbox(d);
    if (!box.bbox) {
      if (box.problem === "invalid") {
        invalidBoxes += 1;
        firstBoxError ??= `details[${i}]: ${box.message}`;
      }
      warnings.push(`details[${i}] dropped: ${box.message}`);
      return;
    }
    const { type, mapped } = normalizeDetailType(d.type);
    if (mapped) warnings.push(`details[${i}].type ${JSON.stringify(d.type)} mapped to "${type}"`);
    details.push({
      label: normalizeLabel(d.label, type),
      type,
      bbox: box.bbox,
      raw_text: normalizeRawText(d.raw_text),
    });
  });

  // A systematic box-format error (every box unusable) is worth one repair attempt.
  if (rawDetails.length > 0 && invalidBoxes === rawDetails.length) {
    return {
      ok: false,
      error: `No detail had a usable bounding box (${firstBoxError}). Use "box_2d": [ymin, xmin, ymax, xmax] as integers 0-1000.`,
    };
  }

  const image_assessment = IMAGE_ASSESSMENTS.includes(raw.image_assessment) ? raw.image_assessment : null;
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim()).slice(0, 4)
    : [];

  return { ok: true, candidate: { style, confidence, details }, info: { image_assessment, evidence, warnings } };
}

/** Drop later details that duplicate an earlier one (same type, IoU > 0.8). */
function dedupeDetails(details) {
  const kept = [];
  for (const d of details) {
    if (!kept.some((k) => k.type === d.type && iou(k.bbox, d.bbox) > DUPLICATE_IOU)) kept.push(d);
  }
  return kept;
}

/**
 * Hallucination guardrails + final shaping.
 *  - image assessed as not_architecture / too_blurry  → style null
 *  - style null                                       → details [] (outcome "no_match")
 *  - confidence < minConfidence                       → details [] (outcome "low_confidence"); style is
 *    kept so Module 4 can return LOW_CONFIDENCE, unless nullStyleBelowThreshold is set
 *  - dedupe, cap at MAX_DETAILS, assign ids det_1..det_n
 * @returns {{ result: VisionResult, outcome: "match"|"low_confidence"|"no_match", warnings: string[] }}
 */
export function applyGuardrails(
  candidate,
  { minConfidence = DEFAULT_MIN_CONFIDENCE, nullStyleBelowThreshold = false, imageAssessment = null } = {},
) {
  let { style, details } = candidate;
  const { confidence } = candidate;
  const warnings = [];
  let outcome;

  if (style !== null && REJECTING_ASSESSMENTS.includes(imageAssessment)) {
    warnings.push(`style "${style}" discarded because image was assessed as ${imageAssessment}`);
    style = null;
  }
  if (style === null) {
    outcome = "no_match";
    details = [];
  } else if (confidence < minConfidence) {
    outcome = "low_confidence";
    if (details.length) warnings.push(`${details.length} detail(s) suppressed: confidence ${confidence} < ${minConfidence}`);
    details = [];
    if (nullStyleBelowThreshold) style = null;
  } else {
    outcome = "match";
  }

  const deduped = dedupeDetails(details);
  if (deduped.length < details.length) warnings.push(`${details.length - deduped.length} duplicate detail(s) removed`);
  if (deduped.length > MAX_DETAILS) warnings.push(`${deduped.length - MAX_DETAILS} detail(s) beyond the first ${MAX_DETAILS} dropped`);

  const finalDetails = deduped.slice(0, MAX_DETAILS).map((d, i) => ({
    id: `det_${i + 1}`,
    label: d.label,
    type: d.type,
    bbox: d.bbox,
    raw_text: d.raw_text,
  }));
  return { result: { style, confidence, details: finalDetails }, outcome, warnings };
}

/**
 * Strict contract check for a VisionResult (docs/contracts.md §3–4). Exported so other code and
 * tests can assert shapes.
 * @returns {string[]} problems; empty when valid
 */
export function checkVisionResult(value) {
  const errors = [];
  if (!isPlainObject(value)) return ["result must be an object"];
  const extra = Object.keys(value).filter((k) => !["style", "confidence", "details"].includes(k));
  if (extra.length) errors.push(`unexpected keys: ${extra.join(", ")}`);
  if (!(value.style === null || STYLES.includes(value.style))) errors.push(`invalid style ${JSON.stringify(value.style)}`);
  if (!isFiniteNumber(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    errors.push(`confidence must be a number in [0, 1]`);
  }
  if (!Array.isArray(value.details)) return [...errors, "details must be an array"];
  if (value.details.length > MAX_DETAILS) errors.push(`at most ${MAX_DETAILS} details allowed`);
  if (value.style === null && value.details.length) errors.push("details must be [] when style is null");
  const ids = new Set();
  value.details.forEach((d, i) => {
    const at = `details[${i}]`;
    if (!isPlainObject(d)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const keys = Object.keys(d).sort().join(",");
    if (keys !== "bbox,id,label,raw_text,type") errors.push(`${at} keys must be exactly id,label,type,bbox,raw_text`);
    if (typeof d.id !== "string" || !/^det_\d+$/.test(d.id)) errors.push(`${at}.id must look like "det_1"`);
    if (ids.has(d.id)) errors.push(`${at}.id is not unique`);
    ids.add(d.id);
    if (typeof d.label !== "string" || d.label.trim() === "") errors.push(`${at}.label must be a non-empty string`);
    if (!DETAIL_TYPES.includes(d.type)) errors.push(`${at}.type invalid: ${JSON.stringify(d.type)}`);
    if (!(d.raw_text === null || typeof d.raw_text === "string")) errors.push(`${at}.raw_text must be string or null`);
    if (!isNumberQuad(d.bbox)) {
      errors.push(`${at}.bbox must be 4 numbers`);
    } else {
      const [x, y, w, h] = d.bbox;
      if (x < 0 || y < 0 || w <= MIN_BOX_SIZE || h <= MIN_BOX_SIZE || x + w > 1 + EPS || y + h > 1 + EPS) {
        errors.push(`${at}.bbox out of range: ${JSON.stringify(d.bbox)}`);
      }
    }
  });
  return errors;
}

/**
 * Full pipeline: raw model text → contract VisionResult.
 * @returns {{ ok: true, result, outcome, info } | { ok: false, error: string }}
 */
export function parseAndValidate(text, { minConfidence = DEFAULT_MIN_CONFIDENCE, nullStyleBelowThreshold = false } = {}) {
  const parsed = parseModelJson(text);
  if (!parsed.ok) return parsed;
  const validated = validateModelOutput(parsed.value);
  if (!validated.ok) return validated;
  const { result, outcome, warnings } = applyGuardrails(validated.candidate, {
    minConfidence,
    nullStyleBelowThreshold,
    imageAssessment: validated.info.image_assessment,
  });
  const problems = checkVisionResult(result);
  if (problems.length) return { ok: false, error: `Normalized output violates the contract: ${problems.join("; ")}` };
  return { ok: true, result, outcome, info: { ...validated.info, warnings: [...validated.info.warnings, ...warnings] } };
}
