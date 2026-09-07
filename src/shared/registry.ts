/**
 * Registered values for the job template attributes a print UI exposes, from the IANA IPP
 * registry and PWG 5101.1 media names. Printers under-report; these are the values worth
 * trying as capability overrides. The printer still has the last word (Validate-Job).
 */
import { enumKeywords } from "./enums.js";

const KEYWORDS: Record<string, string[]> = {
  "sides": ["one-sided", "two-sided-long-edge", "two-sided-short-edge"],
  "print-color-mode": ["auto", "auto-monochrome", "bi-level", "color", "highlight", "monochrome", "process-bi-level", "process-monochrome"],
  "media": [
    "iso_a3_297x420mm",
    "iso_a4_210x297mm",
    "iso_a5_148x210mm",
    "iso_a6_105x148mm",
    "iso_b4_250x353mm",
    "iso_b5_176x250mm",
    "iso_c4_229x324mm",
    "iso_c5_162x229mm",
    "iso_c6_114x162mm",
    "iso_dl_110x220mm",
    "iso_sra3_320x450mm",
    "iso_ra3_305x430mm",
    "jis_b4_257x364mm",
    "jis_b5_182x257mm",
    "na_letter_8.5x11in",
    "na_legal_8.5x14in",
    "na_ledger_11x17in",
    "na_executive_7.25x10.5in",
    "na_invoice_5.5x8.5in",
    "na_index-4x6_4x6in",
    "na_index-5x8_5x8in",
    "na_number-10_4.125x9.5in",
    "na_monarch_3.875x7.5in",
    "om_folio_210x330mm",
    "om_dsc-photo_89x119mm",
    "custom_min_98x148mm",
  ],
  "media-source": ["auto", "main", "alternate", "large-capacity", "manual", "envelope", "photo", "by-pass-tray", "top", "middle", "bottom", "side", "left", "right", "rear", "center", "tray-1", "tray-2", "tray-3", "tray-4", "tray-5", "tray-6", "roll-1", "roll-2"],
  "media-type": [
    "stationery",
    "stationery-archival",
    "stationery-coated",
    "stationery-cotton",
    "stationery-fine",
    "stationery-heavyweight",
    "stationery-heavyweight-coated",
    "stationery-inkjet",
    "stationery-letterhead",
    "stationery-lightweight",
    "stationery-preprinted",
    "stationery-prepunched",
    "stationery-recycled",
    "cardstock",
    "envelope",
    "envelope-plain",
    "envelope-window",
    "labels",
    "photographic",
    "photographic-glossy",
    "photographic-matte",
    "photographic-semi-gloss",
    "transparency",
    "film",
    "disc",
    "auto",
  ],
  "output-bin": ["auto", "top", "middle", "bottom", "side", "left", "right", "center", "rear", "face-up", "face-down", "large-capacity", "my-mailbox", "stacker-1", "stacker-2", "mailbox-1", "mailbox-2", "tray-1", "tray-2", "tray-3"],
  "multiple-document-handling": ["separate-documents-collated-copies", "separate-documents-uncollated-copies", "single-document", "single-document-new-sheet"],
  "print-scaling": ["auto", "auto-fit", "fill", "fit", "none"],
  "print-content-optimize": ["auto", "graphic", "photo", "text", "text-and-graphic"],
  "print-rendering-intent": ["absolute", "auto", "perceptual", "relative", "relative-bpc", "saturation"],
  "job-hold-until": ["no-hold", "indefinite", "day-time", "evening", "night", "weekend", "second-shift", "third-shift"],
  "job-sheets": ["none", "standard"],
  "number-up": ["1", "2", "4", "6", "9", "16"],
  "page-delivery": ["same-order-face-up", "same-order-face-down", "reverse-order-face-up", "reverse-order-face-down"],
  "compression": ["none", "deflate", "gzip", "compress"],
  "document-format": ["application/pdf", "image/jpeg", "image/png", "image/pwg-raster", "image/urf", "application/postscript", "application/vnd.hp-PCL", "text/plain"],
};

/** Registered values for `foo` or `foo-supported`; empty when the attribute has no fixed vocabulary. */
export function standardValues(attrName: string): string[] {
  const base = attrName.replace(/-(default|supported|ready)$/, "");
  const fromEnums = enumKeywords(base);
  return fromEnums.length > 0 ? fromEnums : KEYWORDS[base] ?? [];
}
