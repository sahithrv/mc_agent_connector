import { randomUUID } from "node:crypto";

import type { EventSeverity } from "@mc-ai-video/contracts";

import type { StudioDb } from "./client";
import type { MemoryRecord } from "./types";

interface MemoryRow {
  id: string;
  agent_id: string;
  kind: string;
  summary: string;
  event_id: string | null;
  importance: EventSeverity;
  created_at: string;
}

export interface CreateMemoryInput {
  id?: string;
  agentId: string;
  kind: string;
  summary: string;
  eventId?: string;
  importance: EventSeverity;
  createdAt?: string;
}

export interface MemoryQuery {
  agentId: string;
  limit?: number;
}

export interface ImportantMemoryQuery extends MemoryQuery {
  minImportance?: EventSeverity;
}

export class MemoriesRepository {
  public constructor(private readonly db: StudioDb) {}

  public create(input: CreateMemoryInput): MemoryRecord {
    const memory: MemoryRecord = {
      id: input.id ?? randomUUID(),
      agentId: input.agentId,
      kind: input.kind,
      summary: input.summary,
      eventId: input.eventId,
      importance: input.importance,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO memories (
        id, agent_id, kind, summary, event_id, importance, created_at
      ) VALUES (
        @id, @agentId, @kind, @summary, @eventId, @importance, @createdAt
      )
    `).run(toParams(memory));
    return memory;
  }

  public listRecent(query: MemoryQuery): MemoryRecord[] {
    return this.db
      .prepare(`
        SELECT * FROM memories
        WHERE agent_id = @agentId
        ORDER BY created_at DESC, id DESC
        LIMIT @limit
      `)
      .all({ agentId: query.agentId, limit: query.limit ?? 20 })
      .map((row) => fromRow(row as MemoryRow));
  }

  public listImportant(query: ImportantMemoryQuery): MemoryRecord[] {
    return this.db
      .prepare(`
        SELECT * FROM memories
        WHERE agent_id = @agentId AND importance >= @minImportance
        ORDER BY importance DESC, created_at DESC, id DESC
        LIMIT @limit
      `)
      .all({
        agentId: query.agentId,
        minImportance: query.minImportance ?? 4,
        limit: query.limit ?? 20,
      })
      .map((row) => fromRow(row as MemoryRow));
  }
}

function toParams(memory: MemoryRecord): Record<string, unknown> {
  return {
    id: memory.id,
    agentId: memory.agentId,
    kind: memory.kind,
    summary: memory.summary,
    eventId: memory.eventId ?? null,
    importance: memory.importance,
    createdAt: memory.createdAt,
  };
}

function fromRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    summary: row.summary,
    eventId: row.event_id ?? undefined,
    importance: row.importance,
    createdAt: row.created_at,
  };
}
