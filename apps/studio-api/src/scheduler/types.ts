import type {
  ActionRequest,
  ActionResult,
  AgentConfig,
  AgentMode,
  GameEvent,
  JsonValue,
} from "@mc-ai-video/contracts";

import type {
  PerceptionSnapshot,
  Routine,
  RoutineActionIntent,
  RoutineTaskEvent,
} from "../routines";
import type { ReflectionService } from "../memory/reflection";

export type WakeReasonType =
  | "attacked"
  | "death"
  | "found_diamonds"
  | "leader_command"
  | "direct_mention"
  | "betrayal"
  | "manual";

export interface WakeReason {
  type: WakeReasonType;
  event?: GameEvent;
}

export interface SchedulerConfig {
  maxConcurrentActions: number;
  maxPlanningSlots: number;
  planningCooldownMs: number;
}

export interface PlannerDecision {
  action?: RoutineActionIntent;
  note?: string;
}

export interface DecisionPlanner {
  plan(
    agent: AgentConfig,
    perception: PerceptionSnapshot,
    reason: WakeReason,
    signal: AbortSignal,
  ): Promise<PlannerDecision>;
}

export interface PerceptionProvider {
  snapshot(agent: AgentConfig): Promise<PerceptionSnapshot>;
}

export interface ActionRegistry {
  canRun(agent: AgentConfig, request: ActionRequest): boolean;
  run(agent: AgentConfig, request: ActionRequest, signal: AbortSignal): Promise<ActionResult>;
}

export type SchedulerEvent =
  | RoutineTaskEvent
  | {
      type:
        | "scheduler.wake"
        | "scheduler.planning.started"
        | "scheduler.planning.finished"
        | "scheduler.action.started"
        | "scheduler.action.finished"
        | "scheduler.action.canceled"
        | "scheduler.action.rejected";
      agentId: string;
      severity: 1 | 2 | 3 | 4 | 5;
      payload: Record<string, JsonValue>;
    };

export interface SchedulerEventSink {
  publish(event: SchedulerEvent): void;
}

export interface AgentSchedulerState {
  agentId: string;
  mode: AgentMode;
  planningQueued: boolean;
  planning: boolean;
  nextPlanAt: number;
  wakeReason?: WakeReason;
  currentActionId?: string;
}

export interface SchedulerDependencies {
  agents: AgentConfig[];
  routines: Map<string, Routine>;
  perception: PerceptionProvider;
  actions: ActionRegistry;
  planner: DecisionPlanner;
  reflection?: ReflectionService;
  events?: SchedulerEventSink;
  config: SchedulerConfig;
  now?: () => number;
  idFactory?: () => string;
}
