/**
 * The single validation entry point, called on preset save, job build and before submit.
 * In IPP mode the option map is checked against the printer's capabilities; in PostScript
 * mode against the PPD, with `copies` still an IPP attribute.
 */
import type { DocumentSize } from "../shared/types.js";
import type { PrinterProfile } from "./printers.js";
import { FIT_TO_MARGINS, FIT_TO_PAGE, PPD_PREFIX } from "../shared/attributes.js";
import { checkConstraints, describeViolation } from "./ipp/constraints.js";
import { validateOptions } from "./ipp/options.js";
import { ppdChoices, validatePpdOptions } from "./ppd/form.js";

export function validateJobOptions(options: Record<string, unknown>, profile: PrinterProfile): string[] {
  if (profile.mode === "postscript" && profile.ppd) {
    const errors: string[] = [];
    const ipp: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(options)) {
      if (name === "copies") {
        ipp[name] = value;
      }
      else if (name === FIT_TO_MARGINS || name === FIT_TO_PAGE) {
        if (value !== true && value !== false && value !== "true" && value !== "false")
          errors.push(`"${name}" must be true or false`);
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

function mm(points: number): number {
  return Math.round((points * 25.4) / 72);
}

/**
 * Advisory problems that should not block a job. Printers turn the sheet to suit the page, so a page
 * fits when each of its sides fits a side of the paper, whichever way round they were given.
 */
export function jobWarnings(options: Record<string, unknown>, profile: PrinterProfile, document: DocumentSize | undefined): string[] {
  if (profile.mode !== "postscript" || !profile.ppd || !document)
    return [];
  if (options[FIT_TO_PAGE] === undefined || options[FIT_TO_PAGE] === true || options[FIT_TO_PAGE] === "true")
    return [];
  const size = ppdChoices(options).PageSize;
  const paper = size ? profile.ppd.paperDimensions[size] : undefined;
  if (!paper)
    return [];
  const [pageShort, pageLong] = [document.width, document.height].sort((a, b) => a - b) as [number, number];
  const [paperShort, paperLong] = [paper.width, paper.height].sort((a, b) => a - b) as [number, number];
  if (pageShort <= paperShort && pageLong <= paperLong)
    return [];
  return [`This document's pages are ${mm(pageShort)} \u00D7 ${mm(pageLong)} mm, larger than ${size} (${mm(paperShort)} \u00D7 ${mm(paperLong)} mm). With fit to paper off they print at their own size, so whatever falls outside the sheet is cut.`];
}
