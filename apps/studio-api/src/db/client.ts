import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

export type StudioDb = Database.Database;

export function openStudioDatabase(databasePath: string): StudioDb {
  const filename = normalizeDatabasePath(databasePath);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  return db;
}

function normalizeDatabasePath(databasePath: string): string {
  if (databasePath === ":memory:") {
    return databasePath;
  }
  return resolve(databasePath);
}
