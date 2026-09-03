import type { CapsChangeDto } from "../shared/types.js";
import type { Db } from "./db.js";
import type { IppAttributes } from "./ipp/codec.js";
import { now } from "./db.js";

/** Attributes that change with every fetch and say nothing about capabilities. */
const VOLATILE = [
  /^printer-state/,
  /^printer-up-time$/,
  /^printer-current-time$/,
  /^printer-config-change/,
  /^printer-alert/,
  /^printer-is-accepting-jobs$/,
  /^queued-job-count$/,
  /^printer-supply/,
  /^printer-input-tray$/,
  /^printer-output-tray$/,
  /^printer-message/,
  /^date-time-at-/,
  /^printer-uuid$/,
  /^printer-uri-supported$/,
  /^printer-more-info/,
  /^printer-icons$/,
  /^printer-strings-uri$/,
  /^printer-firmware/,
  /^printer-detailed-status-messages$/,
  /^printer-impressions-completed$/,
  /^printer-pages-completed$/,
  /^printer-media-sheets-completed$/,
  /^job-impressions-completed$/,
];

export interface CapsDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffCaps(before: IppAttributes, after: IppAttributes): CapsDiff {
  const isVolatile = (name: string) => VOLATILE.some(re => re.test(name));
  const diff: CapsDiff = { added: [], removed: [], changed: [] };
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of [...names].sort()) {
    if (isVolatile(name))
      continue;
    const a = before[name];
    const b = after[name];
    if (!a && b)
      diff.added.push(name);
    else if (a && !b)
      diff.removed.push(name);
    else if (JSON.stringify(a) !== JSON.stringify(b))
      diff.changed.push(name);
  }
  return diff;
}

export function isEmptyDiff(diff: CapsDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

export interface CapsChangeRow {
  id: number;
  printer_id: number;
  fetched_at: string;
  diff: string;
  acknowledged_at: string | null;
}

export function recordCapsChange(db: Db, printerId: number, diff: CapsDiff): void {
  db.prepare("INSERT INTO caps_changes (printer_id, fetched_at, diff) VALUES (?, ?, ?)").run(printerId, now(), JSON.stringify(diff));
}

export function listCapsChanges(db: Db, printerId: number, includeAcknowledged = false): CapsChangeRow[] {
  return db.prepare(`SELECT * FROM caps_changes WHERE printer_id = ? ${includeAcknowledged ? "" : "AND acknowledged_at IS NULL"} ORDER BY id DESC`)
    .all(printerId) as unknown as CapsChangeRow[];
}

export function acknowledgeCapsChange(db: Db, printerId: number, changeId: number): boolean {
  const result = db.prepare("UPDATE caps_changes SET acknowledged_at = ? WHERE id = ? AND printer_id = ? AND acknowledged_at IS NULL").run(now(), changeId, printerId);
  return result.changes > 0;
}

export function toCapsChangeDto(row: CapsChangeRow): CapsChangeDto {
  return {
    id: row.id,
    printerId: row.printer_id,
    fetchedAt: row.fetched_at,
    ...(JSON.parse(row.diff) as CapsDiff),
    acknowledgedAt: row.acknowledged_at,
  };
}
