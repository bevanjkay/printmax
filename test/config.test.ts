import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/server/config.js";

describe("loadConfig", () => {
  it("reads numeric settings from the environment it is given", () => {
    expect(loadConfig({ POLL_INTERVAL_MS: "500" }).pollIntervalMs).toBe(500);
    expect(loadConfig({ MAX_UPLOAD_MB: "20" }).maxUploadBytes).toBe(20 * 1024 * 1024);
    expect(loadConfig({}).pollIntervalMs).toBe(3000);
    expect(() => loadConfig({ MAX_UPLOAD_MB: "lots" })).toThrow(/must be a number/);
  });

  it("turns on Google sign-in only when it is fully configured", () => {
    expect(loadConfig({}).google).toBeNull();
    expect(loadConfig({
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_ALLOWED_DOMAINS: "Reside.church, gc.org.au",
      PUBLIC_URL: "https://print.example.org",
    }).google).toEqual({
      clientId: "id",
      clientSecret: "secret",
      allowedDomains: ["reside.church", "gc.org.au"],
      redirectUri: "https://print.example.org/api/auth/google/callback",
    });
    expect(() => loadConfig({ GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_DOMAINS, PUBLIC_URL/);
  });
});
