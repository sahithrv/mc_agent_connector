import type { AgentConfig, AiChatMessage, GameEvent, JsonValue, Position } from "@mc-ai-video/contracts";

import type { ActionResultContext, DynamicAgentState, PromptPerceptionSnapshot } from "../prompts";
import { AgentDecisionSchema, type AgentDecision } from "../schemas/agent-decision";
import { allowedDecisionActionsForAgent } from "./intent-map";

export interface FallbackDecisionInput {
  agent: Pick<AgentConfig, "id" | "name" | "role" | "team" | "routine" | "allowedActions">;
  reason: string;
  perception?: PromptPerceptionSnapshot;
  dynamicState?: DynamicAgentState;
  recentActionResults?: ActionResultContext[];
  recentChat?: AiChatMessage[];
  recentEvents?: GameEvent[];
  availableActions?: AgentDecision["action"][];
}

const RESOURCE_ITEM_PATTERN = /cobblestone|dirt|seed|log|planks|stone|ore|ingot|coal|wheat|carrot|potato|wood|stick|torch|diamond|iron|copper|gold|emerald|redstone|lapis|flint|gravel|sapling|bread|apple/i;
const MINEABLE_BLOCK_PATTERN = /stone|deepslate|dirt|gravel|coal_ore|iron_ore|copper_ore|log|wood/i;
const FARM_GOAL_PATTERN = /\b(farm|farmer|food|crop|seed|wheat|carrot|potato|hoe)\b/;
const MINE_GOAL_PATTERN = /\b(mine|miner|gather|stone|ore|coal|iron|build|base|village|pickaxe|tool)\b/;
const LIGHT_GOAL_PATTERN = /\b(mine|cave|night|torch|safe|base|village|light)\b/;
const CRAFTING_TABLE_GOAL_PATTERN = /\b(build|base|village|craft|tool)\b/;
const UNSAFE_BLOCKS = new Set([
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
const SCOUT_OFFSETS: Array<Pick<Position, "x" | "z">> = [
  { x: 12, z: 0 },
  { x: -12, z: 0 },
  { x: 0, z: 12 },
  { x: 0, z: -12 },
];

export function fallbackDecision(input: FallbackDecisionInput): AgentDecision {
  const availableActions = input.availableActions ?? allowedDecisionActionsForAgent(input.agent);
  const reason = compactReason(input.reason);

  if (isThreatened(input) && availableActions.includes("flee")) {
    const fleeParams = fleeParameters(input, reason);
    if (!fleeParams) {
      return helpOrContinueFallback(input, availableActions, reason);
    }
    return parseFallback({
      intent: "retreat",
      action: "flee",
      parameters: fleeParams,
      confidence: 0.4,
      reasoningSummary: `Fallback flee: ${reason}`,
    });
  }

  if (isThreatened(input)) {
    const help = helpFallback(input, availableActions, reason);
    if (help) {
      return help;
    }
  }

  const productive = productiveFallback(input, availableActions, reason);
  if (productive) {
    return productive;
  }

  return helpOrContinueFallback(input, availableActions, reason);
}

function productiveFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision | undefined {
  return collectVisibleItemFallback(input, availableActions, reason)
    ?? mineVisibleBlockFallback(input, availableActions, reason)
    ?? craftObviousItemFallback(input, availableActions, reason)
    ?? moveToScoutFallback(input, availableActions, reason);
}

function helpOrContinueFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision {
  const help = helpFallback(input, availableActions, reason);
  if (help) {
    return help;
  }

  if ((input.dynamicState?.currentRoutine || input.agent.routine) && availableActions.includes("continue_routine")) {
    const routineId = input.dynamicState?.currentRoutine ?? input.agent.routine ?? "routine";
    return parseFallback({
      intent: "continue_work",
      action: "continue_routine",
      parameters: { routineId, fallback: true, reason },
      confidence: 0.45,
      reasoningSummary: `Fallback continue routine: ${reason}`,
    });
  }

  return parseFallback({
    intent: "wait",
    action: "idle",
    parameters: { durationMs: 1_000, fallback: true, reason },
    confidence: 0.5,
    reasoningSummary: `Fallback idle: ${reason}`,
  });
}

function collectVisibleItemFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision | undefined {
  if (!availableActions.includes("collect_item")) {
    return undefined;
  }
  const item = visibleUsefulItem(input.perception);
  if (!item) {
    return undefined;
  }

  const params: Record<string, JsonValue> = {
    fallback: true,
    reason,
  };
  const entityId = stringValue(item.id);
  const itemName = itemLabel(item);
  if (entityId) params.entityId = entityId;
  if (itemName) params.item = itemName;
  if (!entityId && !itemName) {
    return undefined;
  }

  return parseFallback({
    intent: "gather_item",
    action: "collect_item",
    parameters: params,
    confidence: 0.42,
    reasoningSummary: `Fallback collect visible item: ${reason}`,
  });
}

function mineVisibleBlockFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision | undefined {
  if (!availableActions.includes("mine_block")) {
    return undefined;
  }
  const block = visibleSafeMineBlock(input.perception);
  if (!block) {
    return undefined;
  }
  const position = positionValue(block.position);
  if (!position) {
    return undefined;
  }

  const params: Record<string, JsonValue> = {
    position,
    fallback: true,
    reason,
  };
  const blockName = blockLabel(block);
  if (blockName) params.block = blockName;

  return parseFallback({
    intent: "mine_resource",
    action: "mine_block",
    parameters: params,
    confidence: 0.4,
    reasoningSummary: `Fallback mine visible block: ${reason}`,
  });
}

function craftObviousItemFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision | undefined {
  if (!availableActions.includes("craft_item")) {
    return undefined;
  }
  const craft = obviousCraftItem(input);
  if (!craft) {
    return undefined;
  }

  return parseFallback({
    intent: "craft_needed_item",
    action: "craft_item",
    parameters: {
      item: craft.item,
      count: craft.count,
      fallback: true,
      reason,
    },
    confidence: 0.38,
    reasoningSummary: `Fallback craft ${craft.item}: ${reason}`,
  });
}

function moveToScoutFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision | undefined {
  if (!availableActions.includes("move_to")) {
    return undefined;
  }
  const target = patrolOrScoutPoint(input);
  if (!target) {
    return undefined;
  }

  return parseFallback({
    intent: "continue_work",
    action: "move_to",
    parameters: {
      position: target,
      range: 3,
      fallback: true,
      reason,
    },
    confidence: 0.36,
    reasoningSummary: `Fallback scout movement: ${reason}`,
  });
}

function helpFallback(
  input: FallbackDecisionInput,
  availableActions: AgentDecision["action"][],
  reason: string,
): AgentDecision | undefined {
  if (!shouldAskForHelp(input)) {
    return undefined;
  }

  if (availableActions.includes("chat_ai_private")) {
    const recipientIds = helpRecipients(input);
    if (recipientIds.length > 0) {
      return parseFallback({
        intent: "ask_for_help",
        action: "chat_ai_private",
        parameters: {
          recipientIds,
          message: `I need help: ${reason}`,
          topic: "fallback_help",
        },
        speech: {
          visibility: "ai",
          recipientIds,
          topic: "fallback_help",
          content: `I need help: ${reason}`,
        },
        confidence: 0.35,
        reasoningSummary: `Fallback ask for help: ${reason}`,
      });
    }
  }

  if (availableActions.includes("chat_public")) {
    return parseFallback({
      intent: "ask_for_help",
      action: "chat_public",
      parameters: { message: `I need help: ${reason}` },
      speech: {
        visibility: "public",
        content: `I need help: ${reason}`,
      },
      confidence: 0.3,
      reasoningSummary: `Fallback public help request: ${reason}`,
    });
  }

  return undefined;
}

function visibleUsefulItem(perception: PromptPerceptionSnapshot | undefined): Record<string, JsonValue | undefined> | undefined {
  const nearbyItem = asRecords(perception?.nearbyItems).find(isUsefulResourceItem);
  if (nearbyItem) {
    return nearbyItem;
  }

  return asRecords(perception?.nearbyEntities).find((entity) =>
    isItemLike(entity) && isUsefulResourceItem(entity),
  );
}

function visibleSafeMineBlock(perception: PromptPerceptionSnapshot | undefined): Record<string, JsonValue | undefined> | undefined {
  return asRecords(perception?.visibleBlocks).find((block) => {
    const name = blockLabel(block);
    return Boolean(
      name
      && MINEABLE_BLOCK_PATTERN.test(name)
      && !UNSAFE_BLOCKS.has(normalizeName(name))
      && block.safe !== false
      && block.belowAgent !== true
      && positionValue(block.position),
    );
  });
}

function obviousCraftItem(input: FallbackDecisionInput): { item: string; count: number } | undefined {
  const inventory = inventoryItemNames(input.perception).map(normalizeName);
  if (inventory.length === 0) {
    return undefined;
  }

  const taskGoal = craftTaskGoalText(input);
  const roleGoal = craftRoleGoalText(input);
  const hasPlanks = inventory.some((name) => /planks/.test(name));
  const hasSticks = inventory.some((name) => /stick/.test(name));
  const hasWood = inventory.some((name) => /log|wood|planks/.test(name));
  const hasCoal = inventory.some((name) => /coal|charcoal/.test(name));
  const hasToolIngredients = hasPlanks && hasSticks;
  const wantsFarmFromTask = FARM_GOAL_PATTERN.test(taskGoal);
  const wantsMineFromTask = MINE_GOAL_PATTERN.test(taskGoal);
  const wantsFarm = wantsFarmFromTask || FARM_GOAL_PATTERN.test(roleGoal);
  const wantsMine = wantsMineFromTask || MINE_GOAL_PATTERN.test(roleGoal);

  if (wantsFarmFromTask
    && !inventory.some((name) => /hoe/.test(name))
    && hasToolIngredients) {
    return { item: "wooden_hoe", count: 1 };
  }

  if (wantsMineFromTask
    && !inventory.some((name) => /pickaxe/.test(name))
    && hasToolIngredients) {
    return { item: "wooden_pickaxe", count: 1 };
  }

  if (wantsFarm
    && !inventory.some((name) => /hoe/.test(name))
    && hasToolIngredients) {
    return { item: "wooden_hoe", count: 1 };
  }

  if (wantsMine
    && !inventory.some((name) => /pickaxe/.test(name))
    && hasToolIngredients) {
    return { item: "wooden_pickaxe", count: 1 };
  }

  if ((LIGHT_GOAL_PATTERN.test(taskGoal) || LIGHT_GOAL_PATTERN.test(roleGoal))
    && hasCoal
    && hasSticks) {
    return { item: "torch", count: 4 };
  }

  if ((CRAFTING_TABLE_GOAL_PATTERN.test(taskGoal) || CRAFTING_TABLE_GOAL_PATTERN.test(roleGoal))
    && !inventory.some((name) => name === "crafting_table")
    && hasWood) {
    return { item: "crafting_table", count: 1 };
  }

  return undefined;
}

function patrolOrScoutPoint(input: FallbackDecisionInput): JsonValue | undefined {
  const patrolPoints = (input.perception?.patrolPoints ?? [])
    .map((point) => positionValue(point))
    .filter((point): point is JsonValue => point !== undefined);
  if (patrolPoints.length > 0) {
    return patrolPoints[hashString(input.agent.id) % patrolPoints.length];
  }

  const current = positionRecord(input.perception?.position) ?? input.dynamicState?.position;
  if (!current) {
    return undefined;
  }
  const offset = SCOUT_OFFSETS[hashString(input.agent.id) % SCOUT_OFFSETS.length] ?? SCOUT_OFFSETS[0];
  return {
    x: current.x + offset.x,
    y: current.y,
    z: current.z + offset.z,
    ...(typeof current.world === "string" ? { world: current.world } : {}),
  };
}

function parseFallback(decision: AgentDecision): AgentDecision {
  // Schema fallback guard: every fallback must remain a valid provider-shaped decision.
  return AgentDecisionSchema.parse(decision);
}

function isThreatened(input: FallbackDecisionInput): boolean {
  if ((input.dynamicState?.health ?? 20) <= 8 || input.dynamicState?.threatLevel === "high") {
    return true;
  }
  return hasThreat(input.perception?.nearbyPlayers) || hasThreat(input.perception?.nearbyEntities);
}

function shouldAskForHelp(input: FallbackDecisionInput): boolean {
  return isThreatened(input)
    || hasRecentBlocker(input)
    || (input.recentEvents ?? []).some((event) => event.severity >= 4 || event.targetId === input.agent.id)
    || (input.recentChat ?? []).some((message) => message.recipientIds.includes(input.agent.id));
}

function hasRecentBlocker(input: FallbackDecisionInput): boolean {
  return (input.recentActionResults ?? []).slice(-4).some((result) =>
    result.ok === false
    && Boolean(result.error?.trim() || result.action),
  );
}

function hasThreat(values: unknown): boolean {
  if (!Array.isArray(values)) {
    return false;
  }
  return values.some((value) => {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const record = value as Record<string, JsonValue | undefined>;
    return record.hostile === true || record.threatening === true;
  });
}

function fleeParameters(input: FallbackDecisionInput, reason: string): Record<string, JsonValue> | undefined {
  const threat = firstThreat(input.perception?.nearbyEntities) ?? firstThreat(input.perception?.nearbyPlayers);
  if (!threat) {
    return undefined;
  }

  const position = positionValue(threat.position);
  const entityId = stringValue(threat.id);
  const username = stringValue(threat.username) ?? stringValue(threat.name);
  const target: Record<string, JsonValue> = {
    distance: 16,
    fallback: true,
    reason,
  };
  if (entityId) target.entityId = entityId;
  if (username) target.username = username;
  if (position) target.position = position;
  return entityId || username || position ? target : undefined;
}

function firstThreat(values: unknown): Record<string, JsonValue | undefined> | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  return values.find((value): value is Record<string, JsonValue | undefined> =>
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && ((value as Record<string, JsonValue | undefined>).hostile === true
      || (value as Record<string, JsonValue | undefined>).threatening === true),
  );
}

function helpRecipients(input: FallbackDecisionInput): string[] {
  const direct = (input.recentChat ?? [])
    .flatMap((message) => [message.senderId, ...message.recipientIds])
    .filter((id) => id && id !== input.agent.id);
  const players = (input.perception?.nearbyPlayers ?? [])
    .map((player) => typeof player.id === "string" ? player.id : undefined)
    .filter((id): id is string => Boolean(id && id !== input.agent.id));
  return [...new Set([...direct, ...players])].slice(0, 5);
}

function asRecords(values: unknown): Array<Record<string, JsonValue | undefined>> {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value): value is Record<string, JsonValue | undefined> =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
}

function isUsefulResourceItem(record: Record<string, JsonValue | undefined>): boolean {
  const name = itemLabel(record);
  if (!name || !RESOURCE_ITEM_PATTERN.test(name)) {
    return false;
  }
  const distance = numberValue(record.distance);
  return record.hostile !== true && (distance === undefined || distance <= 16);
}

function isItemLike(record: Record<string, JsonValue | undefined>): boolean {
  const kind = normalizeName(stringValue(record.kind) ?? "");
  const type = normalizeName(stringValue(record.type) ?? "");
  const name = itemLabel(record);
  return kind === "item"
    || type === "object"
    || type === "dropped_item"
    || Boolean(name && RESOURCE_ITEM_PATTERN.test(name));
}

function itemLabel(record: Record<string, JsonValue | undefined>): string | undefined {
  const label = stringValue(record.item)
    ?? stringValue(record.name)
    ?? stringValue(record.displayName)
    ?? stringValue(record.type);
  return label && !isGenericItemLabel(label) ? label : undefined;
}

function blockLabel(record: Record<string, JsonValue | undefined>): string | undefined {
  return stringValue(record.block)
    ?? stringValue(record.type)
    ?? stringValue(record.name);
}

function isGenericItemLabel(value: string): boolean {
  return ["item", "object", "dropped_item"].includes(normalizeName(value));
}

function inventoryItemNames(perception: PromptPerceptionSnapshot | undefined): string[] {
  const inventory = perception?.inventory as unknown;
  if (Array.isArray(inventory)) {
    return inventory
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          return stringValue((item as Record<string, unknown>).name);
        }
        return undefined;
      })
      .filter((name): name is string => Boolean(name));
  }

  if (typeof inventory === "object" && inventory !== null && !Array.isArray(inventory)) {
    const record = inventory as Record<string, unknown>;
    const tools = Array.isArray(record.tools)
      ? record.tools.filter((tool): tool is string => typeof tool === "string")
      : [];
    const counted = Object.entries(record)
      .filter(([, value]) => typeof value === "number" && value > 0)
      .map(([key]) => key);
    return [...tools, ...counted];
  }

  return [];
}

function craftTaskGoalText(input: FallbackDecisionInput): string {
  const recentFailures = (input.recentActionResults ?? [])
    .slice(-4)
    .filter((result) => result.ok === false)
    .map((result) => `${result.action} ${result.error ?? ""}`)
    .join(" ");
  return [
    input.dynamicState?.activeGoal,
    input.dynamicState?.currentTask,
    recentFailures,
  ].filter(Boolean).join(" ").toLowerCase();
}

function craftRoleGoalText(input: FallbackDecisionInput): string {
  return [
    input.agent.role,
    input.agent.routine,
    input.dynamicState?.currentRoutine,
  ].filter(Boolean).join(" ").toLowerCase();
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positionRecord(value: unknown): Position | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.x === "number"
    && typeof record.y === "number"
    && typeof record.z === "number"
    ? {
        x: record.x,
        y: record.y,
        z: record.z,
        ...(typeof record.world === "string" ? { world: record.world } : {}),
      }
    : undefined;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function positionValue(value: unknown): JsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record.x === "number"
    && typeof record.y === "number"
    && typeof record.z === "number"
    ? {
        x: record.x,
        y: record.y,
        z: record.z,
        ...(typeof record.world === "string" ? { world: record.world } : {}),
      }
    : undefined;
}

function compactReason(reason: string): string {
  const trimmed = reason.trim() || "LLM decision unavailable";
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}
