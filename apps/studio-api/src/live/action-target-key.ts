import type { JsonValue, Position } from "@mc-ai-video/contracts";

export function targetKeyForAction(action: string, params: Record<string, JsonValue>): string {
  const normalizedAction = normalizeAction(action);
  switch (normalizedAction) {
    case "mine_block":
      return `${normalizedAction}:${positionKey(params)}`;
    case "place_block":
      return `${normalizedAction}:${positionKey(params)}:${normalizeMaterial(firstString(params, ["block", "item", "name"]))}`;
    case "collect_item":
      return `${normalizedAction}:${normalizeIdentifier(firstString(params, ["entityId", "item", "name"]))}`;
    case "craft_item":
      return `${normalizedAction}:${normalizeMaterial(firstString(params, ["item", "name", "block"]))}:${formatCount(params.count)}`;
    case "move_to":
      return `${normalizedAction}:${positionKey(params)}:range=${formatCount(params.range)}`;
    case "follow_player":
      return `${normalizedAction}:${normalizeIdentifier(firstString(params, ["username", "player", "target", "name"]))}`;
    case "attack_entity":
      return `${normalizedAction}:${normalizeIdentifier(firstString(params, ["entityId", "username", "name", "target"]))}`;
    default:
      return `${normalizedAction}:${fallbackTargetKey(params)}`;
  }
}

function positionKey(params: Record<string, JsonValue>): string {
  const position = positionFromParams(params);
  if (!position) {
    return `${worldFromParams(params)}:unknown`;
  }
  return `${normalizeIdentifier(position.world ?? worldFromParams(params))}:${formatCoordinate(position.x)},${formatCoordinate(position.y)},${formatCoordinate(position.z)}`;
}

function positionFromParams(params: Record<string, JsonValue>): Position | undefined {
  const nested = positionValue(params.position)
    ?? positionValue(params.targetPosition)
    ?? positionValue(params.location);
  if (nested) {
    return {
      ...nested,
      world: nested.world ?? stringValue(params.world) ?? stringValue(params.dimension),
    };
  }
  if (typeof params.x === "number" && typeof params.y === "number" && typeof params.z === "number") {
    return {
      x: params.x,
      y: params.y,
      z: params.z,
      world: stringValue(params.world) ?? stringValue(params.dimension),
    };
  }
  return undefined;
}

function positionValue(value: JsonValue | undefined): Position | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Partial<Position>;
  return typeof source.x === "number" && typeof source.y === "number" && typeof source.z === "number"
    ? { x: source.x, y: source.y, z: source.z, world: source.world }
    : undefined;
}

function fallbackTargetKey(params: Record<string, JsonValue>): string {
  const explicit = firstString(params, ["targetKey"]);
  if (explicit) {
    return normalizeIdentifier(explicit);
  }
  const target = firstString(params, [
    "entityId",
    "username",
    "player",
    "target",
    "name",
    "item",
    "block",
    "blueprintId",
  ]);
  if (target) {
    return normalizeIdentifier(target);
  }
  const position = positionFromParams(params);
  if (position) {
    return `${normalizeIdentifier(position.world ?? worldFromParams(params))}:${formatCoordinate(position.x)},${formatCoordinate(position.y)},${formatCoordinate(position.z)}`;
  }
  return "unknown";
}

function firstString(params: Record<string, JsonValue>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function worldFromParams(params: Record<string, JsonValue>): string {
  return stringValue(params.world) ?? stringValue(params.dimension) ?? "unknown";
}

function formatCount(value: JsonValue | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatCoordinate(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? formatCoordinate(numeric) : normalizeIdentifier(value);
  }
  return "1";
}

function formatCoordinate(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(3)));
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown_action";
}

function normalizeMaterial(value: string | undefined): string {
  return value ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") : "unknown";
}

function normalizeIdentifier(value: string | undefined): string {
  return value?.trim() || "unknown";
}
