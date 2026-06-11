import { randomUUID } from "node:crypto";

import type { StudioDb } from "./client";
import type { ClipMarkerRecord } from "./types";

interface ClipMarkerRow {
  id: string;
  session_id: string;
  title: string;
  notes: string | null;
  source_event_id: string | null;
  timestamp: string;
}

export interface CreateClipMarkerInput {
  id?: string;
  sessionId: string;
  title: string;
  notes?: string;
  sourceEventId?: string;
  timestamp?: string;
}

export class ClipMarkersRepository {
  public constructor(private readonly db: StudioDb) {}

  public create(input: CreateClipMarkerInput): ClipMarkerRecord {
    const marker: ClipMarkerRecord = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      title: input.title,
      notes: input.notes,
      sourceEventId: input.sourceEventId,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO clip_markers (
        id, session_id, title, notes, source_event_id, timestamp
      ) VALUES (
        @id, @sessionId, @title, @notes, @sourceEventId, @timestamp
      )
    `).run(toParams(marker));
    return marker;
  }

  public listBySession(sessionId: string): ClipMarkerRecord[] {
    return this.db
      .prepare(`
        SELECT * FROM clip_markers
        WHERE session_id = @sessionId
        ORDER BY timestamp, id
      `)
      .all({ sessionId })
      .map((row) => fromRow(row as ClipMarkerRow));
  }
}

function toParams(marker: ClipMarkerRecord): Record<string, unknown> {
  return {
    id: marker.id,
    sessionId: marker.sessionId,
    title: marker.title,
    notes: marker.notes ?? null,
    sourceEventId: marker.sourceEventId ?? null,
    timestamp: marker.timestamp,
  };
}

function fromRow(row: ClipMarkerRow): ClipMarkerRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    notes: row.notes ?? undefined,
    sourceEventId: row.source_event_id ?? undefined,
    timestamp: row.timestamp,
  };
}
