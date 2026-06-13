import type { ActionResult, JsonValue, Position } from "@mc-ai-video/contracts";

import type {
  PerceptionSnapshot,
  RoutineActionIntent,
  RoutineAgent,
} from "../routines";

export interface SkillRequest {
  id: string;
  agentId: string;
  skill: string;
  params: Record<string, JsonValue>;
  goal?: string;
}

export interface SkillStepResult {
  action?: RoutineActionIntent;
  done?: boolean;
  failed?: boolean;
  reason?: string;
}

export interface SkillExecutionContext {
  request: SkillRequest;
  agent: RoutineAgent;
  perception: PerceptionSnapshot;
  state: Record<string, JsonValue>;
  lastActionResult?: ActionResult;
  currentPosition?: Position;
  inventoryItemNames?: string[];
  leaderUsername?: string;
  attackTargetUsername?: string;
}

export interface RegisteredSkill {
  name: string;
  planNext(input: SkillExecutionContext): SkillStepResult;
}
