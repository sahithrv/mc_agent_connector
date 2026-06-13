import type { Position } from "@mc-ai-video/contracts";

import {
  TacticalRole,
  type TacticalAssignment,
  type TeamMemory,
  type ThreatMap,
} from "./team-memory";

export interface TacticalPositioningOptions {
  aggroRange?: number;
  flankRadius?: number;
  now?: () => number;
}

export class FlankingEngine {
  private readonly aggroRange: number;
  private readonly flankRadius: number;
  private readonly now: () => number;

  constructor(options: TacticalPositioningOptions = {}) {
    this.aggroRange = options.aggroRange ?? 3;
    this.flankRadius = options.flankRadius ?? 8;
    this.now = options.now ?? Date.now;
  }

  assign(
    agentIds: string[],
    threatMap: ThreatMap,
    agentPositions: ReadonlyMap<string, Position> = new Map(),
  ): TacticalAssignment[] {
    const target = threatMap.playerLastSeen;
    if (!target) return [];

    const ordered = [...new Set(agentIds)].sort((left, right) => left.localeCompare(right));
    return ordered.map((agentId, index) => {
      const role = index === 0
        ? TacticalRole.AGGRO
        : hash(agentId) % 2 === 0
          ? TacticalRole.FLANK_LEFT
          : TacticalRole.FLANK_RIGHT;
      return {
        agentId,
        role,
        targetPosition: this.positionForRole(role, target, agentPositions.get(agentId), agentId),
        assignedAt: this.now(),
      };
    });
  }

  assignIntoMemory(
    memory: TeamMemory,
    agentIds: string[],
    agentPositions: ReadonlyMap<string, Position> = new Map(),
  ): TacticalAssignment[] {
    const assignments = this.assign(agentIds, memory.threatMap, agentPositions);
    for (const assignment of assignments) memory.assignTactic(assignment);
    return assignments;
  }

  private positionForRole(
    role: TacticalRole,
    player: Position,
    current: Position | undefined,
    agentId: string,
  ): Position {
    const approach = current ? normalize2d({
      x: current.x - player.x,
      z: current.z - player.z,
    }) : unitFromHash(agentId);

    if (role === TacticalRole.AGGRO) {
      return snap({
        x: player.x + approach.x * this.aggroRange,
        y: player.y,
        z: player.z + approach.z * this.aggroRange,
        world: player.world,
      });
    }

    const side = role === TacticalRole.FLANK_LEFT
      ? { x: -approach.z, z: approach.x }
      : { x: approach.z, z: -approach.x };
    const forwardPressure = this.flankRadius * 0.35;

    return snap({
      x: player.x + side.x * this.flankRadius + approach.x * forwardPressure,
      y: player.y,
      z: player.z + side.z * this.flankRadius + approach.z * forwardPressure,
      world: player.world,
    });
  }
}

interface Vector2 {
  x: number;
  z: number;
}

function normalize2d(vector: Vector2): Vector2 {
  const length = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
  if (length === 0) return { x: 1, z: 0 };
  return { x: vector.x / length, z: vector.z / length };
}

function unitFromHash(value: string): Vector2 {
  const angle = (hash(value) % 360) * (Math.PI / 180);
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function snap(position: Position): Position {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
    world: position.world,
  };
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}
