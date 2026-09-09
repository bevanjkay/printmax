import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { formFor } from "../src/server/form.js";
import { assemblePostScript, jclHeader, setupBlock } from "../src/server/ppd/assemble.js";
import { marginsFor, ppdFields, validatePpdOptions } from "../src/server/ppd/form.js";
import { ghostscriptAvailable, pdfToPostScript } from "../src/server/ppd/ghostscript.js";
import { parsePpd } from "../src/server/ppd/parser.js";
import { validateJobOptions } from "../src/server/validation.js";

const execFileAsync = promisify(execFile);
const text = readFileSync(new URL("../fixtures/toshiba-e-studio-excerpt.ppd", import.meta.url), "utf8");
const ppd = parsePpd(text);
const byKey = Object.fromEntries(ppd.options.map(o => [o.key, o]));

describe("parsePpd", () => {
  it("reads model, JCL wrapper with hex escapes, groups, defaults and order", () => {
    expect(ppd.nickName).toBe("TOSHIBA ColorMFP");
    expect(ppd.languageLevel).toBe(3);
    expect(ppd.jcl?.begin).toBe("\x1B%-12345X@PJL JOB\n@PJL COMMENT DSSC PRINT CHARCODE=CP65001\n");
    expect(ppd.jcl?.toPs).toBe("@PJL ENTER LANGUAGE = POSTSCRIPT \n");
    expect(byKey.Stapling).toMatchObject({ label: "Stapling", group: "FinishingOptions", groupLabel: "Finishing", default: "None", order: 39, type: "PickOne", installable: false });
    expect(byKey.Finisher?.installable).toBe(true);
    expect(byKey.Folding).toMatchObject({ type: "Boolean", default: "False" });
  });

  it("keeps multi-line PostScript snippets and paper dimensions", () => {
    expect(byKey.PageSize?.choices.find(c => c.value === "A5")?.code).toContain("/PageSize [420 595]");
    expect(byKey.Stapling?.choices.find(c => c.value === "SS")?.code).toBe("<</TSBPrivate (DSSC PRINT STAPLING=1028) >> setpagedevice");
    expect(byKey.Folding?.choices.map(c => c.code)).toEqual(["", "<</TSBPrivate (DSSC PRINT FOLD=CENTER) >> setpagedevice"]);
    expect(ppd.paperDimensions.A5).toEqual({ width: 420, height: 595 });
    expect(ppd.imageableAreas.A5).toEqual({ llx: 12, lly: 12, urx: 408, ury: 583 });
    expect(ppd.hwMargins).toEqual({ left: 12, bottom: 12, right: 12, top: 12 });
    expect(marginsFor(ppd, "A5")).toEqual({ left: 12, bottom: 12, right: 12, top: 12 });
    expect(marginsFor(ppd, undefined)).toEqual(ppd.hwMargins);
    expect(ppd.constraints).toContainEqual({ key1: "Finisher", choice1: "Hanging1", key2: "Stapling", choice2: "SS" });
  });
});

describe("assembling the driver's job", () => {
  const chosen = { Stapling: "SS", Folding: "True", BookletPaperSize: "A4", Duplex: "DuplexTumble", PageSize: "A5" };

  it("emits the PJL header the way CUPS does, with the job named", () => {
    expect(jclHeader(ppd, chosen, "booklet \"test\".pdf", "bevankay")).toBe([
      "\x1B%-12345X@PJL",
      "@PJL COMMENT DSSC PRINT CHARCODE=CP65001",
      "@PJL JOB NAME = \"booklet 'test'.pdf\"",
      "@PJL SET USERNAME = \"bevankay\"",
      "@PJL ENTER LANGUAGE = POSTSCRIPT \n",
    ].join("\n"));
  });

  it("applies every option, chosen or default, in OrderDependency order", () => {
    const block = setupBlock(ppd, chosen);
    const order = [...block.matchAll(/%%BeginFeature: \*(\w+) (\S+)/g)].map(m => `${m[1]} ${m[2]}`);
    expect(order.indexOf("Finisher Saddle2+1")).toBeLessThan(order.indexOf("PageSize A5"));
    expect(order.indexOf("BookletPaperSize A4")).toBeLessThan(order.indexOf("Duplex DuplexTumble"));
    expect(order.indexOf("Duplex DuplexTumble")).toBeLessThan(order.indexOf("InputSlot Auto"));
    expect(order.indexOf("Stapling SS")).toBeLessThan(order.indexOf("Folding True"));
    expect(order.indexOf("Folding True")).toBeLessThan(order.indexOf("Collate True"));
    expect(block).toContain("%%BeginFeature: *Stapling SS\n<</TSBPrivate (DSSC PRINT STAPLING=1028) >> setpagedevice\n%%EndFeature\n} stopped cleartomark");
    expect(block).toContain("%%BeginFeature: *BookletPaperSize A4\n");
    expect(block).toContain("DSSC PRINT BOOKLET=A4");
    expect(block.startsWith("[{\n%%BeginFeature: *JobPatchFile 1\nuserdict /TSBshowpage /showpage load put")).toBe(true);
    expect(order.filter(o => o.startsWith("Page"))).toEqual(["PageSize A5"]);
  });

  it("marks PageRegion together with PageSize when the PPD has both", () => {
    const withRegion = parsePpd(`${text}\n*OpenUI *PageRegion: PickOne\n*OrderDependency: 29 AnySetup *PageRegion\n*DefaultPageRegion: A4\n*PageRegion A4/A4: "a4"\n*PageRegion A5/A5: "a5"\n*CloseUI: *PageRegion\n`);
    expect(setupBlock(withRegion, { PageSize: "A5" })).toContain("%%BeginFeature: *PageRegion A5\na5\n");
  });

  it("leaves out a default the PPD says conflicts with what was chosen, as the driver would change it", () => {
    const block = setupBlock(ppd, { BookletPaperSize: "A4" });
    expect(block).toContain("%%BeginFeature: *BookletPaperSize A4");
    expect(block).not.toContain("%%BeginFeature: *Duplex None");
    expect(setupBlock(ppd, {})).toContain("%%BeginFeature: *Duplex None");
  });

  it("wraps the document: JCL, then PostScript with the setup block before the first page", () => {
    const doc = Buffer.from("%!PS-Adobe-3.0\n%%Pages: 1\n%%EndComments\n%%BeginProlog\n/x 1 def\n%%EndProlog\n%%Page: 1 1\nshowpage\n%%Trailer\n%%EOF\n", "latin1");
    const out = assemblePostScript({ ppd, chosen, jobName: "a.pdf", userName: "pat", document: doc }).toString("latin1");
    expect(out.startsWith("\x1B%-12345X@PJL\n")).toBe(true);
    expect(out.indexOf("%!PS-Adobe-3.0")).toBeGreaterThan(0);
    expect(out.indexOf("%%EndProlog")).toBeLessThan(out.indexOf("%%BeginSetup"));
    expect(out.indexOf("%%EndSetup")).toBeLessThan(out.indexOf("%%Page: 1 1"));
    expect(out.endsWith("%%EOF\n")).toBe(true);
  });
});

describe("pPD options as a form and in validation", () => {
  const profile = { caps: {}, ppd, mode: "postscript" as const };

  it("turns user options into ppd: fields with the PPD's own labels and defaults, hiding installable ones", () => {
    const fields = ppdFields(ppd);
    const names = fields.map(f => f.name);
    expect(names).toContain("ppd:Stapling");
    expect(names).toContain("ppd:BookletPaperSize");
    expect(names).not.toContain("ppd:Finisher");
    expect(fields.find(f => f.name === "ppd:Stapling")).toMatchObject({ label: "Stapling", default: "None", group: "Finishing" });
    // The driver pages "Color Settings" across numbered groups; the form shows them as one section.
    expect(fields.find(f => f.name === "ppd:ColorType")?.group).toBe("Color Settings");
    expect(fields.find(f => f.name === "ppd:PageSize")?.label).toBe("Paper size");
    expect(fields.find(f => f.name === "ppd:Stapling")?.choices?.find(c => c.value === "SS")?.label).toBe("Saddle Stitch");
    expect(fields.find(f => f.name === "ppd:PageSize")?.choices?.find(c => c.value === "A5")?.label).toBe("A5");
    expect(formFor(profile).map(f => f.name)[0]).toBe("copies");
  });

  it("rejects unknown options and bad choices but leaves dialog constraints to the printer", () => {
    expect(validatePpdOptions(ppd, { "ppd:PageSize": "A5", "ppd:Stapling": "SS", "ppd:Folding": "True", "ppd:BookletPaperSize": "A4" })).toEqual([]);
    expect(validatePpdOptions(ppd, { "ppd:Stapling": "Glue" })[0]).toMatch(/"ppd:Stapling" = Glue is not a choice/);
    expect(validatePpdOptions(ppd, { "ppd:Nope": "x" })[0]).toMatch(/not an option/);
  });

  it("keeps copies as the one IPP attribute in PostScript mode and refuses ppd: keys in IPP mode", () => {
    expect(validateJobOptions({ "copies": 2, "ppd:Stapling": "SS" }, profile)).toEqual([]);
    expect(validateJobOptions({ "fit-to-margins": "true" }, profile)).toEqual([]);
    expect(validateJobOptions({ "fit-to-margins": "sometimes" }, profile)[0]).toMatch(/must be true or false/);
    expect(formFor(profile).map(f => f.name).slice(0, 2)).toEqual(["copies", "fit-to-margins"]);
    expect(validateJobOptions({ sides: "one-sided" }, profile)[0]).toMatch(/"sides" is not used in PostScript mode/);
    expect(validateJobOptions({ "ppd:Stapling": "SS" }, { ...profile, mode: "ipp" })[0]).toMatch(/needs PostScript mode/);
  });
});

describe.skipIf(!(await ghostscriptAvailable()))("ghostscript", () => {
  it("parses input only as PDF, including files retained before header validation was tightened", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "printmax-forged-pdf-"));
    const file = path.join(dir, "forged (document).pdf");
    try {
      await writeFile(file, "%PDF\n{} loop\n");
      await expect(pdfToPostScript(file, { timeoutMs: 2000 })).rejects.toThrow("Unrecoverable error");
      // A valid-looking header is also only a comment in PostScript. It must not be executed.
      await writeFile(file, "%PDF-1.7\n{} loop\n");
      await expect(pdfToPostScript(file, { timeoutMs: 2000 })).rejects.toThrow("Unrecoverable error");
    }
    finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bounds output and conversion time, and honors cancellation", async () => {
    const file = new URL("../fixtures/booklet-8-pages.pdf", import.meta.url).pathname;
    await expect(pdfToPostScript(file, { maxOutputBytes: 1024 })).rejects.toThrow("output size limit");
    await expect(pdfToPostScript(file, { timeoutMs: 1 })).rejects.toThrow("timed out");
    const controller = new AbortController();
    controller.abort();
    await expect(pdfToPostScript(file, { signal: controller.signal })).rejects.toThrow("canceled");
  });

  it("shrinks and centres each page inside the printer's margins when asked", async () => {
    const pdf = new URL("../fixtures/booklet-8-pages.pdf", import.meta.url).pathname;
    const box = async (ps: Buffer) => {
      const dir = await mkdtemp(path.join(tmpdir(), "printmax-bbox-"));
      const file = path.join(dir, "page.ps");
      await writeFile(file, ps);
      try {
        const { stderr } = await execFileAsync("gs", ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=bbox", "-dFirstPage=1", "-dLastPage=1", file]);
        return /%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/.exec(stderr)!.slice(1).map(Number);
      }
      finally {
        await rm(dir, { recursive: true, force: true });
      }
    };
    const edge = await box(await pdfToPostScript(pdf));
    const kept = await box(await pdfToPostScript(pdf, { margins: { left: 12, bottom: 12, right: 12, top: 12 } }));
    expect(edge[0]).toBeLessThan(20);
    expect(kept[0]).toBeGreaterThanOrEqual(24);
    expect(kept[1]).toBeGreaterThanOrEqual(24);
    expect(kept[2]).toBeLessThanOrEqual(420 - 24);
    expect(kept[3]).toBeLessThanOrEqual(595 - 24);
    // Uniform scale: the content's aspect ratio is preserved.
    const ratio = (b: number[]) => (b[2]! - b[0]!) / (b[3]! - b[1]!);
    expect(ratio(kept)).toBeCloseTo(ratio(edge), 2);
  });

  it("converts a PDF to DSC PostScript with one %%Page per page, forcing the paper when asked", async () => {
    const ps = (await pdfToPostScript(new URL("../fixtures/booklet-8-pages.pdf", import.meta.url).pathname, { paper: { width: 595, height: 842 } })).toString("latin1");
    expect(ps.startsWith("%!PS-Adobe")).toBe(true);
    expect(ps.match(/^%%Page:/gm)).toHaveLength(8);
    expect(ps).toMatch(/^%%BoundingBox: 0 0 595 842/m);
  });
});
