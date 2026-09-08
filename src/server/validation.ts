/**
 * The single validation entry point, called on preset save, job build and before submit.
 * In IPP mode the option map is checked against the printer's capabilities; in PostScript
 * mode against the PPD, with `copies` still an IPP attribute.
 */
import type { PrinterProfile } from "./printers.js";
import { FIT_TO_MARGINS, PPD_PREFIX } from "../shared/attributes.js";
import { checkConstraints, describeViolation } from "./ipp/constraints.js";
import { validateOptions } from "./ipp/options.js";
import { validatePpdOptions } from "./ppd/form.js";

export function validateJobOptions(options: Record<string, unknown>, profile: PrinterProfile): string[] {
  if (profile.mode === "postscript" && profile.ppd) {
    const errors: string[] = [];
    const ipp: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(options)) {
      if (name === "copies") {
        ipp[name] = value;
      }
      else if (name === FIT_TO_MARGINS) {
        if (value !== true && value !== false && value !== "true" && value !== "false")
          errors.push(`"${FIT_TO_MARGINS}" must be true or false`);
      }
      else if (!name.startsWith(PPD_PREFIX)) {
        errors.push(`"${name}" is not used in PostScript mode; the PPD options replace it`);
      }
    }
    return [...errors, ...validateOptions(ipp, profile.caps), ...validatePpdOptions(profile.ppd, options)];
  }
  const foreign = Object.keys(options).filter(name => name.startsWith(PPD_PREFIX));
  if (foreign.length > 0)
    return foreign.map(name => `"${name}" needs PostScript mode on this printer`);
  const errors = validateOptions(options, profile.caps);
  if (errors.length > 0)
    return errors;
  try {
    return checkConstraints(options, profile.caps).map(describeViolation);
  }
  catch (err) {
    return [(err as Error).message];
  }
}
