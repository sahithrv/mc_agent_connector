import type {
  ActionResult,
  AgentMode,
  AiChatMessage,
  GameEvent,
  JsonValue,
} from "@mc-ai-video/contracts";

export interface AgentStateUpdate {
  agentId: string;
  mode: AgentMode;
  currentTask?: string;
  health?: Record<string, JsonValue>;
  updatedAt: string;
}

export interface DirectorCommand {
  id: string;
  type:
    | "pause-agent"
    | "resume-agent"
    | "pause-all"
    | "resume-all"
    | "inject-event"
    | "send-ai-chat"
    | "mark-clip"
    | "inject-agent-context"
    | "set-agent-role"
    | "set-agent-task"
    | "set-subteam-task"
    | "god-dialogue"
    | "add-agent"
    | "update-agent";
  requestedBy?: string;
  targetAgentId?: string;
  reason?: string;
  payload: Record<string, JsonValue>;
  timestamp: string;
}

export interface StudioEventMap {
  "game.event": GameEvent;
  "chat.message": AiChatMessage;
  "agent.state": AgentStateUpdate;
  "director.command": DirectorCommand;
  "action.result": ActionResult;
}

export type StudioEventName = keyof StudioEventMap;

export interface StudioEventEnvelope<K extends StudioEventName = StudioEventName> {
  type: K;
  payload: StudioEventMap[K];
}
