import type { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Raster {
  /** The page's size in points. */
  width: number;
  height: number;
  /** The colour at a point measured from the page's bottom-left corner, as PDF measures. */
  at: (x: number, y: number) => [number, number, number];
}

/** One page of a PDF drawn by Ghostscript at a pixel per point, to see what landed where. */
export async function rasterise(pdf: Uint8Array, page = 1): Promise<Raster> {
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-raster-"));
  const file = path.join(dir, "document.pdf");
  await writeFile(file, pdf);
  try {
    const { stdout } = await run("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-r72", `-dFirstPage=${page}`, `-dLastPage=${page}`, "-sDEVICE=ppmraw", "-o", "-", file], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
    // Ghostscript signs its work with a comment line between the magic number and the size.
    const header = /^P6\s+(?:#[^\n]*\n)*(\d+)\s+(\d+)\s+255\s/.exec((stdout as Buffer).subarray(0, 200).toString("latin1"))!;
    const [width, height] = [Number(header[1]), Number(header[2])];
    const pixels = (stdout as Buffer).subarray(header[0].length);
    return {
      width,
      height,
      at: (x, y) => {
        const offset = (Math.min(height - 1, Math.max(0, Math.round(height - y))) * width + Math.min(width - 1, Math.max(0, Math.round(x)))) * 3;
        return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
      },
    };
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
}
