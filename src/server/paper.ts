import type { Size } from "../shared/layout.js";
import type { PrinterProfile } from "./printers.js";
import { mediaSize } from "../shared/attributes.js";
import { attrValue } from "./ipp/codec.js";
import { ppdChoices } from "./ppd/form.js";

/**
 * The sheet a job prints on, in points, as far as the printer's own description says: the PPD's
 * PageSize in PostScript mode, the IPP media otherwise, each falling back to the printer's default.
 */
export function paperFor(profile: PrinterProfile, options: Record<string, unknown>): Size | null {
  if (profile.mode === "postscript" && profile.ppd) {
    const pageSize = ppdChoices(options).PageSize ?? profile.ppd.options.find(o => o.key === "PageSize")?.default;
    return (pageSize ? profile.ppd.paperDimensions[pageSize] : undefined) ?? null;
  }
  const media = options.media ?? attrValue<string>(profile.caps, "media-default");
  return typeof media === "string" ? mediaSize(media) : null;
}
