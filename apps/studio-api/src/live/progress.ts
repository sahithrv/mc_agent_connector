import type { ActionResult, JsonValue, Position } from "@mc-ai-video/contracts";

import type { BotHandle, BotInventoryItem } from "../bots/types";
import type { PerceptionSnapshot as RoutinePerceptionSnapshot } from "../routines";
import type { TeamGoalStateSnapshot } from "./team-goal-controller";

export type ProgressChange =
  | "inventory"
  | "position"
  | "health"
  | "food"
  | "placedBlocks"
  | "minedBlocks"
  | "collectedItems"
  | "craftedItems"
  | `teamGoal.${string}`;

export interface ActionProgressCounters {
  placedBlocks: number;
  minedBlocks: number;
  collectedItems: number;
  craftedItems: number;
}

export interface ProgressSnapshot {
  inventory?: Record<string, number>;
  position?: Position;
  health?: number;
  food?: number;
  actionCounts?: ActionProgressCounters;
  teamGoalProgress?: Record<string, number>;
}

export interface ProgressSignal {
  changed: boolean;
  baseline: boolean;
  changes: ProgressChange[];
  delta: Record<string, JsonValue>;
  beforeSignature?: string;
  afterSignature: string;
}

export interface CreateProgressSnapshotInput {
  bot?: BotHandle;
  perception?: RoutinePerceptionSnapshot;
  teamGoal?: TeamGoalStateSnapshot;
  actionCounts?: ActionProgressCounters;
}

const POSITION_TOLERANCE = 0.05;

export function emptyActionProgressCounters(): ActionProgressCounters {
  return {
    placedBlocks: 0,
    minedBlocks: 0,
    collectedItems: 0,
    craftedItems: 0,
  };
}

export function createProgressSnapshot(input: CreateProgressSnapshotInput): ProgressSnapshot {
  const inventory = inventorySnapshot(input.bot?.inventory?.items() ?? perceptionInventoryItems(input.perception));
  const position = positionSnapshot(input.bot?.entity?.position);
  const actionCounts = input.actionCounts ? { ...input.actionCounts } : undefined;
  return compactSnapshot({
    inventory: Object.keys(inventory).length > 0 ? inventory : undefined,
    position,
    health: numeric(input.bot?.health ?? input.perception?.health),
    food: numeric(input.bot?.food ?? input.perception?.inventory.food),
    actionCounts,
    teamGoalProgress: input.teamGoal ? { ...input.teamGoal.progress } : undefined,
  });
}

export function actionProgressDeltaFromResult(result: ActionResult): Partial<ActionProgressCounters> {
  if (!result.ok) {
    return {};
  }

  if (result.action === "place_block" && hasResultData(result, ["block", "position"])) {
    return { placedBlocks: 1 };
  }
  if (result.action === "mine_block" && hasResultData(result, ["block", "position"])) {
    return { minedBlocks: 1 };
  }
  if (result.action === "collect_item" && hasResultData(result, ["item", "entityId"])) {
    return { collectedItems: 1 };
  }
  if (result.action === "craft_item" && hasResultData(result, ["item"])) {
    return { craftedItems: Math.max(1, numeric(result.data?.count) ?? 1) };
  }
  if (result.action === "harvest_crop" && hasResultData(result, ["crop", "position"])) {
    return { collectedItems: 1 };
  }
  if (result.action === "plant_crop" && hasResultData(result, ["seed", "position"])) {
    return { placedBlocks: 1 };
  }
  return {};
}

export function applyActionProgressDelta(
  counters: ActionProgressCounters,
  delta: Partial<ActionProgressCounters>,
): ActionProgressCounters {
  return {
    placedBlocks: counters.placedBlocks + Math.max(0, Math.floor(delta.placedBlocks ?? 0)),
    minedBlocks: counters.minedBlocks + Math.max(0, Math.floor(delta.minedBlocks ?? 0)),
    collectedItems: counters.collectedItems + Math.max(0, Math.floor(delta.collectedItems ?? 0)),
    craftedItems: counters.craftedItems + Math.max(0, Math.floor(delta.craftedItems ?? 0)),
  };
}

export function extractProgressSignal(
  before: ProgressSnapshot | undefined,
  after: ProgressSnapshot,
): ProgressSignal {
  const changes: ProgressChange[] = [];
  const delta: Record<string, JsonValue> = {};

  if (!before) {
    const initialChanges = initialCounterChanges(after);
    return {
      changed: initialChanges.length > 0,
      baseline: false,
      changes: initialChanges,
      delta: initialChanges.length > 0 ? counterDelta(undefined, after, initialChanges) : {},
      afterSignature: progressSignature(after),
    };
  }

  const inventoryDelta = inventoryDeltaFor(before.inventory, after.inventory);
  if (Object.keys(inventoryDelta).length > 0) {
    changes.push("inventory");
    delta.inventory = inventoryDelta;
  }

  if (positionChanged(before.position, after.position)) {
    changes.push("position");
    delta.position = {
      before: before.position ?? null,
      after: after.position ?? null,
    };
  }

  if (numberChanged(before.health, after.health)) {
    changes.push("health");
    delta.health = { before: before.health ?? null, after: after.health ?? null };
  }

  if (numberChanged(before.food, after.food)) {
    changes.push("food");
    delta.food = { before: before.food ?? null, after: after.food ?? null };
  }

  for (const key of ["placedBlocks", "minedBlocks", "collectedItems", "craftedItems"] as const) {
    const beforeValue = before.actionCounts?.[key] ?? 0;
    const afterValue = after.actionCounts?.[key] ?? 0;
    if (beforeValue !== afterValue) {
      changes.push(key);
      delta[key] = afterValue - beforeValue;
    }
  }

  for (const [key, afterValue] of Object.entries(after.teamGoalProgress ?? {})) {
    const beforeValue = before.teamGoalProgress?.[key] ?? 0;
    if (beforeValue !== afterValue) {
      changes.push(`teamGoal.${key}`);
      delta[`teamGoal.${key}`] = afterValue - beforeValue;
    }
  }

  return {
    changed: changes.length > 0,
    baseline: true,
    changes,
    delta,
    beforeSignature: progressSignature(before),
    afterSignature: progressSignature(after),
  };
}

export function progressSignalData(signal: ProgressSignal): Record<string, JsonValue> {
  return {
    changed: signal.changed,
    baseline: signal.baseline,
    changes: signal.changes,
    delta: signal.delta,
    ...(signal.beforeSignature ? { beforeSignature: signal.beforeSignature } : {}),
    afterSignature: signal.afterSignature,
  };
}

export function progressSignature(snapshot: ProgressSnapshot): string {
  return stableJson(compactSnapshot(snapshot));
}

function initialCounterChanges(snapshot: ProgressSnapshot): ProgressChange[] {
  const changes: ProgressChange[] = [];
  for (const key of ["placedBlocks", "minedBlocks", "collectedItems", "craftedItems"] as const) {
    if ((snapshot.actionCounts?.[key] ?? 0) > 0) {
      changes.push(key);
    }
  }
  for (const [key, value] of Object.entries(snapshot.teamGoalProgress ?? {})) {
    if (value > 0) {
      changes.push(`teamGoal.${key}`);
    }
  }
  return changes;
}

function counterDelta(
  before: ProgressSnapshot | undefined,
  after: ProgressSnapshot,
  changes: ProgressChange[],
): Record<string, JsonValue> {
  const delta: Record<string, JsonValue> = {};
  for (const change of changes) {
    if (change.startsWith("teamGoal.")) {
      const key = change.slice("teamGoal.".length);
      delta[change] = (after.teamGoalProgress?.[key] ?? 0) - (before?.teamGoalProgress?.[key] ?? 0);
      continue;
    }
    if (change in (after.actionCounts ?? {})) {
      const key = change as keyof ActionProgressCounters;
      delta[key] = (after.actionCounts?.[key] ?? 0) - (before?.actionCounts?.[key] ?? 0);
    }
  }
  return delta;
}

function inventorySnapshot(items: BotInventoryItem[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = normalizeName(item.name);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + Math.max(0, Math.floor(item.count)));
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function perceptionInventoryItems(
  perception: RoutinePerceptionSnapshot | undefined,
): BotInventoryItem[] {
  if (!perception) {
    return [];
  }
  return [
    ...perception.inventory.tools.map((name) => ({ name, count: 1 })),
    ...(perception.inventory.seeds > 0 ? [{ name: "wheat_seeds", count: perception.inventory.seeds }] : []),
    ...(perception.inventory.food && perception.inventory.food > 0 ? [{ name: "food", count: perception.inventory.food }] : []),
  ];
}

function inventoryDeltaFor(
  before: Record<string, number> | undefined,
  after: Record<string, number> | undefined,
): Record<string, JsonValue> {
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const delta: Record<string, JsonValue> = {};
  for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
    const beforeValue = before?.[name] ?? 0;
    const afterValue = after?.[name] ?? 0;
    if (beforeValue !== afterValue) {
      delta[name] = afterValue - beforeValue;
    }
  }
  return delta;
}

function positionChanged(left: Position | undefined, right: Position | undefined): boolean {
  if (!left && !right) return false;
  if (!left || !right) return true;
  if ((left.world ?? "") !== (right.world ?? "")) return true;
  return distance(left, right) > POSITION_TOLERANCE;
}

function distance(left: Position, right: Position): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function positionSnapshot(position: Position | undefined): Position | undefined {
  return position
    ? {
        x: roundPosition(position.x),
        y: roundPosition(position.y),
        z: roundPosition(position.z),
        world: position.world,
      }
    : undefined;
}

function roundPosition(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberChanged(left: number | undefined, right: number | undefined): boolean {
  return left !== right;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasResultData(result: ActionResult, keys: string[]): boolean {
  const data = result.data ?? {};
  return keys.some((key) => data[key] !== undefined);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function compactSnapshot(snapshot: ProgressSnapshot): ProgressSnapshot {
  return {
    ...(snapshot.inventory && Object.keys(snapshot.inventory).length > 0 ? { inventory: snapshot.inventory } : {}),
    ...(snapshot.position ? { position: snapshot.position } : {}),
    ...(snapshot.health !== undefined ? { health: snapshot.health } : {}),
    ...(snapshot.food !== undefined ? { food: snapshot.food } : {}),
    ...(snapshot.actionCounts ? { actionCounts: { ...snapshot.actionCounts } } : {}),
    ...(snapshot.teamGoalProgress ? { teamGoalProgress: { ...snapshot.teamGoalProgress } } : {}),
  };
}

function stableJson(value: JsonValue | ProgressSnapshot): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
