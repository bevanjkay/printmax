import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createUser } from "../src/server/auth.js";
import { openDb } from "../src/server/db.js";
import { printJob } from "../src/server/ipp/operations.js";
import { cancelJob, createJob, requireJob, startJobWorker } from "../src/server/jobs.js";
import { pdfToPostScript } from "../src/server/ppd/ghostscript.js";

vi.mock("../src/server/ppd/ghostscript.js", () => ({ pdfToPostScript: vi.fn() }));
vi.mock("../src/server/ipp/operations.js", async original => ({ ...await original<typeof import("../src/server/ipp/operations.js")>(), printJob: vi.fn() }));

it("cancels an active conversion without printing it and continues to the next queued job", async () => {
  const db = openDb(":memory:");
  const user = createUser(db, { name: "User", email: "user@example.org", password: "test password", role: "user" });
  const ppd = readFileSync(new URL("../fixtures/toshiba-e-studio-excerpt.ppd", import.meta.url), "utf8");
  db.prepare("INSERT INTO printers (name, uri, created_at, ppd, print_mode) VALUES (?, ?, ?, ?, ?)")
    .run("Fixture", "ipp://127.0.0.1:1/ipp/print", new Date().toISOString(), ppd, "postscript");
  const input = { printerId: 1, user, filename: "test.pdf", filePath: "/unused/test.pdf", byteSize: 10, documentFormat: "application/pdf", options: {} };
  const first = createJob(db, input);
  const second = createJob(db, input);
  let onStarted: (signal: AbortSignal) => void;
  const started = new Promise<AbortSignal>((resolve) => {
    onStarted = resolve;
  });
  vi.mocked(pdfToPostScript).mockImplementationOnce((_file, opts) => new Promise((_resolve, reject) => {
    const signal = opts!.signal!;
    signal.addEventListener("abort", () => reject(new Error("conversion aborted")), { once: true });
    onStarted(signal);
  })).mockResolvedValue(Buffer.from("%!PS-Adobe-3.0\n%%Page: 1 1\nshowpage\n"));
  vi.mocked(printJob).mockResolvedValue({ jobId: 1, state: "completed", stateReasons: [] });
  const worker = startJobWorker(db, { intervalMs: 60_000 });
  let pending: Promise<void> | undefined;
  try {
    pending = worker.tick();
    const signal = await started;
    await cancelJob(db, first.id, user);
    expect(signal.aborted).toBe(true);
    await pending;
    expect(requireJob(db, first.id).state).toBe("canceled");
    expect(requireJob(db, second.id).state).toBe("completed");
    expect(printJob).toHaveBeenCalledTimes(1);
  }
  finally {
    worker.stop();
    await pending;
    db.close();
  }
});
