import type {
  AgentConfig,
  JsonValue,
  Position,
} from "@mc-ai-video/contracts";

import type { BotBlock, BotHandle, BotInventoryItem } from "../bots/types";
import type { ActionResultContext } from "../llm/prompts";
import type { AgentDecision } from "../llm/schemas/agent-decision";
import { isPlaceableMaterialName } from "../materials";
import type {
  PerceivedBlock,
  PerceivedEntity,
  PerceivedPlayer,
  PerceptionSnapshot as RoutinePerceptionSnapshot,
} from "../routines";
import { targetKeyForAction } from "./action-target-key";

export interface ActionAffordance {
  action: AgentDecision["action"];
  params: Record<string, JsonValue>;
  score: number;
  reason: string;
  advancesGoal?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  targetKey?: string;
}

export interface BuildAffordancesInput {
  agent: AgentConfig;
  bot?: BotHandle;
  perception: RoutinePerceptionSnapshot;
  goal?: string;
  recentFailures?: ActionResultContext[];
}

interface InventorySummary {
  counts: Map<string, number>;
  items: BotInventoryItem[];
}

interface CraftRecipe {
  item: string;
  count: number;
  missing: string[];
  reason: string;
  score: number;
  advancesGoal: boolean;
  usefulWhenBlocked: boolean;
}

const MAX_AFFORDANCES = 28;
const MAX_MINE_DISTANCE = 8;
const MAX_COLLECT_DISTANCE = 16;
const MAX_PLACE_DISTANCE = 4;

const USEFUL_DROP_PATTERN =
  /seed|wheat|carrot|potato|apple|bread|beef|pork|chicken|mutton|log|wood|planks|stick|cobblestone|stone|ore|ingot|coal|torch|tool|sword|pickaxe|axe|shovel|hoe|sapling/i;
const MINEABLE_BLOCK_PATTERN =
  /stone|deepslate|dirt|grass_block|sand|gravel|clay|coal_ore|iron_ore|copper_ore|gold_ore|redstone_ore|lapis_ore|diamond_ore|emerald_ore|log|wood|stem|hyphae/i;
const BUILD_GOAL_PATTERN = /\b(build|base|village|house|wall|bridge|shelter|camp|place|construct)\b/i;
const MINE_GOAL_PATTERN = /\b(mine|miner|ore|iron|coal|copper|gold|diamond|stone|cobble|pickaxe|tool)\b/i;
const RESOURCE_GOAL_PATTERN = /\b(gather|collect|resource|supply|wood|log|plank|stick|food|farm|crop|torch)\b/i;
const SCOUT_GOAL_PATTERN = /\b(scout|search|find|explore|locate|look for|survey|spread)\b/i;
const ATTACK_GOAL_PATTERN = /\b(attack|kill|hunt|fight|defend|hostile|mob|enemy)\b/i;
const FOLLOW_GOAL_PATTERN = /\b(follow|leader|group|meet|regroup|escort)\b/i;

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

export function buildAffordances(input: BuildAffordancesInput): ActionAffordance[] {
  const builder = new AffordanceBuilder(input);
  builder.addMineBlockAffordances();
  builder.addCollectItemAffordances();
  builder.addCraftAffordances();
  builder.addPlaceBlockAffordances();
  builder.addFollowPlayerAffordances();
  builder.addAttackEntityAffordances();
  builder.addScoutMoveAffordances();
  return builder.result();
}

class AffordanceBuilder {
  private readonly affordances = new Map<string, ActionAffordance>();
  private readonly goalText: string;
  private readonly inventory: InventorySummary;
  private readonly recentFailures: ActionResultContext[];

  public constructor(private readonly input: BuildAffordancesInput) {
    this.goalText = input.goal?.toLowerCase() ?? "";
    this.inventory = inventorySummary(input.bot, input.perception);
    this.recentFailures = input.recentFailures ?? [];
  }

  public addMineBlockAffordances(): void {
    if (!this.canConsider("mine_block")) {
      return;
    }

    for (const block of this.input.perception.visibleBlocks) {
      const blockName = normalizeName(block.type);
      if (!isMineableBlock(block)) {
        continue;
      }
      if (!withinRange(this.currentPosition(), block.position, MAX_MINE_DISTANCE)) {
        continue;
      }

      const params = {
        position: compactPosition(block.position),
        block: blockName,
        reason: mineReason(blockName, this.goalText),
      };
      const advancesGoal = advancesGoalForName(blockName, this.goalText) || MINE_GOAL_PATTERN.test(this.goalText);
      const targetKey = targetKeyForAction("mine_block", params);
      const missingTool = this.missingToolForBlock(block);
      const recentFailure = this.recentFailure("mine_block", `block:${blockName}`);
      const blockedReason = missingTool ?? missingToolFromFailure(recentFailure);
      if (blockedReason) {
        this.add({
          action: "mine_block",
          params,
          score: score(0.86, advancesGoal),
          reason: `${blockName} is visible but ${blockedReason}`,
          advancesGoal,
          blocked: true,
          blockedReason,
          targetKey,
        });
        this.addToolPrecondition(blockName, blockedReason, advancesGoal);
        continue;
      }

      this.add({
        action: "mine_block",
        params,
        score: score(0.78, advancesGoal),
        reason: mineReason(blockName, this.goalText),
        advancesGoal,
        targetKey,
      });
    }
  }

  public addCollectItemAffordances(): void {
    if (!this.canConsider("collect_item") || this.input.bot && !this.input.bot.collectBlock) {
      return;
    }

    for (const entity of this.input.perception.nearbyEntities) {
      const itemName = normalizeName(entity.type);
      if (!isUsefulDrop(entity)) {
        continue;
      }
      if (!withinRange(this.currentPosition(), entity.position, MAX_COLLECT_DISTANCE)) {
        continue;
      }

      const advancesGoal = advancesGoalForName(itemName, this.goalText) || RESOURCE_GOAL_PATTERN.test(this.goalText);
      const params = {
        entityId: entity.id,
        item: itemName,
        reason: collectReason(itemName, this.goalText),
      };
      this.add({
        action: "collect_item",
        params,
        score: score(0.74, advancesGoal),
        reason: collectReason(itemName, this.goalText),
        advancesGoal,
        targetKey: targetKeyForAction("collect_item", params),
      });
    }
  }

  public addCraftAffordances(): void {
    if (!this.canConsider("craft_item")) {
      return;
    }

    for (const recipe of craftRecipes(this.inventory, this.goalText, this.input.perception)) {
      if (recipe.missing.length > 0 && !recipe.usefulWhenBlocked) {
        continue;
      }
      const blockedReason = recipe.missing.length ? `need ${joinMissing(recipe.missing)}` : undefined;
      const params = {
        item: recipe.item,
        count: recipe.count,
        reason: recipe.reason,
      };
      this.add({
        action: "craft_item",
        params,
        score: score(recipe.score, recipe.advancesGoal),
        reason: recipe.reason,
        advancesGoal: recipe.advancesGoal,
        blocked: blockedReason !== undefined,
        blockedReason,
        targetKey: targetKeyForAction("craft_item", params),
      });
    }
  }

  public addPlaceBlockAffordances(): void {
    if (!this.canConsider("place_block") || this.input.bot && (!this.input.bot.blockAt || !this.input.bot.placeBlock || !this.input.bot.equip)) {
      return;
    }

    const bot = this.input.bot;
    const current = this.currentPosition();
    if (!bot?.blockAt || !current) {
      return;
    }

    const blockItem = this.inventory.items.find((item) =>
      item.count > 0 && isPlaceableMaterialName(item.name),
    );
    if (!blockItem) {
      return;
    }

    for (const target of nearbyPlaceTargets(bot, current).slice(0, 3)) {
      const advancesGoal = BUILD_GOAL_PATTERN.test(this.goalText);
      const params = {
        position: target,
        block: blockItem.name,
        reason: advancesGoal ? "placing usable building material for the active build goal" : "nearby valid placement target",
      };
      this.add({
        action: "place_block",
        params,
        score: score(0.58, advancesGoal),
        reason: advancesGoal ? "placeable block in inventory and nearby support block exists" : "nearby valid placement target",
        advancesGoal,
        targetKey: targetKeyForAction("place_block", params),
      });
    }
  }

  public addFollowPlayerAffordances(): void {
    if (!this.canConsider("follow_player") || this.input.bot && !this.input.bot.pathfinder) {
      return;
    }

    for (const player of this.input.perception.nearbyPlayers) {
      if (!isSafeFollowTarget(this.input.agent, player)) {
        continue;
      }
      const advancesGoal = FOLLOW_GOAL_PATTERN.test(this.goalText);
      const params = {
        username: player.name,
        range: 3,
        reason: advancesGoal ? "visible player matches movement or regrouping goal" : "visible player can be followed if coordination is needed",
      };
      this.add({
        action: "follow_player",
        params,
        score: score(0.52, advancesGoal),
        reason: advancesGoal ? "visible follow target for the active goal" : "visible follow target",
        advancesGoal,
        targetKey: targetKeyForAction("follow_player", params),
      });
    }
  }

  public addAttackEntityAffordances(): void {
    if (!this.canConsider("attack_entity") || this.input.bot && !this.input.bot.attack) {
      return;
    }

    for (const entity of this.input.perception.nearbyEntities) {
      if (!isSafeAttackEntity(entity)) {
        continue;
      }
      const targetName = normalizeName(entity.type);
      const advancesGoal = ATTACK_GOAL_PATTERN.test(this.goalText) || entity.hostile === true;
      const params = {
        entityId: entity.id,
        name: targetName,
        reason: entity.hostile ? "hostile entity is visible and safe to attack" : "visible allowed attack target",
      };
      this.add({
        action: "attack_entity",
        params,
        score: score(0.64, advancesGoal),
        reason: entity.hostile ? "visible hostile entity" : "visible allowed attack target",
        advancesGoal,
        targetKey: targetKeyForAction("attack_entity", params),
      });
    }

    for (const player of this.input.perception.nearbyPlayers) {
      if (!isSafeAttackPlayer(this.input.agent, player, this.goalText)) {
        continue;
      }
      const params = {
        username: player.name,
        directorOverride: true,
        reason: "director-approved attack target is visible",
      };
      this.add({
        action: "attack_entity",
        params,
        score: 0.82,
        reason: "visible director-approved attack target",
        advancesGoal: true,
        targetKey: targetKeyForAction("attack_entity", params),
      });
    }
  }

  public addScoutMoveAffordances(): void {
    if (!this.canConsider("move_to") || this.input.bot && !this.input.bot.pathfinder) {
      return;
    }

    const targets = this.input.perception.patrolPoints?.length
      ? this.input.perception.patrolPoints
      : fallbackScoutTargets(this.currentPosition());
    for (const target of targets.slice(0, 2)) {
      const advancesGoal = SCOUT_GOAL_PATTERN.test(this.goalText)
        || BUILD_GOAL_PATTERN.test(this.goalText)
        || RESOURCE_GOAL_PATTERN.test(this.goalText);
      const params = {
        position: target,
        range: 2,
        reason: advancesGoal ? "scout for visible resources or build space" : "patrol nearby area",
      };
      this.add({
        action: "move_to",
        params,
        score: score(0.4, advancesGoal),
        reason: advancesGoal ? "scout for visible resources or build space" : "patrol nearby area",
        advancesGoal,
        targetKey: targetKeyForAction("move_to", params),
      });
    }
  }

  public result(): ActionAffordance[] {
    return [...this.affordances.values()]
      .sort((left, right) =>
        Number(left.blocked ?? false) - Number(right.blocked ?? false)
        || Number(right.advancesGoal ?? false) - Number(left.advancesGoal ?? false)
        || right.score - left.score
        || left.action.localeCompare(right.action)
        || (left.targetKey ?? "").localeCompare(right.targetKey ?? ""),
      )
      .slice(0, MAX_AFFORDANCES);
  }

  private add(affordance: ActionAffordance): void {
    const key = `${affordance.action}:${affordance.targetKey ?? JSON.stringify(affordance.params)}:${affordance.blocked === true ? "blocked" : "open"}`;
    const existing = this.affordances.get(key);
    if (!existing || affordance.score > existing.score) {
      this.affordances.set(key, {
        ...affordance,
        score: clampScore(affordance.score),
      });
    }
  }

  private addToolPrecondition(blockName: string, blockedReason: string, advancesGoal: boolean): void {
    if (!this.canConsider("craft_item")) {
      return;
    }

    const requiredTier = requiredPickaxeTier(blockName);
    const craftItem = requiredTier ? `${requiredTier}_pickaxe` : toolFromBlockedReason(blockedReason);
    if (!craftItem) {
      return;
    }

    const recipe = craftRecipeForTool(craftItem, this.inventory, this.goalText, true);
    if (!recipe) {
      return;
    }
    const blockedPrecondition = recipe.missing.length ? `need ${joinMissing(recipe.missing)}` : undefined;
    this.add({
      action: "craft_item",
      params: {
        item: recipe.item,
        count: recipe.count,
        reason: `satisfy mining precondition for ${blockName}`,
      },
      score: score(recipe.score, true),
      reason: `satisfy mining precondition for ${blockName}`,
      advancesGoal: advancesGoal || MINE_GOAL_PATTERN.test(this.goalText),
      blocked: blockedPrecondition !== undefined,
      blockedReason: blockedPrecondition,
      targetKey: targetKeyForAction("craft_item", {
        item: recipe.item,
        count: recipe.count,
        reason: `satisfy mining precondition for ${blockName}`,
      }),
    });
  }

  private missingToolForBlock(block: PerceivedBlock): string | undefined {
    const blockName = normalizeName(block.type);
    const requiredTier = requiredPickaxeTier(blockName);
    if (requiredTier && !hasPickaxeAtLeast(this.inventory, requiredTier)) {
      return `missing ${requiredTier}_pickaxe`;
    }

    const canDig = safeCanDig(this.input.bot, block);
    if (canDig === false) {
      return requiredTier ? `missing ${requiredTier}_pickaxe` : "missing valid tool";
    }
    return undefined;
  }

  private recentFailure(action: AgentDecision["action"], targetKey: string): ActionResultContext | undefined {
    return this.recentFailures
      .slice()
      .reverse()
      .find((result) => result.action === action && result.ok === false && resultTargetKey(result) === targetKey);
  }

  private canConsider(action: AgentDecision["action"]): boolean {
    return this.input.agent.allowedActions.includes(action);
  }

  private currentPosition(): Position | undefined {
    return toPosition(this.input.bot?.entity?.position);
  }
}

function inventorySummary(bot: BotHandle | undefined, perception: RoutinePerceptionSnapshot): InventorySummary {
  const rawItems = bot?.inventory?.items?.() ?? [];
  const items = rawItems.length
    ? rawItems
    : [
        ...perception.inventory.tools.map((name) => ({ name, count: 1 })),
        ...(perception.inventory.seeds > 0 ? [{ name: "wheat_seeds", count: perception.inventory.seeds }] : []),
      ];
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = normalizeName(item.name);
    counts.set(name, (counts.get(name) ?? 0) + Math.max(0, item.count));
  }
  return { counts, items };
}

function craftRecipes(
  inventory: InventorySummary,
  goalText: string,
  perception: RoutinePerceptionSnapshot,
): CraftRecipe[] {
  const recipes: CraftRecipe[] = [];
  const log = firstInventoryName(inventory, isLogName);
  const planks = firstInventoryName(inventory, isPlanksName) ?? planksFromLog(log);
  const logCount = countWhere(inventory, isLogName);
  const plankCount = countWhere(inventory, isPlanksName);
  const stickCount = count(inventory, "stick");
  const hasWoodSource = logCount > 0 || plankCount > 0;
  const toolGoal = MINE_GOAL_PATTERN.test(goalText)
    || perception.visibleBlocks.some((block) => requiredPickaxeTier(block.type));
  const buildGoal = BUILD_GOAL_PATTERN.test(goalText);
  const resourceGoal = RESOURCE_GOAL_PATTERN.test(goalText);

  if (log && planks) {
    recipes.push({
      item: planks,
      count: Math.min(16, Math.max(4, logCount * 4)),
      missing: [],
      reason: "logs in inventory; needed for tools and building",
      score: 0.95,
      advancesGoal: toolGoal || buildGoal || resourceGoal || advancesGoalForName(planks, goalText),
      usefulWhenBlocked: true,
    });
  }

  if (planks || hasWoodSource) {
    recipes.push({
      item: "stick",
      count: 4,
      missing: plankCount >= 2 ? [] : ["planks"],
      reason: plankCount >= 2
        ? "planks in inventory; sticks needed for tools and torches"
        : "sticks are needed for tools; craft planks first",
      score: 0.88,
      advancesGoal: toolGoal || resourceGoal,
      usefulWhenBlocked: hasWoodSource || toolGoal,
    });
  }

  if (planks || hasWoodSource || buildGoal || toolGoal) {
    recipes.push({
      item: "crafting_table",
      count: 1,
      missing: plankCount >= 4 ? [] : ["planks"],
      reason: plankCount >= 4
        ? "planks in inventory; crafting table unlocks tool recipes"
        : "crafting table unlocks tool recipes; craft planks first",
      score: 0.84,
      advancesGoal: buildGoal || toolGoal,
      usefulWhenBlocked: hasWoodSource || buildGoal || toolGoal,
    });
  }

  const woodenPickaxe = craftRecipeForTool("wooden_pickaxe", inventory, goalText, hasWoodSource || toolGoal);
  if (woodenPickaxe) {
    recipes.push(woodenPickaxe);
  }

  const stonePickaxe = craftRecipeForTool("stone_pickaxe", inventory, goalText, toolGoal);
  if (stonePickaxe) {
    recipes.push(stonePickaxe);
  }

  if ((count(inventory, "coal") > 0 || count(inventory, "charcoal") > 0 || resourceGoal) && (stickCount > 0 || hasWoodSource)) {
    recipes.push({
      item: "torch",
      count: 4,
      missing: [
        ...(stickCount >= 1 ? [] : ["stick"]),
        ...(count(inventory, "coal") + count(inventory, "charcoal") >= 1 ? [] : ["coal"]),
      ],
      reason: "torches improve mining and base safety",
      score: 0.72,
      advancesGoal: /\b(torch|light|safe|mine|base|cave)\b/i.test(goalText),
      usefulWhenBlocked: true,
    });
  }

  return recipes;
}

function craftRecipeForTool(
  item: string,
  inventory: InventorySummary,
  goalText: string,
  usefulWhenBlocked: boolean,
): CraftRecipe | undefined {
  const plankCount = countWhere(inventory, isPlanksName);
  const stickCount = count(inventory, "stick");
  const hasWoodSource = countWhere(inventory, isLogName) > 0 || plankCount > 0;
  if (item === "wooden_pickaxe") {
    return {
      item,
      count: 1,
      missing: [
        ...(plankCount >= 3 ? [] : ["planks"]),
        ...(stickCount >= 2 ? [] : ["sticks"]),
      ],
      reason: "wooden pickaxe enables stone and coal mining",
      score: 0.82,
      advancesGoal: MINE_GOAL_PATTERN.test(goalText) || hasWoodSource,
      usefulWhenBlocked,
    };
  }
  if (item === "stone_pickaxe") {
    return {
      item,
      count: 1,
      missing: [
        ...(count(inventory, "cobblestone") >= 3 ? [] : ["cobblestone"]),
        ...(stickCount >= 2 ? [] : ["sticks"]),
      ],
      reason: "stone pickaxe is required for iron ore",
      score: 0.9,
      advancesGoal: MINE_GOAL_PATTERN.test(goalText) || /\biron\b/i.test(goalText),
      usefulWhenBlocked,
    };
  }
  if (item === "iron_pickaxe") {
    return {
      item,
      count: 1,
      missing: [
        ...(count(inventory, "iron_ingot") >= 3 ? [] : ["iron_ingot"]),
        ...(stickCount >= 2 ? [] : ["sticks"]),
      ],
      reason: "iron pickaxe is required for diamond, gold, redstone, and emerald ore",
      score: 0.9,
      advancesGoal: MINE_GOAL_PATTERN.test(goalText),
      usefulWhenBlocked,
    };
  }
  return undefined;
}

function nearbyPlaceTargets(bot: BotHandle, current: Position): Position[] {
  const origin = {
    x: Math.floor(current.x),
    y: Math.floor(current.y),
    z: Math.floor(current.z),
    world: current.world,
  };
  const offsets = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 1, z: 0 },
    { x: -1, y: 1, z: 0 },
  ];
  return offsets
    .map((offset) => ({
      x: origin.x + offset.x,
      y: origin.y + offset.y,
      z: origin.z + offset.z,
      world: origin.world,
    }))
    .filter((target) =>
      withinRange(current, target, MAX_PLACE_DISTANCE)
      && isAirAt(bot, target)
      && hasAdjacentReference(bot, target),
    );
}

function isAirAt(bot: BotHandle, position: Position): boolean {
  const block = safeBlockAt(bot, position);
  return !block || block.name === "air";
}

function hasAdjacentReference(bot: BotHandle, target: Position): boolean {
  const offsets = [
    { x: 0, y: -1, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  return offsets.some((offset) => {
    const block = safeBlockAt(bot, {
      x: target.x + offset.x,
      y: target.y + offset.y,
      z: target.z + offset.z,
      world: target.world,
    });
    return Boolean(block && block.name !== "air");
  });
}

function isMineableBlock(block: PerceivedBlock): boolean {
  const name = normalizeName(block.type);
  return block.safe !== false
    && block.belowAgent !== true
    && !UNSAFE_MINE_BLOCKS.has(name)
    && MINEABLE_BLOCK_PATTERN.test(name);
}

function isUsefulDrop(entity: PerceivedEntity): boolean {
  return entity.hostile !== true
    && entity.protected !== true
    && USEFUL_DROP_PATTERN.test(normalizeName(entity.type));
}

function isSafeFollowTarget(agent: AgentConfig, player: PerceivedPlayer): boolean {
  return player.name.length > 0
    && player.protected !== true
    && player.name.toLowerCase() !== agent.account.username.toLowerCase();
}

function isSafeAttackEntity(entity: PerceivedEntity): boolean {
  return entity.hostile === true && entity.protected !== true;
}

function isSafeAttackPlayer(agent: AgentConfig, player: PerceivedPlayer, goalText: string): boolean {
  return player.threatening === true
    && player.protected !== true
    && player.name.toLowerCase() !== agent.account.username.toLowerCase()
    && ATTACK_GOAL_PATTERN.test(goalText);
}

function safeCanDig(bot: BotHandle | undefined, block: PerceivedBlock): boolean | undefined {
  if (!bot?.canDigBlock) {
    return undefined;
  }
  const botBlock = safeBlockAt(bot, block.position) ?? {
    name: block.type,
    position: block.position,
  };
  try {
    return bot.canDigBlock(botBlock);
  } catch {
    return undefined;
  }
}

function safeBlockAt(bot: BotHandle, position: Position): BotBlock | null {
  try {
    return bot.blockAt?.(position) ?? null;
  } catch {
    return null;
  }
}

function requiredPickaxeTier(blockName: string): PickaxeTier | undefined {
  const normalized = normalizeName(blockName);
  if (ORE_TOOL_REQUIREMENTS[normalized]) {
    return ORE_TOOL_REQUIREMENTS[normalized];
  }
  if (/coal_ore|copper_ore/.test(normalized)) {
    return "wooden";
  }
  return undefined;
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

function missingToolFromFailure(result: ActionResultContext | undefined): string | undefined {
  const error = result?.error?.toLowerCase();
  if (!error) {
    return undefined;
  }
  if (/missing .*stone_pickaxe|stone pickaxe/.test(error)) return "missing stone_pickaxe";
  if (/missing .*iron_pickaxe|iron pickaxe/.test(error)) return "missing iron_pickaxe";
  if (/missing .*diamond_pickaxe|diamond pickaxe/.test(error)) return "missing diamond_pickaxe";
  if (/missing .*pickaxe|valid tool|tool/.test(error)) return "missing valid tool";
  return undefined;
}

function toolFromBlockedReason(reason: string): string | undefined {
  const normalized = normalizeName(reason);
  for (const tier of PICKAXE_TIER_ORDER) {
    if (normalized.includes(`${tier}_pickaxe`)) {
      return `${tier}_pickaxe`;
    }
  }
  if (normalized.includes("valid_tool")) {
    return "wooden_pickaxe";
  }
  return undefined;
}

function resultTargetKey(result: ActionResultContext): string | undefined {
  const params = result.params ?? {};
  const block = stringParam(params.block);
  if (block) return `block:${normalizeName(block)}`;
  const item = stringParam(params.item) ?? stringParam(params.name);
  if (item) return `item:${normalizeName(item)}`;
  const username = stringParam(params.username) ?? stringParam(params.player) ?? stringParam(params.target);
  if (username) return `username:${username}`;
  const entityId = stringParam(params.entityId);
  if (entityId) return `entityId:${entityId}`;
  const position = positionValue(params.position);
  if (position) return `position:${formatPosition(position)}`;
  return result.targetKey;
}

function fallbackScoutTargets(current: Position | undefined): Position[] {
  if (!current) {
    return [];
  }
  return [
    { x: Math.floor(current.x + 8), y: Math.floor(current.y), z: Math.floor(current.z), world: current.world },
    { x: Math.floor(current.x), y: Math.floor(current.y), z: Math.floor(current.z + 8), world: current.world },
  ];
}

function mineReason(blockName: string, goalText: string): string {
  if (/log|wood|stem|hyphae/.test(blockName)) return "wood needed for crafting and building";
  if (/ore|coal/.test(blockName)) return "ore or coal supports mining and tools";
  if (/stone|deepslate|cobble/.test(blockName)) return "stone needed for tools and building";
  if (BUILD_GOAL_PATTERN.test(goalText)) return "material can support the build goal";
  return "visible safe resource block";
}

function collectReason(itemName: string, goalText: string): string {
  if (/log|planks|stick|cobblestone|ore|ingot|coal|torch|pickaxe/.test(itemName)) {
    return "useful dropped resource for tools or building";
  }
  if (/seed|wheat|carrot|potato|apple|bread|beef|pork|chicken|mutton/.test(itemName)) {
    return "useful dropped food or farming item";
  }
  if (RESOURCE_GOAL_PATTERN.test(goalText)) return "useful dropped item for the active resource goal";
  return "useful dropped item";
}

function advancesGoalForName(name: string, goalText: string): boolean {
  if (!goalText) {
    return false;
  }
  const normalized = normalizeName(name);
  return goalText.includes(normalized)
    || goalText.includes(normalized.replace(/_/g, " "))
    || (BUILD_GOAL_PATTERN.test(goalText) && /(log|wood|planks|stone|cobblestone|dirt|sand|glass|fence|torch)/.test(normalized))
    || (MINE_GOAL_PATTERN.test(goalText) && /(pickaxe|stone|cobblestone|ore|coal|iron|copper|diamond|stick|planks|log)/.test(normalized))
    || (RESOURCE_GOAL_PATTERN.test(goalText) && /(log|wood|planks|stick|seed|food|wheat|coal|torch|cobblestone)/.test(normalized));
}

function withinRange(current: Position | undefined, target: Position | undefined, maxDistance: number): boolean {
  if (!current || !target) {
    return true;
  }
  return distance(current, target) <= maxDistance;
}

function distance(left: Position, right: Position): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function score(base: number, advancesGoal: boolean): number {
  return advancesGoal ? base + 0.08 : base;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function count(inventory: InventorySummary, item: string): number {
  return inventory.counts.get(normalizeName(item)) ?? 0;
}

function countWhere(inventory: InventorySummary, predicate: (name: string) => boolean): number {
  let total = 0;
  for (const [name, itemCount] of inventory.counts) {
    if (predicate(name)) {
      total += itemCount;
    }
  }
  return total;
}

function firstInventoryName(inventory: InventorySummary, predicate: (name: string) => boolean): string | undefined {
  for (const name of inventory.counts.keys()) {
    if (predicate(name)) {
      return name;
    }
  }
  return undefined;
}

function isLogName(name: string): boolean {
  return /_log$|_wood$|_stem$|_hyphae$/.test(name) || name === "log" || name === "wood";
}

function isPlanksName(name: string): boolean {
  return name.endsWith("_planks") || name === "planks";
}

function planksFromLog(logName: string | undefined): string | undefined {
  if (!logName) {
    return undefined;
  }
  if (logName === "log" || logName === "wood") {
    return "oak_planks";
  }
  return logName
    .replace(/_log$/, "_planks")
    .replace(/_wood$/, "_planks")
    .replace(/_stem$/, "_planks")
    .replace(/_hyphae$/, "_planks");
}

function joinMissing(values: string[]): string {
  return [...new Set(values)].join("/");
}

function stringParam(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function positionValue(value: JsonValue | undefined): Position | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Partial<Position>;
  return typeof source.x === "number" && typeof source.y === "number" && typeof source.z === "number"
    ? compactPosition({
        x: source.x,
        y: source.y,
        z: source.z,
        world: source.world,
      })
    : undefined;
}

function toPosition(value: Position | undefined): Position | undefined {
  if (!value) {
    return undefined;
  }
  return compactPosition(value);
}

function compactPosition(value: Pick<Position, "x" | "y" | "z"> & { world?: string }): Position {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
    ...(typeof value.world === "string" ? { world: value.world } : {}),
  };
}

function formatPosition(position: Position): string {
  const base = `${round(position.x)},${round(position.y)},${round(position.z)}`;
  return position.world ? `${base}@${position.world}` : base;
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
