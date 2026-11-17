/** Lays a PDF's pages out on sheets, as vectors: each page becomes a form drawn into its cell. */
import type { PDFEmbeddedPage, PDFPage } from "pdf-lib";
import type { Layout, Size } from "../../shared/layout.js";
import { degrees, EncryptedPDFError, PDFDocument, rgb } from "pdf-lib";
import { cellPosition, cellSize, pageInCell, POINTS_PER_MM, sheetCount, sheetFor, turnsPage } from "../../shared/layout.js";

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

/** A file that only looks like a PDF loads without complaint and fails when its pages are asked for, so both are tried here. */
async function loadPages(bytes: Uint8Array): Promise<PDFPage[]> {
  try {
    return (await PDFDocument.load(bytes)).getPages();
  }
  catch (err) {
    if (err instanceof EncryptedPDFError)
      throw new Error("a layout cannot be applied to a password-protected PDF");
    throw new Error(`could not read the PDF to lay it out: ${(err as Error).message}`);
  }
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
 * page. With no paper to go by, the sheet grows to hold the grid at the first page's size.
 */
export async function imposePdf(bytes: Uint8Array, layout: Layout, paper: Size | null): Promise<Uint8Array> {
  const pages = await loadPages(bytes);
  if (pages.length === 0)
    throw new Error("the PDF has no pages to lay out");
  const output = await PDFDocument.create();
  // One call for every page, so a font or image they share is copied across once rather than per page.
  const drawable = pages.filter(page => page.node.Contents() !== undefined);
  const embedded = await output.embedPages(drawable, drawable.map((page) => {
    const box = page.getMediaBox();
    return { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height };
  }));
  const sources: SourcePage[] = pages.map((page) => {
    const { width, height } = page.getMediaBox();
    const quarterTurns = ((Math.round(page.getRotation().angle / 90) % 4) + 4) % 4;
    const at = drawable.indexOf(page);
    return {
      embedded: at < 0 ? null : embedded[at]!,
      box: { width, height },
      quarterTurns,
      shown: quarterTurns % 2 === 1 ? { width: height, height: width } : { width, height },
    };
  });

  const { columns, rows } = layout;
  const first = sources[0]!.shown;
  const sheet = paper ? sheetFor(paper, layout, first) : { width: first.width * columns, height: first.height * rows };
  const cell = cellSize(sheet, layout);
  if (cell.width <= 0 || cell.height <= 0)
    throw new Error("the layout's margin and gaps leave no room on the sheet for a page");
  const margin = layout.margin * POINTS_PER_MM;
  const gap = layout.gap * POINTS_PER_MM;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  for (let sheetIndex = 0; sheetIndex < sheetCount(sources.length, layout); sheetIndex++) {
    const placed = [];
    for (let cellIndex = 0; cellIndex < columns * rows; cellIndex++) {
      const source = sources[pageInCell(sheetIndex, cellIndex, layout)];
      if (!source)
        continue;
      const turned = turnsPage(cell, source.shown, layout);
      placed.push({
        source,
        turned,
        ...cellPosition(cellIndex, layout),
        width: turned ? source.shown.height : source.shown.width,
        height: turned ? source.shown.width : source.shown.height,
      });
    }

    // Fitted, every cell is the same size; at their own size, each column and row is as large as its largest page.
    const widths = Array.from<number>({ length: columns }).fill(layout.fit ? cell.width : 0);
    const heights = Array.from<number>({ length: rows }).fill(layout.fit ? cell.height : 0);
    if (!layout.fit) {
      for (const page of placed) {
        widths[page.column] = Math.max(widths[page.column]!, page.width);
        heights[page.row] = Math.max(heights[page.row]!, page.height);
      }
    }
    const left = margin + Math.max(0, (sheet.width - margin * 2 - sum(widths) - gap * (columns - 1)) / 2);
    const top = margin + Math.max(0, (sheet.height - margin * 2 - sum(heights) - gap * (rows - 1)) / 2);

    const out = output.addPage([sheet.width, sheet.height]);
    for (const page of placed) {
      const scale = layout.fit ? Math.min(cell.width / page.width, cell.height / page.height) : 1;
      const width = page.width * scale;
      const height = page.height * scale;
      const x = left + sum(widths.slice(0, page.column)) + gap * page.column + (widths[page.column]! - width) / 2;
      const y = sheet.height - top - sum(heights.slice(0, page.row + 1)) - gap * page.row + (heights[page.row]! - height) / 2;
      drawSource(out, page.source, x, y, scale, page.turned);
      if (layout.borders)
        out.drawRectangle({ x, y, width, height, borderWidth: 0.5, borderColor: rgb(0, 0, 0) });
      if (layout.cropMarks)
        drawCropMarks(out, x, y, width, height);
    }
  }
  // A cross-reference table rather than object streams: printers that read PDF themselves are not all that modern.
  return output.save({ useObjectStreams: false });
}
