import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStudioDatabase, type StudioDb } from "./client";
import { runMigrations } from "./migrations";

export function openMigratedTestDb(): StudioDb {
  const db = openStudioDatabase(":memory:");
  runMigrations(db);
  return db;
}

export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "studio-db-")), "nested", "studio.sqlite");
}
