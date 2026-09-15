import { Buffer } from "node:buffer";
import { expect, it } from "vitest";
import { pdfPageSize } from "../src/client/util.js";

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));

it("reads the largest page box a PDF puts in the clear, and nothing it hides", () => {
  expect(pdfPageSize(bytes("%PDF-1.4\n/MediaBox [0 0 595 842]\n"))).toEqual({ width: 595, height: 842 });
  // A mixed document is measured by its biggest page, which is the one at risk of being cut.
  expect(pdfPageSize(bytes("/MediaBox [0 0 595 842] /MediaBox[0 0 842 1191]"))).toEqual({ width: 842, height: 1191 });
  // An origin that is not 0 0 still describes a page of the same size.
  expect(pdfPageSize(bytes("/MediaBox [ 10 20 605 862 ]"))).toEqual({ width: 595, height: 842 });
  expect(pdfPageSize(bytes("%PDF-1.7\nno page boxes here\n"))).toBeNull();
  expect(pdfPageSize(bytes("/MediaBox [0 0 0 842]"))).toBeNull();
});
