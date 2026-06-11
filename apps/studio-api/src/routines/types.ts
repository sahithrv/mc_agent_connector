import type {
  AgentConfig,
  EventSeverity,
  JsonValue,
  Position,
} from "@mc-ai-video/contracts";

export type RoutineStatus = "idle" | "acting" | "failed";

export interface RoutineAgent
  extends Pick<AgentConfig, "id" | "name" | "role" | "team" | "routine" | "allowedActions"> {}

export interface PerceivedInventory {
  tools: string[];
  seeds: number;
  food?: number;
}

export interface PerceivedBlock {
  id: string;
  type: string;
  position: Position;
  mature?: boolean;
  safe?: boolean;
  belowAgent?: boolean;
  needsPlanting?: boolean;
}

export interface PerceivedEntity {
  id: string;
  type: string;
  position?: Position;
  distance?: number;
  hostile?: boolean;
  protected?: boolean;
}

export interface PerceivedPlayer {
  id: string;
  name: string;
  team?: string;
  distance?: number;
  protected?: boolean;
  threatening?: boolean;
}

export interface PerceptionSnapshot {
  agentId: string;
  health: number;
  inventory: PerceivedInventory;
  visibleBlocks: PerceivedBlock[];
  nearbyEntities: PerceivedEntity[];
  nearbyPlayers: PerceivedPlayer[];
  patrolPoints?: Position[];
}

export interface RoutineActionIntent {
  action: string;
  params: Record<string, JsonValue>;
  timeoutMs?: number;
  requestedBy?: string;
}

export interface RoutineTaskEvent {
  type: "routine.task";
  agentId: string;
  routineId: string;
  status: RoutineStatus;
  severity: EventSeverity;
  message: string;
  payload: Record<string, JsonValue>;
}

export interface RoutineRunResult {
  status: RoutineStatus;
  reason?: string;
  action?: RoutineActionIntent;
  taskEvents: RoutineTaskEvent[];
  wantsPlanning?: boolean;
}

export interface Routine {
  id: string;
  run(agent: RoutineAgent, perception: PerceptionSnapshot): RoutineRunResult;
}

export function canUseAction(agent: RoutineAgent, action: string): boolean {
  return agent.allowedActions.includes(action);
}

export function taskEvent(
  agent: RoutineAgent,
  routineId: string,
  status: RoutineStatus,
  message: string,
  payload: Record<string, JsonValue> = {},
  severity: EventSeverity = 1,
): RoutineTaskEvent {
  return {
    type: "routine.task",
    agentId: agent.id,
    routineId,
    status,
    severity,
    message,
    payload,
  };
}
