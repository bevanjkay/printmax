/**
 * The single validation entry point, called on preset save, job build and before submit.
 * In IPP mode the option map is checked against the printer's capabilities; in PostScript
 * mode against the PPD, with `copies` still an IPP attribute.
 */
import type { DocumentSize, ValidationResult } from "../shared/types.js";
import type { PrinterProfile } from "./printers.js";
import { BLACK_AND_WHITE, FIT_TO_MARGINS, FIT_TO_PAGE, PPD_PREFIX, toggleIsOn } from "../shared/attributes.js";
import { cellSize, hasRoom, layoutErrors, layoutFrom, sheetFor, turnsPage, withoutLayoutOptions } from "../shared/layout.js";
import { applyResolvers, checkConstraints, describeViolation } from "./ipp/constraints.js";
import { validateOptions } from "./ipp/options.js";
import { paperFor } from "./paper.js";
import { ppdChoices, validatePpdOptions } from "./ppd/form.js";

function isToggle(value: unknown): boolean {
  return value === true || value === false || value === "true" || value === "false";
}

export function validateJobOptions(options: Record<string, unknown>, profile: PrinterProfile): string[] {
  const { [BLACK_AND_WHITE]: blackAndWhite, ...rest } = options;
  if (blackAndWhite !== undefined && !isToggle(blackAndWhite))
    return [`"${BLACK_AND_WHITE}" must be true or false`];
  return [...validateLayout(rest, profile), ...validatePrinterOptions(withoutLayoutOptions(rest), profile)];
}

/** The layout is printmax's own in either mode; the paper only decides whether its spacing leaves room for pages. */
export function validateLayout(options: Record<string, unknown>, profile: PrinterProfile): string[] {
  const errors = layoutErrors(options);
  if (errors.length > 0)
    return errors;
  const layout = layoutFrom(options);
  const paper = layout ? paperFor(profile, options) : null;
  return layout && paper && !hasRoom(paper, layout) ? ["The layout's margin and gaps leave no room for pages on this paper. Use a smaller gap, or fewer columns and rows."] : [];
}

function validatePrinterOptions(options: Record<string, unknown>, profile: PrinterProfile): string[] {
  if (profile.mode === "postscript" && profile.ppd) {
    const errors: string[] = [];
    const ipp: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(options)) {
      if (name === "copies") {
        ipp[name] = value;
      }
      else if (name === FIT_TO_MARGINS || name === FIT_TO_PAGE) {
        if (!isToggle(value))
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
  if (!document)
    return [];
  // Laid out, a page answers to its space on the sheet rather than to the paper.
  const layout = layoutFrom(options);
  if (layout) {
    const paper = paperFor(profile, options);
    if (layout.fit || !paper)
      return [];
    const cell = cellSize(sheetFor(paper, layout, document), layout);
    const [width, height] = turnsPage(cell, document, layout) ? [document.height, document.width] : [document.width, document.height];
    // Half a point of slack: paper sizes are whole points, and two A5 pages are a shade over one A4.
    if (width <= cell.width + 0.5 && height <= cell.height + 0.5)
      return [];
    return [`This document's pages are ${mm(document.width)} \u00D7 ${mm(document.height)} mm, larger than the ${mm(cell.width)} \u00D7 ${mm(cell.height)} mm each gets on the sheet. With resize off they print at their own size, so they overlap or run off the sheet.`];
  }
  if (profile.mode !== "postscript" || !profile.ppd)
    return [];
  if (toggleIsOn(options, profile.optionDefaults, FIT_TO_PAGE, true))
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

/** The editor's live check: what blocks a job, what is only advice, and the printer's own fix where it publishes one. */
export function checkOptions(options: Record<string, unknown>, profile: PrinterProfile, document?: DocumentSize): ValidationResult {
  const errors = validateJobOptions(options, profile);
  const warnings = jobWarnings(options, profile, document);
  let resolved = options;
  if (errors.length > 0) {
    try {
      resolved = applyResolvers(options, profile.caps);
    }
    catch {
      resolved = options;
    }
  }
  // Laid out, every warning is about the fit of pages in their spaces.
  const layout = { errors: validateLayout(options, profile), warnings: layoutFrom(options) ? warnings : [], paper: paperFor(profile, options) };
  return { errors, warnings, layout, resolved };
}
