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
    expect(Object.keys(byName).sort()).toEqual(["cancel_job", "check_options", "get_job", "get_print_options", "list_jobs", "list_library", "list_presets", "list_printers", "print_file", "print_library_document", "reprint_job"]);
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

  it("still answers 2025-era clients, which send no envelope and keep no session", async () => {
    const headers = { "authorization": `Bearer ${userToken}`, "content-type": "application/json", "accept": "application/json, text/event-stream" };
    const message = (body: string) => JSON.parse(body.split("\n").find(line => line.startsWith("data: "))!.slice(6));
    const init = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "1" } } } });
    expect(init.statusCode, init.body).toBe(200);
    expect(message(init.body).result.serverInfo.name).toBe("printmax");
    const list = await app.inject({ method: "POST", url: "/mcp", headers: { ...headers, "mcp-protocol-version": "2025-06-18" }, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(message(list.body).result.tools.length).toBe(11);
  });
});
