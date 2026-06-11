import { randomUUID } from "node:crypto";

import type { GameEvent } from "@mc-ai-video/contracts";

import {
  objectBody,
  optionalJsonObject,
  optionalPosition,
  optionalSeverity,
  optionalString,
  optionalVisibility,
  requiredString,
} from "../http/validation";

export function gameEventFromBody(body: unknown): GameEvent {
  const source = objectBody(body);
  return {
    id: optionalString(source, "id", 128) ?? optionalString(source, "eventId", 128) ?? randomUUID(),
    type: requiredString(source, "type", 128),
    actorId: optionalString(source, "actorId", 128) ?? entityRef(source, "actor"),
    targetId: optionalString(source, "targetId", 128) ?? entityRef(source, "target"),
    location: optionalPosition(source, "location"),
    severity: optionalSeverity(source, "severity", 1),
    visibility: optionalVisibility(source, "visibility", "public"),
    payload: optionalJsonObject(source, "payload"),
    timestamp: optionalString(source, "timestamp", 64) ?? new Date().toISOString(),
  };
}

function entityRef(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  const entity = objectBody(value, key);
  return optionalString(entity, "uuid", 128) ?? optionalString(entity, "username", 128);
}
