import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AgentConfig, AgentMode, Visibility } from "@mc-ai-video/contracts";

import { ConfigError } from "./errors";
import {
  optionalString,
  readJsonObject,
  requiredObject,
  requiredString,
} from "./json";

const AGENT_MODES = ["paused", "routine", "planning", "acting", "failed"] as const;
const VISIBILITIES = ["ai", "human-team", "recorder", "public"] as const;
const ACCOUNT_AUTH = ["offline", "microsoft"] as const;

export function defaultAgentsConfigDir(): string {
  return resolve(process.cwd(), "config", "agents");
}

export async function loadAgentConfigs(
  dirPath = defaultAgentsConfigDir(),
): Promise<AgentConfig[]> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown read error";
    throw new ConfigError(`unable to read agent config directory (${reason})`, dirPath);
  }

  const files = entries.filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new ConfigError("no agent config JSON files found", dirPath);
  }

  const agents = await Promise.all(
    files.map(async (file) => parseAgentConfig(await readJsonObject(join(dirPath, file)), join(dirPath, file))),
  );

  assertUnique(agents.map((agent) => agent.id), "agent id", dirPath);
  assertUnique(agents.map((agent) => agent.name), "agent name", dirPath);
  assertUnique(agents.map((agent) => agent.account.username), "account username", dirPath);

  return agents;
}

function parseAgentConfig(source: Record<string, unknown>, filePath: string): AgentConfig {
  const account = requiredObject(source, "account", filePath);
  const mode = optionalEnum(source, "mode", AGENT_MODES, filePath) as AgentMode | undefined;
  const visibility = optionalEnum(source, "visibility", VISIBILITIES, filePath) as Visibility | undefined;
  const auth = optionalEnum(account, "auth", ACCOUNT_AUTH, filePath);

  return {
    id: requiredString(source, "id", filePath),
    name: requiredString(source, "name", filePath),
    account: {
      username: requiredString(account, "username", filePath),
      auth,
    },
    role: requiredString(source, "role", filePath),
    team: optionalString(source, "team", filePath),
    mode,
    routine: optionalString(source, "routine", filePath),
    allowedActions: requiredStringArray(source, "allowedActions", filePath),
    providerRef: requiredString(source, "providerRef", filePath),
    visibility,
  };
}

function requiredStringArray(
  source: Record<string, unknown>,
  field: string,
  filePath: string,
): string[] {
  const value = source[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(`${field} must be a non-empty string array`, filePath);
  }

  const values = value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ConfigError(`${field} must contain only non-empty strings`, filePath);
    }
    return item;
  });

  assertUnique(values, field, filePath);
  return values;
}

function optionalEnum<T extends readonly string[]>(
  source: Record<string, unknown>,
  field: string,
  allowed: T,
  filePath: string,
): T[number] | undefined {
  const value = source[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ConfigError(`${field} must be one of: ${allowed.join(", ")}`, filePath);
  }
  return value;
}

function assertUnique(values: string[], label: string, filePath: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new ConfigError(`duplicate ${label}: ${value}`, filePath);
    }
    seen.add(value);
  }
}
