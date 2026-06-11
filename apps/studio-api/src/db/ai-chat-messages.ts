import { randomUUID } from "node:crypto";

import type { EventSeverity, Position, Visibility } from "@mc-ai-video/contracts";

import type { StudioDb } from "./client";
import { decodeJson, encodeJson, nullableJson } from "./json";
import type { AiChatMessageRecord, ChatViewerRole } from "./types";

interface AiChatMessageRow {
  id: string;
  session_id: string;
  sender_id: string;
  recipients: string;
  topic: string | null;
  urgency: EventSeverity | null;
  visibility: Visibility;
  content: string;
  location: string | null;
  timestamp: string;
}

export interface CreateAiChatMessageInput {
  id?: string;
  sessionId: string;
  senderId: string;
  recipients?: string[];
  topic?: string;
  urgency?: EventSeverity;
  visibility: Visibility;
  content: string;
  location?: Position;
  timestamp?: string;
}

export interface ChatListQuery {
  sessionId: string;
  limit?: number;
}

export interface ChatViewerQuery extends ChatListQuery {
  viewerRole: ChatViewerRole;
}

export class AiChatMessagesRepository {
  public constructor(private readonly db: StudioDb) {}

  public create(input: CreateAiChatMessageInput): AiChatMessageRecord {
    const message: AiChatMessageRecord = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      senderId: input.senderId,
      recipients: input.recipients ?? [],
      topic: input.topic,
      urgency: input.urgency,
      visibility: input.visibility,
      content: input.content,
      location: input.location,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO ai_chat_messages (
        id, session_id, sender_id, recipients, topic, urgency,
        visibility, content, location, timestamp
      ) VALUES (
        @id, @sessionId, @senderId, @recipients, @topic, @urgency,
        @visibility, @content, @location, @timestamp
      )
    `).run(toParams(message));
    return message;
  }

  public listBySession(query: ChatListQuery): AiChatMessageRecord[] {
    return this.db
      .prepare(`
        SELECT * FROM ai_chat_messages
        WHERE session_id = @sessionId
        ORDER BY timestamp, id
        LIMIT @limit
      `)
      .all({ sessionId: query.sessionId, limit: query.limit ?? 100 })
      .map((row) => fromRow(row as AiChatMessageRow));
  }

  public listForViewer(query: ChatViewerQuery): AiChatMessageRecord[] {
    const allowed = visibilitiesForViewer(query.viewerRole);
    if (allowed.length === 4) {
      return this.listBySession(query);
    }

    const params: Record<string, unknown> = {
      sessionId: query.sessionId,
      limit: query.limit ?? 100,
    };
    const placeholders = allowed.map((visibility, index) => {
      const key = `visibility${index}`;
      params[key] = visibility;
      return `@${key}`;
    });

    return this.db
      .prepare(`
        SELECT * FROM ai_chat_messages
        WHERE session_id = @sessionId
          AND visibility IN (${placeholders.join(", ")})
        ORDER BY timestamp, id
        LIMIT @limit
      `)
      .all(params)
      .map((row) => fromRow(row as AiChatMessageRow));
  }
}

function visibilitiesForViewer(viewerRole: ChatViewerRole): Visibility[] {
  switch (viewerRole) {
    case "recorder":
      return ["ai", "human-team", "recorder", "public"];
    case "ai-team-human":
      return ["ai", "human-team", "public"];
    case "human-team":
      return ["human-team", "public"];
    case "unaffiliated":
      return ["public"];
  }
}

function toParams(message: AiChatMessageRecord): Record<string, unknown> {
  return {
    id: message.id,
    sessionId: message.sessionId,
    senderId: message.senderId,
    recipients: encodeJson(message.recipients),
    topic: message.topic ?? null,
    urgency: message.urgency ?? null,
    visibility: message.visibility,
    content: message.content,
    location: message.location ? encodeJson(message.location) : null,
    timestamp: message.timestamp,
  };
}

function fromRow(row: AiChatMessageRow): AiChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    senderId: row.sender_id,
    recipients: decodeJson<string[]>(row.recipients),
    topic: row.topic ?? undefined,
    urgency: row.urgency ?? undefined,
    visibility: row.visibility,
    content: row.content,
    location: nullableJson<Position>(row.location),
    timestamp: row.timestamp,
  };
}
