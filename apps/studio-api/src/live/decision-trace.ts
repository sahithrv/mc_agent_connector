import { randomUUID } from "node:crypto";

import type { GameEvent, JsonValue, Position } from "@mc-ai-video/contracts";

import type { StudioEventBus } from "../events/bus";
import type { RoutineActionIntent } from "../routines";

export type DecisionSource =
  | "routine"
  | "survival"
  | "opportunistic_collect"
  | "competitive"
  | "team_goal"
  | "llm"
  | "llm_repair"
  | "fallback"
  | "stuck_recovery";

export interface DecisionTrace {
  agentId: string;
  source: DecisionSource;
  action?: string;
  targetKey?: string;
  reason?: string;
  note?: string;
  fallback?: boolean;
  rejected?: boolean;
  timestamp: string;
}

export interface CreateDecisionTraceInput {
  agentId: string;
  source: DecisionSource;
  action?: string;
  targetKey?: string;
  reason?: string;
  note?: string;
  fallback?: boolean;
  rejected?: boolean;
  timestamp?: string;
}

export type TracedRoutineActionIntent = RoutineActionIntent & {
  decisionTrace: DecisionTrace;
};

export function createDecisionTrace(input: CreateDecisionTraceInput): DecisionTrace {
  return {
    agentId: input.agentId,
    source: input.source,
    action: input.action,
    targetKey: input.targetKey,
    reason: input.reason,
    note: input.note,
    fallback: input.fallback,
    rejected: input.rejected,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function withDecisionTrace(
  action: RoutineActionIntent,
  trace: DecisionTrace,
): TracedRoutineActionIntent {
  return {
    ...action,
    targetKey: trace.targetKey,
    source: trace.source,
    decisionTrace: trace,
  };
}

export function emitDecisionTrace(eventBus: StudioEventBus, trace: DecisionTrace): GameEvent {
  const event: GameEvent = {
    id: randomUUID(),
    type: "decision.trace",
    actorId: trace.agentId,
    severity: trace.rejected ? 3 : trace.fallback ? 2 : 1,
    visibility: "ai",
    payload: decisionTracePayload(trace),
    timestamp: trace.timestamp,
  };
  eventBus.emit("game.event", event);
  logDecisionTrace(trace);
  return event;
}

export function targetKeyFromAction(action: RoutineActionIntent | undefined): string | undefined {
  if (!action) {
    return undefined;
  }
  return action.targetKey ?? targetKeyFromParams(action.params);
}

export function targetKeyFromParams(params: Record<string, JsonValue> | undefined): string | undefined {
  if (!params) {
    return undefined;
  }
  for (const key of ["targetKey", "username", "player", "target", "entityId", "item", "block", "blueprintId"]) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return `${key}:${value.trim()}`;
    }
  }
  const position = positionValue(params.position);
  return position ? `position:${formatPosition(position)}` : undefined;
}

function decisionTracePayload(trace: DecisionTrace): Record<string, JsonValue> {
  return compactRecord({
    agentId: trace.agentId,
    source: trace.source,
    action: trace.action,
    targetKey: trace.targetKey,
    reason: trace.reason,
    note: trace.note,
    fallback: trace.fallback ?? false,
    rejected: trace.rejected ?? false,
  });
}

function logDecisionTrace(trace: DecisionTrace): void {
  const action = trace.action ?? "none";
  const fallback = trace.fallback === true ? "true" : "false";
  const reason = trace.reason ? ` reason=${JSON.stringify(trace.reason)}` : "";
  const note = trace.note ? ` note=${JSON.stringify(trace.note)}` : "";
  console.log(
    `[decision-trace] agent=${trace.agentId} source=${trace.source} action=${action}`
      + ` fallback=${fallback}${reason}${note}`,
  );
}

function compactRecord(source: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
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

function formatPosition(position: Position): string {
  const base = `${round(position.x)},${round(position.y)},${round(position.z)}`;
  return position.world ? `${base},${position.world}` : base;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
