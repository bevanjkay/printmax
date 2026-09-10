import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE printers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    uri TEXT NOT NULL UNIQUE,
    username TEXT,
    password TEXT,
    uuid TEXT,
    make_model TEXT,
    location TEXT,
    caps_discovered TEXT NOT NULL DEFAULT '{}',
    caps_overrides TEXT NOT NULL DEFAULT '{}',
    caps_fetched_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE presets (
    id INTEGER PRIMARY KEY,
    printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'user')),
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    preset_id INTEGER REFERENCES presets(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    file_path TEXT,
    byte_size INTEGER NOT NULL,
    document_format TEXT NOT NULL,
    options_final TEXT NOT NULL DEFAULT '{}',
    ipp_job_id INTEGER,
    state TEXT NOT NULL,
    state_reasons TEXT NOT NULL DEFAULT '[]',
    state_message TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    submitted_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX jobs_state ON jobs(state);
  CREATE INDEX jobs_printer ON jobs(printer_id);
  `,
  `
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE caps_changes (
    id INTEGER PRIMARY KEY,
    printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    fetched_at TEXT NOT NULL,
    diff TEXT NOT NULL,
    acknowledged_at TEXT
  );
  CREATE INDEX caps_changes_printer ON caps_changes(printer_id, acknowledged_at);
  CREATE INDEX jobs_user ON jobs(user_id);
  `,
  `
  ALTER TABLE printers ADD COLUMN ppd TEXT;
  ALTER TABLE printers ADD COLUMN print_mode TEXT NOT NULL DEFAULT 'ipp';
  `,
  `
  CREATE TABLE stored_jobs (
    id INTEGER PRIMARY KEY,
    printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    preset_id INTEGER REFERENCES presets(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('global', 'user')),
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    document_format TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '{}',
    preset_options TEXT NOT NULL DEFAULT '{}',
    print_count INTEGER NOT NULL DEFAULT 0,
    last_printed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX stored_jobs_printer ON stored_jobs(printer_id);
  `,
  `
  ALTER TABLE stored_jobs ADD COLUMN group_name TEXT;
  `,
  `
  CREATE TABLE library_groups (
    id INTEGER PRIMARY KEY,
    printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX library_groups_name ON library_groups(printer_id, name COLLATE NOCASE);
  ALTER TABLE stored_jobs ADD COLUMN group_id INTEGER REFERENCES library_groups(id) ON DELETE SET NULL;
  INSERT INTO library_groups (printer_id, name, position, created_at)
    SELECT printer_id, name, ROW_NUMBER() OVER (PARTITION BY printer_id ORDER BY name COLLATE NOCASE), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM (
      SELECT printer_id, MIN(group_name) AS name FROM stored_jobs
      WHERE group_name IS NOT NULL GROUP BY printer_id, group_name COLLATE NOCASE
    );
  UPDATE stored_jobs SET group_id = (
    SELECT id FROM library_groups g WHERE g.printer_id = stored_jobs.printer_id AND g.name = stored_jobs.group_name COLLATE NOCASE
  ) WHERE group_name IS NOT NULL;
  ALTER TABLE stored_jobs DROP COLUMN group_name;
  `,
];

export function openDb(file: string): Db {
  if (file !== ":memory:")
    mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = row.user_version;
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]!);
      version += 1;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    }
    catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function now(): string {
  return new Date().toISOString();
}
