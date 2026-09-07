import type { IppAttributes } from "../src/server/ipp/codec.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildJobAttributes, choicesFor, validateOptions } from "../src/server/ipp/options.js";

const caps = JSON.parse(readFileSync(new URL("../fixtures/ippeveprinter.json", import.meta.url), "utf8")) as IppAttributes;

describe("buildJobAttributes", () => {
  it("types values from the registry, the printer's -supported attributes, and JS types", () => {
    const attrs = buildJobAttributes({
      "copies": "2",
      "sides": "two-sided-long-edge",
      "print-quality": "high",
      "finishings": ["none"],
      "page-ranges": "1-3",
      "printer-resolution": "600dpi",
      "media-col": { "media-source": "main", "media-size": { "x-dimension": 21000, "y-dimension": 29700 } },
      "some-vendor-flag": true,
      "ignored": "",
    }, caps);
    expect(attrs).toEqual({
      "copies": { type: "integer", values: [2] },
      "sides": { type: "keyword", values: ["two-sided-long-edge"] },
      "print-quality": { type: "enum", values: [5] },
      "finishings": { type: "enum", values: [3] },
      "page-ranges": { type: "rangeOfInteger", values: [{ min: 1, max: 3 }] },
      "printer-resolution": { type: "resolution", values: [{ x: 600, y: 600, units: 3 }] },
      "media-col": {
        type: "collection",
        values: [{
          "media-source": { type: "keyword", values: ["main"] },
          "media-size": {
            type: "collection",
            values: [{
              "x-dimension": { type: "integer", values: [21000] },
              "y-dimension": { type: "integer", values: [29700] },
            }],
          },
        }],
      },
      "some-vendor-flag": { type: "boolean", values: [true] },
    });
  });
});

describe("validateOptions", () => {
  it("accepts options drawn from the printer's own capabilities", () => {
    expect(validateOptions({ "sides": "two-sided-long-edge", "copies": 5, "print-quality": "draft", "media": "iso_a4_210x297mm" }, caps)).toEqual([]);
  });

  it("explains unsupported values and out-of-range integers", () => {
    const errors = validateOptions({ "sides": "three-sided", "copies": 5000, "print-color-mode": "color" }, caps);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/"sides" = three-sided is not supported; choose from one-sided, two-sided-long-edge/);
    expect(errors[1]).toMatch(/"copies" must be between 1 and 999/);
    expect(errors[2]).toMatch(/"print-color-mode" = color is not supported/);
  });

  it("does not treat job-priority-supported as a value list", () => {
    expect(validateOptions({ "job-priority": 50 }, caps)).toEqual([]);
    expect(validateOptions({ "job-priority": 500 }, caps)).toEqual(["\"job-priority\" must be between 1 and 100"]);
  });

  it("rejects attributes the printer does not list in job-creation-attributes-supported", () => {
    expect(validateOptions({ "job-account-id": "dept-42" }, caps)).toEqual([
      "\"job-account-id\" is not a job attribute this printer accepts",
    ]);
  });

  it("reports unknown enum names", () => {
    expect(validateOptions({ finishings: "glitter" }, caps)).toEqual(["\"finishings\" has no enum value named \"glitter\""]);
  });
});

describe("choicesFor", () => {
  it("returns supported values and the default", () => {
    expect(choicesFor(caps, "sides")).toEqual({ choices: ["one-sided", "two-sided-long-edge", "two-sided-short-edge"], default: "one-sided" });
    expect(choicesFor(caps, "nonexistent")).toEqual({ choices: [], default: undefined });
  });
});

describe("media-col folding", () => {
  const toshiba = JSON.parse(readFileSync(new URL("../fixtures/toshiba-e-studio3515ac.json", import.meta.url), "utf8")) as IppAttributes;

  it("moves tray and paper type into media-col for printers that only take them there", () => {
    const attrs = buildJobAttributes({ "media": "iso_a4_210x297mm", "media-source": "by-pass-tray", "media-type": "jp.co.toshibatec.thick3", "sides": "one-sided" }, toshiba);
    expect(attrs).toEqual({
      "sides": { type: "keyword", values: ["one-sided"] },
      "media-col": {
        type: "collection",
        values: [{
          "media-source": { type: "keyword", values: ["by-pass-tray"] },
          "media-type": { type: "keyword", values: ["jp.co.toshibatec.thick3"] },
          "media-size": {
            type: "collection",
            values: [{
              "x-dimension": { type: "integer", values: [21000] },
              "y-dimension": { type: "integer", values: [29700] },
            }],
          },
        }],
      },
    });
  });

  it("leaves media flat when there is nothing to fold, and never folds for printers that accept the flat attributes", () => {
    expect(buildJobAttributes({ media: "iso_a4_210x297mm" }, toshiba)).toEqual({ media: { type: "keyword", values: ["iso_a4_210x297mm"] } });
    expect(buildJobAttributes({ "media-source": "main" }, caps)).toEqual({ "media-source": { type: "keyword", values: ["main"] } });
  });

  it("validates folded members against their own -supported lists", () => {
    expect(validateOptions({ "media-source": "by-pass-tray", "media-type": "envelope", "media": "iso_dl_110x220mm" }, toshiba)).toEqual([]);
    const errors = validateOptions({ "media-source": "by-pass-tray", "media-type": "cardboard" }, toshiba);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/"media-type" = cardboard is not supported/);
  });
});
