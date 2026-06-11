import type {
  AgentMode,
  EventSeverity,
  JsonValue,
  Position,
  Visibility,
} from "@mc-ai-video/contracts";

export type SessionStatus = "active" | "ended";

export interface SessionRecord {
  id: string;
  title: string;
  status: SessionStatus;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
}

export interface StoredEvent {
  id: string;
  sessionId: string;
  type: string;
  actorId?: string;
  targetId?: string;
  location?: Position;
  severity: EventSeverity;
  payload: Record<string, JsonValue>;
  timestamp: string;
}

export interface AgentStateRecord {
  agentId: string;
  mode: AgentMode;
  role: string;
  currentTask?: string;
  health: number;
  food: number;
  position?: Position;
  updatedAt: string;
}

export interface RelationshipRecord {
  agentId: string;
  targetId: string;
  trust: number;
  loyalty: number;
  fear: number;
  tags: string[];
}

export interface MemoryRecord {
  id: string;
  agentId: string;
  kind: string;
  summary: string;
  eventId?: string;
  importance: EventSeverity;
  createdAt: string;
}

export type ChatViewerRole =
  | "recorder"
  | "ai-team-human"
  | "human-team"
  | "unaffiliated";

export interface AiChatMessageRecord {
  id: string;
  sessionId: string;
  senderId: string;
  recipients: string[];
  topic?: string;
  urgency?: EventSeverity;
  visibility: Visibility;
  content: string;
  location?: Position;
  timestamp: string;
}

export interface ClipMarkerRecord {
  id: string;
  sessionId: string;
  title: string;
  notes?: string;
  sourceEventId?: string;
  timestamp: string;
}
