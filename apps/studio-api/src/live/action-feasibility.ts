import type { AgentConfig, JsonValue, Position } from "@mc-ai-video/contracts";

import type { BotBlock, BotEntity, BotHandle, BotInventoryItem } from "../bots/types";
import { isPlaceableMaterialName } from "../materials";
import type {
  PerceivedBlock,
  PerceivedEntity,
  PerceivedPlayer,
  PerceptionSnapshot as RoutinePerceptionSnapshot,
  RoutineActionIntent,
} from "../routines";
import { targetKeyForAction } from "./action-target-key";
import type { ActionAffordance } from "./affordances";

const minecraftData = require("minecraft-data") as (version: string) => MinecraftData;

export type FeasibilityResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      alternatives: RoutineActionIntent[];
    };

export interface ValidateIntentFeasibilityInput {
  agent: AgentConfig;
  bot?: BotHandle;
  perception: RoutinePerceptionSnapshot;
  intent: RoutineActionIntent;
  affordances: ActionAffordance[];
  blockedTargetKeys: string[];
}

interface MinecraftData {
  itemsByName: Record<string, MinecraftItem | undefined>;
  blocksByName: Record<string, MinecraftItem | undefined>;
}

interface MinecraftItem {
  id: number;
  name: string;
}

interface InventorySummary {
  items: BotInventoryItem[];
  counts: Map<string, number>;
}

interface VisibleEntity {
  id?: string;
  type?: string;
  name?: string;
  username?: string;
  position?: Position;
  distance?: number;
  hostile?: boolean;
  protected?: boolean;
  threatening?: boolean;
}

const DEFAULT_MC_VERSION = "1.21.1";
const MAX_MINE_DISTANCE = 8;
const MAX_COLLECT_DISTANCE = 16;
const MAX_PLACE_DISTANCE = 5;
const MIN_ALTERNATIVE_SCORE = 0.45;

const ITEM_ALIASES: Record<string, string> = {
  planks: "oak_planks",
  wood_planks: "oak_planks",
  wood: "oak_planks",
  table: "crafting_table",
  workbench: "crafting_table",
  wood_pickaxe: "wooden_pickaxe",
  wood_axe: "wooden_axe",
  wood_sword: "wooden_sword",
  wood_shovel: "wooden_shovel",
};

const UNSAFE_MINE_BLOCKS = new Set([
  "air",
  "barrier",
  "bedrock",
  "chain_command_block",
  "command_block",
  "fire",
  "lava",
  "moving_piston",
  "repeating_command_block",
  "structure_block",
  "tnt",
  "water",
]);

const ORE_TOOL_REQUIREMENTS: Record<string, PickaxeTier> = {
  iron_ore: "stone",
  deepslate_iron_ore: "stone",
  lapis_ore: "stone",
  deepslate_lapis_ore: "stone",
  gold_ore: "iron",
  deepslate_gold_ore: "iron",
  redstone_ore: "iron",
  deepslate_redstone_ore: "iron",
  diamond_ore: "iron",
  deepslate_diamond_ore: "iron",
  emerald_ore: "iron",
  deepslate_emerald_ore: "iron",
};
const PICKAXE_TIER_ORDER = ["wooden", "stone", "iron", "diamond", "netherite"] as const;
type PickaxeTier = typeof PICKAXE_TIER_ORDER[number];

export function validateIntentFeasibility(input: ValidateIntentFeasibilityInput): FeasibilityResult {
  const blocked = blockedTargetReason(input);
  if (blocked) {
    return rejected(input, blocked);
  }

  switch (normalizeName(input.intent.action)) {
    case "mine_block":
      return validateMineIntent(input);
    case "collect_item":
      return validateCollectIntent(input);
    case "craft_item":
      return validateCraftIntent(input);
    case "place_block":
      return validatePlaceIntent(input);
    case "follow_player":
      return validateFollowIntent(input);
    case "attack_entity":
      return validateAttackIntent(input);
    default:
      return { ok: true };
  }
}

function validateMineIntent(input: ValidateIntentFeasibilityInput): FeasibilityResult {
  const target = positionParam(input.intent.params);
  if (!target) {
    return rejected(input, "mine_block requires a concrete visible block position");
  }

  if (!input.bot?.blockAt || !input.bot.dig) {
    return rejected(input, "digging is not available for mine_block");
  }

  const current = currentPosition(input.bot);
  if (current && distance(current, target) > MAX_MINE_DISTANCE) {
    return rejected(input, `mine target is farther than ${MAX_MINE_DISTANCE} blocks`);
  }

  const block = safeBlockAt(input.bot, target);
  const perceived = block ? undefined : perceivedBlockAt(input.perception, target);
  if (!block && !perceived) {
    return rejected(input, "mine target block is not visible in the current world snapshot");
  }

  const blockName = normalizeName(block?.name ?? perceived?.type ?? "");
  const requestedName = normalizeName(firstString(input.intent.params, ["block", "name"]) ?? blockName);
  if (requestedName && blockName && requestedName !== blockName) {
    return rejected(input, `visible block is ${blockName}, not ${requestedName}`);
  }

  if (UNSAFE_MINE_BLOCKS.has(blockName)) {
    return rejected(input, `unsafe block cannot be mined: ${blockName}`);
  }
  if (perceived?.safe === false || perceived?.belowAgent === true) {
    return rejected(input, "mine target is marked unsafe in perception");
  }
  if (block?.diggable === false) {
    return rejected(input, `block is not diggable: ${blockName}`);
  }
  if (block && safeCanDigBlock(input.bot, block) === false) {
    return rejected(input, `missing valid tool for block: ${blockName}`);
  }

  const requiredTier = requiredPickaxeTier(blockName);
  if (requiredTier && !hasPickaxeAtLeast(inventorySummary(input.bot, input.perception), requiredTier)) {
    return rejected(input, `missing ${requiredTier}_pickaxe for ${blockName}`);
  }

  return { ok: true };
}

function validateCollectIntent(input: ValidateIntentFeasibilityInput): FeasibilityResult {
  if (!input.bot?.collectBlock) {
    return rejected(input, "collectBlock plugin is not available for collect_item");
  }

  const target = collectTarget(input);
  if (!target) {
    return rejected(input, "collect target item is not visible");
  }
  if (target.hostile === true || target.protected === true) {
    return rejected(input, "collect target is not a safe dropped item");
  }
  if (!target.position && target.distance === undefined) {
    return rejected(input, "collect target position is unknown");
  }

  const emptySlots = safeEmptySlotCount(input.bot);
  if (emptySlots !== undefined && emptySlots <= 0) {
    return rejected(input, "inventory has no empty slots for collect_item");
  }

  const current = currentPosition(input.bot);
  const targetDistance = target.position && current ? distance(current, target.position) : target.distance;
  if (targetDistance !== undefined && targetDistance > MAX_COLLECT_DISTANCE) {
    return rejected(input, `collect target is farther than ${MAX_COLLECT_DISTANCE} blocks`);
  }

  return { ok: true };
}

function validateCraftIntent(input: ValidateIntentFeasibilityInput): FeasibilityResult {
  const itemName = normalizeName(firstString(input.intent.params, ["item", "name", "block"]) ?? "");
  if (!itemName) {
    return rejected(input, "craft_item requires an item name");
  }

  const matchingAffordances = input.affordances.filter((affordance) =>
    affordance.action === "craft_item"
    && normalizeName(firstString(affordance.params, ["item", "name", "block"]) ?? "") === itemName,
  );
  const executableAffordance = matchingAffordances.find((affordance) => affordance.blocked !== true);
  if (executableAffordance) {
    return { ok: true };
  }

  if (!input.bot?.craft || !input.bot.recipesFor) {
    return rejected(input, "crafting is not available for craft_item");
  }

  const craftability = craftableNow(input.bot, itemName);
  if (craftability === true) {
    return { ok: true };
  }

  const blockedReason = matchingAffordances.find((affordance) => affordance.blockedReason)?.blockedReason;
  if (blockedReason) {
    return rejected(input, `craft_item ${itemName} has unmet precondition: ${blockedReason}`);
  }

  return rejected(
    input,
    craftability === "unknown_item"
      ? `unknown craft item: ${itemName}`
      : `craft_item ${itemName} is not currently craftable`,
  );
}

function validatePlaceIntent(input: ValidateIntentFeasibilityInput): FeasibilityResult {
  const target = positionParam(input.intent.params);
  if (!target) {
    return rejected(input, "place_block requires a concrete target position");
  }

  const bot = input.bot;
  if (!bot?.blockAt || !bot.placeBlock || !bot.equip) {
    return rejected(input, "block placement is not available for place_block");
  }

  const current = currentPosition(bot);
  if (current && distance(current, target) > MAX_PLACE_DISTANCE) {
    return rejected(input, `place target is farther than ${MAX_PLACE_DISTANCE} blocks`);
  }

  const blockName = normalizeName(firstString(input.intent.params, ["block", "item", "name"]) ?? firstPlaceableItem(bot) ?? "");
  if (!blockName || !isPlaceableMaterialName(blockName)) {
    return rejected(input, "place_block requires a safe placeable block item");
  }
  if (!hasInventoryItem(bot, blockName)) {
    return rejected(input, `missing block item for placement: ${blockName}`);
  }

  const targetBlock = safeBlockAt(bot, target);
  if (!targetBlock) {
    return rejected(input, "place target block is not visible");
  }
  if (targetBlock.name !== "air") {
    return rejected(input, `place target is occupied by ${targetBlock.name}`);
  }
  if (!hasAdjacentReferenceBlock(bot, target)) {
    return rejected(input, "no adjacent reference block for placement");
  }

  return { ok: true };
}

function validateFollowIntent(input: ValidateIntentFeasibilityInput): FeasibilityResult {
  if (!input.bot?.pathfinder) {
    return rejected(input, "pathfinder is not available for follow_player");
  }

  const username = firstString(input.intent.params, ["username", "player", "target", "name"]);
  if (!username) {
    return rejected(input, "follow_player requires a target username");
  }
  if (username.toLowerCase() === input.agent.account.username.toLowerCase()) {
    return rejected(input, "follow_player cannot target the agent itself");
  }

  if (!visiblePlayer(input, username)) {
    return rejected(input, `follow target is not visible: ${username}`);
  }

  return { ok: true };
}

function validateAttackIntent(input: ValidateIntentFeasibilityInput): FeasibilityResult {
  if (!input.bot?.attack) {
    return rejected(input, "attacking is not available for attack_entity");
  }

  const target = attackTarget(input);
  if (!target) {
    return rejected(input, "attack target is not visible");
  }
  if (target.username?.toLowerCase() === input.agent.account.username.toLowerCase()) {
    return rejected(input, "attack_entity cannot target the agent itself");
  }
  if (target.protected === true && !directorOverride(input.intent)) {
    return rejected(input, "protected attack target requires director override");
  }

  return { ok: true };
}

function blockedTargetReason(input: ValidateIntentFeasibilityInput): string | undefined {
  const blocked = new Set(input.blockedTargetKeys);
  if (blocked.size === 0) {
    return undefined;
  }
  const generated = targetKeyForAction(input.intent.action, input.intent.params);
  const keys = [input.intent.targetKey, generated].filter((key): key is string => Boolean(key));
  const blockedKey = keys.find((key) => blocked.has(key));
  return blockedKey ? `target is blocked by recent stuck detection: ${blockedKey}` : undefined;
}

function rejected(input: ValidateIntentFeasibilityInput, reason: string): FeasibilityResult {
  return {
    ok: false,
    reason,
    alternatives: alternativeIntents(input),
  };
}

function alternativeIntents(input: ValidateIntentFeasibilityInput): RoutineActionIntent[] {
  const blocked = new Set(input.blockedTargetKeys);
  const rejectedTarget = targetKeyForAction(input.intent.action, input.intent.params);
  return input.affordances
    .filter((affordance) => affordance.blocked !== true)
    .filter((affordance) => affordance.advancesGoal === true)
    .filter((affordance) => affordance.score >= MIN_ALTERNATIVE_SCORE)
    .map((affordance) => ({
      ...affordance,
      targetKey: affordance.targetKey ?? targetKeyForAction(affordance.action, affordance.params),
    }))
    .filter((affordance) => !blocked.has(affordance.targetKey))
    .filter((affordance) => !(affordance.action === input.intent.action && affordance.targetKey === rejectedTarget))
    .sort((left, right) =>
      right.score - left.score
      || left.action.localeCompare(right.action)
      || left.targetKey.localeCompare(right.targetKey),
    )
    .slice(0, 4)
    .map((affordance) => ({
      action: affordance.action,
      params: { ...affordance.params },
      timeoutMs: timeoutForAction(affordance.action),
      requestedBy: "llm-feasibility",
      source: "affordance_alternative",
      targetKey: affordance.targetKey,
    }));
}

function timeoutForAction(action: string): number {
  switch (action) {
    case "mine_block":
      return 12_000;
    case "collect_item":
      return 10_000;
    case "craft_item":
    case "place_block":
    case "attack_entity":
      return 8_000;
    case "move_to":
    case "follow_player":
      return 12_000;
    default:
      return 5_000;
  }
}

function collectTarget(input: ValidateIntentFeasibilityInput): VisibleEntity | undefined {
  const entityId = firstString(input.intent.params, ["entityId"]);
  const itemName = normalizeName(firstString(input.intent.params, ["item", "name", "target"]) ?? "");
  const botEntities = Object.values(input.bot?.entities ?? {})
    .filter(isBotItemEntity)
    .map(botEntityToVisibleEntity);
  const perceivedEntities = input.perception.nearbyEntities
    .filter((entity) => entity.hostile !== true)
    .map(perceivedEntityToVisibleEntity);

  return [...botEntities, ...perceivedEntities].find((entity) => {
    if (entityId && entity.id === entityId) {
      return true;
    }
    if (!itemName) {
      return false;
    }
    return [entity.name, entity.type]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeName(value) === itemName);
  });
}

function attackTarget(input: ValidateIntentFeasibilityInput): VisibleEntity | undefined {
  const entityId = firstString(input.intent.params, ["entityId"]);
  const username = firstString(input.intent.params, ["username"]);
  const name = normalizeName(firstString(input.intent.params, ["name", "target"]) ?? "");
  const botEntities = Object.values(input.bot?.entities ?? {}).map(botEntityToVisibleEntity);
  const perceived = [
    ...input.perception.nearbyEntities.map(perceivedEntityToVisibleEntity),
    ...input.perception.nearbyPlayers.map(perceivedPlayerToVisibleEntity),
  ];

  return [...botEntities, ...perceived].find((entity) => {
    if (entityId && entity.id === entityId) {
      return true;
    }
    if (username && entity.username?.toLowerCase() === username.toLowerCase()) {
      return true;
    }
    if (!name) {
      return false;
    }
    return [entity.name, entity.type, entity.username]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeName(value) === name);
  });
}

function visiblePlayer(input: ValidateIntentFeasibilityInput, username: string): boolean {
  const lower = username.toLowerCase();
  return input.perception.nearbyPlayers.some((player) => player.name.toLowerCase() === lower)
    || Object.values(input.bot?.entities ?? {}).some((entity) =>
      entity.type === "player" && entity.username?.toLowerCase() === lower,
    );
}

function perceivedBlockAt(perception: RoutinePerceptionSnapshot, target: Position): PerceivedBlock | undefined {
  return perception.visibleBlocks.find((block) => sameBlockPosition(block.position, target));
}

function safeBlockAt(bot: BotHandle, position: Position): BotBlock | null {
  try {
    return bot.blockAt?.(position) ?? null;
  } catch {
    return null;
  }
}

function safeCanDigBlock(bot: BotHandle, block: BotBlock): boolean | undefined {
  if (!bot.canDigBlock) {
    return undefined;
  }
  try {
    return bot.canDigBlock(block);
  } catch {
    return undefined;
  }
}

function safeEmptySlotCount(bot: BotHandle): number | undefined {
  try {
    return bot.inventory?.emptySlotCount?.();
  } catch {
    return undefined;
  }
}

function hasAdjacentReferenceBlock(bot: BotHandle, target: Position): boolean {
  return [
    { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ].some((offset) => {
    const block = safeBlockAt(bot, {
      x: target.x + offset.x,
      y: target.y + offset.y,
      z: target.z + offset.z,
      world: target.world,
    });
    return Boolean(block && block.name !== "air");
  });
}

function craftableNow(bot: BotHandle, itemName: string): true | false | "unknown_item" {
  const data = safeMinecraftData(bot.version ?? DEFAULT_MC_VERSION);
  if (!data) {
    return false;
  }
  const item = resolveCraftItem(data, itemName);
  if (!item) {
    return "unknown_item";
  }
  try {
    const craftingTable = findNearbyCraftingTable(bot, data);
    return bot.recipesFor?.(item.id, null, 1, craftingTable).length ? true : false;
  } catch {
    return false;
  }
}

function resolveCraftItem(data: MinecraftData, requestedName: string): MinecraftItem | undefined {
  const canonical = ITEM_ALIASES[requestedName] ?? requestedName;
  return data.itemsByName[canonical] ?? data.blocksByName[canonical];
}

function safeMinecraftData(version: string): MinecraftData | undefined {
  try {
    return minecraftData(version);
  } catch {
    return undefined;
  }
}

function findNearbyCraftingTable(bot: BotHandle, data: MinecraftData): BotBlock | null {
  const tableId = data.blocksByName.crafting_table?.id;
  if (tableId === undefined || !bot.findBlock) {
    return null;
  }
  try {
    return bot.findBlock({ matching: tableId, maxDistance: 4 }) ?? null;
  } catch {
    return null;
  }
}

function inventorySummary(bot: BotHandle | undefined, perception: RoutinePerceptionSnapshot): InventorySummary {
  const items = bot?.inventory?.items?.() ?? [
    ...perception.inventory.tools.map((name) => ({ name, count: 1 })),
    ...(perception.inventory.seeds > 0 ? [{ name: "wheat_seeds", count: perception.inventory.seeds }] : []),
  ];
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = normalizeName(item.name);
    counts.set(name, (counts.get(name) ?? 0) + Math.max(0, item.count));
  }
  return { items, counts };
}

function firstPlaceableItem(bot: BotHandle): string | undefined {
  return bot.inventory?.items()
    .map((item) => item.name)
    .find((name) => isPlaceableMaterialName(name));
}

function hasInventoryItem(bot: BotHandle, itemName: string): boolean {
  return Boolean(bot.inventory?.items().some((item) => normalizeName(item.name) === itemName && item.count > 0));
}

function hasPickaxeAtLeast(inventory: InventorySummary, required: PickaxeTier): boolean {
  const requiredIndex = PICKAXE_TIER_ORDER.indexOf(required);
  return [...inventory.counts.keys()].some((item) => {
    const match = /^(.+)_pickaxe$/.exec(item);
    if (!match) {
      return false;
    }
    const tier = match[1] as PickaxeTier;
    const tierIndex = PICKAXE_TIER_ORDER.indexOf(tier);
    return tierIndex >= requiredIndex && count(inventory, item) > 0;
  });
}

function requiredPickaxeTier(blockName: string): PickaxeTier | undefined {
  if (ORE_TOOL_REQUIREMENTS[blockName]) {
    return ORE_TOOL_REQUIREMENTS[blockName];
  }
  if (/coal_ore|copper_ore/.test(blockName)) {
    return "wooden";
  }
  return undefined;
}

function count(inventory: InventorySummary, item: string): number {
  return inventory.counts.get(normalizeName(item)) ?? 0;
}

function isBotItemEntity(entity: BotEntity): boolean {
  return entity.kind === "item" || entity.type === "object" || entity.name === "item";
}

function botEntityToVisibleEntity(entity: BotEntity): VisibleEntity {
  return {
    id: String(entity.id),
    type: entity.type,
    name: entity.displayName ?? entity.name,
    username: entity.username,
    position: toPosition(entity.position),
  };
}

function perceivedEntityToVisibleEntity(entity: PerceivedEntity): VisibleEntity {
  return {
    id: entity.id,
    type: entity.type,
    name: entity.type,
    position: entity.position,
    distance: entity.distance,
    hostile: entity.hostile,
    protected: entity.protected,
  };
}

function perceivedPlayerToVisibleEntity(player: PerceivedPlayer): VisibleEntity {
  return {
    id: player.id,
    type: "player",
    name: player.name,
    username: player.name,
    distance: player.distance,
    protected: player.protected,
    threatening: player.threatening,
  };
}

function directorOverride(intent: RoutineActionIntent): boolean {
  return intent.requestedBy === "director" && intent.params.directorOverride === true;
}

function currentPosition(bot: BotHandle | undefined): Position | undefined {
  return toPosition(bot?.entity?.position);
}

function toPosition(position: Position | undefined): Position | undefined {
  return position
    ? {
        x: position.x,
        y: position.y,
        z: position.z,
        world: position.world,
      }
    : undefined;
}

function positionParam(params: Record<string, JsonValue>): Position | undefined {
  const direct = params.position;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const source = direct as Partial<Position>;
    if (typeof source.x === "number" && typeof source.y === "number" && typeof source.z === "number") {
      return { x: source.x, y: source.y, z: source.z, world: source.world };
    }
  }
  return typeof params.x === "number" && typeof params.y === "number" && typeof params.z === "number"
    ? {
        x: params.x,
        y: params.y,
        z: params.z,
        world: typeof params.world === "string" ? params.world : undefined,
      }
    : undefined;
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

function sameBlockPosition(left: Position, right: Position): boolean {
  if (left.world && right.world && left.world !== right.world) {
    return false;
  }
  return Math.floor(left.x) === Math.floor(right.x)
    && Math.floor(left.y) === Math.floor(right.y)
    && Math.floor(left.z) === Math.floor(right.z);
}

function distance(left: Position, right: Position): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
