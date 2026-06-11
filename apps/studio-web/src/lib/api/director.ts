import type {
  AiChatMessage,
  EventSeverity,
  GameEvent,
  JsonValue,
  Position,
  Visibility,
} from "@mc-ai-video/contracts";

import { ApiClient } from "./client";
import type { PendingDirectorCommand } from "../types";

const client = new ApiClient();

export interface DirectorEventInput {
  type: string;
  actorId?: string;
  targetId?: string;
  location?: Position;
  severity: EventSeverity;
  visibility?: Visibility;
  payload: Record<string, JsonValue>;
  timestamp?: string;
}

export interface DirectorAnnouncementInput {
  senderId: string;
  recipientIds: string[];
  topic?: string;
  urgency: EventSeverity;
  visibility?: Visibility;
  content: string;
}

export interface DirectorClipMarker {
  id: string;
  sessionId?: string;
  title: string;
  notes?: string;
  sourceEventId?: string;
  sourceEventType?: string;
  timestamp: string;
  kind: "manual" | "automatic";
}

export interface DirectorClipInput {
  title: string;
  notes?: string;
  eventId?: string;
  requestedBy?: string;
  timestamp?: string;
}

export interface RoleAssignmentInput {
  agentId: string;
  role: string;
  secret: boolean;
  requestedBy?: string;
}

type ApiRequest = Pick<ApiClient, "request">;

interface DirectorEventResponse {
  ok: boolean;
  event: GameEvent;
}

interface DirectorChatResponse {
  ok: boolean;
  message: AiChatMessage;
}

interface BackendClipMarker {
  id: string;
  sessionId?: string;
  title: string;
  notes?: string;
  sourceEventId?: string;
  timestamp: string;
}

interface DirectorClipResponse {
  ok: boolean;
  marker?: BackendClipMarker;
  command: PendingDirectorCommand;
}

export async function injectDirectorEvent(
  input: DirectorEventInput,
  api: ApiRequest = client,
): Promise<GameEvent> {
  const response = await api.request<DirectorEventResponse>("/director/events", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.event;
}

export async function sendDirectorAnnouncement(
  input: DirectorAnnouncementInput,
  api: ApiRequest = client,
): Promise<AiChatMessage> {
  const response = await api.request<DirectorChatResponse>("/director/chat", {
    method: "POST",
    body: JSON.stringify({ ...input, visibility: input.visibility ?? "ai" }),
  });
  return response.message;
}

export async function markDirectorClip(
  input: DirectorClipInput,
  api: ApiRequest = client,
): Promise<DirectorClipMarker> {
  const response = await api.request<DirectorClipResponse>("/director/clips", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      notes: input.notes,
      eventId: input.eventId,
      requestedBy: input.requestedBy,
      timestamp: input.timestamp,
    }),
  });

  const fallbackTimestamp = input.timestamp ?? new Date().toISOString();
  const marker = response.marker ?? {
    id: stringPayloadValue(response.command.payload.markerId) ?? response.command.id,
    title: input.title,
    notes: input.notes,
    sourceEventId: input.eventId,
    timestamp: stringPayloadValue(response.command.payload.timestamp) ?? fallbackTimestamp,
  };

  return {
    ...marker,
    kind: "manual",
  };
}

export function unsupportedRoleAssignment(input: RoleAssignmentInput): Error {
  const secretLabel = input.secret ? "secret role" : "role";
  return new Error(
    `Cannot assign ${secretLabel} "${input.role}" to ${input.agentId}: the V1 director API has no role assignment endpoint.`,
  );
}

function stringPayloadValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
