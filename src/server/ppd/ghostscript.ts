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
}

export async function pdfToPostScript(pdfPath: string, opts: ConvertOptions = {}): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-ps-"));
  const out = path.join(dir, "out.ps");
  const args = ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=ps2write", "-dLanguageLevel=3"];
  if (opts.paper)
    args.push(`-dDEVICEWIDTHPOINTS=${Math.round(opts.paper.width)}`, `-dDEVICEHEIGHTPOINTS=${Math.round(opts.paper.height)}`, "-dFIXEDMEDIA", "-dPDFFitPage");
  args.push(`-sOutputFile=${out}`, pdfPath);
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
