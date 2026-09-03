/**
 * The one hand-maintained table: how to present IPP job template attributes.
 * Everything else about a printer's options comes from the printer itself.
 */
export type Widget = "select" | "multiselect" | "number" | "text" | "password";

export interface AttributeUi {
  label: string;
  widget: Widget;
  help?: string;
}

export const ATTRIBUTE_UI: Record<string, AttributeUi> = {
  "copies": { label: "Copies", widget: "number" },
  "sides": { label: "Duplex", widget: "select" },
  "print-color-mode": { label: "Colour", widget: "select" },
  "media": { label: "Paper size", widget: "select" },
  "media-source": { label: "Tray", widget: "select" },
  "media-type": { label: "Paper type", widget: "select" },
  "print-quality": { label: "Quality", widget: "select" },
  "printer-resolution": { label: "Resolution", widget: "select" },
  "finishings": { label: "Finishing", widget: "multiselect" },
  "output-bin": { label: "Output tray", widget: "select" },
  "orientation-requested": { label: "Orientation", widget: "select" },
  "number-up": { label: "Pages per sheet", widget: "select" },
  "page-ranges": { label: "Page range", widget: "text", help: "For example 1-3" },
  "print-scaling": { label: "Scaling", widget: "select" },
  "multiple-document-handling": { label: "Collation", widget: "select" },
  "job-hold-until": { label: "Hold until", widget: "select" },
  "job-priority": { label: "Priority", widget: "number" },
  "job-sheets": { label: "Banner page", widget: "select" },
  "print-content-optimize": { label: "Optimise for", widget: "select" },
  "print-rendering-intent": { label: "Rendering intent", widget: "select" },
  "job-account-id": { label: "Account / department code", widget: "text" },
  "job-accounting-user-id": { label: "Accounting user", widget: "text" },
  "job-password": { label: "Print PIN", widget: "password", help: "Job is held at the device until the PIN is entered" },
};

/** Attributes that the editor never shows; they are set by the app or are too complex for v1. */
export const HIDDEN_ATTRIBUTES = new Set([
  "document-access",
  "document-charset",
  "document-format",
  "document-message",
  "document-metadata",
  "document-name",
  "document-natural-language",
  "document-password",
  "ipp-attribute-fidelity",
  "job-name",
  "job-mandatory-attributes",
  "media-col",
  "finishings-col",
  "overrides",
  "job-password-encryption",
  "pdl-init-file",
  "compression",
]);

const KEYWORD_LABELS: Record<string, string> = {
  "one-sided": "Single-sided",
  "two-sided-long-edge": "Double-sided, long edge",
  "two-sided-short-edge": "Double-sided, short edge",
  "monochrome": "Black and white",
  "color": "Colour",
  "auto": "Automatic",
  "auto-monochrome": "Automatic (prefer black and white)",
  "bi-level": "Bi-level",
  "process-monochrome": "Process black and white",
  "none": "None",
  "draft": "Draft",
  "normal": "Normal",
  "high": "High",
  "portrait": "Portrait",
  "landscape": "Landscape",
  "reverse-landscape": "Reverse landscape",
  "reverse-portrait": "Reverse portrait",
  "separate-documents-collated-copies": "Collated",
  "separate-documents-uncollated-copies": "Uncollated",
  "single-document": "Single document",
  "single-document-new-sheet": "Single document, new sheet per file",
  "no-hold": "Print immediately",
  "indefinite": "Hold indefinitely",
  "stationery": "Plain paper",
  "stationery-letterhead": "Letterhead",
  "stationery-heavyweight": "Heavy paper",
  "stationery-lightweight": "Light paper",
  "stationery-recycled": "Recycled paper",
  "by-pass-tray": "Bypass tray",
  "face-down": "Face down",
  "face-up": "Face up",
  "fill": "Fill page",
  "fit": "Fit to page",
};

const MEDIA_RE = /^(?:iso|na|jis|jpn|om|prc|roc|asme|custom)_([a-z0-9.+-]+)_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(mm|in)$/;

/** Turns a PWG keyword or media size name into something a person would recognise. */
export function keywordLabel(value: string | number): string {
  const text = String(value);
  const known = KEYWORD_LABELS[text];
  if (known)
    return known;
  const media = MEDIA_RE.exec(text);
  if (media) {
    const [, name, width, height, unit] = media;
    const pretty = /^[a-z]{1,3}\d{0,2}$/.test(name!) ? name!.toUpperCase() : name!.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase());
    return `${pretty} (${width}×${height} ${unit})`;
  }
  return text.replace(/[-_]/g, " ").replace(/^\w/, c => c.toUpperCase());
}

/** The few options ordinary users actually decide, shown up front; everything else folds under "More options". */
export const PRIMARY_ATTRIBUTES = ["copies", "sides", "print-color-mode", "media", "print-quality", "finishings"];
