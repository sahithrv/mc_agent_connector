import { existsSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { openStudioDatabase } from "./client";
import { listAppliedMigrations, runMigrations } from "./migrations";
import { tempDbPath } from "./test-support";

test("openStudioDatabase creates a DB file and migrations run once", () => {
  const filePath = tempDbPath();
  const db = openStudioDatabase(filePath);

  runMigrations(db);
  runMigrations(db);

  assert.equal(existsSync(filePath), true);
  assert.deepEqual(listAppliedMigrations(db), ["001_initial_persistence"]);

  const row = db
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number };
  assert.equal(row.count, 1);
  db.close();
});
