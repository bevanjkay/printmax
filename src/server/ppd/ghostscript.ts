/** PDF to DSC PostScript through Ghostscript's ps2write device. */
import type { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * ps2write writes every image at its source resolution with no lossy re-encoding, so a colour page
 * costs a few megabytes whatever the PDF weighed: the ceiling is on pages, not on the upload. A page
 * it cannot keep as vectors is rasterised whole instead, and then `resolution` sets what it costs.
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/** Ghostscript's own messages, which are all that reaches us now that the document goes to a file. */
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

let available: Promise<boolean> | undefined;

export function ghostscriptAvailable(): Promise<boolean> {
  available ??= run("gs", ["--version"], { timeout: 5000, killSignal: "SIGKILL" }).then(() => true, () => false);
  return available;
}

export interface ConvertOptions {
  /** Shrink each page uniformly and centre it inside these margins (points). */
  margins?: { left: number; bottom: number; right: number; top: number };
  signal?: AbortSignal;
  /** Upper bounds for conversion time and generated PostScript, independent of upload size. */
  timeoutMs?: number;
  maxOutputBytes?: number;
  /**
   * Force this paper size (points). Without it each page carries its own size into the PostScript,
   * and the printer asks for that paper rather than the one the PPD's PageSize chose.
   */
  paper?: { width: number; height: number };
  /** Scale each page to `paper`, as a driver's "fit to paper" does. Off, pages keep their own size on that sheet. */
  fitToPaper?: boolean;
  /**
   * The document's page size, which lets an unfitted page be centred on `paper` and turned to suit
   * it. Left unset such a page sits in the sheet's bottom-left corner, where Ghostscript puts it.
   */
  documentPage?: { width: number; height: number };
  /**
   * Dots per inch for the raster ps2write cannot keep as vectors. Left unset it uses its own 720 dpi
   * default, which on a large sheet costs hundreds of megabytes of detail the engine cannot image.
   */
  resolution?: { x: number; y: number };
}

/**
 * A page-device Install hook, so the transform becomes part of the default matrix that every page
 * starts from. It reads the page size at install time, so pages of different sizes each fit their own box.
 */
function fitInsideMargins(m: NonNullable<ConvertOptions["margins"]>): string {
  const n = (v: number) => (Math.round(v * 100) / 100).toString();
  return [
    `/L ${n(m.left)} def /B ${n(m.bottom)} def /R ${n(m.right)} def /T ${n(m.top)} def`,
    "<< /Install {",
    "  currentpagedevice /PageSize get aload pop /H exch def /W exch def",
    "  /s W L sub R sub W div H B sub T sub H div 2 copy gt { exch } if pop def",
    "  L W L sub R sub W s mul sub 2 div add B H B sub T sub H s mul sub 2 div add translate",
    "  s s scale",
    "} bind >> setpagedevice",
  ].join(" ");
}

/**
 * Places a page at its own size on the sheet: turned a quarter when that is the only way it fits,
 * shrunk only when margins are being kept, and centred either way. Scales are capped at 1 before
 * they are compared, so a page that already fits both ways is left the way round it was made.
 */
function placeOnPaper(page: NonNullable<ConvertOptions["documentPage"]>, margins: ConvertOptions["margins"]): string {
  const n = (v: number) => (Math.round(v * 100) / 100).toString();
  const m = margins ?? { left: 0, bottom: 0, right: 0, top: 0 };
  return [
    `/PW ${n(page.width)} def /PH ${n(page.height)} def`,
    `/L ${n(m.left)} def /B ${n(m.bottom)} def /R ${n(m.right)} def /T ${n(m.top)} def`,
    "<< /Install {",
    "  currentpagedevice /PageSize get aload pop /SH exch def /SW exch def",
    "  /AW SW L sub R sub def /AH SH B sub T sub def",
    "  /SU AW PW div AH PH div 2 copy gt { exch } if pop def SU 1 gt { /SU 1 def } if",
    "  /SR AW PH div AH PW div 2 copy gt { exch } if pop def SR 1 gt { /SR 1 def } if",
    "  SR SU gt { /FW PH def /FH PW def /ROT true def /S SR def } { /FW PW def /FH PH def /ROT false def /S SU def } ifelse",
    margins ? "" : "  /S 1 def",
    "  /OX L AW FW S mul sub 2 div add def /OY B AH FH S mul sub 2 div add def",
    "  ROT { OX FW S mul add OY translate 90 rotate } { OX OY translate } ifelse",
    "  S S scale",
    "} bind >> setpagedevice",
  ].join(" ");
}

/** Reads every page's box and rotation without drawing any of it. */
const PAGE_BOXES = "PDFFile (r) file runpdfbegin 1 1 pdfpagecount { pdfgetpage dup /MediaBox get aload pop"
  + " /y1 exch def /x1 exch def /y0 exch def /x0 exch def /Rotate .knownget not { 0 } if /rot exch def"
  + " x1 x0 sub 20 string cvs print ( ) print y1 y0 sub 20 string cvs print ( ) print rot 20 string cvs print (\n) print flush } for runpdfend";

/**
 * The largest page in a PDF, in points, turned as its own /Rotate asks. Best effort: a document
 * Ghostscript cannot walk simply goes unmeasured, and its pages are placed as they always were.
 */
export async function largestPdfPage(pdfPath: string, opts: Pick<ConvertOptions, "signal" | "timeoutMs"> = {}): Promise<{ width: number; height: number } | null> {
  const file = path.resolve(pdfPath);
  try {
    const { stdout } = await run("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-dSAFER", `--permit-file-read=${file}`, `-sPDFFile=${file}`, "-c", PAGE_BOXES], {
      encoding: "utf8",
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: MAX_MESSAGE_BYTES,
      killSignal: "SIGKILL",
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    let largest: { width: number; height: number } | null = null;
    for (const line of stdout.split("\n")) {
      const [w, h, rot] = line.trim().split(/\s+/).map(Number);
      if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
        continue;
      const turned = Math.abs(Math.round((rot ?? 0) / 90) % 2) === 1;
      const size = turned ? { width: h, height: w } : { width: w, height: h };
      if (!largest || size.width * size.height > largest.width * largest.height)
        largest = size;
    }
    return largest;
  }
  catch {
    return null;
  }
}

export async function pdfToPostScript(pdfPath: string, opts: ConvertOptions = {}): Promise<Buffer> {
  const file = path.resolve(pdfPath);
  // A booklet's PostScript runs to hundreds of megabytes, far past what a pipe buffer can hold,
  // so Ghostscript writes it to a file we then measure before taking it into memory.
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-ps-"));
  const out = path.join(dir, "document.ps");
  const args = ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-dPDFSTOPONERROR", "-sDEVICE=ps2write", "-dLanguageLevel=3"];
  if (opts.resolution)
    args.push(`-r${Math.round(opts.resolution.x)}x${Math.round(opts.resolution.y)}`);
  if (opts.paper) {
    args.push(`-dDEVICEWIDTHPOINTS=${Math.round(opts.paper.width)}`, `-dDEVICEHEIGHTPOINTS=${Math.round(opts.paper.height)}`, "-dFIXEDMEDIA");
    if (opts.fitToPaper)
      args.push("-dPDFFitPage");
  }
  // Invoke the PDF interpreter explicitly: a forged PDF header must never execute PostScript.
  // Pass the path as a string parameter rather than interpolating it into PostScript code.
  // An unfitted page is placed by us, margins and all; a fitted one is already on the sheet and only
  // needs the margin shrink. Both are one Install hook, because the second would replace the first.
  const place = opts.paper && !opts.fitToPaper && opts.documentPage
    ? placeOnPaper(opts.documentPage, opts.margins)
    : opts.margins ? fitInsideMargins(opts.margins) : "";
  args.push(`-sOutputFile=${out}`, "-sstdout=%stderr", `--permit-file-read=${file}`, `-sPDFFile=${file}`, "-c", `${place} PDFFile (r) file runpdf`);
  try {
    try {
      await run("gs", args, {
        encoding: "buffer",
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: MAX_MESSAGE_BYTES,
        killSignal: "SIGKILL",
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    }
    catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: Buffer; signal?: string };
      if (e.code === "ENOENT")
        throw new Error("Ghostscript (gs) is not installed on the server; PostScript mode needs it");
      if (opts.signal?.aborted)
        throw new Error("Ghostscript failed: conversion canceled");
      if (e.signal === "SIGKILL")
        throw new Error("Ghostscript failed: conversion timed out");
      throw new Error(`Ghostscript failed: ${String(e.stderr || e.message).trim().split("\n").slice(-3).join(" ")}`);
    }
    const limit = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const { size } = await stat(out);
    if (size > limit)
      throw new Error(`Ghostscript failed: the PostScript for this document is ${mb(size)}, over the ${mb(limit)} output size limit`);
    return await readFile(out);
  }
  finally {
    try {
      await rm(dir, { recursive: true, force: true });
    }
    catch {
      // Best-effort cleanup; don't mask conversion errors.
    }
  }
}
