import { readFile } from "node:fs/promises";

import { ConfigError } from "./errors";

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(filePath: string): Promise<JsonObject> {
  let raw: string;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown read error";
    throw new ConfigError(`unable to read JSON config (${reason})`, filePath);
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || Array.isArray(parsed)) {
      throw new ConfigError("expected a JSON object", filePath);
    }
    return parsed;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new ConfigError(`invalid JSON (${reason})`, filePath);
  }
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredObject(
  source: JsonObject,
  field: string,
  filePath: string,
): JsonObject {
  const value = source[field];
  if (!isRecord(value)) {
    throw new ConfigError(`${field} must be an object`, filePath);
  }
  return value;
}

export function requiredString(
  source: JsonObject,
  field: string,
  filePath: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${field} must be a non-empty string`, filePath);
  }
  return value;
}

export function optionalString(
  source: JsonObject,
  field: string,
  filePath: string,
): string | undefined {
  const value = source[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${field} must be a non-empty string when provided`, filePath);
  }
  return value;
}

export function optionalBoolean(
  source: JsonObject,
  field: string,
  filePath: string,
): boolean | undefined {
  const value = source[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new ConfigError(`${field} must be a boolean when provided`, filePath);
  }
  return value;
}

export function requiredInteger(
  source: JsonObject,
  field: string,
  filePath: string,
  min: number,
  max: number,
): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${field} must be an integer between ${min} and ${max}`, filePath);
  }
  return value;
}
