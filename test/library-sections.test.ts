import { describe, expect, it } from "vitest";
import { sectionOpen, withSection } from "../src/client/sections.js";

const closed = { query: "", sections: {} };

describe("library section toggles", () => {
  it("keeps every section closed until something opens it", () => {
    expect(sectionOpen(closed, "group-1", "")).toBe(false);
    expect(sectionOpen(withSection(closed, "", "group-1", true), "group-1", "")).toBe(true);
  });

  it("opens the groups a search matched, even ones collapsed by hand beforehand", () => {
    const byHand = withSection(closed, "", "group-1", false);
    expect(sectionOpen(byHand, "group-1", "")).toBe(false);
    expect(sectionOpen(byHand, "group-1", "bulletin")).toBe(true);
  });

  it("still lets a section be shut while the search that shut it is running", () => {
    const duringSearch = withSection(closed, "bulletin", "group-1", false);
    expect(sectionOpen(duringSearch, "group-1", "bulletin")).toBe(false);
    expect(sectionOpen(duringSearch, "group-2", "bulletin")).toBe(true);
    // Typing on moves to a different search, which opens what it found afresh.
    expect(sectionOpen(duringSearch, "group-1", "bulletins")).toBe(true);
  });

  it("goes back to collapsed once the search is cleared", () => {
    const opened = withSection(closed, "bulletin", "group-1", true);
    expect(sectionOpen(opened, "group-1", "")).toBe(false);
  });
});
