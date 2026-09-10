import type { JobDto } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import type { Db } from "./db.js";
import type { IppAttributes } from "./ipp/codec.js";
import type { ParsedPpd } from "./ppd/parser.js";
import type { PrinterRow } from "./printers.js";
import { randomUUID } from "node:crypto";
import { copyFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { FIT_TO_MARGINS } from "../shared/attributes.js";
import { now } from "./db.js";
import { HttpError, notFound } from "./errors.js";
import { IppStatusError, IppTransportError } from "./ipp/client.js";
import { attrValues } from "./ipp/codec.js";
import { TERMINAL_JOB_STATES } from "./ipp/constants.js";
import { getJobAttributes, cancelJob as ippCancelJob, printJob } from "./ipp/operations.js";
import { buildJobAttributes } from "./ipp/options.js";
import { assemblePostScript } from "./ppd/assemble.js";
import { marginsFor, ppdChoices } from "./ppd/form.js";
import { pdfToPostScript } from "./ppd/ghostscript.js";
import { canUsePreset, getPreset } from "./presets.js";
import { getPrinter, profileFor, refreshStalePrinters, requirePrinter, targetFor } from "./printers.js";
import { validateJobOptions } from "./validation.js";

export interface JobRow {
  id: number;
  user_id: number | null;
  printer_id: number;
  preset_id: number | null;
  filename: string;
  file_path: string | null;
  byte_size: number;
  document_format: string;
  options_final: string;
  ipp_job_id: number | null;
  state: string;
  state_reasons: string;
  state_message: string | null;
  error: string | null;
  attempts: number;
  next_attempt_at: string | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
}

/** Local states before/around the IPP job states. */
export const LocalJobState = {
  queued: "queued",
  retrying: "retrying",
  failed: "failed",
  unknown: "unknown",
} as const;

const LOCAL_TERMINAL = new Set<string>([LocalJobState.failed, LocalJobState.unknown, ...TERMINAL_JOB_STATES]);
export const MAX_SUBMIT_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 2000;
const conversions = new WeakMap<Db, Map<number, AbortController>>();

/** IPP statuses that mean "not right now" rather than "never": busy with another job, temporary error, paused intake. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([0x0502, 0x0505, 0x0506, 0x0507]);
/** A busy printer is waited on at a steady cadence, for as long as a big job could plausibly take. */
const BUSY_RETRY_DELAY_MS = 5000;
const BUSY_GIVE_UP_MS = 10 * 60_000;

export function isTerminal(state: string): boolean {
  return LOCAL_TERMINAL.has(state);
}

export function getJob(db: Db, id: number): JobRow | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as unknown as JobRow | undefined;
}

export function requireJob(db: Db, id: number): JobRow {
  const job = getJob(db, id);
  if (!job)
    throw notFound("job");
  return job;
}

export function listJobs(db: Db, opts: { userId?: number; limit?: number } = {}): JobRow[] {
  const limit = opts.limit ?? 100;
  if (opts.userId !== undefined)
    return db.prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(opts.userId, limit) as unknown as JobRow[];
  return db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit) as unknown as JobRow[];
}

export function canSeeJob(job: JobRow, user: UserRow): boolean {
  return user.role === "admin" || job.user_id === user.id;
}

export interface CreateJobInput {
  printerId: number;
  user: UserRow;
  presetId?: number | null;
  filename: string;
  filePath: string;
  byteSize: number;
  documentFormat: string;
  /** Per-job overrides layered on top of the preset's options. */
  options: Record<string, unknown>;
}

/** Validates and queues a job. The preset's options and the overrides are merged into `options_final`. */
export function createJob(db: Db, input: CreateJobInput): JobRow {
  const printer = requirePrinter(db, input.printerId);
  const profile = profileFor(printer);
  const caps = profile.caps;

  const formats = attrValues<string>(caps, "document-format-supported");
  if (profile.mode === "postscript") {
    if (input.documentFormat !== "application/pdf")
      throw new HttpError(415, `${printer.name} is in PostScript mode, which prints PDF only`);
  }
  else if (formats.length > 0 && !formats.includes(input.documentFormat) && !formats.includes("application/octet-stream")) {
    throw new HttpError(415, `${printer.name} does not accept ${input.documentFormat}; it supports ${formats.join(", ")}`);
  }

  let options = { ...input.options };
  let presetId: number | null = null;
  if (input.presetId) {
    const preset = getPreset(db, input.presetId);
    if (!preset || !canUsePreset(preset, input.user))
      throw notFound("preset");
    if (preset.printer_id !== printer.id)
      throw new HttpError(400, "preset belongs to a different printer");
    options = { ...(JSON.parse(preset.options) as Record<string, unknown>), ...input.options };
    presetId = preset.id;
  }

  const errors = validateJobOptions(options, profile);
  if (errors.length > 0)
    throw new HttpError(422, errors.join("; "));

  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO jobs (user_id, printer_id, preset_id, filename, file_path, byte_size, document_format, options_final, state, next_attempt_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.user.id,
    printer.id,
    presetId,
    input.filename,
    input.filePath,
    input.byteSize,
    input.documentFormat,
    JSON.stringify(options),
    LocalJobState.queued,
    timestamp,
    timestamp,
  );
  return requireJob(db, Number(result.lastInsertRowid));
}

function fail(db: Db, job: JobRow, message: string): void {
  db.prepare("UPDATE jobs SET state = ?, error = ?, attempts = attempts + 1, next_attempt_at = NULL, completed_at = ? WHERE id = ?")
    .run(LocalJobState.failed, message, now(), job.id);
}

function requestingUserName(db: Db, job: JobRow): string {
  if (job.user_id !== null) {
    const user = db.prepare("SELECT name FROM users WHERE id = ?").get(job.user_id) as { name: string } | undefined;
    if (user)
      return user.name;
  }
  return "printmax";
}

/** Sends one queued job to its printer. Transport failures back off and retry; printer rejections fail immediately. */
export async function submitJob(db: Db, job: JobRow, limits: ConversionLimits = {}): Promise<void> {
  if (getJob(db, job.id)?.state === "canceled")
    return;
  const printer = getPrinter(db, job.printer_id);
  if (!printer)
    return fail(db, job, "printer was deleted");
  if (!job.file_path)
    return fail(db, job, "uploaded file is no longer available");

  const profile = profileFor(printer);
  const caps = profile.caps;
  const options = JSON.parse(job.options_final) as Record<string, unknown>;
  // Third validation pass: capabilities may have been re-fetched since the job was queued.
  const problems = validateJobOptions(options, profile);
  if (problems.length > 0)
    return fail(db, job, problems.join("; "));

  const userName = requestingUserName(db, job);
  const controller = new AbortController();
  if (!conversions.has(db))
    conversions.set(db, new Map());
  conversions.get(db)!.set(job.id, controller);
  try {
    const { data, documentFormat, jobAttributes } = profile.mode === "postscript" && profile.ppd
      ? await postScriptDocument(job, profile.ppd, options, caps, userName, controller.signal, limits)
      : { data: await readFile(job.file_path), documentFormat: job.document_format, jobAttributes: buildJobAttributes(options, caps) };
    if (controller.signal.aborted)
      return;
    const status = await printJob(targetFor(printer), {
      data,
      documentFormat,
      jobName: job.filename,
      requestingUserName: userName,
      jobAttributes,
    });
    db.prepare(`
      UPDATE jobs SET ipp_job_id = ?, state = ?, state_reasons = ?, error = NULL, attempts = attempts + 1,
        next_attempt_at = NULL, submitted_at = ?, completed_at = ?
      WHERE id = ?
    `).run(
      status.jobId,
      status.state,
      JSON.stringify(status.stateReasons),
      now(),
      TERMINAL_JOB_STATES.has(status.state) ? now() : null,
      job.id,
    );
  }
  catch (err) {
    if (controller.signal.aborted)
      return;
    const message = (err as Error).message;
    const attempts = job.attempts + 1;
    const transient = err instanceof IppStatusError && TRANSIENT_STATUSES.has(err.status);
    const waitingOnPrinter = transient && Date.now() - new Date(job.created_at).getTime() < BUSY_GIVE_UP_MS;
    if (waitingOnPrinter || (err instanceof IppTransportError && attempts < MAX_SUBMIT_ATTEMPTS)) {
      const delay = waitingOnPrinter ? BUSY_RETRY_DELAY_MS : BASE_RETRY_DELAY_MS * 2 ** (attempts - 1);
      db.prepare("UPDATE jobs SET state = ?, error = ?, attempts = ?, next_attempt_at = ? WHERE id = ?")
        .run(LocalJobState.retrying, message, attempts, new Date(Date.now() + delay).toISOString(), job.id);
      return;
    }
    fail(db, job, message);
  }
  finally {
    conversions.get(db)!.delete(job.id);
  }
}

/** The driver's dialect: PDF through Ghostscript, wrapped in the PPD's JCL with its setup snippets. */
async function postScriptDocument(job: JobRow, ppd: ParsedPpd, options: Record<string, unknown>, caps: IppAttributes, userName: string, signal: AbortSignal, limits: ConversionLimits) {
  const chosen = ppdChoices(options);
  const paper = chosen.PageSize ? ppd.paperDimensions[chosen.PageSize] : undefined;
  const keepMargins = options[FIT_TO_MARGINS] === true || options[FIT_TO_MARGINS] === "true";
  const margins = keepMargins ? marginsFor(ppd, chosen.PageSize) : null;
  const document = await pdfToPostScript(job.file_path!, {
    signal,
    ...(limits.maxPostScriptBytes !== undefined ? { maxOutputBytes: limits.maxPostScriptBytes } : {}),
    ...(paper ? { paper } : {}),
    ...(margins ? { margins } : {}),
  });
  const copies = Number(options.copies);
  const data = assemblePostScript({ ppd, chosen, jobName: job.filename, userName, document, copies: Number.isInteger(copies) ? copies : 1 });
  // Named PostScript where the printer lists it (auto-sensing printers cannot sniff past the PJL header); raw otherwise.
  const formats = attrValues<string>(caps, "document-format-supported");
  const documentFormat = formats.includes("application/postscript") ? "application/postscript" : "application/octet-stream";
  // The document asks for the copies itself. A printer in this mode ignores the IPP attribute, and one
  // that did honour both would print the run twice over.
  return { data, documentFormat, jobAttributes: buildJobAttributes({}, caps) };
}

/** Refreshes the state of one submitted job from the printer. */
export async function pollJob(db: Db, job: JobRow, printer: PrinterRow): Promise<void> {
  if (job.ipp_job_id === null)
    return;
  try {
    const status = await getJobAttributes(targetFor(printer), job.ipp_job_id);
    const terminal = TERMINAL_JOB_STATES.has(status.state);
    db.prepare("UPDATE jobs SET state = ?, state_reasons = ?, state_message = ?, completed_at = ? WHERE id = ?")
      .run(status.state, JSON.stringify(status.stateReasons), status.stateMessage ?? null, terminal ? now() : null, job.id);
  }
  catch (err) {
    if (err instanceof IppStatusError && (err.status === 0x0406 || err.status === 0x0407)) {
      // The printer has purged the job from its history; we can no longer learn how it ended.
      db.prepare("UPDATE jobs SET state = ?, error = ?, completed_at = ? WHERE id = ?")
        .run(LocalJobState.unknown, "printer no longer reports this job", now(), job.id);
      return;
    }
    if (err instanceof IppTransportError)
      return; // transient; try again next tick
    throw err;
  }
}

/**
 * Queues the same document again with the same options, optionally with a different number of
 * copies: print one as a proof, then the run. The file is copied so each job's retention is its own.
 */
export async function reprintJob(db: Db, id: number, user: UserRow, changes: { copies?: unknown } = {}): Promise<JobRow> {
  const job = requireJob(db, id);
  if (!canSeeJob(job, user))
    throw notFound("job");
  if (!job.file_path)
    throw new HttpError(409, "the file for this job is no longer on the server");
  const options = JSON.parse(job.options_final) as Record<string, unknown>;
  if (changes.copies !== undefined) {
    const copies = Number(changes.copies);
    if (!Number.isInteger(copies) || copies < 1)
      throw new HttpError(400, "copies must be a whole number of at least 1");
    options.copies = copies;
  }
  const preset = job.preset_id === null ? undefined : getPreset(db, job.preset_id);
  const filePath = path.join(path.dirname(job.file_path), `${randomUUID()}${path.extname(job.file_path)}`);
  await copyFile(job.file_path, filePath);
  try {
    return createJob(db, {
      printerId: job.printer_id,
      user,
      presetId: preset && canUsePreset(preset, user) ? preset.id : null,
      filename: job.filename,
      filePath,
      byteSize: job.byte_size,
      documentFormat: job.document_format,
      options,
    });
  }
  catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
}

export async function cancelJob(db: Db, id: number, user: UserRow): Promise<JobRow> {
  const job = requireJob(db, id);
  if (!canSeeJob(job, user))
    throw notFound("job");
  if (isTerminal(job.state))
    throw new HttpError(409, `job is already ${job.state}`);
  if (job.ipp_job_id !== null) {
    const printer = requirePrinter(db, job.printer_id);
    try {
      await ippCancelJob(targetFor(printer), job.ipp_job_id, requestingUserName(db, job));
    }
    catch (err) {
      if (err instanceof IppTransportError)
        throw new HttpError(502, `could not reach printer: ${err.message}`);
      if (err instanceof IppStatusError)
        throw new HttpError(409, `printer refused to cancel: ${err.message}`);
      throw err;
    }
    await pollJob(db, requireJob(db, id), printer);
  }
  else {
    db.prepare("UPDATE jobs SET state = 'canceled', next_attempt_at = NULL, completed_at = ? WHERE id = ?").run(now(), id);
    conversions.get(db)?.get(id)?.abort();
  }
  return requireJob(db, id);
}

export interface JobWorker {
  tick: () => Promise<void>;
  stop: () => void;
}

export interface ConversionLimits {
  /** Ceiling on the PostScript one conversion may produce; the converter's own default when unset. */
  maxPostScriptBytes?: number;
}

export interface JobWorkerOptions extends ConversionLimits {
  intervalMs: number;
  /** Re-fetch printer capabilities older than this; 0 disables the schedule. */
  capsRefreshHours?: number;
  onError?: (err: unknown) => void;
  onInfo?: (message: string, data?: Record<string, unknown>) => void;
}

/** Drives submission retries, state polling and scheduled capability refreshes. `tick` is exposed so tests can drive it. */
export function startJobWorker(db: Db, opts: JobWorkerOptions): JobWorker {
  let running = false;
  let stopped = false;
  let lastCapsRefresh = 0;

  async function tick(): Promise<void> {
    if (running || stopped)
      return;
    running = true;
    try {
      const due = db.prepare("SELECT * FROM jobs WHERE state IN (?, ?) AND next_attempt_at <= ? ORDER BY id")
        .all(LocalJobState.queued, LocalJobState.retrying, now()) as unknown as JobRow[];
      for (const job of due) {
        if (stopped)
          return;
        await submitJob(db, job, opts);
      }
      if (stopped)
        return;

      const active = db.prepare("SELECT * FROM jobs WHERE ipp_job_id IS NOT NULL AND state NOT IN ('completed', 'canceled', 'aborted', 'failed', 'unknown') ORDER BY id")
        .all() as unknown as JobRow[];
      for (const job of active) {
        const printer = getPrinter(db, job.printer_id);
        if (printer)
          await pollJob(db, job, printer);
      }

      const hours = opts.capsRefreshHours ?? 0;
      if (hours > 0 && Date.now() - lastCapsRefresh > 15 * 60_000) {
        lastCapsRefresh = Date.now();
        const failures = await refreshStalePrinters(db, hours);
        for (const f of failures)
          opts.onInfo?.("scheduled capability refresh failed", f);
      }
    }
    catch (err) {
      opts.onError?.(err);
    }
    finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), opts.intervalMs);
  return {
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      for (const controller of conversions.get(db)?.values() ?? [])
        controller.abort();
    },
  };
}

/** Deletes uploaded files for jobs that finished more than `retentionDays` ago. Returns the number removed. */
export async function sweepExpiredFiles(db: Db, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const rows = db.prepare("SELECT id, file_path FROM jobs WHERE file_path IS NOT NULL AND completed_at IS NOT NULL AND completed_at < ?")
    .all(cutoff) as unknown as Pick<JobRow, "id" | "file_path">[];
  let removed = 0;
  for (const row of rows) {
    if (row.file_path) {
      try {
        await unlink(row.file_path);
      }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT")
          throw err;
      }
    }
    db.prepare("UPDATE jobs SET file_path = NULL WHERE id = ?").run(row.id);
    removed += 1;
  }
  return removed;
}

export function toDto(db: Db, job: JobRow): JobDto {
  const printer = db.prepare("SELECT name FROM printers WHERE id = ?").get(job.printer_id) as { name: string } | undefined;
  const user = job.user_id === null ? undefined : db.prepare("SELECT name FROM users WHERE id = ?").get(job.user_id) as { name: string } | undefined;
  return {
    id: job.id,
    userId: job.user_id,
    userName: user?.name ?? null,
    printerId: job.printer_id,
    printerName: printer?.name ?? null,
    presetId: job.preset_id,
    filename: job.filename,
    byteSize: job.byte_size,
    documentFormat: job.document_format,
    options: JSON.parse(job.options_final) as Record<string, unknown>,
    ippJobId: job.ipp_job_id,
    state: job.state,
    stateReasons: JSON.parse(job.state_reasons) as string[],
    stateMessage: job.state_message,
    error: job.error,
    attempts: job.attempts,
    nextAttemptAt: job.next_attempt_at,
    createdAt: job.created_at,
    submittedAt: job.submitted_at,
    completedAt: job.completed_at,
    fileRetained: job.file_path !== null,
  };
}
