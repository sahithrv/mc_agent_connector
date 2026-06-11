import type { EventSeverity, GameEvent } from "@mc-ai-video/contracts";

export type LlmWakeReasonType =
  | "routine_tick"
  | "manual"
  | "attacked"
  | "death"
  | "found_diamonds"
  | "leader_command"
  | "direct_mention"
  | "betrayal";

export interface LlmWakeReason {
  type: LlmWakeReasonType;
  event?: GameEvent;
}

export interface LlmPlanningTask {
  id: string;
  provider: string;
  plannerAgentId: string;
  agentIds: string[];
  reason: LlmWakeReason;
  severity: EventSeverity;
  enqueuedAt: number;
  notBefore?: number;
  group?: {
    team?: string;
    role?: string;
  };
}

export interface LlmSchedulingError {
  code: string;
  message: string;
  retryable: boolean;
}
