import { randomUUID } from "node:crypto";

import type { ActionResult, JsonValue, Position } from "@mc-ai-video/contracts";

import {
  canUseAction,
  type PerceptionSnapshot,
  type RoutineActionIntent,
  type RoutineAgent,
} from "../routines";
import type {
  RegisteredSkill,
  SkillExecutionContext,
  SkillRequest,
  SkillStepResult,
} from "./types";

export interface SkillPlannerInput {
  agent: RoutineAgent;
  perception: PerceptionSnapshot;
  request?: SkillRequest;
  currentPosition?: Position;
  inventoryItemNames?: string[];
  leaderUsername?: string;
  attackTargetUsername?: string;
}

export interface SkillPlanResult extends SkillStepResult {
  request: SkillRequest;
  skill: string;
}

interface ActiveSkillExecution {
  request: SkillRequest;
  state: Record<string, JsonValue>;
  lastActionResult?: ActionResult;
}

interface SkillRegistryOptions {
  idFactory?: () => string;
}

const WOOD_PATTERN = /log|wood|planks/i;
const STONE_PATTERN = /stone|deepslate|cobblestone/i;
const TOOL_PATTERNS: Record<string, RegExp> = {
  wooden_pickaxe: /pickaxe/i,
  wooden_axe: /axe/i,
  wooden_shovel: /shovel/i,
  wooden_hoe: /hoe/i,
  stone_pickaxe: /stone_pickaxe|pickaxe/i,
};

export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();
  private readonly active = new Map<string, ActiveSkillExecution>();
  private readonly idFactory: () => string;

  public constructor(options: SkillRegistryOptions = {}) {
    this.idFactory = options.idFactory ?? randomUUID;
  }

  public register(skill: RegisteredSkill): void {
    this.skills.set(skill.name, skill);
  }

  public names(): string[] {
    return [...this.skills.keys()].sort();
  }

  public promptDescriptions(): string[] {
    return this.names().map((name) => `${name}: ${skillDescription(name)}`);
  }

  public hasActive(agentId: string): boolean {
    return this.active.has(agentId);
  }

  public activeRequest(agentId: string): SkillRequest | undefined {
    return this.active.get(agentId)?.request;
  }

  public clearAgent(agentId: string): void {
    this.active.delete(agentId);
  }

  public planActive(input: SkillPlannerInput): SkillPlanResult | undefined {
    const execution = this.active.get(input.agent.id);
    if (!execution) {
      return undefined;
    }
    return this.planExecution(input, execution);
  }

  public planNext(input: SkillPlannerInput & { request: SkillRequest }): SkillPlanResult {
    const existing = this.active.get(input.agent.id);
    const execution = existing?.request.id === input.request.id
      ? existing
      : {
          request: input.request,
          state: {},
          lastActionResult: undefined,
        };
    this.active.set(input.agent.id, execution);
    return this.planExecution(input, execution);
  }

  public request(input: {
    agentId: string;
    skill: string;
    params?: Record<string, JsonValue>;
    goal?: string;
  }): SkillRequest {
    return {
      id: this.idFactory(),
      agentId: input.agentId,
      skill: input.skill,
      params: input.params ?? {},
      goal: input.goal,
    };
  }

  public recordActionResult(result: ActionResult): void {
    const execution = this.active.get(result.agentId);
    if (!execution || !resultBelongsToSkill(result, execution.request.skill)) {
      return;
    }

    execution.lastActionResult = result;
    execution.state.lastActionOk = result.ok;
    execution.state.lastAction = result.action;
    execution.state.lastCompletedAt = result.completedAt;
    if (result.error) {
      execution.state.lastError = result.error;
    }

    if (result.ok) {
      updateSkillProgress(execution, result);
    }
  }

  private planExecution(input: SkillPlannerInput, execution: ActiveSkillExecution): SkillPlanResult {
    const skill = this.skills.get(execution.request.skill);
    if (!skill) {
      this.active.delete(input.agent.id);
      return {
        request: execution.request,
        skill: execution.request.skill,
        failed: true,
        reason: `unknown skill: ${execution.request.skill}`,
      };
    }

    const result = skill.planNext({
      request: execution.request,
      agent: input.agent,
      perception: input.perception,
      state: execution.state,
      lastActionResult: execution.lastActionResult,
      currentPosition: input.currentPosition,
      inventoryItemNames: input.inventoryItemNames,
      leaderUsername: input.leaderUsername,
      attackTargetUsername: input.attackTargetUsername,
    });

    if (result.action) {
      result.action = markSkillIntent(skill.name, result.action);
    }

    if (result.done || result.failed) {
      this.active.delete(input.agent.id);
    } else {
      this.active.set(input.agent.id, execution);
    }

    return {
      ...result,
      request: execution.request,
      skill: skill.name,
    };
  }
}

export function createDefaultSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  for (const skill of [
    gatherWoodSkill(),
    craftBasicToolsSkill(),
    gatherStoneSkill(),
    buildSimpleShelterSkill(),
    followLeaderSkill(),
    farmCycleSkill(),
    huntTargetSkill(),
  ]) {
    registry.register(skill);
  }
  return registry;
}

function gatherWoodSkill(): RegisteredSkill {
  return {
    name: "gather_wood",
    planNext(input) {
      const targetCount = numericParam(input.request.params.count) ?? 4;
      if (stateNumber(input.state, "woodUnits") >= targetCount) {
        return { done: true, reason: `gathered ${targetCount} wood actions` };
      }

      const drop = input.perception.nearbyEntities.find((entity) =>
        isResourceDrop(entity, WOOD_PATTERN),
      );
      if (drop && canUseAction(input.agent, "collect_item")) {
        return skillAction("collect_item", {
          entityId: drop.id,
          item: drop.type,
          reason: "gather_wood collecting visible wood drop",
        }, 10_000);
      }

      const block = firstSafeBlock(input.perception, WOOD_PATTERN);
      if (block && canUseAction(input.agent, "mine_block")) {
        return skillAction("mine_block", {
          blockId: block.id,
          position: block.position,
          block: block.type,
          reason: "gather_wood mining visible log or wood",
        }, 12_000);
      }

      return searchOrFail(input, "searching for trees", "no visible wood source");
    },
  };
}

function craftBasicToolsSkill(): RegisteredSkill {
  return {
    name: "craft_basic_tools",
    planNext(input) {
      rememberCraftedItem(input);
      const requested = stringArrayParam(input.request.params.tools)
        ?? ["wooden_pickaxe", "wooden_axe"];
      const crafted = stateStringArray(input.state, "craftedItems");
      const inventory = inventoryNames(input);

      for (const tool of requested) {
        const normalized = normalizeName(tool);
        const pattern = TOOL_PATTERNS[normalized] ?? new RegExp(escapeRegExp(normalized), "i");
        if (crafted.includes(normalized) || inventory.some((name) => pattern.test(name))) {
          continue;
        }
        if (!canUseAction(input.agent, "craft_item")) {
          return { failed: true, reason: `craft_item unavailable for ${normalized}` };
        }
        return skillAction("craft_item", {
          item: normalized,
          count: 1,
          reason: "craft_basic_tools preparing required tool",
        }, 8_000);
      }

      return { done: true, reason: "basic tools ready" };
    },
  };
}

function gatherStoneSkill(): RegisteredSkill {
  return {
    name: "gather_stone",
    planNext(input) {
      const targetCount = numericParam(input.request.params.count) ?? 8;
      if (stateNumber(input.state, "stoneUnits") >= targetCount) {
        return { done: true, reason: `gathered ${targetCount} stone actions` };
      }

      if (!hasInventory(input, /pickaxe/i) && canUseAction(input.agent, "craft_item")) {
        return skillAction("craft_item", {
          item: "wooden_pickaxe",
          count: 1,
          reason: "gather_stone needs a pickaxe before mining",
        }, 8_000);
      }

      const block = firstSafeBlock(input.perception, STONE_PATTERN);
      if (block && canUseAction(input.agent, "mine_block")) {
        return skillAction("mine_block", {
          blockId: block.id,
          position: block.position,
          block: block.type,
          reason: "gather_stone mining visible stone",
        }, 12_000);
      }

      return searchOrFail(input, "searching for exposed stone", "no visible stone source");
    },
  };
}

function buildSimpleShelterSkill(): RegisteredSkill {
  return {
    name: "build_simple_shelter",
    planNext(input) {
      const targetPlacements = numericParam(input.request.params.blocks) ?? 8;
      if (stateNumber(input.state, "placements") >= targetPlacements) {
        return { done: true, reason: "simple shelter placement budget reached" };
      }

      if (!canUseAction(input.agent, "place_block")) {
        return { failed: true, reason: "place_block unavailable for shelter building" };
      }

      const previousFailedForMaterials = input.lastActionResult?.ok === false
        && input.lastActionResult.action === "place_block"
        && /missing|block item|required/i.test(input.lastActionResult.error ?? "");
      if (previousFailedForMaterials) {
        const material = firstSafeBlock(input.perception, /dirt|stone|deepslate|log|wood/i);
        if (material && canUseAction(input.agent, "mine_block")) {
          return skillAction("mine_block", {
            blockId: material.id,
            position: material.position,
            block: material.type,
            reason: "build_simple_shelter gathering missing placeable material",
          }, 12_000);
        }
      }

      const base = positionParam(input.request.params.position) ?? input.currentPosition;
      if (!base) {
        return searchOrFail(input, "finding shelter build position", "no current position for shelter");
      }

      const offset = shelterOffset(stateNumber(input.state, "placements"));
      const target = {
        x: Math.floor(base.x + offset.x),
        y: Math.floor(base.y + offset.y),
        z: Math.floor(base.z + offset.z),
        world: base.world,
      };
      const block = stringParam(input.request.params.block);
      return skillAction("place_block", {
        position: target,
        ...(block ? { block } : {}),
        reason: "build_simple_shelter placing nearby shelter block",
      }, 10_000);
    },
  };
}

function followLeaderSkill(): RegisteredSkill {
  return {
    name: "follow_leader",
    planNext(input) {
      const maxSteps = numericParam(input.request.params.steps) ?? 3;
      if (stateNumber(input.state, "followSteps") >= maxSteps) {
        return { done: true, reason: "leader follow steps complete" };
      }

      const username = stringParam(input.request.params.username)
        ?? stringParam(input.request.params.player)
        ?? stringParam(input.request.params.target)
        ?? input.leaderUsername;
      if (!username) {
        return { failed: true, reason: "follow_leader has no leader username" };
      }
      if (!canUseAction(input.agent, "follow_player")) {
        return { failed: true, reason: "follow_player unavailable for follow_leader" };
      }

      return skillAction("follow_player", {
        username,
        range: numericParam(input.request.params.range) ?? 4,
        reason: "follow_leader staying with assigned leader",
      }, 15_000);
    },
  };
}

function farmCycleSkill(): RegisteredSkill {
  return {
    name: "farm_cycle",
    planNext(input) {
      const targetCycles = numericParam(input.request.params.cycles);
      if (targetCycles !== undefined && stateNumber(input.state, "farmActions") >= targetCycles) {
        return { done: true, reason: "farm cycle target reached" };
      }

      const matureCrop = input.perception.visibleBlocks.find((block) =>
        /crop|wheat|carrot|potato|beetroot/i.test(block.type)
        && block.mature === true
        && block.safe !== false,
      );
      if (matureCrop && canUseAction(input.agent, "harvest_crop")) {
        return skillAction("harvest_crop", {
          blockId: matureCrop.id,
          position: matureCrop.position,
          block: matureCrop.type,
          replant: input.perception.inventory.seeds > 0,
          reason: "farm_cycle harvesting mature crop",
        }, 8_000);
      }

      if (!input.perception.inventory.tools.some((tool) => /hoe/i.test(tool))) {
        if (canUseAction(input.agent, "craft_item")) {
          return skillAction("craft_item", {
            item: "wooden_hoe",
            count: 1,
            reason: "farm_cycle crafting hoe before planting",
          }, 8_000);
        }
        return { failed: true, reason: "farm_cycle needs a hoe and cannot craft one" };
      }

      const emptyFarmland = input.perception.visibleBlocks.find((block) =>
        block.type === "farmland"
        && block.needsPlanting === true
        && block.safe !== false,
      );
      if (emptyFarmland && input.perception.inventory.seeds > 0 && canUseAction(input.agent, "plant_crop")) {
        return skillAction("plant_crop", {
          blockId: emptyFarmland.id,
          position: emptyFarmland.position,
          reason: "farm_cycle planting empty farmland",
        }, 5_000);
      }

      if (input.perception.inventory.seeds <= 0) {
        const seedDrop = input.perception.nearbyEntities.find((entity) =>
          isResourceDrop(entity, /seed|wheat|carrot|potato|beetroot/i),
        );
        if (seedDrop && canUseAction(input.agent, "collect_item")) {
          return skillAction("collect_item", {
            entityId: seedDrop.id,
            item: seedDrop.type,
            reason: "farm_cycle collecting seed or crop drop",
          }, 10_000);
        }

        const seedSource = input.perception.visibleBlocks.find((block) =>
          /grass|fern|wheat|carrot|potato|beetroot/i.test(block.type)
          && block.safe !== false
          && block.belowAgent !== true,
        );
        if (seedSource && canUseAction(input.agent, "mine_block")) {
          return skillAction("mine_block", {
            blockId: seedSource.id,
            position: seedSource.position,
            block: seedSource.type,
            reason: "farm_cycle gathering seed source",
          }, 10_000);
        }
      }

      return { done: true, reason: "farm cycle has no immediate visible work" };
    },
  };
}

function huntTargetSkill(): RegisteredSkill {
  return {
    name: "hunt_target",
    planNext(input) {
      if (stateNumber(input.state, "attacks") > 0) {
        return { done: true, reason: "hunt target engaged" };
      }

      const target = stringParam(input.request.params.username)
        ?? stringParam(input.request.params.player)
        ?? stringParam(input.request.params.target)
        ?? input.attackTargetUsername;
      const entityId = stringParam(input.request.params.entityId);
      const visiblePlayer = target
        ? input.perception.nearbyPlayers.find((player) =>
            player.name.toLowerCase() === target.toLowerCase()
            || player.id.toLowerCase() === target.toLowerCase(),
          )
        : undefined;
      const visibleEntity = entityId
        ? input.perception.nearbyEntities.find((entity) => entity.id === entityId)
        : input.perception.nearbyEntities.find((entity) =>
            entity.hostile === true && entity.protected !== true,
          );

      if ((visiblePlayer || visibleEntity) && canUseAction(input.agent, "attack_entity")) {
        return skillAction("attack_entity", {
          ...(visiblePlayer ? { username: visiblePlayer.name } : {}),
          ...(visibleEntity ? { entityId: visibleEntity.id, entityType: visibleEntity.type } : {}),
          reason: "hunt_target engaging visible target",
        }, 8_000);
      }

      if (target && canUseAction(input.agent, "follow_player")) {
        return skillAction("follow_player", {
          username: target,
          range: 3,
          reason: "hunt_target closing distance to target",
        }, 15_000);
      }

      return searchOrFail(input, "searching for hunt target", "no visible hunt target");
    },
  };
}

function skillAction(
  action: string,
  params: Record<string, JsonValue>,
  timeoutMs: number,
): SkillStepResult {
  return {
    action: {
      action,
      params,
      timeoutMs,
    },
  };
}

function markSkillIntent(skill: string, action: RoutineActionIntent): RoutineActionIntent {
  return {
    ...action,
    params: {
      ...action.params,
      skill,
    },
    requestedBy: `skill:${skill}`,
    source: "skill",
  };
}

function searchOrFail(
  input: SkillExecutionContext,
  reason: string,
  failReason: string,
): SkillStepResult {
  const searches = stateNumber(input.state, "searches");
  if (!canUseAction(input.agent, "move_to")) {
    return { failed: true, reason: failReason };
  }
  const current = input.currentPosition ?? input.perception.patrolPoints?.[0];
  if (!current) {
    return { failed: true, reason: `${failReason}; no search position available` };
  }
  if (searches >= 4) {
    return { failed: true, reason: `${failReason} after ${searches} searches` };
  }
  input.state.searches = searches + 1;
  const offset = scoutOffset(searches);
  return skillAction("move_to", {
    position: {
      x: Math.floor(current.x + offset.x),
      y: Math.floor(current.y),
      z: Math.floor(current.z + offset.z),
      world: current.world,
    },
    range: 4,
    reason,
  }, 12_000);
}

function updateSkillProgress(execution: ActiveSkillExecution, result: ActionResult): void {
  switch (execution.request.skill) {
    case "gather_wood":
      if (result.action === "mine_block" || result.action === "collect_item") {
        const label = resultLabel(result);
        if (!label || WOOD_PATTERN.test(label)) {
          incrementState(execution.state, "woodUnits");
        }
      }
      break;
    case "gather_stone":
      if (result.action === "mine_block") {
        const label = resultLabel(result);
        if (!label || STONE_PATTERN.test(label)) {
          incrementState(execution.state, "stoneUnits");
        }
      }
      break;
    case "craft_basic_tools":
      if (result.action === "craft_item") {
        appendStateString(execution.state, "craftedItems", normalizeName(resultLabel(result) ?? "tool"));
      }
      break;
    case "build_simple_shelter":
      if (result.action === "place_block") {
        incrementState(execution.state, "placements");
      } else if (result.action === "mine_block") {
        incrementState(execution.state, "materials");
      }
      break;
    case "follow_leader":
      if (result.action === "follow_player") {
        incrementState(execution.state, "followSteps");
      }
      break;
    case "farm_cycle":
      if (["harvest_crop", "plant_crop"].includes(result.action)) {
        incrementState(execution.state, "farmActions");
      }
      break;
    case "hunt_target":
      if (result.action === "attack_entity") {
        incrementState(execution.state, "attacks");
      } else if (result.action === "follow_player" || result.action === "move_to") {
        incrementState(execution.state, "pursuitSteps");
      }
      break;
  }
}

function resultBelongsToSkill(result: ActionResult, skill: string): boolean {
  return result.requestedBy === `skill:${skill}`
    || result.source === "skill"
    || result.source === `skill:${skill}`;
}

function firstSafeBlock(
  perception: PerceptionSnapshot,
  pattern: RegExp,
): PerceptionSnapshot["visibleBlocks"][number] | undefined {
  return perception.visibleBlocks.find((block) =>
    pattern.test(block.type)
    && block.safe !== false
    && block.belowAgent !== true,
  );
}

function isResourceDrop(
  entity: PerceptionSnapshot["nearbyEntities"][number],
  pattern: RegExp,
): boolean {
  return Boolean(
    entity.id
    && entity.hostile !== true
    && entity.position
    && pattern.test(entity.type),
  );
}

function rememberCraftedItem(input: SkillExecutionContext): void {
  if (input.lastActionResult?.ok !== true || input.lastActionResult.action !== "craft_item") {
    return;
  }
  const item = resultLabel(input.lastActionResult);
  if (item) {
    appendStateString(input.state, "craftedItems", normalizeName(item));
  }
}

function inventoryNames(input: SkillExecutionContext): string[] {
  return [
    ...(input.inventoryItemNames ?? []),
    ...input.perception.inventory.tools,
    input.perception.inventory.seeds > 0 ? "seeds" : undefined,
    input.perception.inventory.food && input.perception.inventory.food > 0 ? "food" : undefined,
  ].filter((value): value is string => Boolean(value));
}

function hasInventory(input: SkillExecutionContext, pattern: RegExp): boolean {
  return inventoryNames(input).some((name) => pattern.test(name));
}

function resultLabel(result: ActionResult): string | undefined {
  return stringParam(result.data?.item)
    ?? stringParam(result.data?.block)
    ?? stringParam(result.data?.seed)
    ?? stringParam(result.params?.item)
    ?? stringParam(result.params?.block)
    ?? stringParam(result.params?.name);
}

function shelterOffset(index: number): { x: number; y: number; z: number } {
  const offsets = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 1, z: 0 },
    { x: -1, y: 1, z: 0 },
    { x: 0, y: 1, z: 1 },
    { x: 0, y: 1, z: -1 },
    { x: 0, y: 2, z: 0 },
  ];
  return offsets[index % offsets.length] ?? offsets[0];
}

function scoutOffset(index: number): { x: number; z: number } {
  const offsets = [
    { x: 12, z: 0 },
    { x: 0, z: 12 },
    { x: -12, z: 0 },
    { x: 0, z: -12 },
  ];
  return offsets[index % offsets.length] ?? offsets[0];
}

function numericParam(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringParam(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArrayParam(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings.map(normalizeName) : undefined;
}

function positionParam(value: JsonValue | undefined): Position | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, JsonValue>;
  return typeof record.x === "number" && typeof record.y === "number" && typeof record.z === "number"
    ? {
        x: record.x,
        y: record.y,
        z: record.z,
        ...(typeof record.world === "string" ? { world: record.world } : {}),
      }
    : undefined;
}

function stateNumber(state: Record<string, JsonValue>, key: string): number {
  const value = state[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function incrementState(state: Record<string, JsonValue>, key: string): void {
  state[key] = stateNumber(state, key) + 1;
}

function stateStringArray(state: Record<string, JsonValue>, key: string): string[] {
  const value = state[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function appendStateString(state: Record<string, JsonValue>, key: string, value: string): void {
  const values = new Set(stateStringArray(state, key));
  values.add(value);
  state[key] = [...values];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skillDescription(name: string): string {
  switch (name) {
    case "gather_wood":
      return "mine or collect visible wood/log resources, searching nearby if none are visible";
    case "craft_basic_tools":
      return "craft basic wooden tools such as pickaxe, axe, shovel, or hoe";
    case "gather_stone":
      return "ensure a pickaxe exists, then mine visible stone/deepslate/cobblestone";
    case "build_simple_shelter":
      return "place nearby shelter blocks and gather material if placement is blocked";
    case "follow_leader":
      return "follow the subteam leader for several planning ticks";
    case "farm_cycle":
      return "harvest mature crops, craft a hoe, collect seeds, and plant empty farmland";
    case "hunt_target":
      return "pursue and attack an explicitly allowed target";
    default:
      return "multi-step skill";
  }
}
