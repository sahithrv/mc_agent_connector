import type {
  AgentConfig,
  AiChatMessage,
  GameEvent,
  JsonValue,
  PerceptionSnapshot,
  Position,
} from "@mc-ai-video/contracts";

import type { ScenarioConfig } from "../../scenario/types";

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

export interface ActiveScenarioContext {
  scenario: ScenarioConfig;
  currentEpisodeGoal?: string;
  directorConstraints?: string[];
  visibleSecretRoles?: string[];
}

export interface PromptPerceptionSnapshot
  extends Partial<Omit<PerceptionSnapshot, "nearbyPlayers">> {
  visibleBlocks?: Array<Record<string, JsonValue>>;
  nearbyEntities?: Array<Record<string, JsonValue>>;
  nearbyPlayers?: Array<Record<string, JsonValue>>;
  patrolPoints?: Position[];
}

export interface PromptContextInput {
  agent: Pick<AgentConfig, "id" | "name" | "role" | "team" | "routine" | "allowedActions">;
  staticPersona: StaticPersona;
  dynamicState?: DynamicAgentState;
  perception?: PromptPerceptionSnapshot;
  relationships?: RelationshipContext[];
  memories?: MemoryContext[];
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
