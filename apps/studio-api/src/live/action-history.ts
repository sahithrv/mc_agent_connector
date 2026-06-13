import type { ActionResult, JsonValue, Position } from "@mc-ai-video/contracts";

import type { DecisionSource } from "./decision-trace";

export interface ActionHistoryEntry {
  requestId: string;
  agentId: string;
  action: string;
  params: Record<string, JsonValue>;
  ok: boolean;
  error?: string;
  data?: Record<string, JsonValue>;
  startedAt: string;
  completedAt: string;
  targetKey?: string;
  requestedBy?: string;
  source?: DecisionSource | string;
}

export interface ActionHistoryStoreOptions {
  maxEntriesPerAgent?: number;
}

const DEFAULT_MAX_ENTRIES_PER_AGENT = 20;
const MIN_MAX_ENTRIES_PER_AGENT = 10;
const MAX_MAX_ENTRIES_PER_AGENT = 20;

export class ActionHistoryStore {
  private readonly entriesByAgentId = new Map<string, ActionHistoryEntry[]>();
  private readonly maxEntriesPerAgent: number;

  constructor(options: ActionHistoryStoreOptions = {}) {
    this.maxEntriesPerAgent = clampInteger(
      options.maxEntriesPerAgent ?? DEFAULT_MAX_ENTRIES_PER_AGENT,
      MIN_MAX_ENTRIES_PER_AGENT,
      MAX_MAX_ENTRIES_PER_AGENT,
    );
  }

  record(result: ActionResult): ActionHistoryEntry {
    const entry: ActionHistoryEntry = {
      requestId: result.requestId,
      agentId: result.agentId,
      action: result.action,
      params: compactParams(result.params),
      ok: result.ok,
      error: result.error,
      data: result.data ? { ...result.data } : undefined,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      targetKey: result.targetKey ?? targetKeyFromParams(result.params) ?? targetKeyFromData(result.data),
      requestedBy: result.requestedBy,
      source: result.source,
    };

    const entries = this.entriesByAgentId.get(result.agentId) ?? [];
    entries.push(entry);
    while (entries.length > this.maxEntriesPerAgent) {
      entries.shift();
    }
    this.entriesByAgentId.set(result.agentId, entries);
    return { ...entry, params: { ...entry.params }, data: entry.data ? { ...entry.data } : undefined };
  }

  recentForAgent(agentId: string, maxEntries = this.maxEntriesPerAgent): ActionHistoryEntry[] {
    const count = clampInteger(maxEntries, 1, this.maxEntriesPerAgent);
    return (this.entriesByAgentId.get(agentId) ?? [])
      .slice(-count)
      .map((entry) => ({
        ...entry,
        params: { ...entry.params },
        data: entry.data ? { ...entry.data } : undefined,
      }));
  }
}

function compactParams(params: Record<string, JsonValue> | undefined): Record<string, JsonValue> {
  if (!params) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(params)
      .slice(0, 16)
      .map(([key, value]) => [key, compactJson(value)]),
  );
}

function compactJson(value: JsonValue, depth = 0): JsonValue {
  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 4) {
      return `[array:${value.length}]`;
    }
    const values = value.slice(0, 8).map((item) => compactJson(item, depth + 1));
    return value.length > values.length ? [...values, `...${value.length - values.length} more`] : values;
  }
  if (depth >= 4) {
    return "[object]";
  }
  const entries = Object.entries(value).slice(0, 16);
  const compacted = Object.fromEntries(
    entries.map(([key, item]) => [key, compactJson(item, depth + 1)]),
  ) as Record<string, JsonValue>;
  const omitted = Object.keys(value).length - entries.length;
  if (omitted > 0) {
    compacted._omitted = omitted;
  }
  return compacted;
}

function targetKeyFromParams(params: Record<string, JsonValue> | undefined): string | undefined {
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

function targetKeyFromData(data: Record<string, JsonValue> | undefined): string | undefined {
  if (!data) {
    return undefined;
  }
  const target = data.target ?? data.reached ?? data.followed ?? data.collected ?? data.mined ?? data.placed;
  if (typeof target === "string" && target.trim().length > 0) {
    return `result:${target.trim()}`;
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

function formatPosition(position: Position): string {
  const base = `${round(position.x)},${round(position.y)},${round(position.z)}`;
  return position.world ? `${base},${position.world}` : base;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) {
    return max;
  }
  return Math.min(max, Math.max(min, value));
}
