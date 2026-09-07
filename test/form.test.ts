import type { IppAttributes } from "../src/server/ipp/codec.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildForm } from "../src/server/form.js";
import { keywordLabel } from "../src/shared/attributes.js";

const caps = JSON.parse(readFileSync(new URL("../fixtures/ippeveprinter.json", import.meta.url), "utf8")) as IppAttributes;

describe("buildForm", () => {
  const fields = buildForm(caps);
  const byName = Object.fromEntries(fields.map(f => [f.name, f]));

  it("takes its field list from job-creation-attributes-supported and hides app-managed attributes", () => {
    const names = fields.map(f => f.name);
    expect(names[0]).toBe("copies");
    expect(names).toContain("sides");
    expect(names).toContain("page-ranges");
    expect(names).not.toContain("document-format");
    expect(names).not.toContain("job-name");
    expect(names).not.toContain("ipp-attribute-fidelity");
    expect(names).not.toContain("overrides");
  });

  it("builds choices from -supported and the initial value from -default", () => {
    expect(byName.sides).toEqual({
      name: "sides",
      label: "Duplex",
      widget: "select",
      choices: [
        { value: "one-sided", label: "Single-sided" },
        { value: "two-sided-long-edge", label: "Double-sided, long edge" },
        { value: "two-sided-short-edge", label: "Double-sided, short edge" },
      ],
      default: "one-sided",
    });
    expect(byName["print-quality"]?.choices?.map(c => c.value)).toEqual(["draft", "normal", "high"]);
    expect(byName["print-quality"]?.default).toBe("normal");
  });

  it("turns rangeOfInteger support into a bounded number input", () => {
    expect(byName.copies).toMatchObject({ widget: "number", min: 1, max: 999, default: 1 });
  });

  it("gives enum multi-value attributes a multiselect with keyword names", () => {
    expect(byName.finishings).toBeUndefined(); // only "none" is offered, so there is nothing to choose
  });

  it("bounds job-priority to 1-100 because job-priority-supported is a level count, not a value list", () => {
    expect(byName["job-priority"]).toMatchObject({ widget: "number", min: 1, max: 100, default: 50 });
  });

  it("offers free text for attributes whose -supported is a bare true", () => {
    expect(byName["page-ranges"]).toMatchObject({ widget: "text", help: "For example 1-3" });
  });
});

describe("keywordLabel", () => {
  it("humanises PWG media names and keywords", () => {
    expect(keywordLabel("iso_a4_210x297mm")).toBe("A4 (210×297 mm)");
    expect(keywordLabel("na_letter_8.5x11in")).toBe("Letter (8.5×11 in)");
    expect(keywordLabel("iso_dl_110x220mm")).toBe("DL (110×220 mm)");
    expect(keywordLabel("iso_sra3_320x450mm")).toBe("SRA3 (320×450 mm)");
    expect(keywordLabel("two-sided-long-edge")).toBe("Double-sided, long edge");
    expect(keywordLabel("stationery-letterhead")).toBe("Letterhead");
    expect(keywordLabel("some-unknown_thing")).toBe("Some unknown thing");
  });
});

describe("buildForm for a printer that takes tray and paper type through media-col", () => {
  const toshiba = JSON.parse(readFileSync(new URL("../fixtures/toshiba-e-studio3515ac.json", import.meta.url), "utf8")) as IppAttributes;
  const fields = buildForm(toshiba);
  const byName = Object.fromEntries(fields.map(f => [f.name, f]));

  it("offers Tray and Paper type as ordinary fields", () => {
    expect(byName["media-source"]?.choices?.map(c => c.value)).toEqual(["auto", "tray-1", "tray-2", "tray-3", "by-pass-tray"]);
    expect(byName["media-type"]?.label).toBe("Paper type");
    expect(byName["media-type"]?.default).toBe("stationery");
    expect(byName["media-source"]?.default).toBeUndefined();
    expect(fields.map(f => f.name)).not.toContain("media-col");
  });

  it("gives vendor keywords readable labels", () => {
    const labels = Object.fromEntries((byName["media-type"]?.choices ?? []).map(c => [c.value, c.label]));
    expect(labels["jp.co.toshibatec.thick3"]).toBe("Thick 3");
    expect(labels["jp.co.toshibatec.recycled"]).toBe("Recycled");
    expect(labels.stationery).toBe("Plain paper");
    expect(keywordLabel("jp.co.toshibatec.special1")).toBe("Special 1");
  });
});
