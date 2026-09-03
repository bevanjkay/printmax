import type { InjectOptions } from "fastify";
import type { PrinterDto } from "../src/shared/types.js";
import type { VirtualPrinter } from "./helpers/ippeve.js";
import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { openDb } from "../src/server/db.js";
import { getJob, startJobWorker } from "../src/server/jobs.js";
import { ippeveprinterAvailable, startVirtualPrinter } from "./helpers/ippeve.js";

const MINIMAL_PDF = [
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj",
  "trailer << /Root 1 0 R >>",
  "%%EOF",
  "",
].join("\n");

const FINISHED = ["completed", "aborted", "canceled", "failed"];

function multipart(fields: Record<string, string>, file: { name: string; content: string }): { headers: Record<string, string>; payload: Buffer } {
  const boundary = "----printmax";
  const parts = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n\r\n${file.content}\r\n--${boundary}--\r\n`);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(parts.join("")),
  };
}

const available = await ippeveprinterAvailable();

describe.skipIf(!available)("end to end against ippeveprinter", () => {
  let printer: VirtualPrinter;
  let workDir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: ReturnType<typeof openDb>;
  let cookie: string;

  const asAdmin = (opts: InjectOptions): InjectOptions => ({ ...opts, headers: { ...(opts.headers ?? {}), cookie } });

  beforeAll(async () => {
    printer = await startVirtualPrinter();
    workDir = await mkdtemp(path.join(tmpdir(), "printmax-test-"));
    db = openDb(":memory:");
    app = await buildApp({ db, uploadDir: workDir });
    const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { name: "Admin", email: "admin@example.org", password: "adminadmin" } });
    cookie = `printmax_session=${setup.cookies.find(c => c.name === "printmax_session")!.value}`;
  });

  afterAll(async () => {
    await app?.close();
    db?.close();
    await printer?.stop();
    if (workDir)
      await rm(workDir, { recursive: true, force: true });
  });

  async function firstPrinterId(): Promise<number> {
    const printers = (await app.inject(asAdmin({ method: "GET", url: "/api/printers" }))).json<PrinterDto[]>();
    return printers[0]!.id;
  }

  it("adds a printer by URI and stores its discovered capabilities", async () => {
    const res = await app.inject(asAdmin({ method: "POST", url: "/api/printers", payload: { uri: printer.uri } }));
    expect(res.statusCode, res.body).toBe(201);
    const dto = res.json<PrinterDto>();
    expect(dto.name).toBe("printmax test");
    expect(dto.summary.documentFormats).toContain("application/pdf");
    expect(dto.summary.sides).toEqual(["one-sided", "two-sided-long-edge", "two-sided-short-edge"]);
    expect(dto.summary.jobCreationAttributes).toContain("sides");

    const caps = await app.inject(asAdmin({ method: "GET", url: `/api/printers/${dto.id}/caps` }));
    expect(caps.json()["printer-uri-supported"].type).toBe("uri");
  });

  it("rejects an unreachable printer with a readable error", async () => {
    const res = await app.inject(asAdmin({ method: "POST", url: "/api/printers", payload: { uri: "ipp://127.0.0.1:1/ipp/print" } }));
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/could not reach printer/);
  });

  it("re-fetches capabilities without recording a change when nothing moved", async () => {
    const id = await firstPrinterId();
    const res = await app.inject(asAdmin({ method: "POST", url: `/api/printers/${id}/refresh` }));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<PrinterDto>().pendingChanges).toBe(0);
  });

  it("uploads a PDF, submits it through a preset with per-job overrides, and polls it to completion", async () => {
    const printerId = await firstPrinterId();
    const preset = await app.inject(asAdmin({ method: "POST", url: "/api/presets", payload: { printerId, name: "Duplex", scope: "global", options: { "sides": "two-sided-long-edge", "print-quality": "high" } } }));
    expect(preset.statusCode, preset.body).toBe(201);
    const presetId = preset.json<{ id: number }>().id;

    const res = await app.inject(asAdmin({
      method: "POST",
      url: "/api/jobs",
      ...multipart({ printerId: String(printerId), presetId: String(presetId), options: JSON.stringify({ copies: 2 }) }, { name: "hello.pdf", content: MINIMAL_PDF }),
    }));
    expect(res.statusCode, res.body).toBe(201);
    const job = res.json<{ id: number; state: string; documentFormat: string; options: Record<string, unknown>; presetId: number; userName: string }>();
    expect(job.state).toBe("queued");
    expect(job.documentFormat).toBe("application/pdf");
    expect(job.presetId).toBe(presetId);
    expect(job.userName).toBe("Admin");
    expect(job.options).toEqual({ "sides": "two-sided-long-edge", "print-quality": "high", "copies": 2 });

    const worker = startJobWorker(db, { intervalMs: 60_000 });
    try {
      const deadline = Date.now() + 20_000;
      let state = job.state;
      while (Date.now() < deadline && !FINISHED.includes(state)) {
        await worker.tick();
        state = getJob(db, job.id)!.state;
        if (!FINISHED.includes(state))
          await new Promise(r => setTimeout(r, 300));
      }
      const row = getJob(db, job.id)!;
      expect(row.ipp_job_id).toBeGreaterThan(0);
      expect(row.state).toBe("completed");
      expect(row.completed_at).not.toBeNull();
    }
    finally {
      worker.stop();
    }
  });

  it("refuses options the printer does not support before anything is sent", async () => {
    const printerId = await firstPrinterId();
    const res = await app.inject(asAdmin({ method: "POST", url: "/api/jobs", ...multipart({ printerId: String(printerId), options: JSON.stringify({ sides: "upside-down" }) }, { name: "x.pdf", content: MINIMAL_PDF }) }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/"sides" = upside-down is not supported/);
  });

  it("rejects files that are not PDF, PNG or JPEG", async () => {
    const printerId = await firstPrinterId();
    const res = await app.inject(asAdmin({ method: "POST", url: "/api/jobs", ...multipart({ printerId: String(printerId) }, { name: "x.docx", content: "PKnope" }) }));
    expect(res.statusCode).toBe(415);
  });

  it("retries with backoff when the printer is unreachable, then fails", async () => {
    const file = path.join(workDir, "r.pdf");
    await writeFile(file, MINIMAL_PDF);
    const timestamp = new Date().toISOString();
    db.prepare("INSERT INTO printers (name, uri, caps_discovered, created_at) VALUES (?, ?, ?, ?)").run("dead", "ipp://127.0.0.1:1/ipp/print", "{}", timestamp);
    const dead = db.prepare("SELECT id FROM printers WHERE name = 'dead'").get() as { id: number };
    const inserted = db.prepare("INSERT INTO jobs (printer_id, filename, file_path, byte_size, document_format, options_final, state, next_attempt_at, created_at) VALUES (?, 'r.pdf', ?, 1, 'application/pdf', '{}', 'queued', ?, ?)")
      .run(dead.id, file, timestamp, timestamp);
    const jobId = Number(inserted.lastInsertRowid);

    const worker = startJobWorker(db, { intervalMs: 60_000 });
    try {
      await worker.tick();
      let row = getJob(db, jobId)!;
      expect(row.state).toBe("retrying");
      expect(row.attempts).toBe(1);
      expect(row.error).toMatch(/ECONNREFUSED/);
      expect(new Date(row.next_attempt_at!).getTime()).toBeGreaterThan(Date.now() + 1000);

      for (let i = 0; i < 5; i += 1) {
        db.prepare("UPDATE jobs SET next_attempt_at = ? WHERE id = ?").run(new Date(0).toISOString(), jobId);
        await worker.tick();
      }
      row = getJob(db, jobId)!;
      expect(row.state).toBe("failed");
      expect(row.attempts).toBe(5);
    }
    finally {
      worker.stop();
    }
  });
});
