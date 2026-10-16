import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import type { JobDto } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import type { Db } from "./db.js";
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
import { listStoredJobs, printStoredJob, toStoredJobDto } from "./library.js";
import { listPresetsFor, toPresetDto } from "./presets.js";
import { listPrinters, profileFor, requirePrinter, toDto as toPrinterDto } from "./printers.js";
import { checkOptions } from "./validation.js";

/** A file sent inline arrives as base64 in a JSON body; anything bigger belongs on `POST /api/jobs`. */
const INLINE_FILE_BYTES = 20 * 1024 * 1024;

const INSTRUCTIONS = `printmax sends documents to the office's network printers as the signed-in user, with that user's access.

- Job options are a flat map of IPP attribute names to values, such as {"copies": 2, "sides": "two-sided-long-edge"}. get_print_options lists every option a printer takes with its choices and default; use those names and values exactly. A printer in PostScript mode takes "ppd:<Key>" options in place of most IPP ones.
- Prefer a Library document (list_library) or a preset (list_presets) over building options by hand, and pass only the options that should differ.
- Printing uses paper and cannot be taken back once the printer starts. Confirm the printer, the document and the number of copies with the user before calling a print tool; check_options tests options without printing.
- A print tool returns the queued job; get_job reports how it went.`;

const id = z.number().int().positive();
const options = z.record(z.string(), z.unknown()).describe("Flat map of option name to value, as listed by get_print_options");
const copies = z.number().int().min(1).describe("Number of copies");

const readOnly = { readOnlyHint: true, openWorldHint: false };
const prints = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

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

function decodeBase64(text: string): Buffer {
  const body = text.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (body.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(body))
    throw new HttpError(400, "content must be base64");
  if ((body.length / 4) * 3 > INLINE_FILE_BYTES + 2)
    throw new HttpError(413, `files sent inline are limited to ${INLINE_FILE_BYTES / 1024 / 1024} MB; upload larger ones to POST /api/jobs`);
  return Buffer.from(body, "base64");
}

function buildServer(db: Db, user: UserRow, opts: { uploadDir: string; maxUploadBytes: number }, log: FastifyBaseLogger): McpServer {
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
    description: "Documents kept for printing again, such as forms and price lists, each with the options a print would use.",
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
      .map(d => ({ id: d.id, name: d.name, group: d.group, printerId: d.printerId, printer: d.printerName, preset: d.presetName, filename: d.filename, documentFormat: d.documentFormat, options: d.effectiveOptions, problems: d.problems, printCount: d.printCount, lastPrintedAt: d.lastPrintedAt }));
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
      filename: z.string().min(1).max(255).describe("Shown in the job list"),
      content: z.string().describe("The file's bytes, base64 encoded"),
      presetId: id.optional(),
      options: options.optional(),
    }),
    annotations: prints,
  }, ({ printerId, filename, content, presetId, options }) => answer(async () => {
    const bytes = decodeBase64(content);
    if (bytes.length > opts.maxUploadBytes)
      throw new HttpError(413, "file exceeds the upload size limit");
    const sniffed = sniffFormat(bytes.subarray(0, 16));
    if (!sniffed)
      throw new HttpError(415, `unrecognised file type; send one of ${SUPPORTED_FORMATS.join(", ")}`);
    const filePath = path.join(opts.uploadDir, `${randomUUID()}${sniffed.extension}`);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    try {
      const job = createJob(db, { printerId, user, presetId: presetId ?? null, filename: path.basename(filename), filePath, byteSize: bytes.length, documentFormat: sniffed.format, options: options ?? {} });
      return jobSummary(toJobDto(db, job));
    }
    catch (err) {
      await unlink(filePath).catch(() => {});
      throw err;
    }
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
export function mcpRoutes(app: FastifyInstance, db: Db, opts: { uploadDir: string; maxUploadBytes: number }): void {
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
