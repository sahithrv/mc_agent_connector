import type { EventSeverity, JsonValue, Position, Visibility } from "@mc-ai-video/contracts";

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export function objectBody(value: unknown, label = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  source: Record<string, unknown>,
  key: string,
  maxLength = 256,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RequestValidationError(`${key} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new RequestValidationError(`${key} must be ${maxLength} characters or fewer`);
  }
  return value;
}

export function optionalString(
  source: Record<string, unknown>,
  key: string,
  maxLength = 256,
): string | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RequestValidationError(`${key} must be a string`);
  }
  if (value.length > maxLength) {
    throw new RequestValidationError(`${key} must be ${maxLength} characters or fewer`);
  }
  return value.length === 0 ? undefined : value;
}

export function requiredStringArray(
  source: Record<string, unknown>,
  key: string,
  maxItems = 100,
): string[] {
  const value = source[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestValidationError(`${key} must be a non-empty string array`);
  }
  if (value.length > maxItems) {
    throw new RequestValidationError(`${key} must contain ${maxItems} items or fewer`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new RequestValidationError(`${key}[${index}] must be a non-empty string`);
    }
    return item;
  });
}

export function optionalSeverity(
  source: Record<string, unknown>,
  key: string,
  fallback: EventSeverity,
): EventSeverity {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new RequestValidationError(`${key} must be an integer from 1 to 5`);
  }
  return value as EventSeverity;
}

export function optionalVisibility(
  source: Record<string, unknown>,
  key: string,
  fallback: Visibility,
): Visibility {
  const value = source[key];
  if (value === undefined) {
    return fallback;
  }
  if (value !== "ai" && value !== "human-team" && value !== "recorder" && value !== "public") {
    throw new RequestValidationError(`${key} must be ai, human-team, recorder, or public`);
  }
  return value;
}

export function optionalJsonObject(
  source: Record<string, unknown>,
  key: string,
): Record<string, JsonValue> {
  const value = source[key];
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(`${key} must be an object`);
  }
  if (!isJsonValue(value)) {
    throw new RequestValidationError(`${key} must contain only JSON values`);
  }
  return value as Record<string, JsonValue>;
}

export function optionalPosition(source: Record<string, unknown>, key: string): Position | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  const object = objectBody(value, key);
  const x = numberField(object, "x", key);
  const y = numberField(object, "y", key);
  const z = numberField(object, "z", key);
  const world = optionalString(object, "world", 128);
  return world ? { x, y, z, world } : { x, y, z };
}

export function validationResponse(error: unknown): { statusCode: number; body: object } {
  if (error instanceof RequestValidationError) {
    return { statusCode: 400, body: { error: error.message } };
  }
  throw error;
}

function numberField(source: Record<string, unknown>, key: string, prefix: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestValidationError(`${prefix}.${key} must be a finite number`);
  }
  return value;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }
  return false;
}
