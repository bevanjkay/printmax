import type { JobRow } from "../src/server/jobs.js";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { createUser } from "../src/server/auth.js";
import { openDb } from "../src/server/db.js";
import { printJob } from "../src/server/ipp/operations.js";
import { createJob, submitJob } from "../src/server/jobs.js";
import { pdfToPostScript } from "../src/server/ppd/ghostscript.js";

vi.mock("../src/server/ppd/ghostscript.js", () => ({ pdfToPostScript: vi.fn() }));
vi.mock("../src/server/ipp/operations.js", async original => ({ ...await original<typeof import("../src/server/ipp/operations.js")>(), printJob: vi.fn() }));

const ppd = readFileSync(new URL("../fixtures/toshiba-e-studio-excerpt.ppd", import.meta.url), "utf8");

function convert(options: Record<string, unknown>) {
  const db = openDb(":memory:");
  const user = createUser(db, { name: "User", email: "user@example.org", password: "test password", role: "user" });
  db.prepare("INSERT INTO printers (name, uri, created_at, ppd, print_mode) VALUES (?, ?, ?, ?, ?)")
    .run("Fixture", "ipp://127.0.0.1:1/ipp/print", new Date().toISOString(), ppd, "postscript");
  const job = createJob(db, { printerId: 1, user, filename: "test.pdf", filePath: "/unused/test.pdf", byteSize: 10, documentFormat: "application/pdf", options });
  return submitJob(db, job as JobRow).then(() => vi.mocked(pdfToPostScript).mock.calls.at(-1)![1]!);
}

beforeEach(() => {
  vi.mocked(pdfToPostScript).mockResolvedValue(Buffer.from("%!PS-Adobe-3.0\n%%Page: 1 1\nshowpage\n"));
  vi.mocked(printJob).mockResolvedValue({ jobId: 1, state: "completed", stateReasons: [] });
});

it("converts at the engine's resolution so a transparent page costs what the printer can image", async () => {
  expect(await convert({ "ppd:PageSize": "A4" })).toMatchObject({ resolution: { x: 600, y: 600 } });
});

it("scales pages to the chosen paper only while fit to paper is on", async () => {
  expect(await convert({ "ppd:PageSize": "A4", "fit-to-page": "true" })).toMatchObject({ paper: { width: 595, height: 842 } });
  expect(await convert({ "ppd:PageSize": "A4", "fit-to-page": "false" })).not.toHaveProperty("paper");
});
