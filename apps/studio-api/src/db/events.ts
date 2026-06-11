import { randomUUID } from "node:crypto";

import type { EventSeverity, JsonValue, Position } from "@mc-ai-video/contracts";

import type { StudioDb } from "./client";
import { decodeJson, encodeJson, nullableJson } from "./json";
import type { StoredEvent } from "./types";

interface EventRow {
  id: string;
  session_id: string;
  type: string;
  actor_id: string | null;
  target_id: string | null;
  location: string | null;
  severity: EventSeverity;
  payload: string;
  timestamp: string;
}

export interface CreateEventInput {
  id?: string;
  sessionId: string;
  type: string;
  actorId?: string;
  targetId?: string;
  location?: Position;
  severity: EventSeverity;
  payload?: Record<string, JsonValue>;
  timestamp?: string;
}

export interface EventListFilter {
  sessionId: string;
  type?: string;
  actorId?: string;
  limit?: number;
}

export class EventsRepository {
  public constructor(private readonly db: StudioDb) {}

  public insert(input: CreateEventInput): StoredEvent {
    const event: StoredEvent = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      type: input.type,
      actorId: input.actorId,
      targetId: input.targetId,
      location: input.location,
      severity: input.severity,
      payload: input.payload ?? {},
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO events (
        id, session_id, type, actor_id, target_id, location,
        severity, payload, timestamp
      ) VALUES (
        @id, @sessionId, @type, @actorId, @targetId, @location,
        @severity, @payload, @timestamp
      )
    `).run(toParams(event));
    return event;
  }

  public list(filter: EventListFilter): StoredEvent[] {
    const clauses = ["session_id = @sessionId"];
    const params: Record<string, unknown> = {
      sessionId: filter.sessionId,
      limit: filter.limit ?? 100,
    };

    if (filter.type) {
      clauses.push("type = @type");
      params.type = filter.type;
    }
    if (filter.actorId) {
      clauses.push("actor_id = @actorId");
      params.actorId = filter.actorId;
    }

    return this.db
      .prepare(`
        SELECT * FROM events
        WHERE ${clauses.join(" AND ")}
        ORDER BY timestamp, id
        LIMIT @limit
      `)
      .all(params)
      .map((row) => fromRow(row as EventRow));
  }
}

function toParams(event: StoredEvent): Record<string, unknown> {
  return {
    id: event.id,
    sessionId: event.sessionId,
    type: event.type,
    actorId: event.actorId ?? null,
    targetId: event.targetId ?? null,
    location: event.location ? encodeJson(event.location) : null,
    severity: event.severity,
    payload: encodeJson(event.payload),
    timestamp: event.timestamp,
  };
}

function fromRow(row: EventRow): StoredEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    actorId: row.actor_id ?? undefined,
    targetId: row.target_id ?? undefined,
    location: nullableJson<Position>(row.location),
    severity: row.severity,
    payload: decodeJson<Record<string, JsonValue>>(row.payload),
    timestamp: row.timestamp,
  };
}
