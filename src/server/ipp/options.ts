/**
 * Turns the flat `{ attribute: value }` option map used by presets and jobs
 * into typed IPP job attributes, and validates it against printer capabilities.
 *
 * Value types come from three places in priority order: a small registry of
 * well-known job template attributes, the type of the printer's own
 * `<attr>-supported` attribute, and finally the JavaScript type of the value.
 */
import type { IppAttribute, IppAttributes, IppCollection, IppValue, IppValueType } from "./codec.js";
import { attrValues, isOutOfBand } from "./codec.js";
import { enumName, enumValue } from "./enums.js";

export type OptionMap = Record<string, unknown>;

const KNOWN_TYPES: Record<string, IppValueType> = {
  "copies": "integer",
  "sides": "keyword",
  "media": "keyword",
  "media-col": "collection",
  "media-source": "keyword",
  "media-type": "keyword",
  "media-size-name": "keyword",
  "media-size": "collection",
  "x-dimension": "integer",
  "y-dimension": "integer",
  "media-top-margin": "integer",
  "media-bottom-margin": "integer",
  "media-left-margin": "integer",
  "media-right-margin": "integer",
  "print-color-mode": "keyword",
  "print-quality": "enum",
  "print-scaling": "keyword",
  "print-content-optimize": "keyword",
  "print-rendering-intent": "keyword",
  "printer-resolution": "resolution",
  "finishings": "enum",
  "finishings-col": "collection",
  "finishing-template": "keyword",
  "orientation-requested": "enum",
  "output-bin": "keyword",
  "page-ranges": "rangeOfInteger",
  "number-up": "integer",
  "presentation-direction-number-up": "keyword",
  "multiple-document-handling": "keyword",
  "job-name": "nameWithoutLanguage",
  "job-priority": "integer",
  "job-hold-until": "keyword",
  "job-sheets": "nameWithoutLanguage",
  "job-account-id": "nameWithoutLanguage",
  "job-accounting-user-id": "nameWithoutLanguage",
  "job-password": "octetString",
  "job-password-encryption": "keyword",
  "ipp-attribute-fidelity": "boolean",
};

/** `<attr>-supported` describes the attribute's values; its own type mostly matches the attribute's. */
function typeFromSupported(caps: IppAttributes, name: string): IppValueType | undefined {
  const supported = caps[`${name}-supported`];
  if (!supported || isOutOfBand(supported.type))
    return undefined;
  switch (supported.type) {
    case "rangeOfInteger":
      return "integer";
    case "boolean":
      // e.g. page-ranges-supported = true says nothing about the value type
      return undefined;
    default:
      return supported.type;
  }
}

function typeFromValue(value: unknown): IppValueType {
  if (typeof value === "number")
    return "integer";
  if (typeof value === "boolean")
    return "boolean";
  if (typeof value === "object" && value !== null)
    return "collection";
  return "keyword";
}

export function resolveType(name: string, value: unknown, caps: IppAttributes): IppValueType {
  return KNOWN_TYPES[name] ?? typeFromSupported(caps, name) ?? typeFromValue(Array.isArray(value) ? value[0] : value);
}

function parseResolution(v: unknown, name: string): IppValue {
  if (typeof v === "object" && v !== null)
    return v as IppValue;
  const m = /^(\d+)(?:x(\d+))?(dpi|dpcm)$/.exec(String(v));
  if (!m)
    throw new TypeError(`"${name}" expects a resolution like 600dpi or 600x1200dpi`);
  const x = Number(m[1]);
  return { x, y: m[2] ? Number(m[2]) : x, units: m[3] === "dpcm" ? 4 : 3 };
}

function parseRange(v: unknown, name: string): IppValue {
  if (typeof v === "object" && v !== null)
    return v as IppValue;
  const m = /^(\d+)-(\d+)$/.exec(String(v));
  if (!m)
    throw new TypeError(`"${name}" expects a range like 1-3`);
  return { min: Number(m[1]), max: Number(m[2]) };
}

function coerceValue(name: string, type: IppValueType, v: unknown, caps: IppAttributes): IppValue {
  switch (type) {
    case "integer": {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n))
        throw new TypeError(`"${name}" expects an integer`);
      return n;
    }
    case "enum": {
      const n = enumValue(name, v as string | number);
      if (n === undefined)
        throw new TypeError(`"${name}" has no enum value named "${String(v)}"`);
      return n;
    }
    case "boolean":
      return v === true || v === "true";
    case "resolution":
      return parseResolution(v, name);
    case "rangeOfInteger":
      return parseRange(v, name);
    case "collection":
      if (typeof v !== "object" || v === null || Array.isArray(v))
        throw new TypeError(`"${name}" expects an object`);
      return buildAttributes(v as OptionMap, caps) as IppCollection;
    case "textWithLanguage":
    case "nameWithLanguage":
      return typeof v === "object" && v !== null ? v as IppValue : { language: "en", text: String(v) };
    default:
      return String(v);
  }
}

function buildAttributes(options: OptionMap, caps: IppAttributes): IppAttributes {
  const out: IppAttributes = {};
  for (const [name, raw] of Object.entries(options)) {
    if (raw === undefined || raw === null || raw === "")
      continue;
    const type = resolveType(name, raw, caps);
    const values = (Array.isArray(raw) ? raw : [raw]).map(v => coerceValue(name, type, v, caps));
    if (values.length > 0)
      out[name] = { type, values };
  }
  return out;
}

/** Job template attributes ready for the job attribute group of Print-Job. */
export function buildJobAttributes(options: OptionMap, caps: IppAttributes): IppAttributes {
  return buildAttributes(options, caps);
}

function describe(name: string, v: IppValue): string {
  if (typeof v === "number")
    return enumName(name, v);
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

/**
 * Checks an option map against the printer's capabilities. Returns human-readable
 * problems; an empty array means the printer should accept the job attributes.
 * Constraint/resolver evaluation (PWG 5100.13) is not implemented yet.
 */
export function validateOptions(options: OptionMap, caps: IppAttributes): string[] {
  const errors: string[] = [];
  const creatable = attrValues<string>(caps, "job-creation-attributes-supported");

  let attrs: IppAttributes;
  try {
    attrs = buildJobAttributes(options, caps);
  }
  catch (err) {
    return [(err as Error).message];
  }

  for (const [name, attr] of Object.entries(attrs)) {
    if (creatable.length > 0 && !creatable.includes(name)) {
      errors.push(`"${name}" is not a job attribute this printer accepts`);
      continue;
    }
    const supported = caps[`${name}-supported`];
    if (!supported || isOutOfBand(supported.type))
      continue;

    for (const value of attr.values) {
      if (supported.type === "rangeOfInteger") {
        const range = supported.values[0] as { min: number; max: number } | undefined;
        if (range && typeof value === "number" && (value < range.min || value > range.max))
          errors.push(`"${name}" must be between ${range.min} and ${range.max}`);
      }
      else if (supported.type === "boolean") {
        if (supported.values[0] === false)
          errors.push(`"${name}" is not supported by this printer`);
      }
      else if (attr.type === "keyword" || attr.type === "enum" || attr.type === "mimeMediaType" || attr.type === "integer") {
        const allowed = supported.values;
        if (!allowed.includes(value))
          errors.push(`"${name}" = ${describe(name, value)} is not supported; choose from ${allowed.map(a => describe(name, a)).join(", ")}`);
      }
      else if (attr.type === "resolution") {
        const r = value as { x: number; y: number; units: number };
        const ok = supported.values.some((a) => {
          const s = a as { x: number; y: number; units: number };
          return s.x === r.x && s.y === r.y && s.units === r.units;
        });
        if (!ok)
          errors.push(`"${name}" = ${r.x}x${r.y}${r.units === 4 ? "dpcm" : "dpi"} is not supported`);
      }
    }
  }
  return errors;
}

/** Convenience for UI: choices and default for one job attribute, using enum keyword names. */
export function choicesFor(caps: IppAttributes, name: string): { choices: IppValue[]; default: IppValue | undefined } {
  const supported = caps[`${name}-supported`];
  const def = caps[`${name}-default`];
  return {
    choices: supported && !isOutOfBand(supported.type) ? supported.values : [],
    default: def && !isOutOfBand(def.type) ? def.values[0] : undefined,
  };
}

/** Deep-merges admin overrides over discovered capabilities at the attribute level. */
export function mergeCaps(discovered: IppAttributes, overrides: IppAttributes): IppAttributes {
  return { ...discovered, ...overrides };
}

export { attrValues as capValues };
export type { IppAttribute };
