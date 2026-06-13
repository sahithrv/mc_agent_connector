import type { JsonValue, Position } from "@mc-ai-video/contracts";

import { targetKeyForAction } from "./action-target-key";
import type { ActionHistoryEntry } from "./action-history";

export interface StuckAnalysis {
  stuck: boolean;
  reason?: string;
  blockedTargetKeys: string[];
  recoveryPromptHint?: string;
}

export interface StuckDetectorState {
  activeGoal?: string;
  position?: Position;
  inventory?: JsonValue;
  progress?: JsonValue;
  now?: number | string | Date;
}

const FAILED_PAIR_WINDOW_MS = 60_000;
const BLOCKED_TARGET_MS = 30_000;
const REPEATED_SUCCESS_COUNT = 3;
const REPEATED_IDLE_COUNT = 3;
const REPEATED_CONTINUE_ROUTINE_COUNT = 3;
const MOVE_UNCHANGED_TOLERANCE = 0.5;
const MOVE_TARGET_TOLERANCE = 0.75;

export function analyzeStuck(
  agentId: string,
  history: readonly ActionHistoryEntry[],
  currentState: StuckDetectorState,
): StuckAnalysis {
  const now = timestampMs(currentState.now) ?? Date.now();
  const entries = history
    .filter((entry) => entry.agentId === agentId)
    .sort((left, right) => timestampMs(left.completedAt) - timestampMs(right.completedAt));
  const blockedTargetKeys = repeatedFailedTargets(entries, now);

  if (blockedTargetKeys.length > 0) {
    const target = blockedTargetKeys[0] ?? "target";
    return stuckResult(
      blockedTargetKeys,
      `same failed action-target pair repeated within 60 seconds: ${target}`,
      `Avoid retrying ${target} for 30 seconds; choose a different target/action or satisfy the blocker first.`,
    );
  }

  if (hasActiveGoal(currentState) && countConsecutive(entries, "idle") >= REPEATED_IDLE_COUNT) {
    return stuckResult(
      blockedTargetKeys,
      "three consecutive idle actions while an active goal exists",
      "Stop idling; choose a physical action, a useful routine action, or ask for help with the blocker.",
    );
  }

  const moveToStuck = moveToSuccessWithoutMovement(entries, currentState);
  if (moveToStuck) {
    return stuckResult(
      unique([...blockedTargetKeys, moveToStuck.targetKey]),
      "move_to reported success but the agent position did not change or did not reach the target",
      `Do not repeat ${moveToStuck.targetKey}; choose a nearby reachable move target or a different action.`,
    );
  }

  if (countConsecutive(entries, "continue_routine") >= REPEATED_CONTINUE_ROUTINE_COUNT) {
    const repeated = entries.slice(-REPEATED_CONTINUE_ROUTINE_COUNT);
    if (!hasProgressChange(repeated, currentState)) {
      return stuckResult(
        blockedTargetKeys,
        "repeated continue_routine actions without measurable progress",
        "Choose a concrete action with parameters instead of continuing the same routine again.",
      );
    }
  }

  const repeatedSuccess = repeatedSuccessfulTargetWithoutProgress(entries, currentState);
  if (repeatedSuccess) {
    return stuckResult(
      unique([...blockedTargetKeys, repeatedSuccess.targetKey]),
      `same successful action-target pair repeated ${repeatedSuccess.count} times without measurable progress`,
      `Avoid repeating ${repeatedSuccess.targetKey}; switch action/target or satisfy the missing precondition.`,
    );
  }

  return { stuck: false, blockedTargetKeys };
}

function repeatedFailedTargets(entries: ActionHistoryEntry[], now: number): string[] {
  const failuresByTarget = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.ok) {
      continue;
    }
    const completedAt = timestampMs(entry.completedAt);
    if (!Number.isFinite(completedAt)) {
      continue;
    }
    const targetKey = entryTargetKey(entry);
    const failures = failuresByTarget.get(targetKey) ?? [];
    failures.push(completedAt);
    failuresByTarget.set(targetKey, failures);
  }

  const blocked: string[] = [];
  for (const [targetKey, failures] of failuresByTarget) {
    if (failures.length < 2) {
      continue;
    }
    failures.sort((left, right) => left - right);
    const latest = failures[failures.length - 1] ?? 0;
    const previous = failures[failures.length - 2] ?? 0;
    if (latest - previous <= FAILED_PAIR_WINDOW_MS && now - latest <= BLOCKED_TARGET_MS) {
      blocked.push(targetKey);
    }
  }
  return blocked.sort();
}

function repeatedSuccessfulTargetWithoutProgress(
  entries: ActionHistoryEntry[],
  currentState: StuckDetectorState,
): { targetKey: string; count: number } | undefined {
  const successesByTarget = new Map<string, ActionHistoryEntry[]>();
  for (const entry of entries.slice(-10)) {
    if (!entry.ok || entry.action === "idle" || entry.action === "continue_routine") {
      continue;
    }
    const targetKey = entryTargetKey(entry);
    const successes = successesByTarget.get(targetKey) ?? [];
    successes.push(entry);
    successesByTarget.set(targetKey, successes);
  }

  for (const [targetKey, successes] of successesByTarget) {
    if (successes.length >= REPEATED_SUCCESS_COUNT) {
      const recent = successes.slice(-REPEATED_SUCCESS_COUNT);
      if (!hasProgressChange(recent, currentState)) {
        return { targetKey, count: successes.length };
      }
    }
  }
  return undefined;
}

function moveToSuccessWithoutMovement(
  entries: ActionHistoryEntry[],
  currentState: StuckDetectorState,
): { targetKey: string } | undefined {
  const latestMove = entries
    .slice()
    .reverse()
    .find((entry) => entry.action === "move_to" && entry.ok);
  if (!latestMove) {
    return undefined;
  }

  const target = positionFromParams(latestMove.params ?? {});
  const range = numericValue(latestMove.params?.range) ?? 1;
  const current = currentState.position
    ?? positionFromData(latestMove.data, ["currentPosition", "position", "afterPosition", "endPosition", "finalPosition"]);
  const before = positionFromData(latestMove.data, ["beforePosition", "startPosition", "from", "initialPosition"]);
  const after = positionFromData(latestMove.data, ["afterPosition", "endPosition", "to", "finalPosition", "position"]);
  const unchanged = Boolean(before && after && distance(before, after) <= MOVE_UNCHANGED_TOLERANCE);
  const stillNotNearTarget = Boolean(target && current && distance(current, target) > range + MOVE_TARGET_TOLERANCE);

  return unchanged || stillNotNearTarget
    ? { targetKey: entryTargetKey(latestMove) }
    : undefined;
}

function hasProgressChange(
  entries: ActionHistoryEntry[],
  currentState: StuckDetectorState,
): boolean {
  if (entries.some(hasExplicitProgressDelta)) {
    return true;
  }

  const signatures = entries
    .map((entry) => progressSignature(entry, currentState))
    .filter((signature): signature is string => Boolean(signature));
  if (signatures.length < 2) {
    return false;
  }
  return new Set(signatures).size > 1;
}

function hasExplicitProgressDelta(entry: ActionHistoryEntry): boolean {
  const data = entry.data;
  if (!data) {
    return false;
  }
  const signal = progressSignal(data);
  if (signal?.changed === true) {
    return true;
  }
  for (const key of ["progressDelta", "inventoryDelta", "positionDelta", "itemsAdded", "blocksChanged"]) {
    const value = data[key];
    if (typeof value === "number" && value !== 0) {
      return true;
    }
    if (typeof value === "boolean" && value) {
      return true;
    }
    if (Array.isArray(value) && value.length > 0) {
      return true;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
      return true;
    }
  }
  return false;
}

function progressSignature(entry: ActionHistoryEntry, currentState: StuckDetectorState): string | undefined {
  const fields: Record<string, JsonValue> = {};
  const signal = progressSignal(entry.data);
  const inventory = entry.data?.inventory ?? entry.data?.inventoryAfter ?? currentState.inventory;
  const position = positionFromData(entry.data, ["position", "afterPosition", "endPosition", "finalPosition"]) ?? currentState.position;
  const progress = signal?.afterSignature
    ?? entry.data?.progressSignature
    ?? entry.data?.progress
    ?? entry.data?.progressKey
    ?? entry.data?.progressToken
    ?? currentState.progress;
  if (inventory !== undefined) fields.inventory = inventory;
  if (position) fields.position = position;
  if (progress !== undefined) fields.progress = progress;
  return Object.keys(fields).length > 0 ? stableJson(fields) : undefined;
}

function progressSignal(data: Record<string, JsonValue> | undefined): { changed?: boolean; afterSignature?: string } | undefined {
  const value = data?.progressSignal;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, JsonValue>;
  return {
    changed: typeof record.changed === "boolean" ? record.changed : undefined,
    afterSignature: typeof record.afterSignature === "string" ? record.afterSignature : undefined,
  };
}

function countConsecutive(entries: ActionHistoryEntry[], action: string): number {
  let count = 0;
  for (const entry of entries.slice().reverse()) {
    if (entry.action !== action) {
      break;
    }
    count += 1;
  }
  return count;
}

function entryTargetKey(entry: ActionHistoryEntry): string {
  const generated = targetKeyForAction(entry.action, entry.params ?? {});
  if (entry.targetKey && isUnspecifiedGeneratedKey(entry.action, generated)) {
    return entry.targetKey.startsWith(`${normalizeAction(entry.action)}:`)
      ? entry.targetKey
      : `${normalizeAction(entry.action)}:${entry.targetKey}`;
  }
  return generated;
}

function isUnspecifiedGeneratedKey(action: string, targetKey: string): boolean {
  const normalized = normalizeAction(action);
  return targetKey === `${normalized}:unknown`
    || targetKey === `${normalized}:unknown:1`
    || targetKey.startsWith(`${normalized}:unknown:unknown`);
}

function positionFromParams(params: Record<string, JsonValue>): Position | undefined {
  return positionValue(params.position)
    ?? positionValue(params.targetPosition)
    ?? positionValue(params.location)
    ?? directPosition(params);
}

function directPosition(params: Record<string, JsonValue>): Position | undefined {
  return typeof params.x === "number" && typeof params.y === "number" && typeof params.z === "number"
    ? {
        x: params.x,
        y: params.y,
        z: params.z,
        world: typeof params.world === "string" ? params.world : undefined,
      }
    : undefined;
}

function positionFromData(
  data: Record<string, JsonValue> | undefined,
  keys: string[],
): Position | undefined {
  if (!data) {
    return undefined;
  }
  for (const key of keys) {
    const position = positionValue(data[key]);
    if (position) {
      return position;
    }
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

function numericValue(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function distance(left: Position, right: Position): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function hasActiveGoal(currentState: StuckDetectorState): boolean {
  return Boolean(currentState.activeGoal?.trim());
}

function stuckResult(
  blockedTargetKeys: string[],
  reason: string,
  recoveryPromptHint: string,
): StuckAnalysis {
  return {
    stuck: true,
    reason,
    blockedTargetKeys: unique(blockedTargetKeys),
    recoveryPromptHint,
  };
}

function timestampMs(value: string | number | Date | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    return Date.parse(value);
  }
  return Number.NaN;
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown_action";
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
