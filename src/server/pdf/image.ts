import type { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { degrees, PDFDocument } from "pdf-lib";

/**
 * pdf-lib decodes a PNG to raw pixels inside this process, around ten bytes for each, so it is the
 * pixels that are budgeted: a few hundred kilobytes of flat colour can unpack to gigabytes. A JPEG
 * is embedded as it is and never decoded.
 */
const MAX_PNG_PIXELS = 32_000_000;

/** The pixel count a PNG's header states, which is where a decoder would take it from; 0 for a file with no such header. */
function pngPixels(bytes: Buffer): number {
  return bytes.length >= 24 && bytes.subarray(12, 16).toString("latin1") === "IHDR" ? bytes.readUInt32BE(16) * bytes.readUInt32BE(20) : 0;
}

/** A JPEG's EXIF orientation, 1 to 8; 1, the pixels as stored, where it states none it can be read from. */
function jpegOrientation(bytes: Buffer): number {
  try {
    let at = 2;
    while (bytes[at] === 0xFF && bytes[at + 1] !== 0xDA) {
      const tiff = at + 10;
      if (bytes[at + 1] === 0xE1 && bytes.subarray(at + 4, tiff).toString("latin1") === "Exif\0\0") {
        const little = bytes.subarray(tiff, tiff + 2).toString("latin1") === "II";
        const short = (offset: number) => little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
        const directory = tiff + (little ? bytes.readUInt32LE(tiff + 4) : bytes.readUInt32BE(tiff + 4));
        for (let entry = directory + 2; entry < directory + 2 + short(directory) * 12; entry += 12) {
          if (short(entry) === 0x0112)
            return short(entry + 8) >= 1 && short(entry + 8) <= 8 ? short(entry + 8) : 1;
        }
        return 1;
      }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  catch {
    // A header cut short states nothing.
  }
  return 1;
}

/** What each EXIF orientation asks of the stored pixels: a mirror for four of them, then this many quarter turns clockwise. */
const QUARTER_TURNS = [0, 0, 0, 2, 2, 3, 1, 1, 3];
const MIRRORED = new Set([2, 4, 5, 7]);

/**
 * A PNG or JPEG as a one-page PDF, which is the only kind of document Ghostscript's PDF interpreter
 * reads. The page is the image at a point per pixel: an image has no paper size of its own, so
 * whatever prints it has to scale it to a sheet. A camera's JPEG is stored the way the sensor was
 * held, so the page is turned to the way it is meant to be seen.
 */
export async function imageToPdf(imagePath: string, format: string): Promise<Uint8Array> {
  const bytes = await readFile(imagePath);
  const png = format === "image/png";
  if (png && pngPixels(bytes) > MAX_PNG_PIXELS)
    throw new Error(`the image is ${Math.round(pngPixels(bytes) / 1_000_000)} megapixels, and a PNG can be converted at up to ${MAX_PNG_PIXELS / 1_000_000}; save it as a JPEG or a PDF and print that`);
  const pdf = await PDFDocument.create();
  let image;
  try {
    image = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  }
  catch (err) {
    throw new Error(`could not read the image: ${(err as Error).message}`);
  }
  const orientation = png ? 1 : jpegOrientation(bytes);
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, MIRRORED.has(orientation)
    ? { x: image.width, y: 0, width: -image.width, height: image.height }
    : { x: 0, y: 0, width: image.width, height: image.height });
  page.setRotation(degrees(QUARTER_TURNS[orientation]! * 90));
  return pdf.save();
}
