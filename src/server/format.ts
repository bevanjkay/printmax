import type { Buffer } from "node:buffer";

const SIGNATURES: Array<{ format: string; magic: number[]; extension: string }> = [
  { format: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46], extension: ".pdf" },
  { format: "image/png", magic: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], extension: ".png" },
  { format: "image/jpeg", magic: [0xFF, 0xD8, 0xFF], extension: ".jpg" },
];

export const SUPPORTED_FORMATS = SIGNATURES.map(s => s.format);

/** Identifies the document format from its leading bytes. Declared MIME types are not trusted. */
export function sniffFormat(head: Buffer): { format: string; extension: string } | undefined {
  for (const sig of SIGNATURES) {
    if (head.length >= sig.magic.length && sig.magic.every((b, i) => head[i] === b))
      return { format: sig.format, extension: sig.extension };
  }
  return undefined;
}
