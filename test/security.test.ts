import type { FastifyInstance, FastifyRequest } from "fastify";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/server/app.js";
import { createSession, createUser } from "../src/server/auth.js";
import { loadConfig } from "../src/server/config.js";
import { openDb } from "../src/server/db.js";
import { receiveUpload, sweepAbandonedUploads } from "../src/server/routes/upload.js";
import { multipart } from "./helpers/multipart.js";

describe("security boundaries", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let app: FastifyInstance;
  let cookie: string;
  let adminCookie: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "printmax-security-"));
    db = openDb(":memory:");
    const admin = createUser(db, { name: "Admin", email: "admin@example.org", password: "test password", role: "admin" });
    const user = createUser(db, { name: "User", email: "user@example.org", password: "test password", role: "user" });
    cookie = `printmax_session=${createSession(db, user.id).token}`;
    adminCookie = `printmax_session=${createSession(db, admin.id).token}`;
    const caps = await readFile(new URL("../fixtures/ippeveprinter.json", import.meta.url), "utf8");
    db.prepare("INSERT INTO printers (name, uri, caps_discovered, created_at) VALUES (?, ?, ?, ?)")
      .run("Fixture", "ipp://127.0.0.1:1/ipp/print", caps, new Date().toISOString());
    app = await buildApp({ db, uploadDir: dir, storedDir: dir, maxUploadBytes: 32, loginAttemptsPerMinute: 2 });
  });

  afterEach(async () => {
    await app.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("ignores forged forwarded addresses by default when enforcing login limits", async () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: "127.0.0.1" }).trustProxy).toBe("127.0.0.1");
    expect(loadConfig({ TRUST_PROXY: "127.0.0.1, ::1" }).trustProxy).toEqual(["127.0.0.1", "::1"]);
    const codes = [];
    for (let i = 1; i <= 3; i++) {
      const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-forwarded-for": `192.0.2.${i}` }, payload: { email: "user@example.org", password: "wrong" } });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([401, 401, 429]);
  });

  it.each(["/api/jobs", "/api/library", "/api/library/1/file"])("removes oversized uploads rejected by %s", async (url) => {
    const upload = multipart({ printerId: "1" }, { name: "test.pdf", content: `%PDF-1.7\n${"a".repeat(64)}` });
    const res = await app.inject({ method: url.endsWith("/file") ? "PUT" : "POST", url, ...upload, headers: { ...upload.headers, cookie } });
    expect(res.statusCode).toBe(413);
    expect(await readdir(dir)).toEqual([]);
  });

  it("rejects a second file even when the parser destroys the first buffered stream", async () => {
    const payload = Buffer.from("--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.pdf\"\r\n\r\n%PDF-1.7\n\r\n--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"b.pdf\"\r\n\r\n%PDF-1.7\n\r\n--boundary--\r\n");
    const res = await app.inject({ method: "POST", url: "/api/jobs", headers: { cookie, "content-type": "multipart/form-data; boundary=boundary" }, payload });
    expect(res.statusCode).toBe(413);
    expect(await readdir(dir)).toEqual([]);
  });

  it("cleans up when the file stream fails mid-upload", async () => {
    const req = {
      isMultipart: () => true,
      async* parts() {
        yield { type: "file", filename: "broken.pdf", file: Readable.from((async function* () {
          yield Buffer.from("%PDF-1.7\n");
          throw new Error("connection reset");
        })()) };
      },
    } as unknown as FastifyRequest;
    await expect(receiveUpload(req, dir)).rejects.toThrow("connection reset");
    expect(await readdir(dir)).toEqual([]);
  });

  it("rejects PostScript disguised with the old four-byte PDF signature", async () => {
    const upload = multipart({ printerId: "1" }, { name: "loop.pdf", content: "%PDF\n{} loop\n" });
    const res = await app.inject({ method: "POST", url: "/api/jobs", ...upload, headers: { ...upload.headers, cookie } });
    expect(res.statusCode).toBe(415);
    expect(await readdir(dir)).toEqual([]);
  });

  it("sweeps old abandoned temporary files without removing fresh files or documents", async () => {
    const old = `${randomUUID()}.upload`;
    const fresh = `${randomUUID()}.upload`;
    const document = `${randomUUID()}.pdf`;
    for (const name of [old, fresh, document])
      await writeFile(path.join(dir, name), "document");
    const yesterday = new Date(Date.now() - 2 * 86_400_000);
    for (const name of [old, document])
      await utimes(path.join(dir, name), yesterday, yesterday);
    expect(await sweepAbandonedUploads([dir])).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([fresh, document].sort());
  });

  it("does not sweep an active upload even if its timestamp is old", async () => {
    const file = new PassThrough();
    const req = {
      isMultipart: () => true,
      async* parts() { yield { type: "file", filename: "test.pdf", file }; },
    } as unknown as FastifyRequest;
    const pending = receiveUpload(req, dir);
    try {
      file.write("%PDF-1.7\n");
      await vi.waitFor(async () => expect(await readdir(dir)).toHaveLength(1));
      const name = (await readdir(dir))[0]!;
      await utimes(path.join(dir, name), new Date(0), new Date(0));
      expect(await sweepAbandonedUploads([dir])).toBe(0);
      file.end();
      expect((await pending).format).toBe("application/pdf");
    }
    finally {
      file.destroy();
      await pending.catch(() => {});
    }
  });

  it("uses the saved snapshot for listing and printing after a preset becomes private", async () => {
    const preset = (await app.inject({ method: "POST", url: "/api/presets", headers: { cookie: adminCookie }, payload: { printerId: 1, name: "Shared", scope: "global", options: { copies: 1 } } })).json();
    const upload = multipart({ printerId: "1", presetId: String(preset.id), name: "Bulletin", scope: "global" }, { name: "test.pdf", content: "%PDF-1.7\n" });
    const saved = await app.inject({ method: "POST", url: "/api/library", ...upload, headers: { ...upload.headers, cookie: adminCookie } });
    expect(saved.statusCode).toBe(201);
    const id = saved.json().id;
    expect((await app.inject({ method: "PUT", url: `/api/presets/${preset.id}`, headers: { cookie: adminCookie }, payload: { name: "Private name", scope: "user", options: { copies: 2 } } })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/presets/${preset.id}`, headers: { cookie } })).statusCode).toBe(404);
    const entries = (await app.inject({ url: "/api/library", headers: { cookie } })).json();
    expect(entries[0]).toMatchObject({ presetId: null, presetName: null, effectiveOptions: { copies: 1 } });
    const printed = await app.inject({ method: "POST", url: `/api/library/${id}/print`, headers: { cookie } });
    expect(printed.statusCode).toBe(201);
    expect(printed.json()).toMatchObject({ presetId: null, options: { copies: 1 } });

    // Explicitly sharing a personal preset saves today's values without exposing future edits.
    const snapshot = await app.inject({ method: "POST", url: "/api/library", ...upload, headers: { ...upload.headers, cookie: adminCookie } });
    expect(snapshot.statusCode).toBe(201);
    expect(snapshot.json()).toMatchObject({ presetId: null, presetName: null, effectiveOptions: { copies: 2 } });
    await app.inject({ method: "PUT", url: `/api/presets/${preset.id}`, headers: { cookie: adminCookie }, payload: { name: "New private name", scope: "user", options: { copies: 3 } } });
    const snapshots = (await app.inject({ url: "/api/library", headers: { cookie } })).json();
    expect(snapshots.find((entry: { id: number }) => entry.id === snapshot.json().id).effectiveOptions).toEqual({ copies: 2 });
  });
});
