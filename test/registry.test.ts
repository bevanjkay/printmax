import { describe, expect, it } from "vitest";
import { standardValues } from "../src/shared/registry.js";

describe("standardValues", () => {
  it("knows keyword vocabularies for the attributes the UI exposes, with or without the -supported suffix", () => {
    expect(standardValues("sides-supported")).toEqual(["one-sided", "two-sided-long-edge", "two-sided-short-edge"]);
    expect(standardValues("media-source")).toContain("by-pass-tray");
    expect(standardValues("media-supported")).toContain("iso_a4_210x297mm");
  });

  it("uses the enum tables for enum attributes", () => {
    expect(standardValues("finishings-supported")).toContain("staple-top-left");
    expect(standardValues("print-quality")).toEqual(["draft", "normal", "high"]);
  });

  it("is empty for attributes without a fixed vocabulary", () => {
    expect(standardValues("job-name")).toEqual([]);
    expect(standardValues("copies-supported")).toEqual([]);
  });
});
