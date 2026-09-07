/**
 * Job constraint and resolver evaluation, PWG 5100.13 section 8.
 *
 * `job-constraints-supported` lists combinations the printer cannot honour; each entry names a
 * resolver in `job-resolvers-supported` that says which values to change to make the job valid.
 * Most printers publish neither, in which case there is nothing to check here.
 */
import type { IppAttributes, IppCollection, IppValue } from "./codec.js";
import { enumName } from "../../shared/enums.js";
import { attrValue, attrValues, isOutOfBand } from "./codec.js";
import { buildAttributes } from "./options.js";

export interface ConstraintViolation {
  resolverName: string;
  /** The conflicting attribute values, as the user would see them. */
  conflict: Record<string, string[]>;
  /** What the printer's resolver would change, as option-map values. Empty if no resolver is published. */
  resolution: Record<string, unknown>;
}

function sameValue(a: IppValue, b: IppValue): boolean {
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null)
    return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function describe(name: string, v: IppValue): string {
  if (typeof v === "number")
    return enumName(name, v);
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

/** Option-map form of an IPP value: enums become their keyword names so the UI and presets can store them. */
function toOptionValue(name: string, v: IppValue): unknown {
  if (typeof v === "number")
    return enumName(name, v);
  if (typeof v === "object" && v !== null && !("min" in v) && !("x" in v) && !("language" in v))
    return Object.fromEntries(Object.entries(v as IppCollection).map(([k, a]) => [k, a.values.length === 1 ? toOptionValue(k, a.values[0]!) : a.values.map(x => toOptionValue(k, x))]));
  return v;
}

function jobValues(attrs: IppAttributes, caps: IppAttributes, name: string): IppValue[] | undefined {
  const explicit = attrs[name];
  if (explicit && !isOutOfBand(explicit.type))
    return explicit.values;
  const def = caps[`${name}-default`];
  if (def && !isOutOfBand(def.type))
    return def.values;
  return undefined;
}

export function checkConstraints(options: Record<string, unknown>, caps: IppAttributes): ConstraintViolation[] {
  const constraints = attrValues<IppCollection>(caps, "job-constraints-supported");
  if (constraints.length === 0)
    return [];
  const resolvers = attrValues<IppCollection>(caps, "job-resolvers-supported");
  const attrs = buildAttributes(options, caps);
  const violations: ConstraintViolation[] = [];

  for (const constraint of constraints) {
    const resolverName = attrValue<string>(constraint, "resolver-name") ?? "";
    const members = Object.entries(constraint).filter(([k]) => k !== "resolver-name");
    if (members.length === 0)
      continue;
    const conflict: Record<string, string[]> = {};
    let matches = true;
    for (const [name, attr] of members) {
      const values = jobValues(attrs, caps, name);
      const hit = values?.filter(v => attr.values.some(cv => sameValue(v, cv))) ?? [];
      if (hit.length === 0) {
        matches = false;
        break;
      }
      conflict[name] = hit.map(v => describe(name, v));
    }
    if (!matches)
      continue;

    const resolver = resolvers.find(r => attrValue<string>(r, "resolver-name") === resolverName);
    const resolution: Record<string, unknown> = {};
    if (resolver) {
      for (const [name, attr] of Object.entries(resolver)) {
        if (name === "resolver-name" || isOutOfBand(attr.type))
          continue;
        resolution[name] = attr.values.length === 1 ? toOptionValue(name, attr.values[0]!) : attr.values.map(v => toOptionValue(name, v));
      }
    }
    violations.push({ resolverName, conflict, resolution });
  }
  return violations;
}

export function describeViolation(v: ConstraintViolation): string {
  const combo = Object.entries(v.conflict).map(([k, vals]) => `${k}=${vals.join("/")}`).join(" with ");
  const fix = Object.entries(v.resolution).map(([k, val]) => `${k}=${Array.isArray(val) ? val.join(",") : String(val)}`).join(", ");
  return fix
    ? `${combo} is not a valid combination on this printer; suggested fix: ${fix}`
    : `${combo} is not a valid combination on this printer${v.resolverName ? ` (${v.resolverName})` : ""}`;
}

/** Applies every matching resolver, repeating until the options are constraint-free or nothing changes. */
export function applyResolvers(options: Record<string, unknown>, caps: IppAttributes): Record<string, unknown> {
  let current = { ...options };
  for (let round = 0; round < 5; round += 1) {
    const violations = checkConstraints(current, caps).filter(v => Object.keys(v.resolution).length > 0);
    if (violations.length === 0)
      break;
    const next = { ...current };
    for (const v of violations)
      Object.assign(next, v.resolution);
    if (JSON.stringify(next) === JSON.stringify(current))
      break;
    current = next;
  }
  return current;
}
