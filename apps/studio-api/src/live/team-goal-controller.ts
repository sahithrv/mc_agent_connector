import type { ActionResult, AgentConfig, Position } from "@mc-ai-video/contracts";

import type { BotHandle } from "../bots/types";
import { isPlaceableMaterialName } from "../materials";
import type { PerceptionSnapshot, RoutineActionIntent } from "../routines";
import type { SubteamDirectory, SubteamView } from "./subteams";
import type { TeamMemoryRecentView, TeamMemoryStore } from "./team-memory";

export type TeamGoalPhase =
  | "rally"
  | "scout_site"
  | "claim_site"
  | "gather_materials"
  | "build_base"
  | "hunt_target";

interface TeamProgressCounters {
  scoutMoves: number;
  claimedSites: number;
  minedBlocks: number;
  collectedItems: number;
  placedBlocks: number;
  patrols: number;
  hunts: number;
  movementRetries: number;
}

interface PositionOffset {
  x: number;
  z: number;
}

interface FailedMovementTarget {
  position: Position;
  expiresAt: number;
}

interface TeamGoalState {
  teamId: string;
  goalText: string;
  phase: TeamGoalPhase;
  siteAnchor?: Position;
  claimed: boolean;
  memberOffsets: Map<string, PositionOffset>;
  failedMovementTargets: Map<string, FailedMovementTarget>;
  progress: TeamProgressCounters;
}

interface LastMoveTarget {
  teamId: string;
  position: Position;
}

export interface TeamGoalControllerOptions {
  subteams: SubteamDirectory;
  getBot(agentId: string): BotHandle | undefined;
  roleForAgent?(agentId: string): string | undefined;
  memory?: TeamMemoryStore;
  now?: () => number;
  log?: (message: string) => void;
}

export interface TeamGoalPlanInput {
  agent: AgentConfig;
  perception: PerceptionSnapshot;
  goal?: string;
  attackTargetUsername?: string;
}

export interface TeamGoalPlanResult {
  action?: RoutineActionIntent;
  note?: string;
}

export interface TeamGoalStateSnapshot {
  teamId: string;
  goalText: string;
  phase: TeamGoalPhase;
  siteAnchor?: Position;
  claimed: boolean;
  memberOffsets: Record<string, PositionOffset>;
  failedMovementTargets: Position[];
  progress: TeamProgressCounters;
}

const FAILED_TARGET_COOLDOWN_MS = 20_000;
const SITE_CLAIM_DISTANCE = 5;
const SITE_WORK_DISTANCE = 24;
const LEADER_RALLY_DISTANCE = 8;

const AUTONOMY_GOAL_PATTERN =
  /\b(follow|leader|go|move|find|scout|build|village|base|camp|house|mine|gather|collect|farm|patrol|guard|hunt|kill|attack|eliminate|prepare|survive)\b/i;
const ATTACK_GOAL_PATTERN = /\b(kill|attack|hunt|eliminate)\b/i;
const MINEABLE_BLOCK_PATTERN = /stone|deepslate|dirt|gravel|coal_ore|iron_ore|copper_ore|log|wood/i;
const RESOURCE_ITEM_PATTERN = /cobblestone|dirt|seed|log|planks|stone|ore|ingot|coal|wheat|carrot|potato|wood/i;
const WOOD_ITEM_PATTERN = /log|wood|planks/i;
const MAX_RESOURCE_ITEM_DISTANCE = 12;

const SCOUT_OFFSETS: PositionOffset[] = [
  { x: 28, z: 0 },
  { x: -28, z: 0 },
  { x: 0, z: 28 },
  { x: 0, z: -28 },
  { x: 20, z: 20 },
  { x: -20, z: 20 },
  { x: 20, z: -20 },
  { x: -20, z: -20 },
];

const MEMBER_OFFSETS: PositionOffset[] = [
  { x: 0, z: 0 },
  { x: 5, z: 0 },
  { x: -5, z: 0 },
  { x: 0, z: 5 },
  { x: 0, z: -5 },
  { x: 5, z: 5 },
  { x: -5, z: 5 },
  { x: 5, z: -5 },
  { x: -5, z: -5 },
  { x: 9, z: 0 },
  { x: -9, z: 0 },
  { x: 0, z: 9 },
  { x: 0, z: -9 },
];

export class TeamGoalController {
  private readonly teams = new Map<string, TeamGoalState>();
  private readonly lastMoveTargets = new Map<string, LastMoveTarget>();
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: TeamGoalControllerOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((message) => console.log(message));
  }

  plan(input: TeamGoalPlanInput): TeamGoalPlanResult {
    const goal = input.goal?.trim();
    if (!goal || !AUTONOMY_GOAL_PATTERN.test(goal)) {
      return {};
    }

    const team = this.options.subteams.teamForAgent(input.agent.id);
    if (!team) {
      return {};
    }

    const state = this.stateForTeam(team.id);
    this.updateGoal(state, goal);
    this.pruneFailedTargets(state);
    this.ensureMemberOffsets(state, team);
    const recentMemory = this.options.memory?.recentForAgent(input.agent.id, { maxEntries: 12 });

    const current = this.currentPosition(input.agent.id);
    if (!current) {
      return this.noAction(input.agent, state, ["bot position unknown"]);
    }

    const role = this.roleFor(input.agent);
    const attackGoal = ATTACK_GOAL_PATTERN.test(goal);
    if (attackGoal && input.attackTargetUsername) {
      state.phase = "hunt_target";
      const huntIntent = this.huntTargetIntent(input, state, role, input.attackTargetUsername);
      if (huntIntent) {
        return this.rememberPlan(input, state, {
          action: huntIntent,
          note: "team autonomy hunting explicit target",
        });
      }
    }

    if (!state.siteAnchor) {
      if (team.leaderId === input.agent.id) {
        state.phase = "scout_site";
        state.siteAnchor = this.scoutTarget(team, current);
        state.progress.scoutMoves += 1;
        return this.rememberPlan(input, state, {
          action: this.moveIntent(input.agent, state, state.siteAnchor, 3, "scouting and claiming a subteam build site"),
          note: "team autonomy scouting site",
        });
      }

      const nearLeaderIntent = this.workNearLeaderOrRally(input, state, team, role, current, recentMemory);
      if (nearLeaderIntent) {
        return this.rememberPlan(input, state, {
          action: nearLeaderIntent,
          note: "team autonomy rally or nearby role work",
        });
      }

      return this.noAction(input.agent, state, this.noActionReasons(input, state, role));
    }

    this.updateClaimState(state, team);
    if (attackGoal && input.attackTargetUsername) {
      state.phase = "hunt_target";
    } else if (state.claimed && (role.includes("builder") || role.includes("farmer") || role.includes("leader"))) {
      state.phase = "build_base";
    } else if (state.claimed) {
      state.phase = "gather_materials";
    }

    if (team.leaderId === input.agent.id && !state.claimed && distance(current, state.siteAnchor) > SITE_CLAIM_DISTANCE) {
      return this.rememberPlan(input, state, {
        action: this.moveIntent(input.agent, state, state.siteAnchor, 3, "leader moving to claim subteam site"),
        note: "team autonomy claiming site",
      });
    }

    const assignedTarget = this.assignedSitePosition(state, input.agent.id);
    if (distance(current, state.siteAnchor) > SITE_WORK_DISTANCE && canUse(input.agent, "move_to")) {
      return this.rememberPlan(input, state, {
        action: this.moveIntent(input.agent, state, assignedTarget, 3, "moving to assigned subteam site slot"),
        note: "team autonomy moving to assigned site slot",
      });
    }

    const roleIntent = this.roleWorkIntent(input, state, role, recentMemory);
    if (roleIntent) {
      return this.rememberPlan(input, state, {
        action: roleIntent,
        note: "team autonomy role work",
      });
    }

    if (distance(current, assignedTarget) > 3 && canUse(input.agent, "move_to")) {
      return this.rememberPlan(input, state, {
        action: this.moveIntent(input.agent, state, assignedTarget, 2, "spreading to assigned subteam slot"),
        note: "team autonomy spreading by slot",
      });
    }

    return this.noAction(input.agent, state, this.noActionReasons(input, state, role));
  }

  recordActionResult(result: ActionResult): void {
    const team = this.options.subteams.teamForAgent(result.agentId);
    if (!team) return;
    const state = this.stateForTeam(team.id);

    if (result.action === "move_to") {
      const target = this.lastMoveTargets.get(result.agentId);
      if (target && !result.ok) {
        state.failedMovementTargets.set(positionKey(target.position), {
          position: target.position,
          expiresAt: this.now() + FAILED_TARGET_COOLDOWN_MS,
        });
        this.options.memory?.recordObservation(result.agentId, {
          category: "path",
          key: `failed-path:${positionKey(target.position)}`,
          text: `failed path to ${formatPosition(target.position)}`,
          position: target.position,
          importance: 4,
        });
      }
      if (result.ok) {
        this.lastMoveTargets.delete(result.agentId);
      }
      return;
    }

    if (!result.ok) return;
    if (result.action === "mine_block") state.progress.minedBlocks += 1;
    if (result.action === "collect_item") state.progress.collectedItems += 1;
    if (result.action === "place_block") state.progress.placedBlocks += 1;
    if (result.action === "attack_entity") state.progress.hunts += 1;
  }

  snapshot(teamId: string): TeamGoalStateSnapshot | undefined {
    const state = this.teams.get(teamId);
    if (!state) return undefined;
    return {
      teamId: state.teamId,
      goalText: state.goalText,
      phase: state.phase,
      siteAnchor: state.siteAnchor ? { ...state.siteAnchor } : undefined,
      claimed: state.claimed,
      memberOffsets: Object.fromEntries(
        [...state.memberOffsets.entries()].map(([agentId, offset]) => [agentId, { ...offset }]),
      ),
      failedMovementTargets: [...state.failedMovementTargets.values()].map((target) => ({ ...target.position })),
      progress: { ...state.progress },
    };
  }

  private stateForTeam(teamId: string): TeamGoalState {
    const existing = this.teams.get(teamId);
    if (existing) return existing;
    const created: TeamGoalState = {
      teamId,
      goalText: "",
      phase: "rally",
      claimed: false,
      memberOffsets: new Map(),
      failedMovementTargets: new Map(),
      progress: {
        scoutMoves: 0,
        claimedSites: 0,
        minedBlocks: 0,
        collectedItems: 0,
        placedBlocks: 0,
        patrols: 0,
        hunts: 0,
        movementRetries: 0,
      },
    };
    this.teams.set(teamId, created);
    return created;
  }

  private updateGoal(state: TeamGoalState, goal: string): void {
    if (state.goalText === goal) return;
    state.goalText = goal;
    state.phase = ATTACK_GOAL_PATTERN.test(goal) ? "hunt_target" : state.siteAnchor ? "claim_site" : "rally";
  }

  private ensureMemberOffsets(state: TeamGoalState, team: SubteamView): void {
    const ordered = [
      ...(team.leaderId ? [team.leaderId] : []),
      ...team.memberIds.filter((id) => id !== team.leaderId).sort((left, right) => left.localeCompare(right)),
    ];
    const known = new Set(ordered);
    for (const agentId of [...state.memberOffsets.keys()]) {
      if (!known.has(agentId)) state.memberOffsets.delete(agentId);
    }
    ordered.forEach((agentId, index) => {
      if (!state.memberOffsets.has(agentId)) {
        state.memberOffsets.set(agentId, MEMBER_OFFSETS[index % MEMBER_OFFSETS.length] ?? MEMBER_OFFSETS[0]);
      }
    });
  }

  private updateClaimState(state: TeamGoalState, team: SubteamView): void {
    if (state.claimed || !state.siteAnchor || !team.leaderId) return;
    const leaderPosition = this.currentPosition(team.leaderId);
    if (leaderPosition && distance(leaderPosition, state.siteAnchor) <= SITE_CLAIM_DISTANCE) {
      state.claimed = true;
      state.phase = "claim_site";
      state.progress.claimedSites += 1;
    }
  }

  private workNearLeaderOrRally(
    input: TeamGoalPlanInput,
    state: TeamGoalState,
    team: SubteamView,
    role: string,
    current: Position,
    recentMemory: TeamMemoryRecentView | undefined,
  ): RoutineActionIntent | undefined {
    const leaderId = team.leaderId;
    if (!leaderId || leaderId === input.agent.id) return undefined;

    const leaderPosition = this.currentPosition(leaderId);
    if (!leaderPosition) {
      return this.roleWorkIntent(input, state, role, recentMemory);
    }

    const leaderDistance = distance(current, leaderPosition);
    if (leaderDistance <= LEADER_RALLY_DISTANCE) {
      return this.roleWorkIntent(input, state, role, recentMemory);
    }

    state.phase = "rally";
    if (!canUse(input.agent, "move_to") && !canUse(input.agent, "follow_player")) {
      return undefined;
    }

    const leader = this.options.subteams.leaderForAgent(input.agent.id);
    const leaderVisible = Object.values(this.options.getBot(input.agent.id)?.entities ?? {}).some((entity) =>
      entity.type === "player" && entity.username === leader?.account.username,
    );
    if (leaderVisible && leader && canUse(input.agent, "follow_player")) {
      return {
        action: "follow_player",
        params: {
          username: leader.account.username,
          range: 4,
          reason: "rallying with subteam leader until near leader or claimed site",
        },
        timeoutMs: 12_000,
        requestedBy: "live-autonomy",
      };
    }

    if (canUse(input.agent, "move_to")) {
      return this.moveIntent(input.agent, state, leaderPosition, 4, "moving toward leader rally position");
    }
    return undefined;
  }

  private roleWorkIntent(
    input: TeamGoalPlanInput,
    state: TeamGoalState,
    role: string,
    recentMemory: TeamMemoryRecentView | undefined,
  ): RoutineActionIntent | undefined {
    const bot = this.options.getBot(input.agent.id);
    const sitePosition = state.siteAnchor ?? this.currentPosition(input.agent.id);

    if (role.includes("guard")) {
      const hostileIntent = this.hostileMobIntent(input.agent);
      if (hostileIntent) return hostileIntent;
      if (sitePosition && canUse(input.agent, "move_to")) {
        state.progress.patrols += 1;
        return this.moveIntent(input.agent, state, this.patrolPosition(state, input.agent.id), 3, "patrolling subteam perimeter");
      }
    }

    const craftIntent = this.craftIntent(input, role, bot);
    if (craftIntent) {
      return craftIntent;
    }

    const item = this.nearbyResourceItem(input.perception, input.agent.id);
    if (item && canUse(input.agent, "collect_item") && bot?.collectBlock) {
      return {
        action: "collect_item",
        params: { entityId: item.id, item: item.type, reason: "collecting dropped supplies for subteam goal" },
        timeoutMs: 10_000,
        requestedBy: "live-autonomy",
      };
    }

    if (hasPlaceableInventory(bot) && canUse(input.agent, "place_block")) {
      const target = this.placeTarget(input.agent.id, state);
      const block = firstPlaceableItem(bot);
      if (target && block) {
        return {
          action: "place_block",
          params: {
            position: target,
            block,
            reason: role.includes("farmer") ? "starting primitive farm/base blocks" : "building primitive subteam base",
          },
          timeoutMs: 10_000,
          requestedBy: "live-autonomy",
        };
      }
    }

    const mineable = this.mineableBlock(input.perception, input.agent.id);
    if (
      mineable
      && !this.teammateAlreadyMining(input.agent.id, role, mineable.type, recentMemory)
      && canUse(input.agent, "mine_block")
    ) {
      return {
        action: "mine_block",
        params: {
          position: mineable.position,
          block: mineable.type,
          reason: "gathering visible safe materials for subteam goal",
        },
        timeoutMs: 12_000,
        requestedBy: "live-autonomy",
      };
    }

    return undefined;
  }

  private craftIntent(
    input: TeamGoalPlanInput,
    role: string,
    bot: BotHandle | undefined,
  ): RoutineActionIntent | undefined {
    if (!canUse(input.agent, "craft_item") || !bot?.craft || !bot.recipesFor) {
      return undefined;
    }

    const inventory = inventoryNames(bot);
    const goal = input.goal?.toLowerCase() ?? "";
    const wantsFarm = role.includes("farmer") || /\b(farm|food|crop|seed|wheat|carrot|potato)\b/.test(goal);
    const wantsMine = role.includes("miner") || /\b(mine|gather|stone|ore|coal|iron|build|base|village)\b/.test(goal);
    const wantsLight = /\b(mine|cave|night|torch|safe|base|village)\b/.test(goal);

    if (wantsFarm && !inventory.some((name) => /hoe/i.test(name)) && inventory.some((name) => WOOD_ITEM_PATTERN.test(name))) {
      return craftItemIntent("wooden_hoe", "crafting hoe to unblock farming");
    }

    if (wantsMine && !inventory.some((name) => /pickaxe/i.test(name)) && inventory.some((name) => WOOD_ITEM_PATTERN.test(name))) {
      return craftItemIntent("wooden_pickaxe", "crafting pickaxe to gather team materials");
    }

    if (wantsLight && inventory.some((name) => /coal|charcoal/i.test(name)) && inventory.some((name) => /stick/i.test(name))) {
      return craftItemIntent("torch", "crafting torches for safer team work");
    }

    if (/\b(build|base|village|craft|tool)\b/.test(goal) && !inventory.some((name) => name === "crafting_table") && inventory.some((name) => /planks|log|wood/i.test(name))) {
      return craftItemIntent("crafting_table", "crafting table to unlock team tools");
    }

    return undefined;
  }

  private huntTargetIntent(
    input: TeamGoalPlanInput,
    state: TeamGoalState,
    role: string,
    targetUsername: string,
  ): RoutineActionIntent | undefined {
    const target = input.perception.nearbyPlayers.find((player) =>
      player.name.toLowerCase() === targetUsername.toLowerCase(),
    );
    if (target && canUse(input.agent, "attack_entity")) {
      return {
        action: "attack_entity",
        params: { username: targetUsername, directorOverride: true, reason: "director-approved target visible" },
        timeoutMs: 8_000,
        requestedBy: "director",
      };
    }

    const botTarget = Object.values(this.options.getBot(input.agent.id)?.entities ?? {}).find((entity) =>
      entity.type === "player" && entity.username?.toLowerCase() === targetUsername.toLowerCase() && entity.position,
    );
    if (botTarget?.position && canUse(input.agent, "move_to")) {
      return this.moveIntent(input.agent, state, botTarget.position, 4, "moving toward director-approved target");
    }

    if ((role.includes("guard") || role.includes("leader")) && state.siteAnchor && canUse(input.agent, "move_to")) {
      return this.moveIntent(input.agent, state, this.patrolPosition(state, input.agent.id), 3, "hunting from subteam perimeter");
    }
    return undefined;
  }

  private hostileMobIntent(agent: AgentConfig): RoutineActionIntent | undefined {
    const hostile = Object.values(this.options.getBot(agent.id)?.entities ?? {}).find((entity) =>
      entity.type !== "player" && /zombie|skeleton|creeper|spider|hostile/i.test(entityName(entity)),
    );
    if (!hostile || !canUse(agent, "attack_entity")) return undefined;
    return {
      action: "attack_entity",
      params: { entityId: String(hostile.id), reason: "guard engaging hostile near subteam perimeter" },
      timeoutMs: 8_000,
      requestedBy: "live-autonomy",
    };
  }

  private mineableBlock(perception: PerceptionSnapshot, agentId: string): PerceptionSnapshot["visibleBlocks"][number] | undefined {
    const current = this.currentPosition(agentId);
    return perception.visibleBlocks.find((block) =>
      MINEABLE_BLOCK_PATTERN.test(block.type)
      && block.safe !== false
      && block.belowAgent !== true
      && (!current || distance(current, block.position) <= 8),
    );
  }

  private nearbyResourceItem(perception: PerceptionSnapshot, agentId: string): PerceptionSnapshot["nearbyEntities"][number] | undefined {
    const current = this.currentPosition(agentId);
    return perception.nearbyEntities.find((entity) => isNearbyResourceItem(entity, current));
  }

  private scoutTarget(team: SubteamView, current: Position): Position {
    const index = Math.max(0, this.options.subteams.list().findIndex((candidate) => candidate.id === team.id));
    const offset = SCOUT_OFFSETS[index % SCOUT_OFFSETS.length] ?? SCOUT_OFFSETS[0];
    return {
      x: Math.floor(current.x + offset.x),
      y: Math.floor(current.y),
      z: Math.floor(current.z + offset.z),
      world: current.world,
    };
  }

  private assignedSitePosition(state: TeamGoalState, agentId: string): Position {
    const anchor = state.siteAnchor ?? this.currentPosition(agentId) ?? { x: 0, y: 64, z: 0 };
    const offset = state.memberOffsets.get(agentId) ?? MEMBER_OFFSETS[0];
    return {
      x: Math.floor(anchor.x + offset.x),
      y: Math.floor(anchor.y),
      z: Math.floor(anchor.z + offset.z),
      world: anchor.world,
    };
  }

  private patrolPosition(state: TeamGoalState, agentId: string): Position {
    const anchor = state.siteAnchor ?? this.currentPosition(agentId) ?? { x: 0, y: 64, z: 0 };
    const offset = state.memberOffsets.get(agentId) ?? MEMBER_OFFSETS[1];
    const scale = Math.max(1.8, 12 / Math.max(1, Math.sqrt(offset.x * offset.x + offset.z * offset.z)));
    return {
      x: Math.floor(anchor.x + offset.x * scale),
      y: Math.floor(anchor.y),
      z: Math.floor(anchor.z + offset.z * scale),
      world: anchor.world,
    };
  }

  private placeTarget(agentId: string, state: TeamGoalState): Position | undefined {
    const bot = this.options.getBot(agentId);
    const current = this.currentPosition(agentId);
    if (!bot?.blockAt || !current) return undefined;

    const assigned = state.siteAnchor ? this.assignedSitePosition(state, agentId) : current;
    const base = distance(current, assigned) <= 5 ? assigned : current;
    const candidates = [
      { x: base.x + 1, z: base.z },
      { x: base.x, z: base.z + 1 },
      { x: base.x - 1, z: base.z },
      { x: base.x, z: base.z - 1 },
      { x: base.x + 1, z: base.z + 1 },
      { x: base.x - 1, z: base.z + 1 },
    ].map((candidate) => ({
      x: Math.floor(candidate.x),
      y: Math.floor(base.y),
      z: Math.floor(candidate.z),
      world: base.world,
    }));

    return candidates.find((candidate) => {
      if (distance(current, candidate) > 5) return false;
      const target = safeBlockAt(bot, candidate);
      const below = safeBlockAt(bot, { ...candidate, y: candidate.y - 1 });
      return (!target || target.name === "air") && Boolean(below && below.name !== "air");
    });
  }

  private moveIntent(
    agent: AgentConfig,
    state: TeamGoalState,
    target: Position,
    range: number,
    reason: string,
  ): RoutineActionIntent {
    const adjusted = this.adjustMovementTarget(agent.id, state, target);
    this.lastMoveTargets.set(agent.id, { teamId: state.teamId, position: adjusted });
    return {
      action: "move_to",
      params: {
        position: adjusted,
        range,
        reason: adjusted === target ? reason : `${reason}; retrying via safer waypoint`,
      },
      timeoutMs: 15_000,
      requestedBy: "live-autonomy",
    };
  }

  private adjustMovementTarget(agentId: string, state: TeamGoalState, target: Position): Position {
    if (!this.failedTargetActive(state, target)) {
      return target;
    }

    state.progress.movementRetries += 1;
    const current = this.currentPosition(agentId);
    if (current && distance(current, target) > 10) {
      return projectToward(current, target, 8);
    }

    const offset = MEMBER_OFFSETS[state.progress.movementRetries % MEMBER_OFFSETS.length] ?? MEMBER_OFFSETS[1];
    return {
      x: Math.floor(target.x + offset.x),
      y: Math.floor(target.y),
      z: Math.floor(target.z + offset.z),
      world: target.world,
    };
  }

  private failedTargetActive(state: TeamGoalState, target: Position): boolean {
    const failed = state.failedMovementTargets.get(positionKey(target));
    return Boolean(failed && failed.expiresAt > this.now());
  }

  private pruneFailedTargets(state: TeamGoalState): void {
    const now = this.now();
    for (const [key, failed] of state.failedMovementTargets.entries()) {
      if (failed.expiresAt <= now) state.failedMovementTargets.delete(key);
    }
  }

  private roleFor(agent: AgentConfig): string {
    return (this.options.roleForAgent?.(agent.id) ?? agent.role).toLowerCase();
  }

  private currentPosition(agentId: string): Position | undefined {
    const position = this.options.getBot(agentId)?.entity?.position;
    return position ? { x: position.x, y: position.y, z: position.z, world: position.world } : undefined;
  }

  private noAction(agent: AgentConfig, state: TeamGoalState, reasons: string[]): TeamGoalPlanResult {
    const uniqueReasons = [...new Set(reasons.filter((reason) => reason.length > 0))];
    const reason = uniqueReasons.length > 0 ? uniqueReasons.join(", ") : "no deterministic team action available";
    this.log(`[live-autonomy] ${agent.id} no action: ${reason}`);
    return {
      note: `team autonomy no action in ${state.phase}: ${reason}`,
    };
  }

  private noActionReasons(input: TeamGoalPlanInput, state: TeamGoalState, role: string): string[] {
    const bot = this.options.getBot(input.agent.id);
    const visibleResources = this.mineableBlock(input.perception, input.agent.id)
      || this.nearbyResourceItem(input.perception, input.agent.id);
    return [
      visibleResources ? "" : "no visible resources",
      state.siteAnchor ? "" : "no site anchor",
      (role.includes("farmer") || role.includes("builder")) && !hasPlaceableInventory(bot) ? "no placeable inventory" : "",
      canUse(input.agent, "move_to") ? "" : "move_to not allowed",
    ];
  }

  private rememberPlan(
    input: TeamGoalPlanInput,
    state: TeamGoalState,
    result: TeamGoalPlanResult,
  ): TeamGoalPlanResult {
    if (!result.action) return result;

    this.options.memory?.recordActivity(input.agent.id, result.action);

    if (state.siteAnchor) {
      this.options.memory?.recordObservation(input.agent.id, {
        category: "site",
        key: `site-anchor:${state.teamId}`,
        text: `site anchor ${formatPosition(state.siteAnchor)}`,
        position: state.siteAnchor,
        importance: 4,
      });
      this.options.memory?.recordObservation(input.agent.id, {
        category: "site",
        key: `site-slot:${state.teamId}:${input.agent.id}`,
        text: `${input.agent.id} slot ${formatPosition(this.assignedSitePosition(state, input.agent.id))}`,
        position: this.assignedSitePosition(state, input.agent.id),
        importance: 3,
      });
    }

    if (result.action.action === "attack_entity") {
      const target = stringParam(result.action.params.username) ?? stringParam(result.action.params.entityId);
      if (target) {
        this.options.memory?.recordObservation(input.agent.id, {
          category: "target",
          key: `hunt-target:${state.teamId}:${target.toLowerCase()}`,
          text: `hunt target ${target}`,
          target,
          importance: 5,
        });
      }
    }

    if (result.action.action === "place_block") {
      this.options.memory?.recordNeed(state.teamId, "more planks or stone for building");
    }

    return result;
  }

  private teammateAlreadyMining(
    agentId: string,
    role: string,
    blockType: string,
    recentMemory: TeamMemoryRecentView | undefined,
  ): boolean {
    if (role.includes("miner")) return false;
    return Boolean(recentMemory?.entries.some((entry) =>
      entry.agentId
      && entry.agentId !== agentId
      && entry.kind === "activity"
      && entry.action === "mine_block"
      && (entry.target === blockType || entry.text.toLowerCase().includes(blockType.toLowerCase())),
    ));
  }
}

function canUse(agent: AgentConfig, action: string): boolean {
  return agent.allowedActions.includes(action);
}

function isNearbyResourceItem(
  entity: PerceptionSnapshot["nearbyEntities"][number],
  current: Position | undefined,
): boolean {
  if (!entity.id || entity.hostile === true || !entity.position) {
    return false;
  }
  return Boolean(entity.id)
    && isSpecificResourceItemType(entity.type)
    && (!current || distance(current, entity.position) <= MAX_RESOURCE_ITEM_DISTANCE);
}

function isSpecificResourceItemType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized !== "item"
    && normalized !== "object"
    && normalized !== "dropped_item"
    && RESOURCE_ITEM_PATTERN.test(normalized);
}

function entityName(entity: { name?: string; displayName?: string; type?: string }): string {
  return entity.name ?? entity.displayName ?? entity.type ?? "";
}

function hasPlaceableInventory(bot: BotHandle | undefined): boolean {
  return Boolean(firstPlaceableItem(bot));
}

function firstPlaceableItem(bot: BotHandle | undefined): string | undefined {
  return bot?.inventory?.items()
    .map((item) => item.name)
    .find(isPlaceableMaterialName);
}

function inventoryNames(bot: BotHandle): string[] {
  return bot.inventory?.items().map((item) => item.name.toLowerCase()) ?? [];
}

function craftItemIntent(item: string, reason: string): RoutineActionIntent {
  return {
    action: "craft_item",
    params: {
      item,
      count: item === "torch" ? 4 : 1,
      reason,
    },
    timeoutMs: 8_000,
    requestedBy: "live-autonomy",
  };
}

function safeBlockAt(bot: BotHandle, position: Position) {
  try {
    return bot.blockAt?.(position) ?? null;
  } catch {
    return null;
  }
}

function positionKey(position: Position): string {
  return `${position.world ?? ""}:${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
}

function formatPosition(position: Position): string {
  return `${round(position.x)},${round(position.y)},${round(position.z)}${position.world ? `@${position.world}` : ""}`;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function projectToward(current: Position, target: Position, step: number): Position {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dz = target.z - current.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length === 0) return current;
  return {
    x: Math.floor(current.x + (dx / length) * step),
    y: Math.floor(current.y + (dy / length) * step),
    z: Math.floor(current.z + (dz / length) * step),
    world: current.world ?? target.world,
  };
}

function distance(left: Pick<Position, "x" | "y" | "z">, right: Pick<Position, "x" | "y" | "z">): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
