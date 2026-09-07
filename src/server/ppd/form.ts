/**
 * The PPD as a print form: one field per user-visible option, named `ppd:<Key>` so PPD
 * choices live in the same flat option map as IPP attributes.
 */
import type { FormField } from "../../shared/types.js";
import type { ParsedPpd, PpdConstraint } from "./parser.js";
import { PPD_PREFIX } from "../../shared/attributes.js";

/** Handled elsewhere or meaningless without a driver dialog. */
const HIDDEN_PPD_OPTIONS = new Set(["PageRegion", "CustomPageSize"]);
const OFF_CHOICES = new Set(["None", "False", "Off"]);

/** For PPD keys that ship without a translation string. */
const KEY_LABELS: Record<string, string> = {
  PageSize: "Paper size",
  InputSlot: "Tray",
  MediaType: "Paper type",
  Duplex: "Duplex",
  ColorModel: "Colour",
  OutputBin: "Output tray",
  Resolution: "Resolution",
  Collate: "Collate",
};

/**
 * Drivers page a long group across several numbered ones ("Color Settings 1" through
 * "Color Settings 4"); to someone filling in the form they are one section.
 */
function sectionLabel(label: string): string {
  const merged = label.replace(/\s*\d+$/, "").trim();
  return merged.length > 0 ? merged : label;
}

/** "Saddle Stitch (Portrait) / Saddle Stitch (Landscape)" reads as "Saddle Stitch" in a form and a summary. */
function shortLabel(label: string): string {
  const short = label.replace(/\s*\(.*$/, "").trim();
  return short.length > 0 ? short : label;
}

export function ppdFields(ppd: ParsedPpd): FormField[] {
  return ppd.options
    .filter(o => !o.installable && !HIDDEN_PPD_OPTIONS.has(o.key) && o.choices.length > 1)
    .map(o => ({
      name: `${PPD_PREFIX}${o.key}`,
      label: o.label === o.key ? KEY_LABELS[o.key] ?? o.key : o.label,
      widget: "select" as const,
      choices: o.choices.map(c => ({ value: c.value, label: shortLabel(c.label) })),
      ...(o.default !== null ? { default: o.default } : {}),
      ...(o.groupLabel ? { group: sectionLabel(o.groupLabel) } : {}),
    }));
}

/** The `ppd:` entries of an option map as PPD key to choice value. */
export function ppdChoices(options: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(options)) {
    if (name.startsWith(PPD_PREFIX) && value !== undefined && value !== null && value !== "")
      out[name.slice(PPD_PREFIX.length)] = String(value);
  }
  return out;
}

export function validatePpdOptions(ppd: ParsedPpd, options: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const chosen = ppdChoices(options);
  const byKey = new Map(ppd.options.map(o => [o.key, o]));
  for (const [key, value] of Object.entries(chosen)) {
    const option = byKey.get(key);
    if (!option || option.installable) {
      errors.push(`"${PPD_PREFIX}${key}" is not an option in this printer's PPD`);
      continue;
    }
    if (!option.choices.some(c => c.value === value))
      errors.push(`"${PPD_PREFIX}${key}" = ${value} is not a choice; choose from ${option.choices.map(c => c.value).join(", ")}`);
  }
  // *UIConstraints describe the driver dialog, not what the device refuses: the proven booklet
  // job (A5 pages, saddle stitch, fold) breaks one. They shape defaults (see overriddenDefaults)
  // but do not block, the same as a CUPS command-line job.
  return [...new Set(errors)];
}

/** Constraints that hold for the chosen values plus defaults. A constraint without a choice means "any choice that turns the option on", as CUPS reads it. */
export function activeConstraints(ppd: ParsedPpd, chosen: Record<string, string>): PpdConstraint[] {
  const byKey = new Map(ppd.options.map(o => [o.key, o]));
  const effective = (key: string): string | null => chosen[key] ?? byKey.get(key)?.default ?? null;
  const hits = (key: string, choice: string | null): boolean => {
    const value = effective(key);
    return choice === null ? value !== null && !OFF_CHOICES.has(value) : value === choice;
  };
  return ppd.constraints.filter(c => (c.key1 in chosen || c.key2 in chosen) && hits(c.key1, c.choice1) && hits(c.key2, c.choice2));
}

/** Options whose default conflicts with an explicit choice; the driver would change them, we leave them out. */
export function overriddenDefaults(ppd: ParsedPpd, chosen: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const c of activeConstraints(ppd, chosen)) {
    if (c.key1 in chosen && !(c.key2 in chosen))
      out.add(c.key2);
    if (c.key2 in chosen && !(c.key1 in chosen))
      out.add(c.key1);
  }
  return out;
}
