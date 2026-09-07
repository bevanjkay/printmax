import type { IppAttributes } from "../src/server/ipp/codec.js";
import { describe, expect, it } from "vitest";
import { applyResolvers, checkConstraints, describeViolation } from "../src/server/ipp/constraints.js";
import { validateJobOptions } from "../src/server/validation.js";

/** A printer that cannot duplex envelopes or staple transparencies, in PWG 5100.13 form. */
const caps: IppAttributes = {
  "job-creation-attributes-supported": { type: "keyword", values: ["sides", "media", "finishings", "media-type"] },
  "sides-supported": { type: "keyword", values: ["one-sided", "two-sided-long-edge", "two-sided-short-edge"] },
  "sides-default": { type: "keyword", values: ["two-sided-long-edge"] },
  "media-supported": { type: "keyword", values: ["iso_a4_210x297mm", "iso_dl_110x220mm"] },
  "media-default": { type: "keyword", values: ["iso_a4_210x297mm"] },
  "media-type-supported": { type: "keyword", values: ["stationery", "transparency"] },
  "finishings-supported": { type: "enum", values: [3, 4] },
  "finishings-default": { type: "enum", values: [3] },
  "job-constraints-supported": {
    type: "collection",
    values: [
      {
        "resolver-name": { type: "nameWithoutLanguage", values: ["duplex-envelope"] },
        "sides": { type: "keyword", values: ["two-sided-long-edge", "two-sided-short-edge"] },
        "media": { type: "keyword", values: ["iso_dl_110x220mm"] },
      },
      {
        "resolver-name": { type: "nameWithoutLanguage", values: ["staple-transparency"] },
        "finishings": { type: "enum", values: [4] },
        "media-type": { type: "keyword", values: ["transparency"] },
      },
    ],
  },
  "job-resolvers-supported": {
    type: "collection",
    values: [
      {
        "resolver-name": { type: "nameWithoutLanguage", values: ["duplex-envelope"] },
        "sides": { type: "keyword", values: ["one-sided"] },
      },
      {
        "resolver-name": { type: "nameWithoutLanguage", values: ["staple-transparency"] },
        "finishings": { type: "enum", values: [3] },
      },
    ],
  },
};

describe("checkConstraints", () => {
  it("flags a job whose values match every member of a constraint and names the resolver's fix", () => {
    const violations = checkConstraints({ sides: "two-sided-long-edge", media: "iso_dl_110x220mm" }, caps);
    expect(violations).toEqual([{
      resolverName: "duplex-envelope",
      conflict: { sides: ["two-sided-long-edge"], media: ["iso_dl_110x220mm"] },
      resolution: { sides: "one-sided" },
    }]);
    expect(describeViolation(violations[0]!)).toBe("sides=two-sided-long-edge with media=iso_dl_110x220mm is not a valid combination on this printer; suggested fix: sides=one-sided");
  });

  it("falls back to printer defaults for attributes the job does not set", () => {
    // sides-default is two-sided-long-edge, so an envelope job with no explicit sides still conflicts
    expect(checkConstraints({ media: "iso_dl_110x220mm" }, caps)).toHaveLength(1);
    expect(checkConstraints({ media: "iso_a4_210x297mm" }, caps)).toEqual([]);
  });

  it("accepts enum keyword names and reports them as names", () => {
    const [v] = checkConstraints({ "finishings": ["staple"], "media-type": "transparency" }, caps);
    expect(v?.conflict).toEqual({ "finishings": ["staple"], "media-type": ["transparency"] });
    expect(v?.resolution).toEqual({ finishings: "none" });
  });

  it("returns nothing when the printer publishes no constraints", () => {
    const { "job-constraints-supported": _c, ...noConstraints } = caps;
    expect(checkConstraints({ sides: "two-sided-long-edge", media: "iso_dl_110x220mm" }, noConstraints)).toEqual([]);
  });
});

describe("applyResolvers", () => {
  it("applies every matching resolver until the options are valid", () => {
    const resolved = applyResolvers({ "sides": "two-sided-short-edge", "media": "iso_dl_110x220mm", "finishings": ["staple"], "media-type": "transparency" }, caps);
    expect(resolved).toEqual({ "sides": "one-sided", "media": "iso_dl_110x220mm", "finishings": "none", "media-type": "transparency" });
    expect(checkConstraints(resolved, caps)).toEqual([]);
  });

  it("leaves valid options untouched", () => {
    const options = { sides: "one-sided", media: "iso_dl_110x220mm" };
    expect(applyResolvers(options, caps)).toEqual(options);
  });
});

describe("validateJobOptions", () => {
  it("reports capability errors before constraint errors", () => {
    expect(validateJobOptions({ sides: "sideways", media: "iso_dl_110x220mm" }, { caps, ppd: null, mode: "ipp" })).toEqual([
      "\"sides\" = sideways is not supported; choose from one-sided, two-sided-long-edge, two-sided-short-edge",
    ]);
    expect(validateJobOptions({ sides: "two-sided-long-edge", media: "iso_dl_110x220mm" }, { caps, ppd: null, mode: "ipp" })).toEqual([
      "sides=two-sided-long-edge with media=iso_dl_110x220mm is not a valid combination on this printer; suggested fix: sides=one-sided",
    ]);
  });
});
