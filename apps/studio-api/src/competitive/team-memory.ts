import { EventEmitter } from "node:events";

import type { Position } from "@mc-ai-video/contracts";

import { canonicalMaterialName } from "../materials";
import type { Blueprint, BlueprintType } from "./blueprints";

export enum AgentRole {
  GATHERER = "GATHERER",
  BUILDER = "BUILDER",
  SCOUT = "SCOUT",
}

export enum AgentState {
  BUILD_PHASE = "BUILD_PHASE",
  HUNT_PHASE = "HUNT_PHASE",
  KILL_PHASE = "KILL_PHASE",
}

export enum TacticalRole {
  AGGRO = "AGGRO",
  FLANK_LEFT = "FLANK_LEFT",
  FLANK_RIGHT = "FLANK_RIGHT",
}

export type BlueprintProgressStatus = "pending" | "in_progress" | "completed";
export type AlertLevel = "low" | "medium" | "high";

export interface BlueprintProgress {
  blueprintId: string;
  type: BlueprintType;
  status: BlueprintProgressStatus;
  assignedAgentId?: string;
  startedAt?: number;
  completedAt?: number;
  placedBlocks: number;
  totalBlocks: number;
}

export interface ThreatMap {
  playerLastSeen: Position | null;
  lastSightingTimestamp: number;
  alertLevel: AlertLevel;
  playerUsername?: string;
}

export interface ArmoryLedger {
  sharedResources: Map<string, number>;
  assignedGear: Map<string, string[]>;
}

export interface TacticalAssignment {
  agentId: string;
  role: TacticalRole;
  targetPosition: Position;
  assignedAt: number;
}

export interface TeamMemorySnapshot {
  teamId: string;
  phase: AgentState;
  blueprintState: BlueprintProgress[];
  threatMap: ThreatMap;
  sharedResources: Record<string, number>;
  assignedGear: Record<string, string[]>;
  roles: Record<string, AgentRole>;
  tactics: Record<string, TacticalAssignment>;
}

export interface TeamMemoryEvents {
  "blueprint.assigned": [BlueprintProgress];
  "blueprint.progress": [BlueprintProgress];
  "blueprint.completed": [BlueprintProgress];
  "phase.changed": [{ previous: AgentState; next: AgentState; reason: string }];
  "resources.changed": [{ item: string; previous: number; next: number }];
  "resources.depleted": [{ item: string; available: number; required: number }];
  "player.spotted": [ThreatMap];
  "role.changed": [{ agentId: string; previous?: AgentRole; next: AgentRole; reason: string }];
  "gear.assigned": [{ agentId: string; items: string[] }];
  "tactic.assigned": [TacticalAssignment];
}

export interface TeamMemoryOptions {
  teamId: string;
  agentIds: string[];
  blueprints: Blueprint[];
  initialResources?: Record<string, number>;
  initialRoles?: Partial<Record<string, AgentRole>>;
  now?: () => number;
}

type TeamMemoryEventName = keyof TeamMemoryEvents;

export class TeamMemory extends EventEmitter {
  public readonly teamId: string;
  public readonly blueprintState = new Map<string, BlueprintProgress>();
  public readonly threatMap: ThreatMap = {
    playerLastSeen: null,
    lastSightingTimestamp: 0,
    alertLevel: "low",
  };
  public readonly armoryLedger: ArmoryLedger = {
    sharedResources: new Map(),
    assignedGear: new Map(),
  };

  private readonly blueprints = new Map<string, Blueprint>();
  private readonly agentIds: string[];
  private readonly roles = new Map<string, AgentRole>();
  private readonly tactics = new Map<string, TacticalAssignment>();
  private readonly depletedResources = new Set<string>();
  private readonly now: () => number;
  private phase = AgentState.BUILD_PHASE;

  constructor(options: TeamMemoryOptions) {
    super();
    this.teamId = options.teamId;
    this.agentIds = [...new Set(options.agentIds)].sort((left, right) => left.localeCompare(right));
    this.now = options.now ?? Date.now;

    for (const blueprint of options.blueprints) {
      this.blueprints.set(blueprint.id, cloneBlueprint(blueprint));
      this.blueprintState.set(blueprint.id, {
        blueprintId: blueprint.id,
        type: blueprint.type,
        status: "pending",
        placedBlocks: 0,
        totalBlocks: schematicBlockCount(blueprint),
      });
    }

    for (const [item, count] of Object.entries(options.initialResources ?? {})) {
      this.addSharedResource(item, count);
    }

    for (const agentId of this.agentIds) {
      const role = options.initialRoles?.[agentId] ?? AgentRole.SCOUT;
      this.roles.set(agentId, role);
    }

    this.rebalanceRoles("initial team bootstrap");
  }

  override on<EventName extends TeamMemoryEventName>(
    eventName: EventName,
    listener: (...args: TeamMemoryEvents[EventName]) => void,
  ): this {
    return super.on(eventName, listener);
  }

  override once<EventName extends TeamMemoryEventName>(
    eventName: EventName,
    listener: (...args: TeamMemoryEvents[EventName]) => void,
  ): this {
    return super.once(eventName, listener);
  }

  override off<EventName extends TeamMemoryEventName>(
    eventName: EventName,
    listener: (...args: TeamMemoryEvents[EventName]) => void,
  ): this {
    return super.off(eventName, listener);
  }

  override emit<EventName extends TeamMemoryEventName>(
    eventName: EventName,
    ...args: TeamMemoryEvents[EventName]
  ): boolean {
    return super.emit(eventName, ...args);
  }

  currentPhase(): AgentState {
    return this.phase;
  }

  roleFor(agentId: string): AgentRole {
    return this.roles.get(agentId) ?? AgentRole.SCOUT;
  }

  tacticFor(agentId: string): TacticalAssignment | undefined {
    const tactic = this.tactics.get(agentId);
    return tactic ? cloneTacticalAssignment(tactic) : undefined;
  }

  claimNextBlueprint(agentId: string, preferredTypes: BlueprintType[] = []): BlueprintProgress | undefined {
    const pending = [...this.blueprintState.values()]
      .filter((blueprint) => blueprint.status === "pending")
      .sort((left, right) => {
        const leftRank = preferredTypes.includes(left.type) ? 0 : 1;
        const rightRank = preferredTypes.includes(right.type) ? 0 : 1;
        return leftRank - rightRank || left.blueprintId.localeCompare(right.blueprintId);
      });

    const next = pending[0];
    if (!next) return undefined;

    const updated: BlueprintProgress = {
      ...next,
      status: "in_progress",
      assignedAgentId: agentId,
      startedAt: this.now(),
    };
    this.blueprintState.set(next.blueprintId, updated);
    this.emit("blueprint.assigned", cloneProgress(updated));
    this.rebalanceRoles(`blueprint ${next.blueprintId} claimed`);
    return cloneProgress(updated);
  }

  completeBlueprint(agentId: string, blueprintId: string): void {
    const current = this.blueprintState.get(blueprintId);
    if (!current || current.status === "completed") return;
    if (current.assignedAgentId && current.assignedAgentId !== agentId) {
      throw new Error(`blueprint ${blueprintId} is assigned to ${current.assignedAgentId}`);
    }

    const completed: BlueprintProgress = {
      ...current,
      status: "completed",
      assignedAgentId: agentId,
      placedBlocks: current.totalBlocks,
      completedAt: this.now(),
    };
    this.blueprintState.set(blueprintId, completed);
    this.emit("blueprint.completed", cloneProgress(completed));

    if (this.villageComplete()) {
      this.setPhase(
        this.threatMap.playerLastSeen ? AgentState.KILL_PHASE : AgentState.HUNT_PHASE,
        "all required village blueprints completed",
      );
    } else {
      this.rebalanceRoles(`blueprint ${blueprintId} completed`);
    }
  }

  recordBlueprintPlacement(agentId: string, blueprintId: string, count = 1): BlueprintProgress | undefined {
    const current = this.blueprintState.get(blueprintId);
    if (!current || current.status === "completed") return current ? cloneProgress(current) : undefined;
    if (current.assignedAgentId && current.assignedAgentId !== agentId) {
      throw new Error(`blueprint ${blueprintId} is assigned to ${current.assignedAgentId}`);
    }

    const updated: BlueprintProgress = {
      ...current,
      status: "in_progress",
      assignedAgentId: current.assignedAgentId ?? agentId,
      startedAt: current.startedAt ?? this.now(),
      placedBlocks: Math.min(current.totalBlocks, current.placedBlocks + Math.max(1, count)),
    };
    this.blueprintState.set(blueprintId, updated);
    this.emit("blueprint.progress", cloneProgress(updated));

    if (updated.placedBlocks >= updated.totalBlocks) {
      this.completeBlueprint(agentId, blueprintId);
      return this.blueprintState.get(blueprintId);
    }

    return cloneProgress(updated);
  }

  updateSharedResource(item: string, delta: number): void {
    const material = canonicalMaterialName(item);
    const previous = this.armoryLedger.sharedResources.get(material) ?? 0;
    const next = Math.max(0, previous + delta);
    this.armoryLedger.sharedResources.set(material, next);
    if (previous !== next) {
      this.emit("resources.changed", { item: material, previous, next });
      this.emitDepletionChange(material, next);
    }

    this.rebalanceRoles(`resource ${material} changed`);
  }

  setSharedResource(item: string, count: number): void {
    const material = canonicalMaterialName(item);
    const previous = this.armoryLedger.sharedResources.get(material) ?? 0;
    const next = Math.max(0, Math.floor(count));
    this.armoryLedger.sharedResources.set(material, next);
    if (previous !== next) {
      this.emit("resources.changed", { item: material, previous, next });
      this.emitDepletionChange(material, next);
    }
    this.rebalanceRoles(`resource ${material} set`);
  }

  assignGear(agentId: string, items: string[]): void {
    this.ensureAgent(agentId);
    const normalized = [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort();
    this.armoryLedger.assignedGear.set(agentId, normalized);
    this.emit("gear.assigned", { agentId, items: [...normalized] });
  }

  spotPlayer(position: Position, alertLevel: AlertLevel = "high", playerUsername?: string): void {
    this.threatMap.playerLastSeen = { ...position };
    this.threatMap.lastSightingTimestamp = this.now();
    this.threatMap.alertLevel = alertLevel;
    this.threatMap.playerUsername = playerUsername;
    this.emit("player.spotted", { ...this.threatMap, playerLastSeen: { ...position } });

    if (this.phase === AgentState.HUNT_PHASE || this.phase === AgentState.KILL_PHASE) {
      this.setPhase(AgentState.KILL_PHASE, "human player sighted after village completion");
    }
  }

  clearPlayerSighting(reason = "player sighting expired"): void {
    this.threatMap.playerLastSeen = null;
    this.threatMap.alertLevel = "low";
    this.threatMap.playerUsername = undefined;
    if (this.phase === AgentState.KILL_PHASE) {
      this.setPhase(AgentState.HUNT_PHASE, reason);
    }
  }

  assignTactic(assignment: TacticalAssignment): void {
    this.ensureAgent(assignment.agentId);
    const cloned = cloneTacticalAssignment(assignment);
    this.tactics.set(assignment.agentId, cloned);
    this.emit("tactic.assigned", cloneTacticalAssignment(cloned));
  }

  rebalanceRoles(reason: string): void {
    if (this.phase !== AgentState.BUILD_PHASE) {
      const nextRole = this.phase === AgentState.KILL_PHASE ? AgentRole.SCOUT : AgentRole.SCOUT;
      for (const agentId of this.agentIds) this.setRole(agentId, nextRole, reason);
      return;
    }

    const deficits = this.materialDeficits();
    const hasMaterialDeficit = [...deficits.values()].some((value) => value > 0);
    const pendingCount = [...this.blueprintState.values()].filter((state) => state.status !== "completed").length;
    const gathererTarget = hasMaterialDeficit
      ? Math.max(1, Math.ceil(this.agentIds.length * 0.45))
      : Math.max(0, Math.floor(this.agentIds.length * 0.2));
    const builderTarget = pendingCount > 0
      ? Math.max(1, Math.min(pendingCount, this.agentIds.length - gathererTarget))
      : 0;

    this.agentIds.forEach((agentId, index) => {
      const next = index < gathererTarget
        ? AgentRole.GATHERER
        : index < gathererTarget + builderTarget
          ? AgentRole.BUILDER
          : AgentRole.SCOUT;
      this.setRole(agentId, next, reason);
    });
  }

  materialDeficits(): Map<string, number> {
    const required = new Map<string, number>();
    for (const state of this.blueprintState.values()) {
      if (state.status === "completed") continue;
      const blueprint = this.blueprints.get(state.blueprintId);
      if (!blueprint) continue;
      for (const [item, count] of Object.entries(blueprint.requiredMaterials)) {
        const material = canonicalMaterialName(item);
        required.set(material, (required.get(material) ?? 0) + count);
      }
    }

    for (const [item, available] of this.armoryLedger.sharedResources.entries()) {
      const needed = required.get(item) ?? 0;
      required.set(item, Math.max(0, needed - available));
    }

    for (const [item, needed] of [...required.entries()]) {
      if (needed <= 0) required.delete(item);
    }
    return required;
  }

  snapshot(): TeamMemorySnapshot {
    return {
      teamId: this.teamId,
      phase: this.phase,
      blueprintState: [...this.blueprintState.values()].map(cloneProgress),
      threatMap: {
        ...this.threatMap,
        playerLastSeen: this.threatMap.playerLastSeen ? { ...this.threatMap.playerLastSeen } : null,
      },
      sharedResources: Object.fromEntries(this.armoryLedger.sharedResources.entries()),
      assignedGear: Object.fromEntries(
        [...this.armoryLedger.assignedGear.entries()].map(([agentId, items]) => [agentId, [...items]]),
      ),
      roles: Object.fromEntries(this.agentIds.map((agentId) => [agentId, this.roleFor(agentId)])),
      tactics: Object.fromEntries(
        [...this.tactics.entries()].map(([agentId, tactic]) => [agentId, cloneTacticalAssignment(tactic)]),
      ),
    };
  }

  private setRole(agentId: string, next: AgentRole, reason: string): void {
    this.ensureAgent(agentId);
    const previous = this.roles.get(agentId);
    if (previous === next) return;
    this.roles.set(agentId, next);
    this.emit("role.changed", { agentId, previous, next, reason });
  }

  private setPhase(next: AgentState, reason: string): void {
    if (this.phase === next) return;
    const previous = this.phase;
    this.phase = next;
    this.emit("phase.changed", { previous, next, reason });
    this.rebalanceRoles(reason);
  }

  private emitDepletionChange(item: string, available: number): void {
    const material = canonicalMaterialName(item);
    const required = this.materialDeficits().get(material) ?? 0;
    if (required > 0 && available < required) {
      if (!this.depletedResources.has(material)) {
        this.depletedResources.add(material);
        this.emit("resources.depleted", { item: material, available, required });
      }
      return;
    }

    this.depletedResources.delete(material);
  }

  private addSharedResource(item: string, count: number): void {
    const material = canonicalMaterialName(item);
    this.armoryLedger.sharedResources.set(
      material,
      (this.armoryLedger.sharedResources.get(material) ?? 0) + Math.max(0, Math.floor(count)),
    );
  }

  private villageComplete(): boolean {
    return [...this.blueprintState.values()].every((state) => state.status === "completed");
  }

  private ensureAgent(agentId: string): void {
    if (!this.agentIds.includes(agentId)) {
      throw new Error(`agent ${agentId} is not registered in team ${this.teamId}`);
    }
  }
}

function cloneBlueprint(blueprint: Blueprint): Blueprint {
  return {
    ...blueprint,
    requiredMaterials: { ...blueprint.requiredMaterials },
    schematicData: blueprint.schematicData.map((layer) => layer.map((row) => [...row])),
  };
}

function cloneProgress(progress: BlueprintProgress): BlueprintProgress {
  return { ...progress };
}

function cloneTacticalAssignment(assignment: TacticalAssignment): TacticalAssignment {
  return {
    ...assignment,
    targetPosition: { ...assignment.targetPosition },
  };
}

function schematicBlockCount(blueprint: Blueprint): number {
  const count = blueprint.schematicData.reduce((total, layer) =>
    total + layer.reduce((layerTotal, row) =>
      layerTotal + row.filter((block) => block !== "air").length, 0),
  0);
  return Math.max(1, count);
}
