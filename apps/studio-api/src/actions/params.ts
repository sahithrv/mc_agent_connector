import type { Position } from "@mc-ai-video/contracts";

export function stringParam(
  params: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = params[field];
  return typeof value === "string" ? value : undefined;
}

export function numberParam(
  params: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = params[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanParam(
  params: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = params[field];
  return typeof value === "boolean" ? value : undefined;
}

export function stringArrayParam(
  params: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = params[field];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : undefined;
}

export function positionParam(params: Record<string, unknown>): Position | undefined {
  const direct = params.position;
  if (isPositionRecord(direct)) {
    return direct;
  }

  const x = numberParam(params, "x");
  const y = numberParam(params, "y");
  const z = numberParam(params, "z");
  if (x === undefined || y === undefined || z === undefined) {
    return undefined;
  }

  return { x, y, z };
}

export function distance(left: Position, right: Position): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isPositionRecord(value: unknown): value is Position {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.x === "number"
    && typeof record.y === "number"
    && typeof record.z === "number";
}
