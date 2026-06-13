import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { loadLocalEnvFiles } from "./env";

test("loadLocalEnvFiles loads env files without overriding shell env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-env-"));
  const missingKey = "STUDIO_TEST_ENV_FROM_FILE";
  const existingKey = "STUDIO_TEST_ENV_FROM_SHELL";
  const previousMissing = process.env[missingKey];
  const previousExisting = process.env[existingKey];

  try {
    delete process.env[missingKey];
    process.env[existingKey] = "shell-value";
    await writeFile(
      join(dir, ".env"),
      [
        "STUDIO_TEST_ENV_FROM_FILE=from-file",
        "STUDIO_TEST_ENV_FROM_SHELL=file-value",
      ].join("\n"),
      "utf8",
    );

    const loaded = loadLocalEnvFiles([dir]);

    assert.deepEqual(loaded, [join(dir, ".env")]);
    assert.equal(process.env[missingKey], "from-file");
    assert.equal(process.env[existingKey], "shell-value");
  } finally {
    restoreEnv(missingKey, previousMissing);
    restoreEnv(existingKey, previousExisting);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
