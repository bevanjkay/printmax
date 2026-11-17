import type { Layout } from "../src/shared/layout.js";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { degrees, PDFDocument, PDFName, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { summariseOptions } from "../src/client/util.js";
import { formFor } from "../src/server/form.js";
import { paperFor } from "../src/server/paper.js";
import { imposePdf } from "../src/server/pdf/imposition.js";
import { ghostscriptAvailable, measurePdf, pdfToPostScript } from "../src/server/ppd/ghostscript.js";
import { parsePpd } from "../src/server/ppd/parser.js";
import { jobWarnings, validateJobOptions } from "../src/server/validation.js";
import { isOwnOption, isPrimaryOption, mediaSize, paperChoice, withoutOwnOptions } from "../src/shared/attributes.js";
import { arrangementOptions, cellPosition, describeLayout, describeRun, describeTemplate, LAYOUT_DEFAULTS, LAYOUT_TEMPLATES, layoutErrors, layoutFrom, layoutOptions, pageInCell, PAGES_PER_SHEET, pageScale, placePages, readLayout, sameArrangement, sheetCount, sheetFor } from "../src/shared/layout.js";
import { rasterise } from "./helpers/raster.js";

const ppd = parsePpd(readFileSync(new URL("../fixtures/toshiba-e-studio-excerpt.ppd", import.meta.url), "utf8"));
const caps = JSON.parse(readFileSync(new URL("../fixtures/toshiba-e-studio3515ac.json", import.meta.url), "utf8"));
const postScript = { caps: {}, ppd, mode: "postscript" as const, optionDefaults: {} };
const ipp = { caps, ppd: null, mode: "ipp" as const, optionDefaults: {} };

const A4 = { width: 595, height: 842 };
const A5 = { width: 420, height: 595 };
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

const layout = (changes: Partial<Layout> = {}): Layout => ({ ...LAYOUT_DEFAULTS, columns: 2, rows: 2, ...changes });

/** A PDF of flat-coloured pages, so a raster of the sheet shows which page landed in which cell. */
async function colouredPages(colours: number[][], size = A5): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const [r, g, b] of colours)
    pdf.addPage([size.width, size.height]).drawRectangle({ x: 0, y: 0, ...size, color: rgb(r! / 255, g! / 255, b! / 255) });
  return pdf.save();
}

async function sheetSizes(pdf: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  return (await PDFDocument.load(pdf)).getPages().map(page => page.getSize());
}

describe("layout options", () => {
  it("reads a layout from the option map, and none from one that leaves each page on its own sheet", () => {
    expect(layoutFrom({})).toBeNull();
    expect(layoutFrom({ "layout-columns": 1, "layout-rows": 1, "layout-repeat": "true", "layout-margin": 0 })).toBeNull();
    expect(layoutFrom({ "layout-columns": 2 })).toEqual({ ...LAYOUT_DEFAULTS, columns: 2 });
    expect(layoutFrom({ "layout-columns": "3", "layout-rows": 2, "layout-order": "down", "layout-repeat": true, "layout-fit": "false", "layout-rotate": "true", "layout-margin": 0, "layout-gap": "10", "layout-borders": "true" }))
      .toEqual({ columns: 3, rows: 2, order: "down", repeat: true, fit: false, rotate: true, margin: 0, gap: 10, cropMarks: false, borders: true });
    // A single page with marks around it is still something to draw.
    expect(layoutFrom({ "layout-crop-marks": "true" })).toMatchObject({ columns: 1, rows: 1, cropMarks: true });
    // A form asks while a value is half typed, so the unreadable falls back rather than throwing.
    expect(layoutFrom({ "layout-columns": 99, "layout-rows": "two", "layout-gap": -4 })).toMatchObject({ columns: 10, rows: 1, gap: 0 });
  });

  it("says what is wrong with layout options, including ones it has never heard of", () => {
    expect(layoutErrors({ "layout-columns": 2, "layout-rows": "2", "layout-order": "down", "layout-repeat": "true", "layout-margin": 0, "copies": 2 })).toEqual([]);
    expect(layoutErrors({ "layout-columns": 0 })[0]).toMatch(/"layout-columns" must be a whole number from 1 to 10/);
    expect(layoutErrors({ "layout-rows": 2.5 })[0]).toMatch(/whole number/);
    expect(layoutErrors({ "layout-gap": 26 })[0]).toMatch(/from 0 to 25/);
    expect(layoutErrors({ "layout-order": "sideways" })[0]).toMatch(/"across" or "down"/);
    expect(layoutErrors({ "layout-repeat": "sometimes" })[0]).toMatch(/must be true or false/);
    expect(layoutErrors({ "layout-bleed": 3 })[0]).toMatch(/is not a layout option/);
  });

  it("fills a sheet across or down, and counts sheets by pages or, repeated, one per page", () => {
    expect([0, 1, 2, 3, 4, 5].map(cell => cellPosition(cell, layout({ columns: 3, rows: 2 })))).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ]);
    expect([0, 1, 2, 3].map(cell => cellPosition(cell, layout({ columns: 3, rows: 2, order: "down" })))).toEqual([
      { row: 0, column: 0 },
      { row: 1, column: 0 },
      { row: 0, column: 1 },
      { row: 1, column: 1 },
    ]);
    expect(sheetCount(9, layout())).toBe(3);
    expect(sheetCount(9, layout({ repeat: true }))).toBe(9);
    expect(pageInCell(1, 2, layout())).toBe(6);
    expect(pageInCell(1, 2, layout({ repeat: true }))).toBe(1);
  });

  it("turns the paper on its side when that gives the pages more room", () => {
    const sideways = { width: 842, height: 595 };
    // Two upright pages side by side want the sheet on its side; stacked, or four to a sheet, they want it upright.
    expect(sheetFor(A4, layout({ columns: 2, rows: 1 }), A4)).toEqual(sideways);
    expect(sheetFor(A4, layout({ columns: 1, rows: 2 }), sideways)).toEqual(A4);
    expect(sheetFor(A4, layout(), A4)).toEqual(A4);
    // Pages the layout turns to suit their space are measured the way they will sit.
    expect(sheetFor(A4, layout({ columns: 1, rows: 2, rotate: true }), A4)).toEqual(A4);
  });

  it("reads a sheet's size from its PWG name, and the job's paper from whichever the printer's mode uses", () => {
    expect(mediaSize("iso_a4_210x297mm")?.width).toBeCloseTo(595.28, 2);
    expect(mediaSize("iso_a4_210x297mm")?.height).toBeCloseTo(841.89, 2);
    expect(mediaSize("na_letter_8.5x11in")).toEqual({ width: 612, height: 792 });
    expect(mediaSize("stationery")).toBeNull();
    expect(paperFor(postScript, { "ppd:PageSize": "A3" })).toEqual({ width: 842, height: 1191 });
    expect(paperFor(postScript, {})).toEqual(A4);
    expect(paperFor(ipp, { media: "iso_a5_148x210mm" })?.width).toBeCloseTo(419.5, 0);
    expect(paperFor(ipp, {})?.height).toBeCloseTo(842, 0);
    expect(paperFor({ ...ipp, caps: {} }, {})).toBeNull();
  });

  it("says what a run of copies comes to when every sheet repeats one page", () => {
    expect(describeRun(5, layout({ columns: 2, rows: 4, repeat: true }), 1)).toBe("40 in total (5 copies × 8 per sheet)");
    expect(describeRun(1, layout({ repeat: true }), null)).toBe("4 of each page (1 copy × 4 per sheet)");
    expect(describeRun(3, layout({ repeat: true }), 2)).toBe("12 of each page (3 copies × 4 per sheet)");
  });

  it("places a sheet's pages for the sketch exactly as it does for the printer", () => {
    const sideways = { width: 842, height: 595 };
    const placed = placePages(sideways, layout({ columns: 2, rows: 1, margin: 0, gap: 0 }), [A4, A4, A4], 1);
    // The second sheet of a three-page 2-up holds the last page alone, at half the sheet's width.
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ page: 2, turned: false });
    expect(placed[0]!.x).toBeCloseTo(0, 0);
    expect(placed[0]!.width).toBeCloseTo(420.5, 0);
    expect(placed[0]!.scale).toBeCloseTo(595 / 842, 3);
    // At their own size, business cards keep 90 x 55 mm and the block of them is centred.
    const card = { width: 255.12, height: 155.91 };
    const cards = placePages({ width: 841.89, height: 1190.55 }, LAYOUT_TEMPLATES.find(t => t.id === "business-cards")!.layout, [card], 0);
    expect(cards).toHaveLength(10);
    expect(cards.every(c => c.scale === 1 && Math.abs(c.width - 255.12) < 0.01)).toBe(true);
    expect(cards[0]!.x).toBeCloseTo((841.89 - (255.12 * 2 + 2 * 72 / 25.4)) / 2, 1);
  });

  it("describes a layout in a phrase for a summary line", () => {
    expect(describeLayout(layout())).toBe("4 pages per sheet");
    expect(describeLayout(layout({ repeat: true, cropMarks: true }))).toBe("4 of each page per sheet with crop marks");
    expect(describeLayout(layout({ columns: 1, rows: 1, cropMarks: true, borders: true }))).toBe("Crop marks and page borders");
  });
});

describe("ready-made layouts", () => {
  const a3 = { width: 841.89, height: 1190.55 };
  const template = (id: string) => LAYOUT_TEMPLATES.find(t => t.id === id)!;
  const piece = (id: string) => ({ width: template(id).size.width * 72 / 25.4, height: template(id).size.height * 72 / 25.4 });

  it("says outright what each does to the size of the piece", () => {
    // Eight A6 or six DL fill an A3 exactly, so a margin and gaps to cut along cost them a few percent.
    expect(LAYOUT_TEMPLATES.map(t => `${t.name}: ${describeTemplate(t)}`)).toEqual([
      "A6 cards: 8 per A3, at 96% of full size",
      "A6 cards, full size: 4 per A3",
      "Business cards: 10 per A3, full size",
      "DL: 6 per A3, at 95% of full size",
    ]);
  });

  it("fits every piece on its sheet, upright or sideways artwork alike, and never enlarges one", () => {
    for (const { id, layout: grid } of LAYOUT_TEMPLATES) {
      const options = { "ppd:PageSize": "A3", ...layoutOptions(grid) };
      expect(layoutFrom(options), id).toEqual(grid);
      expect(validateJobOptions(options, postScript), id).toEqual([]);
      for (const page of [piece(id), { width: piece(id).height, height: piece(id).width }]) {
        expect(jobWarnings(options, postScript, page), id).toEqual([]);
        expect(pageScale(a3, grid, page), id).toBeLessThanOrEqual(1);
        expect(pageScale(a3, grid, page), id).toBeGreaterThan(0.95);
      }
    }
    // Resized to fit, a business card would be blown up to fill its space, which is why that one is not.
    expect(pageScale(a3, { ...template("business-cards").layout, fit: true }, piece("business-cards"))).toBeGreaterThan(1.4);
  });

  it("arranges the pages and leaves the user's crop marks and borders alone", () => {
    const marked = { "layout-crop-marks": "true", "layout-borders": "true", "layout-margin": 12 };
    for (const { layout: grid } of [...LAYOUT_TEMPLATES, ...PAGES_PER_SHEET]) {
      const chosen = readLayout({ ...marked, ...arrangementOptions(grid) });
      expect(chosen).toMatchObject({ cropMarks: true, borders: true, margin: grid.margin });
      // Marks added afterwards do not make it a different arrangement, so its button stays pressed.
      expect(sameArrangement(chosen, grid)).toBe(true);
    }
    expect(sameArrangement(readLayout({ "layout-columns": 2, "layout-rows": 2 }), PAGES_PER_SHEET.find(c => c.id === "four")!.layout)).toBe(true);
    expect(sameArrangement(readLayout({ "layout-columns": 2, "layout-rows": 3 }), PAGES_PER_SHEET.find(c => c.id === "four")!.layout)).toBe(false);
  });

  it("leaves crop marks and borders off until they are asked for, ready-made or not", () => {
    for (const profile of [postScript, ipp]) {
      const fields = formFor(profile);
      expect(fields.find(f => f.name === "layout-crop-marks")?.default).toBe("false");
      expect(fields.find(f => f.name === "layout-borders")?.default).toBe("false");
    }
    expect(LAYOUT_TEMPLATES.filter(t => t.layout.cropMarks || t.layout.borders)).toEqual([]);
    expect(describeLayout(template("a6").layout)).toBe("8 of each page per sheet");
  });

  it("chooses its paper on the printer's own form, and is not offered where the printer has none", () => {
    expect(paperChoice(formFor(postScript), "A3", a3)).toEqual({ name: "ppd:PageSize", value: "A3" });
    expect(paperChoice(formFor(ipp), "A3", a3)).toEqual({ name: "media", value: "iso_a3_297x420mm" });
    const letterOnly = [{ name: "media", choices: [{ value: "na_letter_8.5x11in" }, { value: "na_legal_8.5x14in" }] }];
    expect(paperChoice(letterOnly, "A3", a3)).toBeNull();
  });
});

describe("layout in the form and in validation", () => {
  it("offers the same layout fields on every printer, after the printer's own", () => {
    for (const profile of [postScript, ipp]) {
      const fields = formFor(profile);
      const names = fields.map(f => f.name);
      expect(names.slice(-10)).toEqual(["layout-columns", "layout-rows", "layout-order", "layout-repeat", "layout-fit", "layout-rotate", "layout-margin", "layout-gap", "layout-crop-marks", "layout-borders"]);
      expect(fields.find(f => f.name === "layout-columns")).toMatchObject({ widget: "number", min: 1, max: 10, default: 1, group: "Layout" });
      // The form's own defaults ask for no layout, so a job that leaves them alone is sent as it came.
      expect(layoutFrom(Object.fromEntries(fields.map(f => [f.name, f.default])))).toBeNull();
    }
  });

  it("sums a layout up as one phrase beside the other options, and only where it was asked for", () => {
    const fields = formFor(ipp);
    const names = ["copies", ...fields.filter(f => f.name.startsWith("layout-")).map(f => f.name)];
    const options = { "copies": 2, "layout-columns": 2, "layout-rows": 2, "layout-repeat": "true", "layout-margin": 5 };
    // Repeated, "copies" is said as what it comes to, which is the number people are after.
    expect(summariseOptions(fields, options, names)).toBe("8 of each page (2 copies × 4 per sheet)");
    expect(summariseOptions(fields, options, names, { pages: 1 })).toBe("8 in total (2 copies × 4 per sheet)");
    expect(summariseOptions(fields, { ...options, "layout-repeat": "false" }, names)).toBe("2 copies · 4 pages per sheet");
    // A preset card shows what the preset changes, so the layout stands without a count.
    expect(summariseOptions(fields, options, names, { changesOnly: true })).toBe("2 copies · 4 of each page per sheet");
    expect(summariseOptions(fields, { "layout-columns": 2 }, names, { changesOnly: true })).toBe("2 pages per sheet");
    expect(summariseOptions(fields, options, ["copies"])).toBe("2 copies");
    expect(summariseOptions(fields, { copies: 2 }, names, { changesOnly: true })).toBe("2 copies");
  });

  it("keeps layout options off the printer's attributes and out of the everyday options", () => {
    expect(isOwnOption("layout-columns")).toBe(true);
    expect(isPrimaryOption("layout-columns")).toBe(false);
    expect(withoutOwnOptions({ "copies": 2, "layout-columns": 2, "layout-repeat": "true", "black-and-white": "true" })).toEqual({ copies: 2 });
  });

  it("validates a layout in either mode, without asking the printer about options it has never heard of", () => {
    const options = { "layout-columns": 2, "layout-rows": 2, "layout-repeat": "true" };
    expect(validateJobOptions({ ...options, "ppd:PageSize": "A4" }, postScript)).toEqual([]);
    expect(validateJobOptions({ ...options, copies: 2 }, ipp)).toEqual([]);
    expect(validateJobOptions({ "layout-columns": 12 }, ipp)[0]).toMatch(/whole number from 1 to 10/);
    expect(validateJobOptions({ "layout-columns": 12, "sides": "upside-down" }, ipp)).toHaveLength(2);
    // Ten columns with 25 mm between them is more than an A4 sheet is wide, either way round.
    expect(validateJobOptions({ "layout-columns": 10, "layout-rows": 10, "layout-gap": 25, "ppd:PageSize": "A4" }, postScript)[0]).toMatch(/leave no room/);
    expect(validateJobOptions({ "layout-columns": 10, "layout-rows": 10, "layout-gap": 25, "ppd:PageSize": "A3" }, postScript)).toEqual([]);
  });

  it("warns when pages kept at their own size are larger than their space on the sheet", () => {
    const unfitted = { "ppd:PageSize": "A4", "layout-columns": 2, "layout-fit": "false", "layout-margin": 0, "layout-gap": 0 };
    // Two A5 pages are one A4 sheet exactly; two A4 pages are not.
    expect(jobWarnings(unfitted, postScript, A5)).toEqual([]);
    expect(jobWarnings(unfitted, postScript, A4)[0]).toMatch(/larger than the 149 × 210 mm each gets/);
    expect(jobWarnings({ ...unfitted, "layout-fit": "true" }, postScript, A4)).toEqual([]);
    expect(jobWarnings({ ...unfitted, "layout-margin": 5 }, postScript, A5)[0]).toMatch(/overlap/);
    // Laid out, a page no longer answers to the paper, so the plain "larger than A4" warning gives way.
    expect(jobWarnings({ ...unfitted, "fit-to-page": "false", "layout-fit": "true" }, postScript, { width: 842, height: 1191 })).toEqual([]);
    expect(jobWarnings({ "media": "iso_a4_210x297mm", "layout-columns": 2, "layout-fit": "false" }, ipp, A4)[0]).toMatch(/larger than/);
  });
});

describe("imposing a PDF", () => {
  it("puts the pages on sheets of the paper, turned to suit them, with a short last sheet", async () => {
    const pages = await colouredPages([RED, GREEN, BLUE, BLACK, RED]);
    expect(await sheetSizes(await imposePdf(pages, layout(), A4))).toEqual([A4, A4]);
    expect(await sheetSizes(await imposePdf(pages, layout({ columns: 2, rows: 1 }), A4))).toEqual([{ width: 842, height: 595 }, { width: 842, height: 595 }, { width: 842, height: 595 }]);
    expect(await sheetSizes(await imposePdf(pages, layout({ repeat: true }), A4))).toHaveLength(5);
    // With no paper to go by, the sheet grows to hold the grid at the page's own size.
    expect(await sheetSizes(await imposePdf(pages, layout({ columns: 2, rows: 1 }), null))).toEqual([{ width: 840, height: 595 }, { width: 840, height: 595 }, { width: 840, height: 595 }]);
  });

  it("gives a blank page its cell rather than failing on a page with nothing to draw", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([A5.width, A5.height]);
    pdf.addPage([A5.width, A5.height]).drawRectangle({ x: 0, y: 0, ...A5, color: rgb(1, 0, 0) });
    expect(await sheetSizes(await imposePdf(await pdf.save(), layout({ columns: 2, rows: 1 }), A4))).toHaveLength(1);
  });

  it("places only the pages a range asks for, counted in the document's pages rather than in sheets", async () => {
    const pages = await colouredPages([RED, GREEN, BLUE, BLACK, RED, GREEN, BLUE, BLACK]);
    expect(await sheetSizes(await imposePdf(pages, layout({ columns: 2, rows: 1 }), A4, [{ min: 1, max: 2 }]))).toHaveLength(1);
    expect(await sheetSizes(await imposePdf(pages, layout({ columns: 2, rows: 1 }), A4, [{ min: 1, max: 2 }, { min: 6, max: 8 }]))).toHaveLength(3);
    await expect(imposePdf(pages, layout(), A4, [{ min: 20, max: 30 }])).rejects.toThrow("page range leaves no pages");
  });

  it("refuses a PDF whose printing annotations a layout would leave out, but not one with only links", async () => {
    const annotated = async (subtype: string, flags: number) => {
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([A5.width, A5.height]);
      page.drawRectangle({ x: 0, y: 0, ...A5, color: rgb(1, 0, 0) });
      const annotation = pdf.context.obj({ Type: "Annot", Subtype: subtype, Rect: [50, 50, 200, 100], F: flags });
      page.node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.register(annotation)]));
      return pdf.save();
    };
    await expect(imposePdf(await annotated("Stamp", 4), layout(), A4)).rejects.toThrow("stamps or comments set to print");
    expect(await sheetSizes(await imposePdf(await annotated("Link", 4), layout(), A4))).toHaveLength(1);
    // A comment that is not set to print would not have printed anyway.
    expect(await sheetSizes(await imposePdf(await annotated("Text", 0), layout(), A4))).toHaveLength(1);
  });

  it("refuses an XFA-only form, whose page is a placeholder for content a layout cannot reach", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([A5.width, A5.height]).drawRectangle({ x: 0, y: 0, ...A5, color: rgb(1, 0, 0) });
    pdf.catalog.set(PDFName.of("AcroForm"), pdf.context.obj({ Fields: [], XFA: pdf.context.obj([]) }));
    await expect(imposePdf(await pdf.save(), layout(), A4)).rejects.toThrow("XFA form");
    // An empty AcroForm with no XFA is just a PDF.
    pdf.catalog.set(PDFName.of("AcroForm"), pdf.context.obj({ Fields: [] }));
    expect(await sheetSizes(await imposePdf(await pdf.save(), layout(), A4))).toHaveLength(1);
  });

  it("refuses a document it cannot read in words, and a layout with no room for pages", async () => {
    await expect(imposePdf(new TextEncoder().encode("%PDF-1.7\nnot really\n"), layout(), A4)).rejects.toThrow("could not read the PDF to lay it out");
    await expect(imposePdf(await colouredPages([RED]), layout({ columns: 10, rows: 10, gap: 25 }), A5)).rejects.toThrow("no room");
  });
});

describe.skipIf(!(await ghostscriptAvailable()))("what an imposed sheet draws", () => {
  const exact = layout({ margin: 0, gap: 0 });
  const quadrants = { topLeft: [150, 630], topRight: [450, 630], bottomLeft: [150, 210], bottomRight: [450, 210] } as const;
  const seen = async (pdf: Uint8Array, page = 1) => {
    const sheet = await rasterise(pdf, page);
    return Object.fromEntries(Object.entries(quadrants).map(([name, [x, y]]) => [name, sheet.at(x, y)]));
  };

  it("runs the pages across then down, or down then across", async () => {
    const pages = await colouredPages([RED, GREEN, BLUE, BLACK, RED]);
    const across = await imposePdf(pages, exact, A4);
    expect(await seen(across)).toEqual({ topLeft: RED, topRight: GREEN, bottomLeft: BLUE, bottomRight: BLACK });
    expect(await seen(across, 2)).toEqual({ topLeft: RED, topRight: WHITE, bottomLeft: WHITE, bottomRight: WHITE });
    expect(await seen(await imposePdf(pages, { ...exact, order: "down" }, A4))).toEqual({ topLeft: RED, topRight: BLUE, bottomLeft: GREEN, bottomRight: BLACK });
  });

  it("fills each sheet with one page when asked to repeat", async () => {
    const repeated = await imposePdf(await colouredPages([RED, GREEN]), { ...exact, repeat: true }, A4);
    expect(await seen(repeated, 1)).toEqual({ topLeft: RED, topRight: RED, bottomLeft: RED, bottomRight: RED });
    expect(await seen(repeated, 2)).toEqual({ topLeft: GREEN, topRight: GREEN, bottomLeft: GREEN, bottomRight: GREEN });
  });

  it("scales pages to their space, or keeps them their own size and centres the grid", async () => {
    const small = await colouredPages([RED, RED, RED, RED], { width: 100, height: 100 });
    const fitted = await rasterise(await imposePdf(small, exact, A4));
    // A square page fills its cell's width and is centred in its height.
    expect(fitted.at(10, 630)).toEqual(RED);
    expect(fitted.at(150, 830)).toEqual(WHITE);
    const own = await rasterise(await imposePdf(small, { ...exact, fit: false }, A4));
    // Four 100 pt squares make a 200 pt block in the middle of the sheet.
    expect(own.at(10, 630)).toEqual(WHITE);
    expect(own.at(250, 470)).toEqual(RED);
    expect(own.at(350, 370)).toEqual(RED);
    expect(own.at(410, 470)).toEqual(WHITE);
  });

  it("draws a page the way a reader shows it, whatever its /Rotate, and turns it only when asked", async () => {
    // A landscape page marked red along what a reader shows as its left edge, stored a quarter turn round.
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([A5.width, A5.height]);
    page.drawRectangle({ x: 0, y: 0, ...A5, color: rgb(0, 0, 1) });
    page.drawRectangle({ x: 0, y: 0, width: A5.width, height: 100, color: rgb(1, 0, 0) });
    page.setRotation(degrees(90));
    const stored = await pdf.save();

    // One landscape page per upright half sheet: its red edge stays on the left.
    const shown = await rasterise(await imposePdf(stored, { ...exact, columns: 1, rows: 2 }, A4));
    expect(shown.at(40, 630)).toEqual(RED);
    expect(shown.at(300, 630)).toEqual(BLUE);
    expect(shown.at(300, 210)).toEqual(WHITE);

    // Side by side its spaces are upright, so turned to fit, the red edge runs along the bottom.
    const turned = await rasterise(await imposePdf(stored, { ...exact, columns: 2, rows: 1, rotate: true }, A5));
    expect(turned.at(105, 30)).toEqual(RED);
    expect(turned.at(105, 300)).toEqual(BLUE);
    expect(turned.at(105, 400)).toEqual(BLUE);
  });

  it("lays out a real document, fonts and all, into sheets Ghostscript converts without complaint", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "printmax-layout-"));
    try {
      const file = path.join(dir, "sheets.pdf");
      await writeFile(file, await imposePdf(readFileSync(new URL("../fixtures/booklet-8-pages.pdf", import.meta.url)), layout({ cropMarks: true, borders: true }), A4));
      expect(await measurePdf(file)).toEqual({ pages: 2, largest: A4 });
      // The converter refuses a page Ghostscript could not draw, so getting PostScript back is the proof.
      const sheets = (await pdfToPostScript(file, { paper: A4, fitToPaper: true })).toString("latin1");
      expect(sheets.match(/^%%Page:/gm)).toHaveLength(2);
    }
    finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cuts business cards from an A3 sheet at their true size", async () => {
    const card = { width: 90 * 72 / 25.4, height: 55 * 72 / 25.4 };
    const cards = LAYOUT_TEMPLATES.find(t => t.id === "business-cards")!.layout;
    const sheet = await rasterise(await imposePdf(await colouredPages([RED], card), cards, { width: 841.89, height: 1190.55 }));
    expect([sheet.width, sheet.height]).toEqual([842, 1191]);
    // Two columns of 90 mm and a 2 mm gap, centred: the block of cards is 182 mm wide and no wider.
    const [left, right] = [(841.89 - (card.width * 2 + 2 * 72 / 25.4)) / 2, (841.89 + (card.width * 2 + 2 * 72 / 25.4)) / 2];
    expect(sheet.at(left + 4, 595)).toEqual(RED);
    expect(sheet.at(right - 4, 595)).toEqual(RED);
    expect(sheet.at(left - 20, 595)).toEqual(WHITE);
    expect(sheet.at(right + 20, 595)).toEqual(WHITE);
    // Five rows of 55 mm with four gaps, centred top to bottom.
    const top = (1190.55 + (card.height * 5 + 4 * 2 * 72 / 25.4)) / 2;
    expect(sheet.at(421 - card.width / 2, top - 4)).toEqual(RED);
    expect(sheet.at(421 - card.width / 2, top + 20)).toEqual(WHITE);
  });

  it("draws what was typed into a form's fields, which a page embedded as a form would otherwise leave behind", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([A5.width, A5.height]);
    const field = pdf.getForm().createTextField("name");
    field.setText("MMMMMM");
    field.addToPage(page, { x: 60, y: 250, width: 300, height: 100, borderWidth: 0 });
    const sheet = await rasterise(await imposePdf(await pdf.save(), layout({ columns: 1, rows: 1, fit: false, margin: 0, gap: 0, borders: true }), A5));
    // The letters fill the field, so somewhere across its middle there is ink.
    const inked = Array.from({ length: 280 }, (_, x) => sheet.at(70 + x, 300)).filter(([r]) => r < 128).length;
    expect(inked).toBeGreaterThan(20);
  });

  it("leaves a hidden field, or one not set to print, off the sheet as it would be off the page", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([A5.width, A5.height]);
    const form = pdf.getForm();
    const fill = (name: string, y: number) => {
      const field = form.createTextField(name);
      field.setText("MMMMMM");
      field.addToPage(page, { x: 60, y, width: 300, height: 100, borderWidth: 0 });
      return field.acroField.getWidgets()[0]!;
    };
    fill("printed", 450);
    fill("hidden", 250).setFlagTo(2, true);
    fill("screen-only", 50).setFlagTo(4, false);
    const sheet = await rasterise(await imposePdf(await pdf.save(), layout({ columns: 1, rows: 1, fit: false, margin: 0, gap: 0, borders: true }), A5));
    const inked = (y: number) => Array.from({ length: 280 }, (_, x) => sheet.at(70 + x, y)).filter(([r]) => r < 128).length;
    expect(inked(500)).toBeGreaterThan(20);
    expect(inked(300)).toBe(0);
    expect(inked(100)).toBe(0);
  });

  it("places a cropped page by the box a reader shows, not by what lies outside it", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([A5.width, A5.height]);
    page.drawRectangle({ x: 0, y: 0, ...A5, color: rgb(0, 1, 0) });
    page.drawRectangle({ x: 110, y: 147.5, width: 200, height: 300, color: rgb(1, 0, 0) });
    page.setCropBox(110, 147.5, 200, 300);
    const sheet = await rasterise(await imposePdf(await pdf.save(), layout({ columns: 1, rows: 1, margin: 0, gap: 0, borders: true }), A5));
    // The red crop fills the sheet's height; none of the green around it is drawn.
    expect(sheet.at(210, 20)).toEqual(RED);
    expect(sheet.at(210, 575)).toEqual(RED);
    expect(sheet.at(5, 297)).toEqual(WHITE);
    expect(sheet.at(415, 297)).toEqual(WHITE);
  });

  it("marks where to cut and rules a border around each page when asked", async () => {
    const pages = await colouredPages([WHITE], { width: 200, height: 200 });
    const single = layout({ columns: 1, rows: 1, fit: false, margin: 0, gap: 0 });
    const plain = await rasterise(await imposePdf(pages, { ...single, cropMarks: true }, A4));
    const dark = (colour: number[]) => colour[0]! < 250;
    // The page sits in the middle of the sheet; its marks start 3 pt clear of each corner.
    const [left, bottom] = [(595 - 200) / 2, (842 - 200) / 2];
    expect([-1, 0, 1].some(nudge => dark(plain.at(left - 8, bottom + nudge)))).toBe(true);
    expect([-1, 0, 1].some(nudge => dark(plain.at(left + nudge, bottom - 8)))).toBe(true);
    expect(dark(plain.at(left + 100, bottom))).toBe(false);
    const bordered = await rasterise(await imposePdf(pages, { ...single, borders: true }, A4));
    expect([-1, 0, 1].some(nudge => dark(bordered.at(left + 100, bottom + nudge)))).toBe(true);
  });
});
