import { readFile } from "node:fs/promises";

import type { EventSeverity } from "@mc-ai-video/contracts";

import { ConfigError } from "../config/errors";
import type {
  ScenarioConfig,
  ScenarioDirectorTrigger,
  ScenarioRole,
  ScenarioSecretRole,
  ScenarioStartingGoal,
  ScenarioTeam,
} from "./types";

type JsonObject = Record<string, unknown>;

export async function loadScenarioConfig(filePath: string): Promise<ScenarioConfig> {
  const raw = await readScenarioJson(filePath);
  const scenario: ScenarioConfig = {
    id: requiredString(raw, "id", filePath),
    name: optionalString(raw, "name", filePath),
    teams: requiredArray(raw, "teams", filePath).map((item, index) =>
      parseTeam(requiredObjectAt(item, `teams[${index}]`, filePath), `teams[${index}]`, filePath),
    ),
    roles: requiredArray(raw, "roles", filePath).map((item, index) =>
      parseRole(requiredObjectAt(item, `roles[${index}]`, filePath), `roles[${index}]`, filePath),
    ),
    startingGoals: requiredArray(raw, "startingGoals", filePath).map((item, index) =>
      parseGoal(
        requiredObjectAt(item, `startingGoals[${index}]`, filePath),
        `startingGoals[${index}]`,
        filePath,
      ),
    ),
    secretRoles: requiredArray(raw, "secretRoles", filePath).map((item, index) =>
      parseSecretRole(
        requiredObjectAt(item, `secretRoles[${index}]`, filePath),
        `secretRoles[${index}]`,
        filePath,
      ),
    ),
    directorTriggers: requiredArray(raw, "directorTriggers", filePath).map((item, index) =>
      parseDirectorTrigger(
        requiredObjectAt(item, `directorTriggers[${index}]`, filePath),
        `directorTriggers[${index}]`,
        filePath,
      ),
    ),
  };

  assertUnique(scenario.teams.map((team) => team.id), "teams.id", filePath);
  assertUnique(scenario.roles.map((role) => role.agentId), "roles.agentId", filePath);
  assertUnique(scenario.directorTriggers.map((trigger) => trigger.id), "directorTriggers.id", filePath);
  return scenario;
}

function parseTeam(source: JsonObject, path: string, filePath: string): ScenarioTeam {
  return {
    id: requiredString(source, "id", filePath, `${path}.id`),
    name: optionalString(source, "name", filePath, `${path}.name`),
    agentIds: requiredStringArray(source, "agentIds", filePath, `${path}.agentIds`),
  };
}

function parseRole(source: JsonObject, path: string, filePath: string): ScenarioRole {
  return {
    agentId: requiredString(source, "agentId", filePath, `${path}.agentId`),
    role: requiredString(source, "role", filePath, `${path}.role`),
    team: optionalString(source, "team", filePath, `${path}.team`),
    routine: optionalString(source, "routine", filePath, `${path}.routine`),
    leader: optionalBoolean(source, "leader", filePath, `${path}.leader`),
  };
}

function parseGoal(source: JsonObject, path: string, filePath: string): ScenarioStartingGoal {
  return {
    agentId: requiredString(source, "agentId", filePath, `${path}.agentId`),
    goal: requiredString(source, "goal", filePath, `${path}.goal`),
    priority: optionalInteger(source, "priority", filePath, 1, 5, `${path}.priority`) ?? 3,
  };
}

function parseSecretRole(source: JsonObject, path: string, filePath: string): ScenarioSecretRole {
  return {
    agentId: requiredString(source, "agentId", filePath, `${path}.agentId`),
    role: requiredString(source, "role", filePath, `${path}.role`),
    visibleTo: optionalStringArray(source, "visibleTo", filePath, `${path}.visibleTo`) ?? [],
  };
}

function parseDirectorTrigger(
  source: JsonObject,
  path: string,
  filePath: string,
): ScenarioDirectorTrigger {
  return {
    id: requiredString(source, "id", filePath, `${path}.id`),
    event: requiredString(source, "event", filePath, `${path}.event`),
    action: requiredString(source, "action", filePath, `${path}.action`),
    severity: optionalInteger(
      source,
      "severity",
      filePath,
      1,
      5,
      `${path}.severity`,
    ) as EventSeverity | undefined,
  };
}

async function readScenarioJson(filePath: string): Promise<JsonObject> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown read error";
    throw new ConfigError(`unable to read scenario JSON (${reason})`, filePath);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) throw new ConfigError("scenario must be a JSON object", filePath);
    return parsed;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new ConfigError(`invalid scenario JSON (${reason})`, filePath);
  }
}
function requiredArray(source: JsonObject, path: string, filePath: string): unknown[] {
  const value = getPath(source, path);
  if (!Array.isArray(value)) throw new ConfigError(`${path} must be an array`, filePath);
  return value;
}

function requiredStringArray(
  source: JsonObject,
  path: string,
  filePath: string,
  displayPath = path,
): string[] {
  const value = getPath(source, path);
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(`${displayPath} must be a non-empty string array`, filePath);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ConfigError(`${displayPath}[${index}] must be a non-empty string`, filePath);
    }
    return item;
  });
}
function optionalStringArray(
  source: JsonObject,
  path: string,
  filePath: string,
  displayPath = path,
): string[] | undefined {
  const value = getPath(source, path);
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ConfigError(`${displayPath} must be a string array`, filePath);
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ConfigError(`${displayPath}[${index}] must be a non-empty string`, filePath);
    }
    return item;
  });
}
function requiredString(
  source: JsonObject,
  path: string,
  filePath: string,
  displayPath = path,
): string {
  const value = getPath(source, path);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${displayPath} must be a non-empty string`, filePath);
  }
  return value;
}
function optionalString(
  source: JsonObject,
  path: string,
  filePath: string,
  displayPath = path,
): string | undefined {
  const value = getPath(source, path);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${displayPath} must be a non-empty string when provided`, filePath);
  }
  return value;
}

function optionalBoolean(
  source: JsonObject,
  path: string,
  filePath: string,
  displayPath = path,
): boolean | undefined {
  const value = getPath(source, path);
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ConfigError(`${displayPath} must be a boolean`, filePath);
  return value;
}

function optionalInteger(
  source: JsonObject,
  path: string,
  filePath: string,
  min: number,
  max: number,
  displayPath = path,
): number | undefined {
  const value = getPath(source, path);
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${displayPath} must be an integer between ${min} and ${max}`, filePath);
  }
  return value;
}

function requiredObjectAt(value: unknown, path: string, filePath: string): JsonObject {
  if (!isObject(value)) throw new ConfigError(`${path} must be an object`, filePath);
  return value;
}

function getPath(source: JsonObject, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = source;
  for (const part of parts) {
    if (!isObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUnique(values: string[], label: string, filePath: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new ConfigError(`duplicate ${label}: ${value}`, filePath);
    seen.add(value);
  }
}
