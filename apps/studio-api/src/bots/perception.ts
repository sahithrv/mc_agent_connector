import type {
  EntityKind,
  EntitySnapshot,
  GameEvent,
  PerceptionSnapshot,
  Position,
} from "@mc-ai-video/contracts";

import type { BotEntity, BotHandle, BotInventoryItem, BotVector } from "./types";

const MAX_INVENTORY_ITEMS = 36;
const MAX_NEARBY_ENTITIES = 12;
const MAX_RECENT_EVENTS = 20;

export interface PerceptionOptions {
  agentId: string;
  bot: BotHandle;
  recentEvents?: GameEvent[];
  now?: Date;
}

export function createPerceptionSnapshot(
  options: PerceptionOptions,
): PerceptionSnapshot {
  const position = toPosition(options.bot.entity?.position);
  const entities = Object.values(options.bot.entities ?? {})
    .map((entity) => toEntitySnapshot(entity, position))
    .filter((entity) => entity.id.length > 0)
    .sort(sortByDistance);

  return {
    agentId: options.agentId,
    timestamp: (options.now ?? new Date()).toISOString(),
    health: options.bot.health,
    food: options.bot.food,
    position,
    inventory: inventorySnapshot(options.bot.inventory?.items() ?? []),
    nearbyPlayers: takeKind(entities, "player"),
    nearbyMobs: entities
      .filter((entity) => entity.kind === "hostile" || entity.kind === "passive")
      .slice(0, MAX_NEARBY_ENTITIES),
    nearbyItems: takeKind(entities, "item"),
    recentEvents: (options.recentEvents ?? []).slice(-MAX_RECENT_EVENTS),
  };
}

function inventorySnapshot(items: BotInventoryItem[]) {
  return items.slice(0, MAX_INVENTORY_ITEMS).map((item) => ({
    name: item.name,
    count: item.count,
    slot: item.slot,
  }));
}

function toEntitySnapshot(
  entity: BotEntity,
  origin?: Position,
): EntitySnapshot {
  const position = toPosition(entity.position);
  return {
    id: String(entity.id ?? ""),
    kind: classifyEntity(entity),
    name: entity.displayName ?? entity.name ?? entity.type,
    username: entity.username,
    position,
    distance: origin && position ? distance(origin, position) : undefined,
  };
}

function classifyEntity(entity: BotEntity): EntityKind {
  if (entity.kind === "hostile" || entity.kind === "passive") {
    return entity.kind;
  }
  if (entity.type === "player" || entity.username) {
    return "player";
  }
  if (entity.kind === "item" || entity.type === "object" || entity.name === "item") {
    return "item";
  }
  if (entity.type === "mob") {
    return isHostileName(entity.displayName ?? entity.name) ? "hostile" : "passive";
  }
  return "unknown";
}

function isHostileName(name?: string): boolean {
  return [
    "blaze",
    "creeper",
    "drowned",
    "enderman",
    "skeleton",
    "spider",
    "witch",
    "zombie",
  ].includes(normalizedEntityName(name));
}

function normalizedEntityName(name?: string): string {
  return (name ?? "").toLowerCase().replace(/\s+/g, "_");
}

function takeKind(entities: EntitySnapshot[], kind: EntityKind): EntitySnapshot[] {
  return entities
    .filter((entity) => entity.kind === kind)
    .slice(0, MAX_NEARBY_ENTITIES);
}

function toPosition(position?: BotVector): Position | undefined {
  if (!position) {
    return undefined;
  }
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    world: position.world,
  };
}

function distance(left: Position, right: Position): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function sortByDistance(left: EntitySnapshot, right: EntitySnapshot): number {
  return (left.distance ?? Number.POSITIVE_INFINITY)
    - (right.distance ?? Number.POSITIVE_INFINITY);
}
