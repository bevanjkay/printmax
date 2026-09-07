import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formFor } from "../src/server/form.js";
import { assemblePostScript, jclHeader, setupBlock } from "../src/server/ppd/assemble.js";
import { ppdFields, validatePpdOptions } from "../src/server/ppd/form.js";
import { ghostscriptAvailable, pdfToPostScript } from "../src/server/ppd/ghostscript.js";
import { parsePpd } from "../src/server/ppd/parser.js";
import { validateJobOptions } from "../src/server/validation.js";

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
    expect(fields.find(f => f.name === "ppd:Stapling")).toMatchObject({ label: "Stapling", default: "None", help: "Finishing" });
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
    expect(validateJobOptions({ sides: "one-sided" }, profile)[0]).toMatch(/"sides" is not used in PostScript mode/);
    expect(validateJobOptions({ "ppd:Stapling": "SS" }, { ...profile, mode: "ipp" })[0]).toMatch(/needs PostScript mode/);
  });
});

describe.skipIf(!(await ghostscriptAvailable()))("ghostscript", () => {
  it("converts a PDF to DSC PostScript with one %%Page per page, forcing the paper when asked", async () => {
    const ps = (await pdfToPostScript(new URL("../fixtures/booklet-8-pages.pdf", import.meta.url).pathname, { paper: { width: 595, height: 842 } })).toString("latin1");
    expect(ps.startsWith("%!PS-Adobe")).toBe(true);
    expect(ps.match(/^%%Page:/gm)).toHaveLength(8);
    expect(ps).toMatch(/^%%BoundingBox: 0 0 595 842/m);
  });
});
