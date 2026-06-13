import type {
  AgentConfig,
  AiChatMessage,
  GameEvent,
  JsonValue,
  PerceptionSnapshot,
  Position,
} from "@mc-ai-video/contracts";

import type { ScenarioConfig } from "../../scenario/types";
import type { AgentDecision } from "../schemas/agent-decision";

export interface StaticPersona {
  identity: string;
  background?: string;
  speakingStyle?: string;
  values?: string[];
  boundaries?: string[];
}

export interface DynamicAgentState {
  mode?: AgentConfig["mode"];
  health?: number;
  food?: number;
  position?: Position;
  activeGoal?: string;
  currentRoutine?: string;
  currentTask?: string;
  emotionalState?: string;
  threatLevel?: "none" | "low" | "medium" | "high";
}

export interface RelationshipContext {
  agentId: string;
  name?: string;
  trust?: number;
  loyalty?: number;
  fear?: number;
  tags?: string[];
}

export interface MemoryContext {
  id?: string;
  summary: string;
  importance?: number;
  timestamp?: string;
  relatedAgentIds?: string[];
}

export interface ActionResultContext {
  action: string;
  ok: boolean;
  error?: string;
  params?: Record<string, JsonValue>;
  data?: Record<string, JsonValue>;
  requestedBy?: string;
  targetKey?: string;
  completedAt?: string;
}

export interface ActiveScenarioContext {
  scenario: ScenarioConfig;
  currentEpisodeGoal?: string;
  directorConstraints?: string[];
  visibleSecretRoles?: string[];
}

export interface PromptActionAffordance {
  action: AgentDecision["action"];
  params: Record<string, JsonValue>;
  score: number;
  reason: string;
  advancesGoal?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  targetKey?: string;
}

export interface PromptRecoveryContext {
  stuck: boolean;
  reason?: string;
  blockedTargetKeys?: string[];
  hint?: string;
}

export interface PromptPlanStep {
  id: string;
  description: string;
  status: "pending" | "active" | "done" | "blocked" | "failed";
  neededItems?: Record<string, number>;
  target?: JsonValue;
  blocker?: string;
  successCondition?: string;
  nextAction?: string;
  skill?: string;
}

export interface PromptTaskState {
  goal?: string;
  currentStepId?: string;
  updatedAt: string;
  plan: PromptPlanStep[];
}

export interface PromptPerceptionSnapshot
  extends Partial<Omit<PerceptionSnapshot, "nearbyPlayers">> {
  visibleBlocks?: Array<Record<string, JsonValue>>;
  nearbyEntities?: Array<Record<string, JsonValue>>;
  nearbyPlayers?: Array<Record<string, JsonValue>>;
  patrolPoints?: Position[];
}

export interface PromptContextInput {
  agent: Pick<AgentConfig, "id" | "name" | "role" | "team" | "subteam" | "leader" | "routine" | "allowedActions">;
  staticPersona: StaticPersona;
  dynamicState?: DynamicAgentState;
  perception?: PromptPerceptionSnapshot;
  relationships?: RelationshipContext[];
  memories?: MemoryContext[];
  recentActionResults?: ActionResultContext[];
  affordances?: PromptActionAffordance[];
  recovery?: PromptRecoveryContext;
  taskState?: PromptTaskState;
  recentChat?: AiChatMessage[];
  recentEvents?: GameEvent[];
  activeScenario?: ActiveScenarioContext;
  maxChars?: number;
}

export interface PromptContext {
  agentId: string;
  maxChars: number;
  staticPersonaText: string;
  dynamicStateText: string;
  contextText: string;
  truncated: boolean;
}
