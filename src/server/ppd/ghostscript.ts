/** PDF to DSC PostScript through Ghostscript's ps2write device. */
import type { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

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
  const args = ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-dPDFSTOPONERROR", "-sDEVICE=ps2write", "-dLanguageLevel=3"];
  if (opts.paper)
    args.push(`-dDEVICEWIDTHPOINTS=${Math.round(opts.paper.width)}`, `-dDEVICEHEIGHTPOINTS=${Math.round(opts.paper.height)}`, "-dFIXEDMEDIA", "-dPDFFitPage");
  // Invoke the PDF interpreter explicitly: a forged PDF header must never execute PostScript.
  // Pass the path as a string parameter rather than interpolating it into PostScript code.
  args.push("-sOutputFile=%stdout", "-sstdout=%stderr", `--permit-file-read=${file}`, `-sPDFFile=${file}`, "-c", `${opts.margins ? fitInsideMargins(opts.margins) : ""} PDFFile (r) file runpdf`);
  try {
    const { stdout } = await run("gs", args, {
      encoding: "buffer",
      timeout: opts.timeoutMs ?? 60_000,
      maxBuffer: opts.maxOutputBytes ?? 64 * 1024 * 1024,
      killSignal: "SIGKILL",
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return stdout;
  }
  catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer; signal?: string };
    if (e.code === "ENOENT")
      throw new Error("Ghostscript (gs) is not installed on the server; PostScript mode needs it");
    if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      throw new Error("Ghostscript failed: conversion exceeded the output size limit");
    if (opts.signal?.aborted)
      throw new Error("Ghostscript failed: conversion canceled");
    if (e.signal === "SIGKILL")
      throw new Error("Ghostscript failed: conversion timed out");
    throw new Error(`Ghostscript failed: ${String(e.stderr || e.message).trim().split("\n").slice(-3).join(" ")}`);
  }
}
