import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.js";

describe("loadConfig", () => {
  it("reads numeric settings from the environment it is given", () => {
    expect(loadConfig({ POLL_INTERVAL_MS: "500" }).pollIntervalMs).toBe(500);
    expect(loadConfig({ MAX_UPLOAD_MB: "20" }).maxUploadBytes).toBe(20 * 1024 * 1024);
    expect(loadConfig({}).pollIntervalMs).toBe(3000);
    expect(() => loadConfig({ MAX_UPLOAD_MB: "lots" })).toThrow(/must be a number/);
  });
});
