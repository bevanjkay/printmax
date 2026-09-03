import type { PresetDto } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import type { Db } from "./db.js";
import { now } from "./db.js";
import { HttpError, notFound } from "./errors.js";
import { capsFor, requirePrinter } from "./printers.js";
import { validateJobOptions } from "./validation.js";

export interface PresetRow {
  id: number;
  printer_id: number;
  name: string;
  description: string | null;
  scope: "global" | "user";
  owner_id: number | null;
  options: string;
  created_at: string;
  updated_at: string;
}

export function getPreset(db: Db, id: number): PresetRow | undefined {
  return db.prepare("SELECT * FROM presets WHERE id = ?").get(id) as unknown as PresetRow | undefined;
}

export function requirePreset(db: Db, id: number): PresetRow {
  const p = getPreset(db, id);
  if (!p)
    throw notFound("preset");
  return p;
}

/** Presets a user may use: every global preset plus their own personal ones. */
export function listPresetsFor(db: Db, user: UserRow, printerId?: number): PresetRow[] {
  const rows = db.prepare(`
    SELECT * FROM presets
    WHERE (scope = 'global' OR owner_id = ?) AND (? IS NULL OR printer_id = ?)
    ORDER BY scope ASC, name
  `).all(user.id, printerId ?? null, printerId ?? null) as unknown as PresetRow[];
  return rows;
}

export function canUsePreset(preset: PresetRow, user: UserRow): boolean {
  return preset.scope === "global" || preset.owner_id === user.id;
}

export function canEditPreset(preset: PresetRow, user: UserRow): boolean {
  if (user.role === "admin")
    return true;
  return preset.scope === "user" && preset.owner_id === user.id;
}

export interface PresetInput {
  printerId: unknown;
  name: unknown;
  description?: unknown;
  scope?: unknown;
  options: unknown;
}

function parseInput(db: Db, input: PresetInput, user: UserRow): { printerId: number; name: string; description: string | null; scope: "global" | "user"; options: Record<string, unknown> } {
  const printerId = Number(input.printerId);
  if (!Number.isInteger(printerId))
    throw new HttpError(400, "printerId is required");
  const printer = requirePrinter(db, printerId);
  if (typeof input.name !== "string" || input.name.trim() === "")
    throw new HttpError(400, "name is required");
  const scope = input.scope === "global" ? "global" : "user";
  if (scope === "global" && user.role !== "admin")
    throw new HttpError(403, "only admins can create global presets");
  if (typeof input.options !== "object" || input.options === null || Array.isArray(input.options))
    throw new HttpError(400, "options must be an object");
  const options = input.options as Record<string, unknown>;
  const errors = validateJobOptions(options, capsFor(printer));
  if (errors.length > 0)
    throw new HttpError(422, errors.join("; "));
  return {
    printerId,
    name: input.name.trim(),
    description: typeof input.description === "string" && input.description.trim() ? input.description.trim() : null,
    scope,
    options,
  };
}

export function createPreset(db: Db, input: PresetInput, user: UserRow): PresetRow {
  const p = parseInput(db, input, user);
  const timestamp = now();
  const result = db.prepare(`
    INSERT INTO presets (printer_id, name, description, scope, owner_id, options, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.printerId, p.name, p.description, p.scope, p.scope === "user" ? user.id : null, JSON.stringify(p.options), timestamp, timestamp);
  return requirePreset(db, Number(result.lastInsertRowid));
}

export function updatePreset(db: Db, id: number, input: PresetInput, user: UserRow): PresetRow {
  const existing = requirePreset(db, id);
  if (!canEditPreset(existing, user))
    throw new HttpError(403, "you cannot edit this preset");
  const p = parseInput(db, { ...input, printerId: input.printerId ?? existing.printer_id }, user);
  db.prepare(`
    UPDATE presets SET printer_id = ?, name = ?, description = ?, scope = ?, owner_id = ?, options = ?, updated_at = ?
    WHERE id = ?
  `).run(p.printerId, p.name, p.description, p.scope, p.scope === "user" ? (existing.owner_id ?? user.id) : null, JSON.stringify(p.options), now(), id);
  return requirePreset(db, id);
}

export function deletePreset(db: Db, id: number, user: UserRow): void {
  const existing = requirePreset(db, id);
  if (!canEditPreset(existing, user))
    throw new HttpError(403, "you cannot delete this preset");
  db.prepare("DELETE FROM presets WHERE id = ?").run(id);
}

export function toPresetDto(db: Db, preset: PresetRow, user: UserRow): PresetDto {
  const options = JSON.parse(preset.options) as Record<string, unknown>;
  const printer = db.prepare("SELECT * FROM printers WHERE id = ?").get(preset.printer_id);
  const problems = printer ? validateJobOptions(options, capsFor(printer as never)) : ["printer no longer exists"];
  return {
    id: preset.id,
    printerId: preset.printer_id,
    name: preset.name,
    description: preset.description,
    scope: preset.scope,
    ownerId: preset.owner_id,
    options,
    problems,
    editable: canEditPreset(preset, user),
    createdAt: preset.created_at,
    updatedAt: preset.updated_at,
  };
}
