import type { CallToolResult } from "@modelcontextprotocol/client";
import type { FastifyInstance } from "fastify";
import { Buffer } from "node:buffer";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { createApiToken, createUser } from "../src/server/auth.js";
import { openDb } from "../src/server/db.js";

const PDF = Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64");

describe("mCP server", () => {
  let dir: string;
  let db: ReturnType<typeof openDb>;
  let app: FastifyInstance;
  let url: URL;
  let client: Client;
  let userToken: string;
  let printerId: number;
  let adminJobId: number;

  const text = (result: CallToolResult) => (result.content[0] as { text: string }).text;
  const call = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, text(result)).toBeFalsy();
    return JSON.parse(text(result)) as T;
  };
  const refusal = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    return text(result);
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "printmax-mcp-"));
    db = openDb(":memory:");
    const admin = createUser(db, { name: "Admin", email: "admin@example.org", password: "test password", role: "admin" });
    const user = createUser(db, { name: "Pat", email: "pat@example.org", password: "test password", role: "user" });
    userToken = createApiToken(db, user.id, "Assistant").secret;
    const caps = await readFile(new URL("../fixtures/ippeveprinter.json", import.meta.url), "utf8");
    const stamp = new Date().toISOString();
    printerId = Number(db.prepare("INSERT INTO printers (name, uri, caps_discovered, created_at) VALUES ('Front office', 'ipp://127.0.0.1:1/ipp/print', ?, ?)").run(caps, stamp).lastInsertRowid);
    adminJobId = Number(db.prepare("INSERT INTO jobs (user_id, printer_id, filename, byte_size, document_format, state, created_at) VALUES (?, ?, 'payroll.pdf', 1, 'application/pdf', 'completed', ?)").run(admin.id, printerId, stamp).lastInsertRowid);

    app = await buildApp({ db, uploadDir: dir, storedDir: dir });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    url = new URL("/mcp", address);
    client = new Client({ name: "printmax-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${userToken}` } } }));
  });

  afterAll(async () => {
    await client.close();
    await app.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("needs a token or a session", async () => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("lists its tools, marking which ones print", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(["add_library_document", "cancel_job", "check_options", "delete_library_document", "get_job", "get_print_options", "list_jobs", "list_library", "list_presets", "list_printers", "print_file", "print_library_document", "replace_library_file", "reprint_job", "update_library_document"]);
    expect(byName.list_printers!.annotations?.readOnlyHint).toBe(true);
    expect(byName.print_file!.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
    expect(client.getInstructions()).toContain("flat map of IPP attribute names");
  });

  it("describes printers and their options from the printer's own attributes", async () => {
    const printers = await call<Array<{ id: number; name: string; documentFormats: string[] }>>("list_printers");
    expect(printers).toMatchObject([{ id: printerId, name: "Front office" }]);
    expect(printers[0]!.documentFormats).toContain("application/pdf");
    const fields = await call<Array<{ name: string; widget?: string }>>("get_print_options", { printerId });
    expect(fields.map(f => f.name)).toContain("sides");
    expect(fields[0]).not.toHaveProperty("widget");
  });

  it("checks options without printing", async () => {
    const result = await call<{ errors: string[] }>("check_options", { printerId, options: { sides: "sideways" } });
    expect(result.errors.join(" ")).toContain("sides");
    expect(await readdir(dir)).toEqual([]);
  });

  it("queues an inline file as the token's user and refuses what it cannot print", async () => {
    const job = await call<{ id: number; user: string; state: string; options: Record<string, unknown> }>("print_file", { printerId, filename: "minutes.pdf", content: PDF, options: { copies: 2 } });
    expect(job).toMatchObject({ user: "Pat", state: "queued", options: { copies: 2 } });

    expect(await refusal("print_file", { printerId, filename: "x.pdf", content: "not base64!" })).toContain("base64");
    expect(await refusal("print_file", { printerId, filename: "x.ps", content: Buffer.from("%!PS-Adobe-3.0\n").toString("base64") })).toContain("unrecognised file type");
    expect(await refusal("print_file", { printerId, filename: "x.pdf", content: PDF, options: { sides: "sideways" } })).toContain("sides");
    expect((await readdir(dir)).length).toBe(1);

    const cancelled = await call<{ state: string }>("cancel_job", { id: job.id });
    expect(cancelled.state).toBe("canceled");
  });

  it("keeps to the user's own jobs", async () => {
    const jobs = await call<Array<{ filename: string }>>("list_jobs");
    expect(jobs.map(j => j.filename)).toEqual(["minutes.pdf"]);
    expect(await refusal("list_jobs", { allUsers: true })).toContain("only admins");
    expect(await refusal("get_job", { id: adminJobId })).toBe("job not found");
    expect(await refusal("reprint_job", { id: adminJobId })).toBe("job not found");
  });

  it("finds a Library document and prints it with this print's copies", async () => {
    const file = path.join(dir, "timesheet.pdf");
    await writeFile(file, Buffer.from(PDF, "base64"));
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO stored_jobs (printer_id, name, scope, filename, file_path, byte_size, document_format, options, created_at, updated_at) VALUES (?, 'Timesheet', 'global', 'timesheet.pdf', ?, 15, 'application/pdf', '{\"sides\":\"two-sided-long-edge\"}', ?, ?)")
      .run(printerId, file, stamp, stamp);

    expect(await call("list_library", { search: "invoice" })).toEqual([]);
    const [entry] = await call<Array<{ id: number; name: string }>>("list_library", { search: "TIME" });
    expect(entry?.name).toBe("Timesheet");
    const job = await call<{ filename: string; options: Record<string, unknown> }>("print_library_document", { id: entry!.id, copies: 3 });
    expect(job).toMatchObject({ filename: "timesheet.pdf", options: { copies: 3, sides: "two-sided-long-edge" } });
  });

  it("adds, updates, replaces and deletes the user's own Library documents", async () => {
    const stamp = new Date().toISOString();
    const presetId = Number(db.prepare("INSERT INTO presets (printer_id, name, scope, options, created_at, updated_at) VALUES (?, 'Rota preset', 'global', '{\"sides\":\"one-sided\"}', ?, ?)").run(printerId, stamp, stamp).lastInsertRowid);
    const groupId = Number(db.prepare("INSERT INTO library_groups (printer_id, name, position, created_at) VALUES (?, 'Rotas', 1, ?)").run(printerId, stamp).lastInsertRowid);
    const before = new Set(await readdir(dir));
    const added = await call<{ id: number; name: string; scope: string; filename: string; overrides: Record<string, unknown> }>("add_library_document", { printerId, name: "Rota", filename: "rota.pdf", content: PDF, presetId, groupId, options: { sides: "two-sided-long-edge" } });
    expect(added).toMatchObject({ name: "Rota", scope: "user", filename: "rota.pdf", presetId, groupId, overrides: { sides: "two-sided-long-edge" } });
    const [firstFile] = (await readdir(dir)).filter(f => !before.has(f));
    expect(firstFile).toMatch(/\.pdf$/);

    expect(await refusal("add_library_document", { printerId, name: "Shared", filename: "s.pdf", content: PDF, scope: "global" })).toContain("only admins");
    expect(await refusal("add_library_document", { printerId, name: "Bad", filename: "b.pdf", content: PDF, options: { sides: "sideways" } })).toContain("sides");
    expect((await readdir(dir)).filter(f => !before.has(f))).toEqual([firstFile]);

    const renamed = await call<{ name: string; overrides: Record<string, unknown> }>("update_library_document", { id: added.id, name: "Weekly rota" });
    expect(renamed).toMatchObject({ name: "Weekly rota", presetId, groupId, overrides: { sides: "two-sided-long-edge" } });
    expect(await call("update_library_document", { id: added.id, presetId: null, groupId: null })).toMatchObject({ name: "Weekly rota", presetId: null, groupId: null });
    const detached = await call<{ overrides: Record<string, unknown>; options: Record<string, unknown> }>("update_library_document", { id: added.id, options: {} });
    expect([detached.overrides, detached.options]).toEqual([{}, {}]);

    const png = Buffer.from("\x89PNG\r\n\x1A\n0000000000", "latin1").toString("base64");
    const replaced = await call<{ filename: string; documentFormat: string }>("replace_library_file", { id: added.id, filename: "rota.png", content: png });
    expect(replaced).toMatchObject({ filename: "rota.png", documentFormat: "image/png" });
    expect(await readdir(dir)).not.toContain(firstFile);

    const [shared] = await call<Array<{ id: number; editable: boolean }>>("list_library", { search: "timesheet" });
    expect(shared?.editable).toBe(false);
    expect(await refusal("update_library_document", { id: shared!.id, name: "Mine now" })).toContain("cannot edit");
    expect(await refusal("replace_library_file", { id: shared!.id, filename: "x.pdf", content: PDF })).toContain("cannot edit");
    expect(await refusal("delete_library_document", { id: shared!.id })).toContain("cannot delete");

    expect(await call("delete_library_document", { id: added.id })).toEqual({ deleted: added.id });
    expect(await call("list_library", { search: "rota" })).toEqual([]);
    expect(new Set(await readdir(dir))).toEqual(before);
  });

  it("refuses a Library file the printer cannot take, keeping the one it has", async () => {
    const caps = JSON.parse(await readFile(new URL("../fixtures/ippeveprinter.json", import.meta.url), "utf8")) as Record<string, unknown>;
    caps["document-format-supported"] = { type: "mimeMediaType", values: ["application/pdf"] };
    const pdfOnly = Number(db.prepare("INSERT INTO printers (name, uri, caps_discovered, created_at) VALUES ('PDF only', 'ipp://127.0.0.1:1/ipp/pdf', ?, ?)").run(JSON.stringify(caps), new Date().toISOString()).lastInsertRowid);
    const png = Buffer.from("\x89PNG\r\n\x1A\n0000000000", "latin1").toString("base64");
    const before = new Set(await readdir(dir));

    expect(await refusal("add_library_document", { printerId: pdfOnly, name: "Map", filename: "map.png", content: png })).toContain("does not accept image/png");
    const added = await call<{ id: number }>("add_library_document", { printerId: pdfOnly, name: "Map", filename: "map.pdf", content: PDF });
    expect(await refusal("replace_library_file", { id: added.id, filename: "map.png", content: png })).toContain("does not accept image/png");
    expect(await call("list_library", { printerId: pdfOnly })).toMatchObject([{ filename: "map.pdf", documentFormat: "application/pdf", problems: [] }]);
    expect((await readdir(dir)).filter(f => !before.has(f))).toHaveLength(1);

    const grey = { "black-and-white": "true" };
    expect(await refusal("add_library_document", { printerId, name: "Grey map", filename: "map.png", content: png, options: grey })).toContain("PDFs only");
    const photo = await call<{ id: number }>("add_library_document", { printerId, name: "Photo", filename: "photo.png", content: png });
    expect(await refusal("update_library_document", { id: photo.id, options: grey })).toContain("PDFs only");
    const greyPdf = await call<{ id: number }>("add_library_document", { printerId, name: "Grey notes", filename: "notes.pdf", content: PDF, options: grey });
    expect(await refusal("replace_library_file", { id: greyPdf.id, filename: "notes.png", content: png })).toContain("PDFs only");
    expect((await readdir(dir)).filter(f => !before.has(f))).toHaveLength(3);
  });

  it("still answers 2025-era clients, which send no envelope and keep no session", async () => {
    const headers = { "authorization": `Bearer ${userToken}`, "content-type": "application/json", "accept": "application/json, text/event-stream" };
    const message = (body: string) => JSON.parse(body.split("\n").find(line => line.startsWith("data: "))!.slice(6));
    const init = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "1" } } } });
    expect(init.statusCode, init.body).toBe(200);
    expect(message(init.body).result.serverInfo.name).toBe("printmax");
    const list = await app.inject({ method: "POST", url: "/mcp", headers: { ...headers, "mcp-protocol-version": "2025-06-18" }, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(message(list.body).result.tools.length).toBe(15);
  });
});
