import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import type { JobDto, StoredJobDto } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import type { Db } from "./db.js";
import type { StoredFile, StoredJobRow } from "./library.js";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { HttpError, notFound } from "./errors.js";
import { formFor } from "./form.js";
import { sniffFormat, SUPPORTED_FORMATS } from "./format.js";
import { cancelJob, canSeeJob, createJob, listJobs, reprintJob, requireJob, toDto as toJobDto } from "./jobs.js";
import { createStoredJob, deleteStoredJob, listStoredJobs, printStoredJob, replaceStoredFile, requireStoredJob, toStoredJobDto, updateStoredJob } from "./library.js";
import { listPresetsFor, toPresetDto } from "./presets.js";
import { listPrinters, profileFor, requirePrinter, toDto as toPrinterDto } from "./printers.js";
import { checkOptions } from "./validation.js";

/** A file sent inline arrives as base64 in a JSON body; anything bigger belongs on `POST /api/jobs`. */
const INLINE_FILE_BYTES = 20 * 1024 * 1024;

const INSTRUCTIONS = `printmax sends documents to the office's network printers as the signed-in user, with that user's access.

- Job options are a flat map of IPP attribute names to values, such as {"copies": 2, "sides": "two-sided-long-edge"}. get_print_options lists every option a printer takes with its choices and default; use those names and values exactly. A printer in PostScript mode takes "ppd:<Key>" options in place of most IPP ones.
- Prefer a Library document (list_library) or a preset (list_presets) over building options by hand, and pass only the options that should differ.
- Printing uses paper and cannot be taken back once the printer starts. Confirm the printer, the document and the number of copies with the user before calling a print tool; check_options tests options without printing.
- A print tool returns the queued job; get_job reports how it went.
- A shared Library document changes for everyone. Confirm with the user before replacing its file or deleting it.`;

const id = z.number().int().positive();
const options = z.record(z.string(), z.unknown()).describe("Flat map of option name to value, as listed by get_print_options");
const copies = z.number().int().min(1).describe("Number of copies");
const filename = z.string().min(1).max(255);
const content = z.string().describe("The file's bytes, base64 encoded");
const scope = z.enum(["user", "global"]).describe("\"global\" shares it with everyone (admins only); \"user\" keeps it to you");

const readOnly = { readOnlyHint: true, openWorldHint: false };
const prints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const adds = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const overwrites = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

function jobSummary(job: JobDto) {
  return {
    id: job.id,
    filename: job.filename,
    printer: job.printerName,
    preset: job.presetName,
    user: job.userName,
    state: job.state,
    stateReasons: job.stateReasons,
    stateMessage: job.stateMessage,
    error: job.error,
    options: job.options,
    impressions: job.impressions,
    impressionsCompleted: job.impressionsCompleted,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    canReprint: job.fileRetained,
  };
}

function librarySummary(d: StoredJobDto) {
  return {
    id: d.id,
    name: d.name,
    groupId: d.groupId,
    group: d.group,
    scope: d.scope,
    printerId: d.printerId,
    printer: d.printerName,
    presetId: d.presetId,
    preset: d.presetName,
    filename: d.filename,
    documentFormat: d.documentFormat,
    overrides: d.options,
    options: d.effectiveOptions,
    problems: d.problems,
    editable: d.editable,
    printCount: d.printCount,
    lastPrintedAt: d.lastPrintedAt,
  };
}

function decodeBase64(text: string): Buffer {
  const body = text.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (body.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(body))
    throw new HttpError(400, "content must be base64");
  if ((body.length / 4) * 3 > INLINE_FILE_BYTES + 2)
    throw new HttpError(413, `files sent inline are limited to ${INLINE_FILE_BYTES / 1024 / 1024} MB; upload larger ones to POST /api/jobs`);
  return Buffer.from(body, "base64");
}

function buildServer(db: Db, user: UserRow, opts: { uploadDir: string; storedDir: string; maxUploadBytes: number }, log: FastifyBaseLogger): McpServer {
  const server = new McpServer({ name: "printmax", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  /** Refusals keep their message, as the REST API's do; anything unexpected is logged and stays vague. */
  const answer = async (work: () => unknown) => {
    try {
      return { content: [{ type: "text" as const, text: JSON.stringify(await work()) }] };
    }
    catch (err) {
      if (err instanceof HttpError)
        throw err;
      log.error(err);
      throw new Error("internal error");
    }
  };

  /** Writes a base64 file into `dir` under a random name, refusing what printmax cannot print. */
  const receiveInline = async (dir: string, name: string, text: string): Promise<StoredFile> => {
    const bytes = decodeBase64(text);
    if (bytes.length > opts.maxUploadBytes)
      throw new HttpError(413, "file exceeds the upload size limit");
    const sniffed = sniffFormat(bytes.subarray(0, 16));
    if (!sniffed)
      throw new HttpError(415, `unrecognised file type; send one of ${SUPPORTED_FORMATS.join(", ")}`);
    const filePath = path.join(dir, `${randomUUID()}${sniffed.extension}`);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 }).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== "EEXIST")
        await unlink(filePath).catch(() => {});
      throw err;
    });
    return { filePath, filename: path.basename(name), byteSize: bytes.length, format: sniffed.format };
  };

  /** Runs `work` with the received file, removing it if `work` refuses. */
  const withInline = async <T>(dir: string, name: string, text: string, work: (file: StoredFile) => T | Promise<T>): Promise<T> => {
    const file = await receiveInline(dir, name, text);
    try {
      return await work(file);
    }
    catch (err) {
      await unlink(file.filePath).catch(() => {});
      throw err;
    }
  };

  const libraryDocument = (row: StoredJobRow) => librarySummary(toStoredJobDto(db, row, user));

  server.registerTool("list_printers", {
    title: "List printers",
    description: "The printers you can print to, with their state and the document formats they accept.",
    annotations: readOnly,
  }, () => answer(() => listPrinters(db).map((row) => {
    const p = toPrinterDto(db, row);
    return { id: p.id, name: p.name, location: p.location, makeModel: p.makeModel, state: p.summary.state, stateReasons: p.summary.stateReasons, printMode: p.printMode, documentFormats: p.summary.documentFormats };
  })));

  server.registerTool("get_print_options", {
    title: "Get print options",
    description: "Every option a printer takes: its name in the option map, a label, its choices and its default.",
    inputSchema: z.object({ printerId: id }),
    annotations: readOnly,
  }, ({ printerId }) => answer(() => formFor(profileFor(requirePrinter(db, printerId))).map(({ widget: _widget, ...field }) => field)));

  server.registerTool("list_presets", {
    title: "List presets",
    description: "Saved option sets you can print with: the shared ones and your own. A preset with problems no longer suits its printer.",
    inputSchema: z.object({ printerId: id.optional().describe("Only this printer's presets") }),
    annotations: readOnly,
  }, ({ printerId }) => answer(() => listPresetsFor(db, user, printerId).map((row) => {
    const p = toPresetDto(db, row, user);
    return { id: p.id, printerId: p.printerId, name: p.name, description: p.description, scope: p.scope, options: p.options, problems: p.problems };
  })));

  server.registerTool("list_library", {
    title: "List Library documents",
    description: "Documents kept for printing again, such as forms and price lists. Each has its preset, the overrides it layers on that preset, and the options a print would use.",
    inputSchema: z.object({
      printerId: id.optional().describe("Only this printer's documents"),
      search: z.string().optional().describe("Matches the name, file, group or preset, ignoring case"),
    }),
    annotations: readOnly,
  }, ({ printerId, search }) => answer(() => {
    const needle = search?.trim().toLowerCase() ?? "";
    return listStoredJobs(db, user, printerId)
      .map(row => toStoredJobDto(db, row, user))
      .filter(d => [d.name, d.filename, d.group, d.presetName].some(text => text?.toLowerCase().includes(needle)))
      .map(librarySummary);
  }));

  server.registerTool("check_options", {
    title: "Check options",
    description: "Tests a complete option map against a printer without printing. Returns blocking errors, advisory warnings, and the printer's own suggested fix in resolved.",
    inputSchema: z.object({ printerId: id, options }),
    annotations: readOnly,
  }, ({ printerId, options }) => answer(() => checkOptions(options, profileFor(requirePrinter(db, printerId)))));

  server.registerTool("print_library_document", {
    title: "Print a Library document",
    description: "Prints a Library document with its saved options, optionally changing the copies or other options for this print only.",
    inputSchema: z.object({ id: id.describe("Library document id"), copies: copies.optional(), options: options.optional() }),
    annotations: prints,
  }, ({ id, copies, options }) => answer(async () => jobSummary(toJobDto(db, await printStoredJob(db, id, { copies, options }, user, opts.uploadDir)))));

  server.registerTool("print_file", {
    title: "Print a file",
    description: `Prints a PDF, PNG or JPEG sent as base64, up to ${INLINE_FILE_BYTES / 1024 / 1024} MB. Options are layered over the preset's, if one is given.`,
    inputSchema: z.object({
      printerId: id,
      filename: filename.describe("Shown in the job list"),
      content,
      presetId: id.optional(),
      options: options.optional(),
    }),
    annotations: prints,
  }, ({ printerId, filename, content, presetId, options }) => answer(() => withInline(opts.uploadDir, filename, content, (file) => {
    const job = createJob(db, { printerId, user, presetId: presetId ?? null, filename: file.filename, filePath: file.filePath, byteSize: file.byteSize, documentFormat: file.format, options: options ?? {} });
    return jobSummary(toJobDto(db, job));
  })));

  server.registerTool("add_library_document", {
    title: "Add a Library document",
    description: `Keeps a PDF, PNG or JPEG, sent as base64 up to ${INLINE_FILE_BYTES / 1024 / 1024} MB, in the Library for printing again. Its options are layered over the preset's, if one is given. Refused if it could not print as it stands.`,
    inputSchema: z.object({
      printerId: id,
      name: z.string().min(1).describe("Shown in the Library"),
      filename: filename.describe("The file's own name"),
      content,
      presetId: id.optional(),
      groupId: id.optional().describe("A group on the same printer, from list_library"),
      scope: scope.default("user"),
      options: options.optional(),
    }),
    annotations: adds,
  }, ({ printerId, name, filename, content, presetId, groupId, scope, options }) => answer(() => withInline(opts.storedDir, filename, content, file =>
    libraryDocument(createStoredJob(db, { printerId, name, presetId, groupId, scope, options }, file, user)))));

  server.registerTool("update_library_document", {
    title: "Update a Library document",
    description: "Changes a Library document's name, preset, group, sharing or overrides. Anything left out stays as it is; options replaces the overrides as a whole, and null clears the preset or group.",
    inputSchema: z.object({
      id: id.describe("Library document id"),
      name: z.string().min(1).optional(),
      presetId: id.nullable().optional(),
      groupId: id.nullable().optional(),
      scope: scope.optional(),
      options: options.optional().describe("The overrides layered on the preset, as listed by list_library; {} follows the preset alone"),
    }),
    annotations: overwrites,
  }, input => answer(() => {
    const current = toStoredJobDto(db, requireStoredJob(db, input.id), user);
    return libraryDocument(updateStoredJob(db, input.id, {
      name: input.name ?? current.name,
      presetId: input.presetId === undefined ? current.presetId : input.presetId,
      groupId: input.groupId === undefined ? current.groupId : input.groupId,
      scope: input.scope ?? current.scope,
      options: input.options ?? current.options,
    }, user));
  }));

  server.registerTool("replace_library_file", {
    title: "Replace a Library document's file",
    description: `Swaps the file a Library document prints for a new PDF, PNG or JPEG, sent as base64 up to ${INLINE_FILE_BYTES / 1024 / 1024} MB, keeping its name and options. The old file is deleted.`,
    inputSchema: z.object({ id: id.describe("Library document id"), filename: filename.describe("The new file's own name"), content }),
    annotations: overwrites,
  }, ({ id, filename, content }) => answer(() => withInline(opts.storedDir, filename, content, async file =>
    libraryDocument(await replaceStoredFile(db, id, file, user)))));

  server.registerTool("delete_library_document", {
    title: "Delete a Library document",
    description: "Removes a document from the Library and deletes its file. Jobs already printed from it are kept.",
    inputSchema: z.object({ id: id.describe("Library document id") }),
    annotations: overwrites,
  }, ({ id }) => answer(async () => {
    await deleteStoredJob(db, id, user);
    return { deleted: id };
  }));

  server.registerTool("list_jobs", {
    title: "List jobs",
    description: "Your print jobs, newest first. Admins can ask for everyone's.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(100).default(20),
      allUsers: z.boolean().default(false).describe("Admins only"),
    }),
    annotations: readOnly,
  }, ({ limit, allUsers }) => answer(() => {
    if (allUsers && user.role !== "admin")
      throw new HttpError(403, "only admins can list everyone's jobs");
    return listJobs(db, { limit, ...(allUsers ? {} : { userId: user.id }) }).map(job => jobSummary(toJobDto(db, job)));
  }));

  server.registerTool("get_job", {
    title: "Get a job",
    description: "A job's current state, what the printer last said about it, and any error.",
    inputSchema: z.object({ id }),
    annotations: readOnly,
  }, ({ id }) => answer(() => {
    const job = requireJob(db, id);
    if (!canSeeJob(job, user))
      throw notFound("job");
    return jobSummary(toJobDto(db, job));
  }));

  server.registerTool("reprint_job", {
    title: "Reprint a job",
    description: "Queues a finished job again with the same file and options, optionally with a different number of copies. Needs canReprint.",
    inputSchema: z.object({ id, copies: copies.optional() }),
    annotations: prints,
  }, ({ id, copies }) => answer(async () => jobSummary(toJobDto(db, await reprintJob(db, id, user, { copies })))));

  server.registerTool("cancel_job", {
    title: "Cancel a job",
    description: "Cancels a job that has not finished, at the printer if it has already been sent.",
    inputSchema: z.object({ id }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, ({ id }) => answer(async () => jobSummary(toJobDto(db, await cancelJob(db, id, user)))));

  return server;
}

function webRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined && name !== "content-length")
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(new URL(req.url, `${req.protocol}://${req.host}`), { method: req.method, headers });
}

/**
 * Model Context Protocol over HTTP at `/mcp`, mounted behind the same sign-in as the REST API. The
 * SDK's Host and Origin guards are left out: they stop a rebound page borrowing a localhost
 * server's ambient access, and here every request already needs a token or session of its own.
 */
export function mcpRoutes(app: FastifyInstance, db: Db, opts: { uploadDir: string; storedDir: string; maxUploadBytes: number }): void {
  const handler = createMcpHandler(({ authInfo }) => buildServer(db, authInfo!.extra!.user as UserRow, opts, app.log));
  app.addHook("onClose", async () => handler.close());

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    bodyLimit: Math.ceil(INLINE_FILE_BYTES / 3) * 4 + 1024 * 1024,
    handler: async (req, reply) => {
      const user = req.user!;
      const authInfo = { token: "", clientId: `user-${user.id}`, scopes: [], extra: { user } };
      return reply.send(await handler.fetch(webRequest(req), { authInfo, parsedBody: req.body }));
    },
  });
}
