/** Lays a PDF's pages out on sheets, as vectors: each page becomes a form drawn into its cell. */
import type { PDFEmbeddedPage, PDFPage } from "pdf-lib";
import type { Layout, Size } from "../../shared/layout.js";
import { degrees, EncryptedPDFError, PDFDict, PDFDocument, PDFName, PDFNumber, rgb } from "pdf-lib";
import { cellSize, placePages, sheetCount, sheetFor } from "../../shared/layout.js";

const CROP_MARK_LENGTH = 10;
const CROP_MARK_OFFSET = 3;

interface SourcePage {
  /** Null for a page with nothing on it, which still takes its cell. */
  embedded: PDFEmbeddedPage | null;
  /** The page's own box, before its /Rotate. */
  box: Size;
  /** Quarter turns clockwise a reader gives the page, from its /Rotate. */
  quarterTurns: number;
  /** The page's size the way a reader shows it. */
  shown: Size;
}

export interface PageRange {
  min: number;
  max: number;
}

/** Annotation flags: one that is hidden, or lacks the print flag, is left off the printed page. */
const HIDDEN = 2;
const PRINT = 4;

/**
 * A page drawn as a form brings its content and leaves its annotations behind. Filled-in form
 * fields are annotations, so they are drawn into their pages first; a form that cannot be is refused
 * rather than printed empty. Fields that are hidden or not set to print are left out, as they would
 * be on paper: pdf-lib would draw them all.
 */
function flattenForm(document: PDFDocument): void {
  const acroForm = document.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acroForm)
    return;
  // Asked before `getForm`, which quietly deletes the XFA it cannot read.
  const xfa = acroForm.has(PDFName.of("XFA"));
  const form = document.getForm();
  const fields = form.getFields();
  if (fields.length === 0) {
    // An XFA-only form keeps its content where pdf-lib cannot reach it; its page is a placeholder saying so.
    if (xfa)
      throw new Error("this PDF is an XFA form, which a layout cannot draw; print it from Adobe Reader, or save a flattened copy first");
    return;
  }
  for (const field of fields) {
    const widgets = field.acroField.getWidgets();
    for (let at = widgets.length - 1; at >= 0; at--) {
      const flags = widgets[at]!.getFlags();
      if ((flags & HIDDEN) !== 0 || (flags & PRINT) === 0)
        field.acroField.removeWidget(at);
    }
  }
  try {
    form.flatten();
  }
  catch (err) {
    throw new Error(`could not draw this PDF's filled-in fields into a layout: ${(err as Error).message}`);
  }
}

/** Whether a page still carries an annotation that prints, such as a stamp or a typed comment, which a layout would silently leave out. */
function printsAnnotation(page: PDFPage): boolean {
  const annotations = page.node.Annots();
  for (let at = 0; at < (annotations?.size() ?? 0); at++) {
    const annotation = annotations!.lookupMaybe(at, PDFDict);
    const subtype = annotation?.get(PDFName.of("Subtype"));
    const flags = annotation?.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
    // Links and pop-ups draw nothing; anything else prints only with its Print flag set and its Hidden flag clear.
    if (annotation && subtype !== PDFName.of("Link") && subtype !== PDFName.of("Popup") && (flags & PRINT) !== 0 && (flags & HIDDEN) === 0)
      return true;
  }
  return false;
}

/** A file that only looks like a PDF loads without complaint and fails when its pages are asked for, so both are tried here. */
async function loadPages(bytes: Uint8Array): Promise<PDFPage[]> {
  let document: PDFDocument;
  let pages: PDFPage[];
  try {
    document = await PDFDocument.load(bytes);
    pages = document.getPages();
  }
  catch (err) {
    if (err instanceof EncryptedPDFError)
      throw new Error("a layout cannot be applied to a password-protected PDF");
    throw new Error(`could not read the PDF to lay it out: ${(err as Error).message}`);
  }
  flattenForm(document);
  if (pages.some(printsAnnotation))
    throw new Error("this PDF has stamps or comments set to print, which a layout would leave out; print it without a layout, or save a flattened copy first");
  return pages;
}

/** The box a reader shows and prints: the crop box where it lies inside the page, the whole page otherwise. */
function visibleBox(page: PDFPage): { x: number; y: number; width: number; height: number } {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : media;
}

function drawCropMarks(sheet: PDFPage, x: number, y: number, width: number, height: number): void {
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    sheet.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.25, color: rgb(0, 0, 0) });
  const near = CROP_MARK_OFFSET;
  const far = CROP_MARK_OFFSET + CROP_MARK_LENGTH;
  const top = y + height;
  const right = x + width;
  line(x - far, top, x - near, top);
  line(x, top + near, x, top + far);
  line(right + near, top, right + far, top);
  line(right, top + near, right, top + far);
  line(x - far, y, x - near, y);
  line(x, y - near, x, y - far);
  line(right + near, y, right + far, y);
  line(right, y - near, right, y - far);
}

/**
 * Draws a page the way a reader shows it, bottom-left corner at (x, y), with a further quarter turn
 * when the layout asks for one. A form is drawn from its own origin, so each turn moves the anchor
 * to the corner the page's origin ends up in.
 */
function drawSource(sheet: PDFPage, source: SourcePage, x: number, y: number, scale: number, turned: boolean): void {
  if (!source.embedded)
    return;
  const width = source.box.width * scale;
  const height = source.box.height * scale;
  const quarters = ((turned ? 1 : 0) - source.quarterTurns + 4) % 4;
  const anchor = [{ x, y }, { x: x + height, y }, { x: x + width, y: y + height }, { x, y: y + width }][quarters]!;
  sheet.drawPage(source.embedded, { ...anchor, width, height, rotate: degrees(quarters * 90) });
}

/**
 * The document with its pages placed on sheets of `paper`, turned whichever way suits the first
 * page. With no paper to go by, the sheet grows to hold the grid at the first page's size. `ranges`
 * picks the document's pages, counted from 1, before they are placed: left to the printer, a page
 * range would count sheets.
 */
export async function imposePdf(bytes: Uint8Array, layout: Layout, paper: Size | null, ranges?: PageRange[]): Promise<Uint8Array> {
  const all = await loadPages(bytes);
  const pages = ranges ? all.filter((_, at) => ranges.some(range => at + 1 >= range.min && at + 1 <= range.max)) : all;
  if (pages.length === 0)
    throw new Error(ranges && all.length > 0 ? "the page range leaves no pages to lay out" : "the PDF has no pages to lay out");
  const output = await PDFDocument.create();
  // One call for every page, so a font or image they share is copied across once rather than per page.
  const drawable = pages.filter(page => page.node.Contents() !== undefined);
  const embedded = await output.embedPages(drawable, drawable.map((page) => {
    const box = visibleBox(page);
    return { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height };
  }));
  const sources: SourcePage[] = pages.map((page) => {
    const { width, height } = visibleBox(page);
    const quarterTurns = ((Math.round(page.getRotation().angle / 90) % 4) + 4) % 4;
    const at = drawable.indexOf(page);
    return {
      embedded: at < 0 ? null : embedded[at]!,
      box: { width, height },
      quarterTurns,
      shown: quarterTurns % 2 === 1 ? { width: height, height: width } : { width, height },
    };
  });

  const first = sources[0]!.shown;
  const sheet = paper ? sheetFor(paper, layout, first) : { width: first.width * layout.columns, height: first.height * layout.rows };
  const cell = cellSize(sheet, layout);
  if (cell.width <= 0 || cell.height <= 0)
    throw new Error("the layout's margin and gaps leave no room on the sheet for a page");

  const shown = sources.map(source => source.shown);
  for (let sheetIndex = 0; sheetIndex < sheetCount(sources.length, layout); sheetIndex++) {
    const out = output.addPage([sheet.width, sheet.height]);
    for (const { page, x, y, width, height, scale, turned } of placePages(sheet, layout, shown, sheetIndex)) {
      drawSource(out, sources[page]!, x, y, scale, turned);
      if (layout.borders)
        out.drawRectangle({ x, y, width, height, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
      if (layout.cropMarks)
        drawCropMarks(out, x, y, width, height);
    }
  }
  // A cross-reference table rather than object streams: printers that read PDF themselves are not all that modern.
  return output.save({ useObjectStreams: false });
}
