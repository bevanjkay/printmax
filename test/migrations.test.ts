import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../src/server/db.js";

/** The Library's groups started as free text on the entry; the names in use become the first list. */
describe("migrations", () => {
  function dbAt(version: number): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    for (const migration of MIGRATIONS.slice(0, version))
      db.exec(migration);
    return db;
  }

  it("turns free-text library groups into a per-printer group list", () => {
    const db = dbAt(5);
    const stamp = "2026-01-01T00:00:00.000Z";
    db.exec(`
      INSERT INTO printers (id, name, uri, created_at) VALUES
        (1, 'Front office', 'ipp://a/ipp/print', '${stamp}'),
        (2, 'Hall', 'ipp://b/ipp/print', '${stamp}');
    `);
    const insert = db.prepare(`
      INSERT INTO stored_jobs (printer_id, name, group_name, scope, filename, file_path, byte_size, document_format, created_at, updated_at)
      VALUES (?, ?, ?, 'global', 'x.pdf', '/tmp/x.pdf', 4, 'application/pdf', '${stamp}', '${stamp}')
    `);
    insert.run(1, "Bulletin", "Sunday");
    insert.run(1, "Envelope", "sunday");
    insert.run(1, "Roster", "Office");
    insert.run(1, "Flyer", null);
    insert.run(2, "Banner", "Sunday");

    db.exec(MIGRATIONS[5]!);

    const groups = db.prepare("SELECT printer_id, name, position FROM library_groups ORDER BY printer_id, position").all() as unknown as Array<{ printer_id: number; name: string; position: number }>;
    // Names that differed only in case were one group all along, so they merge under the first of them.
    expect(groups.map(g => [g.printer_id, g.name, g.position])).toEqual([[1, "Office", 1], [1, "Sunday", 2], [2, "Sunday", 1]]);

    const filed = db.prepare("SELECT s.name, g.name AS group_name, g.printer_id FROM stored_jobs s LEFT JOIN library_groups g ON g.id = s.group_id ORDER BY s.name").all() as unknown as Array<{ name: string; group_name: string | null; printer_id: number | null }>;
    expect(filed.map(f => [f.name, f.group_name, f.printer_id])).toEqual([
      ["Banner", "Sunday", 2],
      ["Bulletin", "Sunday", 1],
      ["Envelope", "Sunday", 1],
      ["Flyer", null, null],
      ["Roster", "Office", 1],
    ]);

    const columns = (db.prepare("PRAGMA table_info(stored_jobs)").all() as unknown as Array<{ name: string }>).map(c => c.name);
    expect(columns).toContain("group_id");
    expect(columns).not.toContain("group_name");
  });
});
