import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ENV_FILE_NAMES = [".env", ".env.local"];

export function loadLocalEnvFiles(dirs = defaultEnvDirs()): string[] {
  const originalKeys = new Set(Object.keys(process.env));
  const loaded: string[] = [];

  for (const dir of uniqueResolvedDirs(dirs)) {
    for (const fileName of ENV_FILE_NAMES) {
      const filePath = join(dir, fileName);
      if (!existsSync(filePath)) {
        continue;
      }

      const entries = parseEnvFile(readFileSync(filePath, "utf8"));
      for (const [key, value] of entries) {
        if (!originalKeys.has(key)) {
          process.env[key] = value;
        }
      }
      loaded.push(filePath);
    }
  }

  return loaded;
}

function defaultEnvDirs(): string[] {
  const roots = uniqueResolvedDirs([
    workspaceRoot(process.env.INIT_CWD),
    workspaceRoot(process.cwd()),
  ].filter((dir): dir is string => Boolean(dir)));

  return roots.flatMap((root) => [
    root,
    join(root, "apps", "studio-api"),
  ]);
}

function workspaceRoot(start: string | undefined): string | undefined {
  if (!start) {
    return undefined;
  }

  let current = resolve(start);
  while (true) {
    if (hasWorkspacePackage(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function hasWorkspacePackage(dir: string): boolean {
  const packagePath = join(dir, "package.json");
  if (!existsSync(packagePath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { workspaces?: unknown };
    return Array.isArray(parsed.workspaces);
  } catch {
    return false;
  }
}

function uniqueResolvedDirs(dirs: string[]): string[] {
  return [...new Set(dirs.map((dir) => resolve(dir)))];
}

function parseEnvFile(raw: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed) {
      entries.push(parsed);
    }
  }
  return entries;
}

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const source = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
  const equalsAt = source.indexOf("=");
  if (equalsAt <= 0) {
    return undefined;
  }

  const key = source.slice(0, equalsAt).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return undefined;
  }

  return [key, parseEnvValue(source.slice(equalsAt + 1).trim())];
}

function parseEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const unquoted = value.slice(1, -1);
    return value.startsWith("\"")
      ? unquoted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, "\"")
      : unquoted;
  }

  const commentAt = value.search(/\s#/);
  return (commentAt >= 0 ? value.slice(0, commentAt) : value).trimEnd();
}
