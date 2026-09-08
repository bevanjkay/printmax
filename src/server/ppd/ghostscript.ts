/** PDF to DSC PostScript through Ghostscript's ps2write device. */
import type { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

let available: Promise<boolean> | undefined;

export function ghostscriptAvailable(): Promise<boolean> {
  available ??= run("gs", ["--version"]).then(() => true, () => false);
  return available;
}

export interface ConvertOptions {
  /** Force this paper size (points) and scale pages to fit it, as a driver's "fit to paper" does. */
  paper?: { width: number; height: number };
  /** Shrink each page uniformly and centre it inside these margins (points), as a driver keeps to the printable area. */
  margins?: { left: number; bottom: number; right: number; top: number };
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
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-ps-"));
  const out = path.join(dir, "out.ps");
  const args = ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=ps2write", "-dLanguageLevel=3"];
  if (opts.paper)
    args.push(`-dDEVICEWIDTHPOINTS=${Math.round(opts.paper.width)}`, `-dDEVICEHEIGHTPOINTS=${Math.round(opts.paper.height)}`, "-dFIXEDMEDIA", "-dPDFFitPage");
  args.push(`-sOutputFile=${out}`);
  if (opts.margins)
    args.push("-c", fitInsideMargins(opts.margins), "-f");
  args.push(pdfPath);
  try {
    await run("gs", args, { maxBuffer: 16 * 1024 * 1024 });
    return await readFile(out);
  }
  catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT")
      throw new Error("Ghostscript (gs) is not installed on the server; PostScript mode needs it");
    throw new Error(`Ghostscript failed: ${(e.stderr ?? e.message).trim().split("\n").slice(-3).join(" ")}`);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
}
