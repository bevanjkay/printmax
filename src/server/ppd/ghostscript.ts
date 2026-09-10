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
 * costs a few megabytes whatever the PDF weighed: the ceiling is on pages, not on the upload.
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
  /** Force this paper size (points) and scale pages to fit it, as a driver's "fit to paper" does. */
  paper?: { width: number; height: number };
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

export async function pdfToPostScript(pdfPath: string, opts: ConvertOptions = {}): Promise<Buffer> {
  const file = path.resolve(pdfPath);
  // A booklet's PostScript runs to hundreds of megabytes, far past what a pipe buffer can hold,
  // so Ghostscript writes it to a file we then measure before taking it into memory.
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-ps-"));
  const out = path.join(dir, "document.ps");
  const args = ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-dPDFSTOPONERROR", "-sDEVICE=ps2write", "-dLanguageLevel=3"];
  if (opts.paper)
    args.push(`-dDEVICEWIDTHPOINTS=${Math.round(opts.paper.width)}`, `-dDEVICEHEIGHTPOINTS=${Math.round(opts.paper.height)}`, "-dFIXEDMEDIA", "-dPDFFitPage");
  // Invoke the PDF interpreter explicitly: a forged PDF header must never execute PostScript.
  // Pass the path as a string parameter rather than interpolating it into PostScript code.
  args.push(`-sOutputFile=${out}`, "-sstdout=%stderr", `--permit-file-read=${file}`, `-sPDFFile=${file}`, "-c", `${opts.margins ? fitInsideMargins(opts.margins) : ""} PDFFile (r) file runpdf`);
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
    await rm(dir, { recursive: true, force: true });
  }
}
