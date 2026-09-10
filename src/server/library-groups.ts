/**
 * The Library's groups: a list an admin curates per printer, so documents are filed from a known
 * list rather than by retyping a name. Deleting a group leaves its documents ungrouped.
 */
import type { LibraryGroupDto } from "../shared/types.js";
import type { UserRow } from "./auth.js";
import type { Db } from "./db.js";
import { now } from "./db.js";
import { HttpError, notFound } from "./errors.js";
import { requirePrinter } from "./printers.js";

export interface LibraryGroupRow {
  id: number;
  printer_id: number;
  name: string;
  position: number;
  created_at: string;
}

export function getGroup(db: Db, id: number): LibraryGroupRow | undefined {
  return db.prepare("SELECT * FROM library_groups WHERE id = ?").get(id) as unknown as LibraryGroupRow | undefined;
}

export function requireGroup(db: Db, id: number): LibraryGroupRow {
  const row = getGroup(db, id);
  if (!row)
    throw notFound("library group");
  return row;
}

export function listGroups(db: Db, printerId: number): LibraryGroupRow[] {
  return db.prepare("SELECT * FROM library_groups WHERE printer_id = ? ORDER BY position, name COLLATE NOCASE")
    .all(printerId) as unknown as LibraryGroupRow[];
}

function requireAdmin(user: UserRow): void {
  if (user.role !== "admin")
    throw new HttpError(403, "only admins can manage library groups");
}

function parsePrinterId(db: Db, value: unknown): number {
  const printerId = Number(value);
  if (!Number.isInteger(printerId))
    throw new HttpError(400, "printerId is required");
  requirePrinter(db, printerId);
  return printerId;
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new HttpError(400, "name is required");
  return value.trim();
}

/** A curated list is only useful while its names stay distinct, so a clash is refused. */
function assertNameFree(db: Db, printerId: number, name: string, exceptId: number | null = null): void {
  const clash = db.prepare("SELECT id FROM library_groups WHERE printer_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?")
    .get(printerId, name, exceptId);
  if (clash)
    throw new HttpError(409, `there is already a group called ${name}`);
}

export function createGroup(db: Db, input: { printerId: unknown; name: unknown }, user: UserRow): LibraryGroupRow {
  requireAdmin(user);
  const printerId = parsePrinterId(db, input.printerId);
  const name = parseName(input.name);
  assertNameFree(db, printerId, name);
  const { next } = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM library_groups WHERE printer_id = ?")
    .get(printerId) as unknown as { next: number };
  const result = db.prepare("INSERT INTO library_groups (printer_id, name, position, created_at) VALUES (?, ?, ?, ?)")
    .run(printerId, name, next, now());
  return requireGroup(db, Number(result.lastInsertRowid));
}

export function renameGroup(db: Db, id: number, input: { name: unknown }, user: UserRow): LibraryGroupRow {
  requireAdmin(user);
  const existing = requireGroup(db, id);
  const name = parseName(input.name);
  assertNameFree(db, existing.printer_id, name, id);
  db.prepare("UPDATE library_groups SET name = ? WHERE id = ?").run(name, id);
  return requireGroup(db, id);
}

/** The documents stay; the foreign key returns them to the ungrouped section. */
export function deleteGroup(db: Db, id: number, user: UserRow): void {
  requireAdmin(user);
  requireGroup(db, id);
  db.prepare("DELETE FROM library_groups WHERE id = ?").run(id);
}

export function reorderGroups(db: Db, input: { printerId: unknown; ids: unknown }, user: UserRow): LibraryGroupRow[] {
  requireAdmin(user);
  const printerId = parsePrinterId(db, input.printerId);
  const existing = listGroups(db, printerId);
  const ids = (Array.isArray(input.ids) ? input.ids : []).map(Number);
  if (ids.length !== existing.length || new Set(ids).size !== ids.length || !ids.every(id => existing.some(g => g.id === id)))
    throw new HttpError(400, "ids must list every group for this printer exactly once");
  const update = db.prepare("UPDATE library_groups SET position = ? WHERE id = ?");
  ids.forEach((id, i) => update.run(i + 1, id));
  return listGroups(db, printerId);
}

export function toLibraryGroupDto(db: Db, row: LibraryGroupRow, user: UserRow): LibraryGroupDto {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM stored_jobs WHERE group_id = ? AND (scope = 'global' OR owner_id = ?)")
    .get(row.id, user.id) as unknown as { count: number };
  return {
    id: row.id,
    printerId: row.printer_id,
    name: row.name,
    position: row.position,
    documentCount: count,
  };
}
