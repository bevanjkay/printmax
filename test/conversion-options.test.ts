import type { ConversionLimits, JobRow } from "../src/server/jobs.js";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { beforeEach, expect, it, vi } from "vitest";
import { createUser } from "../src/server/auth.js";
import { openDb } from "../src/server/db.js";
import { printJob } from "../src/server/ipp/operations.js";
import { createJob, requireJob, submitJob, toDto } from "../src/server/jobs.js";
import { conversionTimeoutMs, measurePdf, pdfToGrayscalePdf, pdfToPostScript } from "../src/server/ppd/ghostscript.js";
import { flatPng } from "./helpers/images.js";

vi.mock("../src/server/ppd/ghostscript.js", async original => ({ ...await original<typeof import("../src/server/ppd/ghostscript.js")>(), pdfToPostScript: vi.fn(), pdfToGrayscalePdf: vi.fn(), measurePdf: vi.fn() }));
vi.mock("../src/server/ipp/operations.js", async original => ({ ...await original<typeof import("../src/server/ipp/operations.js")>(), printJob: vi.fn() }));

const ppd = readFileSync(new URL("../fixtures/toshiba-e-studio-excerpt.ppd", import.meta.url), "utf8");

/** Submits a job to a printer in PostScript mode and returns it as the attempt left it. */
async function submitPostScript(options: Record<string, unknown>, optionDefaults: Record<string, unknown> = {}, limits: ConversionLimits = {}, document = { filePath: "/unused/test.pdf", documentFormat: "application/pdf" }, driver = ppd) {
  const db = openDb(":memory:");
  const user = createUser(db, { name: "User", email: "user@example.org", password: "test password", role: "user" });
  db.prepare("INSERT INTO printers (name, uri, created_at, ppd, print_mode, option_defaults) VALUES (?, ?, ?, ?, ?, ?)")
    .run("Fixture", "ipp://127.0.0.1:1/ipp/print", new Date().toISOString(), driver, "postscript", JSON.stringify(optionDefaults));
  const job = createJob(db, { printerId: 1, user, filename: path.basename(document.filePath), byteSize: 10, options, ...document });
  await submitJob(db, job as JobRow, limits);
  return requireJob(db, job.id);
}

/** What the converter was asked for when a job went to a printer in PostScript mode. */
function convert(...job: Parameters<typeof submitPostScript>) {
  return submitPostScript(...job).then(() => vi.mocked(pdfToPostScript).mock.calls.at(-1)![1]!);
}

/** Submits a job to a printer in IPP mode and returns what went to the printer. */
async function sendIpp(options: Record<string, unknown>, documentFormat = "application/pdf", optionDefaults: Record<string, unknown> = {}, filePath = new URL(import.meta.url).pathname, caps: Record<string, unknown> = {}) {
  const db = openDb(":memory:");
  const user = createUser(db, { name: "User", email: "user@example.org", password: "test password", role: "user" });
  db.prepare("INSERT INTO printers (name, uri, created_at, option_defaults, caps_discovered) VALUES (?, ?, ?, ?, ?)")
    .run("Fixture", "ipp://127.0.0.1:1/ipp/print", new Date().toISOString(), JSON.stringify(optionDefaults), JSON.stringify(caps));
  const job = createJob(db, { printerId: 1, user, filename: "test.pdf", filePath, byteSize: 10, documentFormat, options });
  await submitJob(db, job as JobRow);
  return vi.mocked(printJob).mock.calls.at(-1)![1];
}

/** The state a job reports while its document is converted, then while it is sent to the printer. */
async function reportedStates(printMode: "postscript" | "ipp", options: Record<string, unknown>) {
  const db = openDb(":memory:");
  const user = createUser(db, { name: "User", email: "user@example.org", password: "test password", role: "user" });
  db.prepare("INSERT INTO printers (name, uri, created_at, ppd, print_mode) VALUES (?, ?, ?, ?, ?)")
    .run("Fixture", "ipp://127.0.0.1:1/ipp/print", new Date().toISOString(), printMode === "postscript" ? ppd : null, printMode);
  const job = createJob(db, { printerId: 1, user, filename: "test.pdf", filePath: new URL(import.meta.url).pathname, byteSize: 10, documentFormat: "application/pdf", options });
  const state = () => toDto(db, requireJob(db, job.id)).state;
  const seen: { converting?: string; sending?: string } = {};
  const converted = async () => {
    seen.converting = state();
    return Buffer.from("%!PS-Adobe-3.0\n%%Page: 1 1\nshowpage\n");
  };
  if (printMode === "postscript")
    vi.mocked(pdfToPostScript).mockImplementation(converted);
  else
    vi.mocked(pdfToGrayscalePdf).mockImplementation(converted);
  vi.mocked(printJob).mockImplementation(async () => {
    seen.sending = state();
    return { jobId: 1, state: "pending", stateReasons: [] };
  });
  await submitJob(db, job as JobRow);
  return { ...seen, after: state() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measurePdf).mockResolvedValue({ pages: 1, largest: { width: 842, height: 595 } });
  vi.mocked(pdfToGrayscalePdf).mockResolvedValue(Buffer.from("%PDF-1.7 grey"));
  vi.mocked(pdfToPostScript).mockResolvedValue(Buffer.from("%!PS-Adobe-3.0\n%%Page: 1 1\nshowpage\n"));
  vi.mocked(printJob).mockResolvedValue({ jobId: 1, state: "completed", stateReasons: [] });
});

it("converts at the engine's resolution so a transparent page costs what the printer can image", async () => {
  expect(await convert({ "ppd:PageSize": "A4" })).toMatchObject({ resolution: { x: 600, y: 600 } });
});

it("falls back to the printer's own fit to paper when the job does not say", async () => {
  expect(await convert({ "ppd:PageSize": "A4" }, { "fit-to-page": "false" })).toMatchObject({ fitToPaper: false });
  expect(await convert({ "ppd:PageSize": "A4" }, {})).toMatchObject({ fitToPaper: true });
  // A job that states it still wins over the printer's default.
  expect(await convert({ "ppd:PageSize": "A4", "fit-to-page": "true" }, { "fit-to-page": "false" })).toMatchObject({ fitToPaper: true });
});

it("sends the printer's own driver defaults for options the job leaves unset", async () => {
  const sent = async (options: Record<string, unknown>, optionDefaults: Record<string, unknown>) => {
    await convert(options, optionDefaults);
    return Buffer.from(vi.mocked(printJob).mock.calls.at(-1)![1].data).toString("latin1");
  };
  expect(await sent({ "ppd:PageSize": "A4" }, { "ppd:ColorType": "Auto" })).toContain("*ColorType Auto");
  expect(await sent({ "ppd:PageSize": "A4" }, {})).toContain("*ColorType Color");
  // A job that states it still wins over the printer's default.
  expect(await sent({ "ppd:PageSize": "A4", "ppd:ColorType": "Mono" }, { "ppd:ColorType": "Auto" })).toContain("*ColorType Mono");
});

it("forces the chosen sheet either way, so the printer asks for the paper PageSize chose", async () => {
  const paper = { width: 595, height: 842 };
  expect(await convert({ "ppd:PageSize": "A4", "fit-to-page": "true" })).toMatchObject({ paper, fitToPaper: true });
  expect(await convert({ "ppd:PageSize": "A4", "fit-to-page": "false" })).toMatchObject({ paper, fitToPaper: false });
});

it("passes the document's page size only when its pages are the ones being placed", async () => {
  expect(await convert({ "ppd:PageSize": "A4", "fit-to-page": "false" })).toMatchObject({ documentPage: { width: 842, height: 595 } });
  // Fitted, every page is scaled to the sheet, so its own size decides nothing.
  expect(await convert({ "ppd:PageSize": "A4", "fit-to-page": "true" })).not.toHaveProperty("documentPage");
});

it("sets an image on a page of its own in PostScript mode, always scaled to a sheet", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-image-job-"));
  const image = { filePath: path.join(dir, "photo.png"), documentFormat: "image/png" };
  await writeFile(image.filePath, flatPng(40, 30, [255, 0, 0]));
  const converted: string[] = [];
  vi.mocked(pdfToPostScript).mockImplementation(async (file) => {
    converted.push(`${path.basename(file)} ${(await readFile(file)).subarray(0, 5).toString("latin1")}`);
    return Buffer.from("%!PS-Adobe-3.0\n%%Page: 1 1\nshowpage\n");
  });
  try {
    // No paper chosen and fit to paper off: an image has no size of its own to print at, so it still gets the PPD's default sheet.
    expect(await convert({ "fit-to-page": "false" }, {}, {}, image)).toMatchObject({ paper: { width: 595, height: 842 }, fitToPaper: true });
    expect(await convert({ "ppd:PageSize": "A3", "black-and-white": "true" }, {}, {}, image)).toMatchObject({ paper: { width: 842, height: 1191 }, grayscale: true });
    expect(converted).toEqual(["document.pdf %PDF-", "document.pdf %PDF-"]);
    // A PPD that lists a paper without its size leaves nothing to scale the image to, which is said rather than guessed.
    const sizeless = ppd.replace(/^\*PaperDimension.*$/gm, "");
    expect(await submitPostScript({}, {}, {}, image, sizeless)).toMatchObject({ state: "failed", error: expect.stringContaining("does not give the size of its paper") });
    // A file that only starts like a PNG fails the job in words, and nothing reaches the printer.
    await writeFile(image.filePath, "\x89PNG\r\n\x1A\n and nothing after it", "latin1");
    expect(await submitPostScript({}, {}, {}, image)).toMatchObject({ state: "failed", error: expect.stringContaining("could not read the image") });
    expect(vi.mocked(printJob)).toHaveBeenCalledTimes(2);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("lays a document out on sheets before it is converted or sent, in either mode", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "printmax-layout-job-"));
  const pages = await PDFDocument.create();
  for (let page = 0; page < 5; page++)
    pages.addPage([420, 595]).drawRectangle({ x: 0, y: 0, width: 420, height: 595 });
  const pdf = { filePath: path.join(dir, "notes.pdf"), documentFormat: "application/pdf" };
  const image = { filePath: path.join(dir, "flyer.png"), documentFormat: "image/png" };
  await writeFile(pdf.filePath, await pages.save());
  await writeFile(image.filePath, flatPng(40, 30, [255, 0, 0]));
  const sheets = async (document: Uint8Array) => (await PDFDocument.load(document)).getPages().map(page => page.getSize());
  let converted: Array<{ width: number; height: number }> = [];
  vi.mocked(pdfToPostScript).mockImplementation(async (file) => {
    converted = await sheets(await readFile(file));
    return Buffer.from("%!PS-Adobe-3.0\n%%Page: 1 1\nshowpage\n");
  });
  const twoUp = { "layout-columns": 2, "layout-rows": 1 };
  try {
    // PostScript mode: the sheets are cut to the PPD's paper, chosen or default, and that paper is forced.
    expect(await convert(twoUp, {}, {}, pdf)).toMatchObject({ paper: { width: 595, height: 842 } });
    expect(converted).toEqual(Array.from({ length: 3 }).fill({ width: 842, height: 595 }));
    await convert({ ...twoUp, "ppd:PageSize": "A3", "layout-repeat": "true" }, {}, {}, image);
    expect(converted).toEqual([{ width: 1191, height: 842 }]);

    // IPP mode: the printer is sent the sheets as a PDF, and never hears of the layout options.
    const media = { "media-default": { type: "keyword", values: ["iso_a4_210x297mm"] } };
    const sent = await sendIpp({ ...twoUp, copies: 2 }, pdf.documentFormat, {}, pdf.filePath, media);
    expect(sent.documentFormat).toBe("application/pdf");
    expect(Object.keys(sent.jobAttributes ?? {})).toEqual(["copies"]);
    expect(await sheets(sent.data)).toHaveLength(3);
    expect((await sheets(sent.data))[0]!.width).toBeCloseTo(841.89, 1);
    // An image becomes a PDF on the way, which black and white can then convert like any other.
    const flyer = await sendIpp({ ...twoUp, "black-and-white": "true" }, image.documentFormat, {}, image.filePath);
    expect(flyer.documentFormat).toBe("application/pdf");
    expect(String(flyer.data)).toBe("%PDF-1.7 grey");
    // A printer that reads no PDF cannot be sent one, so the job is refused rather than failed later.
    const imagesOnly = { "document-format-supported": { type: "mimeMediaType", values: ["image/jpeg", "image/png"] } };
    await expect(sendIpp(twoUp, image.documentFormat, {}, image.filePath, imagesOnly)).rejects.toThrow("does not accept application/pdf, which a layout is sent as");
    expect((await sendIpp({}, image.documentFormat, {}, image.filePath, imagesOnly)).documentFormat).toBe("image/png");
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("gives a long document time in proportion to its pages, since ps2write may rasterise every one", async () => {
  vi.mocked(measurePdf).mockResolvedValue({ pages: 19, largest: { width: 842, height: 1191 } });
  expect(await convert({ "ppd:PageSize": "A3" })).toMatchObject({ timeoutMs: 190_000 });
  expect(await convert({ "ppd:PageSize": "A3" }, {}, { postScriptSecondsPerPage: 20 })).toMatchObject({ timeoutMs: 380_000 });
  // A short document keeps the flat minute, as does one Ghostscript could not count.
  vi.mocked(measurePdf).mockResolvedValue({ pages: 2, largest: { width: 842, height: 1191 } });
  expect(await convert({ "ppd:PageSize": "A3" })).toMatchObject({ timeoutMs: 60_000 });
  vi.mocked(measurePdf).mockResolvedValue(null);
  expect(await convert({ "ppd:PageSize": "A3" })).toMatchObject({ timeoutMs: 60_000 });
});

it("keeps the timeout a whole number of milliseconds that Node's timers can hold, whatever the setting", () => {
  // execFile throws on a fractional or infinite timeout, and quietly fires one past 2^31 - 1 ms after 1 ms.
  expect(conversionTimeoutMs(100, 1.1)).toBe(110_000);
  expect(conversionTimeoutMs(19, 1e308)).toBe(2 ** 31 - 1);
  expect(conversionTimeoutMs(19, 1e6)).toBe(2 ** 31 - 1);
});

it("reports a job as converting while Ghostscript works on it, and only then", async () => {
  expect(await reportedStates("postscript", { "ppd:PageSize": "A4" })).toEqual({ converting: "converting", sending: "queued", after: "pending" });
  expect(await reportedStates("ipp", { "black-and-white": "true" })).toEqual({ converting: "converting", sending: "queued", after: "pending" });
  // A document sent as it came never goes near Ghostscript.
  expect(await reportedStates("ipp", {})).toEqual({ sending: "queued", after: "pending" });
});

it("converts a black and white job to greyscale, whether the job or the printer asks", async () => {
  expect(await convert({ "ppd:PageSize": "A4", "black-and-white": "true" })).toMatchObject({ grayscale: true });
  expect(await convert({ "ppd:PageSize": "A4" }, { "black-and-white": "true" })).toMatchObject({ grayscale: true });
  expect(await convert({ "ppd:PageSize": "A4", "black-and-white": "false" }, { "black-and-white": "true" })).toMatchObject({ grayscale: false });
  expect(await convert({ "ppd:PageSize": "A4" })).toMatchObject({ grayscale: false });
});

it("sends a greyscale PDF in IPP mode, without telling the printer about an option it has never heard of", async () => {
  const sent = await sendIpp({ "copies": 2, "black-and-white": "true" });
  expect(String(sent.data)).toBe("%PDF-1.7 grey");
  expect(Object.keys(sent.jobAttributes ?? {})).toEqual(["copies"]);
  expect(String((await sendIpp({ copies: 2 })).data)).not.toBe("%PDF-1.7 grey");
  expect(vi.mocked(pdfToGrayscalePdf)).toHaveBeenCalledTimes(1);
});

it("refuses black and white for a file it cannot convert, rather than print it in colour", async () => {
  await expect(sendIpp({ "black-and-white": "true" }, "image/png")).rejects.toThrow("PDFs only");
  await expect(sendIpp({}, "image/png", { "black-and-white": "true" })).rejects.toThrow("PDFs only");
  await expect(sendIpp({ "black-and-white": "sometimes" })).rejects.toThrow("must be true or false");
});
