/**
 * The Library: documents kept for good, each paired with a preset, so the weekly bulletin or the
 * giving envelope prints again in one click. Files live under their own directory and are never
 * swept by retention. Printing copies the file into the upload area and queues an ordinary job.
 */
import type { StoredJobDto } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import type { Db } from "./db.js";
import type { PrinterProfile, PrinterRow } from "./printers.js";
import { randomUUID } from "node:crypto";
import { copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { now } from "./db.js";
import { HttpError, notFound } from "./errors.js";
import { canSeeJob, createJob, requireJob } from "./jobs.js";
import { canUsePreset, getPreset } from "./presets.js";
import { profileFor, requirePrinter } from "./printers.js";
import { validateJobOptions } from "./validation.js";

export interface StoredJobRow {
  id: number;
  printer_id: number;
  preset_id: number | null;
  name: string;
  scope: "global" | "user";
  owner_id: number | null;
  filename: string;
  file_path: string;
  byte_size: number;
  document_format: string;
  options: string;
  preset_options: string;
  print_count: number;
  last_printed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredFile {
  filePath: string;
  filename: string;
  byteSize: number;
  format: string;
}

export function getStoredJob(db: Db, id: number): StoredJobRow | undefined {
  return db.prepare("SELECT * FROM stored_jobs WHERE id = ?").get(id) as unknown as StoredJobRow | undefined;
}

export function requireStoredJob(db: Db, id: number): StoredJobRow {
  const row = getStoredJob(db, id);
  if (!row)
    throw notFound("library entry");
  return row;
}

export function listStoredJobs(db: Db, user: UserRow, printerId?: number): StoredJobRow[] {
  return db.prepare(`
    SELECT * FROM stored_jobs
    WHERE (scope = 'global' OR owner_id = ?) AND (? IS NULL OR printer_id = ?)
    ORDER BY scope ASC, name
  `).all(user.id, printerId ?? null, printerId ?? null) as unknown as StoredJobRow[];
}

export function canUseStoredJob(row: StoredJobRow, user: UserRow): boolean {
  return row.scope === "global" || row.owner_id === user.id;
}

export function canEditStoredJob(row: StoredJobRow, user: UserRow): boolean {
  return user.role === "admin" || (row.scope === "user" && row.owner_id === user.id);
}

function parseJson(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

/** The preset as it is today, or its snapshot if it has gone, with the entry's overrides on top. */
export function effectiveOptions(db: Db, row: StoredJobRow): Record<string, unknown> {
  const preset = row.preset_id === null ? undefined : getPreset(db, row.preset_id);
  const base = preset ? parseJson(preset.options) : parseJson(row.preset_options);
  return { ...base, ...parseJson(row.options) };
}

/** PostScript mode prints PDF only; a stored PNG on such a printer needs attention. */
function formatProblem(profile: PrinterProfile, format: string): string | null {
  return profile.mode === "postscript" && format !== "application/pdf" ? "this printer is in PostScript mode, which prints PDF only" : null;
}

function problemsFor(db: Db, row: StoredJobRow, printer: PrinterRow | undefined): string[] {
  if (!printer)
    return ["printer no longer exists"];
  const profile = profileFor(printer);
  const problems = validateJobOptions(effectiveOptions(db, row), profile);
  const format = formatProblem(profile, row.document_format);
  return format ? [...problems, format] : problems;
}

interface Parsed {
  printerId: number;
  presetId: number | null;
  name: string;
  scope: "global" | "user";
  options: Record<string, unknown>;
}

function parseInput(db: Db, input: { printerId: unknown; presetId?: unknown; name: unknown; scope?: unknown; options?: unknown }, user: UserRow): Parsed {
  const printerId = Number(input.printerId);
  if (!Number.isInteger(printerId))
    throw new HttpError(400, "printerId is required");
  requirePrinter(db, printerId);
  if (typeof input.name !== "string" || input.name.trim() === "")
    throw new HttpError(400, "name is required");
  const scope = input.scope === "global" ? "global" : "user";
  if (scope === "global" && user.role !== "admin")
    throw new HttpError(403, "only admins can add shared library entries");
  let presetId: number | null = null;
  if (input.presetId !== undefined && input.presetId !== null && input.presetId !== "") {
    presetId = Number(input.presetId);
    const preset = Number.isInteger(presetId) ? getPreset(db, presetId) : undefined;
    if (!preset || !canUsePreset(preset, user))
      throw notFound("preset");
    if (preset.printer_id !== printerId)
      throw new HttpError(400, "preset belongs to a different printer");
  }
  const options = input.options ?? {};
  if (typeof options !== "object" || options === null || Array.isArray(options))
    throw new HttpError(400, "options must be an object");
  return { printerId, presetId, name: input.name.trim(), scope, options: options as Record<string, unknown> };
}

/** Refuses an entry that could not print as it stands, the same bar presets are held to. */
function assertPrintable(db: Db, parsed: Parsed, format: string): void {
  const printer = requirePrinter(db, parsed.printerId);
  const profile = profileFor(printer);
  const preset = parsed.presetId === null ? undefined : getPreset(db, parsed.presetId);
  const errors = validateJobOptions({ ...(preset ? parseJson(preset.options) : {}), ...parsed.options }, profile);
  const bad = formatProblem(profile, format);
  if (bad)
    errors.push(bad);
  if (errors.length > 0)
    throw new HttpError(422, errors.join("; "));
}

export function createStoredJob(db: Db, input: { printerId: unknown; presetId?: unknown; name: unknown; scope?: unknown; options?: unknown }, file: StoredFile, user: UserRow): StoredJobRow {
  const parsed = parseInput(db, input, user);
  assertPrintable(db, parsed, file.format);
  const preset = parsed.presetId === null ? undefined : getPreset(db, parsed.presetId);
  const stamp = now();
  const result = db.prepare(`
    INSERT INTO stored_jobs (printer_id, preset_id, name, scope, owner_id, filename, file_path, byte_size, document_format, options, preset_options, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(parsed.printerId, parsed.presetId, parsed.name, parsed.scope, parsed.scope === "user" ? user.id : null, file.filename, file.filePath, file.byteSize, file.format, JSON.stringify(parsed.options), preset ? preset.options : "{}", stamp, stamp);
  return requireStoredJob(db, Number(result.lastInsertRowid));
}

/**
 * Keeps a printed job. Its preset is kept by reference; only the options that differed from the
 * preset become overrides, so later improvements to the preset flow through. Copies are left to
 * print time.
 */
export async function storeFromJob(db: Db, jobId: number, input: { name: unknown; scope?: unknown }, user: UserRow, storedDir: string): Promise<StoredJobRow> {
  const job = requireJob(db, jobId);
  if (!canSeeJob(job, user))
    throw notFound("job");
  if (!job.file_path)
    throw new HttpError(409, "the file for this job is no longer on the server");
  const preset = job.preset_id === null ? undefined : getPreset(db, job.preset_id);
  const usable = preset && canUsePreset(preset, user) ? preset : undefined;
  const presetOptions = usable ? parseJson(usable.options) : {};
  const final = parseJson(job.options_final);
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(final)) {
    if (key !== "copies" && JSON.stringify(value) !== JSON.stringify(presetOptions[key]))
      overrides[key] = value;
  }
  const filePath = path.join(storedDir, `${randomUUID()}${path.extname(job.file_path)}`);
  await copyFile(job.file_path, filePath);
  try {
    const scope = user.role === "admin" ? input.scope : "user";
    return createStoredJob(db, { printerId: job.printer_id, presetId: usable?.id ?? null, name: input.name, scope, options: overrides }, { filePath, filename: job.filename, byteSize: job.byte_size, format: job.document_format }, user);
  }
  catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
}

export function updateStoredJob(db: Db, id: number, input: { presetId?: unknown; name: unknown; scope?: unknown; options?: unknown }, user: UserRow): StoredJobRow {
  const existing = requireStoredJob(db, id);
  if (!canEditStoredJob(existing, user))
    throw new HttpError(403, "you cannot edit this library entry");
  const parsed = parseInput(db, { ...input, printerId: existing.printer_id }, user);
  assertPrintable(db, parsed, existing.document_format);
  const preset = parsed.presetId === null ? undefined : getPreset(db, parsed.presetId);
  db.prepare(`
    UPDATE stored_jobs SET preset_id = ?, name = ?, scope = ?, owner_id = ?, options = ?, preset_options = ?, updated_at = ?
    WHERE id = ?
  `).run(parsed.presetId, parsed.name, parsed.scope, parsed.scope === "user" ? (existing.owner_id ?? user.id) : null, JSON.stringify(parsed.options), preset ? preset.options : existing.preset_options, now(), id);
  return requireStoredJob(db, id);
}

export async function replaceStoredFile(db: Db, id: number, file: StoredFile, user: UserRow): Promise<StoredJobRow> {
  const existing = requireStoredJob(db, id);
  if (!canEditStoredJob(existing, user))
    throw new HttpError(403, "you cannot edit this library entry");
  const bad = formatProblem(profileFor(requirePrinter(db, existing.printer_id)), file.format);
  if (bad)
    throw new HttpError(422, bad);
  db.prepare("UPDATE stored_jobs SET filename = ?, file_path = ?, byte_size = ?, document_format = ?, updated_at = ? WHERE id = ?")
    .run(file.filename, file.filePath, file.byteSize, file.format, now(), id);
  await unlink(existing.file_path).catch(() => {});
  return requireStoredJob(db, id);
}

export async function deleteStoredJob(db: Db, id: number, user: UserRow): Promise<void> {
  const existing = requireStoredJob(db, id);
  if (!canEditStoredJob(existing, user))
    throw new HttpError(403, "you cannot delete this library entry");
  db.prepare("DELETE FROM stored_jobs WHERE id = ?").run(id);
  await unlink(existing.file_path).catch(() => {});
}

/** Queues the document as a normal job with the entry's effective options and the chosen copies. */
export async function printStoredJob(db: Db, id: number, input: { copies?: unknown }, user: UserRow, uploadDir: string) {
  const row = requireStoredJob(db, id);
  if (!canUseStoredJob(row, user))
    throw notFound("library entry");
  const options = effectiveOptions(db, row);
  if (input.copies !== undefined && input.copies !== null && input.copies !== "") {
    const copies = Number(input.copies);
    if (!Number.isInteger(copies) || copies < 1)
      throw new HttpError(400, "copies must be a whole number of at least 1");
    options.copies = copies;
  }
  const preset = row.preset_id === null ? undefined : getPreset(db, row.preset_id);
  const filePath = path.join(uploadDir, `${randomUUID()}${path.extname(row.file_path)}`);
  await copyFile(row.file_path, filePath);
  try {
    const job = createJob(db, {
      printerId: row.printer_id,
      user,
      presetId: preset && canUsePreset(preset, user) ? preset.id : null,
      filename: row.filename,
      filePath,
      byteSize: row.byte_size,
      documentFormat: row.document_format,
      options,
    });
    db.prepare("UPDATE stored_jobs SET print_count = print_count + 1, last_printed_at = ? WHERE id = ?").run(now(), id);
    return job;
  }
  catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
}

export function toStoredJobDto(db: Db, row: StoredJobRow, user: UserRow): StoredJobDto {
  const printer = db.prepare("SELECT * FROM printers WHERE id = ?").get(row.printer_id) as unknown as PrinterRow | undefined;
  const preset = row.preset_id === null ? undefined : getPreset(db, row.preset_id);
  return {
    id: row.id,
    printerId: row.printer_id,
    printerName: printer?.name ?? null,
    presetId: preset?.id ?? null,
    presetName: preset?.name ?? null,
    name: row.name,
    scope: row.scope,
    ownerId: row.owner_id,
    filename: row.filename,
    byteSize: row.byte_size,
    documentFormat: row.document_format,
    options: parseJson(row.options),
    effectiveOptions: effectiveOptions(db, row),
    problems: problemsFor(db, row, printer),
    editable: canEditStoredJob(row, user),
    printCount: row.print_count,
    lastPrintedAt: row.last_printed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
