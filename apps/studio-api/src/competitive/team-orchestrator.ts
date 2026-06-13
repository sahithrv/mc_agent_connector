import type { AgentConfig, Position } from "@mc-ai-video/contracts";

import type { BotHandle } from "../bots/types";
import type { PerceptionSnapshot, RoutineActionIntent } from "../routines";
import type { BlueprintType } from "./blueprints";
import { AgentRole, AgentState, TacticalRole, TeamMemory } from "./team-memory";
import { FlankingEngine } from "./tactics";
import type { LLMQueuedRequest, LLMRequestQueue } from "./llm-request-queue";

const MAX_COMPETITIVE_COLLECT_DISTANCE = 12;

export interface CompetitiveAgentPlanInput {
  agent: AgentConfig;
  bot?: BotHandle;
  perception: PerceptionSnapshot;
}

export interface CompetitiveTeamOrchestratorOptions {
  memory: TeamMemory;
  llmQueue?: LLMRequestQueue;
  buildLlmRequest?: (eventName: string, agentIds: string[]) => LLMQueuedRequest | undefined;
  flanking?: FlankingEngine;
  now?: () => number;
}

export class CompetitiveTeamOrchestrator {
  private readonly memory: TeamMemory;
  private readonly flanking: FlankingEngine;
  private readonly now: () => number;
  private readonly teardown: Array<() => void> = [];

  constructor(options: CompetitiveTeamOrchestratorOptions) {
    this.memory = options.memory;
    this.flanking = options.flanking ?? new FlankingEngine();
    this.now = options.now ?? Date.now;

    if (options.llmQueue && options.buildLlmRequest) {
      this.bindMajorEvents(options.llmQueue, options.buildLlmRequest);
    }
  }

  stop(): void {
    while (this.teardown.length > 0) {
      this.teardown.pop()?.();
    }
  }

  planNextAction(input: CompetitiveAgentPlanInput): RoutineActionIntent | undefined {
    const phase = this.memory.currentPhase();
    if (phase === AgentState.KILL_PHASE) {
      return this.killPhaseIntent(input);
    }
    if (phase === AgentState.HUNT_PHASE) {
      return this.huntPhaseIntent(input);
    }
    return this.buildPhaseIntent(input);
  }

  private buildPhaseIntent(input: CompetitiveAgentPlanInput): RoutineActionIntent | undefined {
    const role = this.memory.roleFor(input.agent.id);
    if (role === AgentRole.GATHERER) {
      return this.gatherIntent(input) ?? this.searchIntent(input, "searching for missing village materials");
    }

    if (role === AgentRole.BUILDER) {
      return this.builderIntent(input) ?? this.searchIntent(input, "moving to expand the village build footprint");
    }

    return this.scoutIntent(input, "scouting perimeter while builders finish village")
      ?? (canUse(input.agent, "idle") ? idleIntent("competitive scout has no movement capability") : undefined);
  }

  private huntPhaseIntent(input: CompetitiveAgentPlanInput): RoutineActionIntent | undefined {
    const lastSeen = this.memory.threatMap.playerLastSeen;
    if (lastSeen && canUse(input.agent, "move_to")) {
      return moveIntent(lastSeen, 6, "moving toward last human sighting without committing to a straight-line rush");
    }
    return this.scoutIntent(input, "sweeping search pattern for human player after village completion")
      ?? (canUse(input.agent, "idle") ? idleIntent("hunt phase waiting for movement capability") : undefined);
  }

  private killPhaseIntent(input: CompetitiveAgentPlanInput): RoutineActionIntent | undefined {
    const humanUsername = this.memory.threatMap.playerUsername;
    const visiblePlayer = humanUsername
      ? input.perception.nearbyPlayers.find((player) => player.name.toLowerCase() === humanUsername.toLowerCase())
      : input.perception.nearbyPlayers.find((player) => player.threatening);

    if (
      visiblePlayer
      && visiblePlayer.distance !== undefined
      && visiblePlayer.distance <= 3
      && canUse(input.agent, "attack_entity")
    ) {
      return {
        action: "attack_entity",
        params: humanUsername
          ? { username: humanUsername, directorOverride: true, reason: "kill phase: target in melee range" }
          : { entityId: visiblePlayer.id, directorOverride: true, reason: "kill phase: visible target in melee range" },
        timeoutMs: 3_000,
        requestedBy: "director",
      };
    }

    const current = toPosition(input.bot?.entity?.position);
    const positions = current ? new Map([[input.agent.id, current]]) : new Map<string, Position>();
    const teamAgentIds = Object.keys(this.memory.snapshot().roles);
    this.flanking.assignIntoMemory(this.memory, teamAgentIds, positions);
    const tactic = this.memory.tacticFor(input.agent.id);
    const targetPosition = tactic?.targetPosition ?? this.memory.threatMap.playerLastSeen;
    if (!targetPosition) return undefined;
    if (!canUse(input.agent, "move_to")) {
      return canUse(input.agent, "idle") ? idleIntent("kill phase waiting for movement capability") : undefined;
    }

    return {
      action: "move_to",
      params: {
        position: targetPosition,
        range: tactic?.role === TacticalRole.AGGRO ? 2 : 3,
        reason: `kill phase ${tactic?.role ?? "TACTICAL_MOVE"} positioning; pathfinder handles movement asynchronously`,
      },
      timeoutMs: 6_000,
      requestedBy: "competitive-orchestrator",
    };
  }

  private gatherIntent(input: CompetitiveAgentPlanInput): RoutineActionIntent | undefined {
    const deficits = this.memory.materialDeficits();
    const deficitNames = [...deficits.keys()];
    const item = input.perception.nearbyEntities.find((entity) => isCollectibleMaterialDrop(entity, deficitNames));
    if (item && canUse(input.agent, "collect_item")) {
      return {
        action: "collect_item",
        params: { entityId: item.id, item: item.type, reason: "collecting shared village material deficit" },
        timeoutMs: 8_000,
        requestedBy: "competitive-orchestrator",
      };
    }

    if (!canUse(input.agent, "mine_block")) {
      return undefined;
    }

    const block = input.perception.visibleBlocks.find((candidate) =>
      isSafeResourceBlock(candidate)
      && deficitNames.some((name) => materialNameMatches(candidate.type, name)),
    ) ?? input.perception.visibleBlocks.find(isSafeResourceBlock);
    if (!block) return undefined;

    return {
      action: "mine_block",
      params: { position: block.position, block: block.type, reason: "gathering deterministic village materials" },
      timeoutMs: 10_000,
      requestedBy: "competitive-orchestrator",
    };
  }

  private builderIntent(input: CompetitiveAgentPlanInput): RoutineActionIntent | undefined {
    const inProgress = [...this.memory.blueprintState.values()].find((state) =>
      state.assignedAgentId === input.agent.id && state.status === "in_progress",
    ) ?? this.memory.claimNextBlueprint(input.agent.id, preferredBuildTypes(input.agent.id));
    if (!inProgress) {
      return this.searchIntent(input, "no pending blueprint; spreading to useful build position");
    }

    const target = nearbyBuildPosition(input.bot);
    const block = firstPlaceableItem(input.bot);
    if (!target || !block || !canUse(input.agent, "place_block")) {
      return this.gatherIntent(input)
        ?? this.searchIntent(input, block ? "finding more open build space" : "finding placeable village materials");
    }

    return {
      action: "place_block",
      params: {
        position: target,
        block,
        blueprintId: inProgress.blueprintId,
        reason: `building ${inProgress.type} blueprint ${inProgress.blueprintId}`,
      },
      timeoutMs: 8_000,
      requestedBy: "competitive-orchestrator",
    };
  }

  private scoutIntent(input: CompetitiveAgentPlanInput, reason: string): RoutineActionIntent | undefined {
    const current = toPosition(input.bot?.entity?.position);
    if (!current || !canUse(input.agent, "move_to")) return undefined;
    const offset = scoutOffset(input.agent.id);
    return moveIntent({
      x: Math.round(current.x + offset.x),
      y: Math.round(current.y),
      z: Math.round(current.z + offset.z),
      world: current.world,
    }, 3, reason);
  }

  private searchIntent(input: CompetitiveAgentPlanInput, reason: string): RoutineActionIntent | undefined {
    const current = toPosition(input.bot?.entity?.position);
    if (!current || !canUse(input.agent, "move_to")) {
      return canUse(input.agent, "idle") ? idleIntent(reason) : undefined;
    }

    const offset = searchOffset(input.agent.id);
    return moveIntent({
      x: Math.round(current.x + offset.x),
      y: Math.round(current.y),
      z: Math.round(current.z + offset.z),
      world: current.world,
    }, 4, reason);
  }

  private bindMajorEvents(
    llmQueue: LLMRequestQueue,
    buildLlmRequest: (eventName: string, agentIds: string[]) => LLMQueuedRequest | undefined,
  ): void {
    const agentIds = () => Object.keys(this.memory.snapshot().roles);
    const bind = (eventName: "blueprint.completed" | "resources.depleted" | "player.spotted") => {
      const listener = () => {
        const request = buildLlmRequest(eventName, agentIds());
        if (!request) return;

        // Major events wake the LLM queue, not the game tick. The queue staggers calls,
        // while deterministic routines keep moving so agents do not freeze on provider latency.
        llmQueue.enqueue(request).then((result) => {
          if (!result.ok) {
            console.warn(`[competitive-llm] ${result.agentId} ${result.error}`);
          }
        }).catch((error: unknown) => {
          console.warn(`[competitive-llm] queue failed: ${formatError(error)}`);
        });
      };
      this.memory.on(eventName, listener);
      this.teardown.push(() => this.memory.off(eventName, listener));
    };

    bind("blueprint.completed");
    bind("resources.depleted");
    bind("player.spotted");
  }
}

function preferredBuildTypes(agentId: string): BlueprintType[] {
  const order: BlueprintType[] = ["residential", "farm", "blacksmith", "watchtower"];
  const index = Math.abs(hash(agentId)) % order.length;
  return [...order.slice(index), ...order.slice(0, index)];
}

function moveIntent(position: Position, range: number, reason: string): RoutineActionIntent {
  return {
    action: "move_to",
    params: {
      position,
      range,
      reason,
    },
    timeoutMs: 8_000,
    requestedBy: "competitive-orchestrator",
  };
}

function idleIntent(reason: string): RoutineActionIntent {
  return {
    action: "idle",
    params: { durationMs: 1_000, reason },
    timeoutMs: 2_000,
    requestedBy: "competitive-orchestrator",
  };
}

function nearbyBuildPosition(bot: BotHandle | undefined): Position | undefined {
  const current = toPosition(bot?.entity?.position);
  if (!current || !bot?.blockAt) return undefined;
  const base = {
    x: Math.floor(current.x),
    y: Math.floor(current.y),
    z: Math.floor(current.z),
    world: current.world,
  };
  const candidates: Position[] = [];
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        candidates.push({
          x: base.x + dx,
          y: base.y,
          z: base.z + dz,
          world: base.world,
        });
      }
    }
  }

  return candidates.find((candidate) => {
    const target = bot.blockAt?.(candidate);
    const below = bot.blockAt?.({ ...candidate, y: candidate.y - 1 });
    return (!target || target.name === "air") && Boolean(below && below.name !== "air");
  });
}

function firstPlaceableItem(bot: BotHandle | undefined): string | undefined {
  return bot?.inventory?.items()
    .map((item) => item.name)
    .find((name) => /dirt|cobblestone|stone|planks|log|wood|brick|sand|gravel|glass/i.test(name));
}

function canUse(agent: AgentConfig, action: string): boolean {
  return agent.allowedActions.includes(action);
}

function isSafeResourceBlock(candidate: { type: string; safe?: boolean; belowAgent?: boolean }): boolean {
  return candidate.safe !== false && candidate.belowAgent !== true && /log|wood|stone|dirt|sand|ore|gravel|clay/i.test(candidate.type);
}

function isCollectibleMaterialDrop(
  entity: PerceptionSnapshot["nearbyEntities"][number],
  deficitNames: string[],
): boolean {
  if (!entity.id || entity.hostile === true || !entity.position) {
    return false;
  }
  return (isDroppedItem(entity.type) || deficitNames.some((name) => materialNameMatches(entity.type, name)))
    && (entity.distance === undefined || entity.distance <= MAX_COMPETITIVE_COLLECT_DISTANCE);
}

function isDroppedItem(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized !== "item"
    && normalized !== "object"
    && normalized !== "dropped_item"
    && /log|wood|planks|stone|cobblestone|dirt|sand|gravel|ore|ingot|coal|seed|wheat|carrot|potato|torch|ladder|fence|glass|brick/i.test(normalized);
}

function materialNameMatches(candidate: string, required: string): boolean {
  const left = normalizeMaterialName(candidate);
  const right = normalizeMaterialName(required);
  return left.includes(right) || right.includes(left);
}

function normalizeMaterialName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scoutOffset(agentId: string): { x: number; z: number } {
  const angle = (hash(agentId) % 360) * (Math.PI / 180);
  return {
    x: Math.cos(angle) * 18,
    z: Math.sin(angle) * 18,
  };
}

function searchOffset(agentId: string): { x: number; z: number } {
  const angle = ((hash(`${agentId}:search`) % 360) * Math.PI) / 180;
  return {
    x: Math.cos(angle) * 24,
    z: Math.sin(angle) * 24,
  };
}

function toPosition(position: { x: number; y: number; z: number; world?: string } | undefined): Position | undefined {
  return position ? { x: position.x, y: position.y, z: position.z, world: position.world } : undefined;
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
