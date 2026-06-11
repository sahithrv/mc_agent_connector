import type { AgentConfig, JsonValue, Position } from "@mc-ai-video/contracts";

export interface SafetyHumanParticipant {
  id: string;
  username: string;
  teamId?: string;
  isRecorder?: boolean;
}

export interface ScenarioSafetyRules {
  allowFriendlyFire?: boolean;
  allowGrief?: boolean;
  allowUnsafeMining?: boolean;
  protectedBlocks?: string[];
  griefActions?: string[];
}

export interface LlmActionPolicyInput {
  agent: AgentConfig;
  action: string;
  parameters?: Record<string, JsonValue>;
  agents?: AgentConfig[];
  humans?: SafetyHumanParticipant[];
  scenario?: ScenarioSafetyRules;
}

export type LlmActionPolicyResult =
  | { ok: true }
  | { ok: false; reason: string };

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

const DEFAULT_PROTECTED_BLOCKS = new Set([
  "chest",
  "trapped_chest",
  "barrel",
  "furnace",
  "blast_furnace",
  "shulker_box",
  "lectern",
]);

const DEFAULT_GRIEF_ACTIONS = new Set([
  "ignite_block",
  "place_tnt",
  "break_structure",
  "steal_item",
]);

export function evaluateLlmActionPolicy(input: LlmActionPolicyInput): LlmActionPolicyResult {
  if (!input.agent.allowedActions.includes(input.action)) {
    return { ok: false, reason: `action is not allowed for agent: ${input.action}` };
  }

  if (input.action === "attack_entity") {
    const friendlyFire = blocksFriendlyFire(input);
    if (friendlyFire) return friendlyFire;
  }

  if (input.action === "mine_block") {
    const unsafeMining = blocksUnsafeMining(input);
    if (unsafeMining) return unsafeMining;
  }

  const grief = blocksGrief(input);
  if (grief) return grief;

  return { ok: true };
}

function blocksFriendlyFire(input: LlmActionPolicyInput): LlmActionPolicyResult | undefined {
  if (input.scenario?.allowFriendlyFire === true) {
    return undefined;
  }

  const targetAgentId = stringParam(input.parameters, "targetAgentId")
    ?? stringParam(input.parameters, "agentId");
  const targetUsername = stringParam(input.parameters, "username");
  const targetAgent = input.agents?.find((agent) =>
    agent.id === targetAgentId || agent.account.username === targetUsername,
  );
  if (targetAgent?.team && input.agent.team && targetAgent.team === input.agent.team) {
    return { ok: false, reason: "friendly fire is blocked by default" };
  }

  const targetHuman = input.humans?.find((human) =>
    human.id === targetAgentId || human.username === targetUsername,
  );
  if (targetHuman?.teamId && input.agent.team && targetHuman.teamId === input.agent.team) {
    return { ok: false, reason: "friendly fire against allied human is blocked by default" };
  }

  return undefined;
}

function blocksUnsafeMining(input: LlmActionPolicyInput): LlmActionPolicyResult | undefined {
  if (input.scenario?.allowUnsafeMining === true) {
    return undefined;
  }

  const block = stringParam(input.parameters, "block") ?? stringParam(input.parameters, "name");
  if (block && UNSAFE_BLOCKS.has(block)) {
    return { ok: false, reason: `unsafe mining is blocked for block: ${block}` };
  }

  const position = positionParam(input.parameters);
  if (position && position.y < 0) {
    return { ok: false, reason: "unsafe mining below world floor is blocked" };
  }

  return undefined;
}

function blocksGrief(input: LlmActionPolicyInput): LlmActionPolicyResult | undefined {
  if (input.scenario?.allowGrief === true) {
    return undefined;
  }

  const griefActions = new Set([
    ...DEFAULT_GRIEF_ACTIONS,
    ...(input.scenario?.griefActions ?? []),
  ]);
  if (griefActions.has(input.action)) {
    return { ok: false, reason: `grief action is blocked by scenario policy: ${input.action}` };
  }

  const protectedBlocks = new Set([
    ...DEFAULT_PROTECTED_BLOCKS,
    ...(input.scenario?.protectedBlocks ?? []),
  ]);
  const block = stringParam(input.parameters, "block") ?? stringParam(input.parameters, "name");
  if (input.action === "mine_block" && block && protectedBlocks.has(block)) {
    return { ok: false, reason: `grief mining protected block is blocked: ${block}` };
  }

  return undefined;
}

function stringParam(params: Record<string, JsonValue> | undefined, field: string): string | undefined {
  const value = params?.[field];
  return typeof value === "string" ? value : undefined;
}

function positionParam(params: Record<string, JsonValue> | undefined): Position | undefined {
  const value = params?.position;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, JsonValue>;
  return typeof record.x === "number"
    && typeof record.y === "number"
    && typeof record.z === "number"
    ? { x: record.x, y: record.y, z: record.z }
    : undefined;
}
