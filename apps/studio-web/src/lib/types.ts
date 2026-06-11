import type {
  ActionResult,
  AgentConfig,
  AgentMode,
  AiChatMessage,
  GameEvent,
  JsonValue,
} from "@mc-ai-video/contracts";

export const PENDING_SHARED_CONTRACT_TYPES = [
  "UiHealthSnapshot",
  "UiSessionSummary",
  "UiAgentRuntime",
  "PendingStudioEventEnvelope",
] as const;

export type ServiceStatus = "online" | "degraded" | "offline" | "unknown";

export interface UiHealthSnapshot {
  backend: {
    status: ServiceStatus;
    message?: string;
    lastCheckedAt?: string;
  };
  minecraft: {
    status: ServiceStatus;
    message?: string;
  };
  bots: {
    connected: number;
    total: number;
    message?: string;
  };
  llmQueue: {
    status: ServiceStatus;
    active: number;
    queued: number;
    message?: string;
  };
}

export interface UiSessionSummary {
  id: string;
  name: string;
  startedAt: string;
  status: "booting" | "running" | "paused" | "stopped";
}

export interface UiAgentRuntime extends AgentConfig {
  mode: AgentMode;
  currentTask?: string;
  health?: Record<string, JsonValue>;
  updatedAt?: string;
}

export interface PendingAgentStateUpdate {
  agentId: string;
  mode: AgentMode;
  currentTask?: string;
  health?: Record<string, JsonValue>;
  updatedAt: string;
}

export interface PendingDirectorCommand {
  id: string;
  type:
    | "pause-agent"
    | "resume-agent"
    | "pause-all"
    | "resume-all"
    | "inject-event"
    | "send-ai-chat"
    | "mark-clip";
  requestedBy?: string;
  targetAgentId?: string;
  reason?: string;
  payload: Record<string, JsonValue>;
  timestamp: string;
}

export type PendingStudioEventEnvelope =
  | { type: "game.event"; payload: GameEvent }
  | { type: "chat.message"; payload: AiChatMessage }
  | { type: "agent.state"; payload: PendingAgentStateUpdate }
  | { type: "director.command"; payload: PendingDirectorCommand }
  | { type: "action.result"; payload: ActionResult };
