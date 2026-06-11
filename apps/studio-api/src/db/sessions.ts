import { randomUUID } from "node:crypto";

import type { StudioDb } from "./client";
import type { SessionRecord } from "./types";

interface SessionRow {
  id: string;
  title: string;
  status: "active" | "ended";
  is_current: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface CreateSessionInput {
  id?: string;
  title?: string;
  createdAt?: string;
  makeCurrent?: boolean;
}

export class SessionsRepository {
  public constructor(private readonly db: StudioDb) {}

  public create(input: CreateSessionInput = {}): SessionRecord {
    const now = input.createdAt ?? new Date().toISOString();
    const record: SessionRecord = {
      id: input.id ?? randomUUID(),
      title: input.title ?? "Untitled session",
      status: "active",
      isCurrent: input.makeCurrent ?? true,
      createdAt: now,
      updatedAt: now,
    };

    const insert = () => {
      if (record.isCurrent) {
        this.db.prepare("UPDATE sessions SET is_current = 0").run();
      }
      this.db.prepare(`
        INSERT INTO sessions (
          id, title, status, is_current, created_at, updated_at, ended_at
        ) VALUES (
          @id, @title, @status, @isCurrent, @createdAt, @updatedAt, @endedAt
        )
      `).run(toParams(record));
    };

    this.db.transaction(insert)();
    return record;
  }

  public get(id: string): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = @id")
      .get({ id }) as SessionRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  public getCurrent(): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE is_current = 1")
      .get() as SessionRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  public setCurrent(id: string, updatedAt = new Date().toISOString()): void {
    const update = () => {
      this.db.prepare("UPDATE sessions SET is_current = 0").run();
      const result = this.db.prepare(`
        UPDATE sessions
        SET is_current = 1, status = 'active', updated_at = @updatedAt
        WHERE id = @id
      `).run({ id, updatedAt });
      if (result.changes !== 1) {
        throw new Error(`session not found: ${id}`);
      }
    };

    this.db.transaction(update)();
  }

  public list(): SessionRecord[] {
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY created_at")
      .all()
      .map((row) => fromRow(row as SessionRow));
  }
}

function toParams(record: SessionRecord): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    isCurrent: record.isCurrent ? 1 : 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    endedAt: record.endedAt ?? null,
  };
}

function fromRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    isCurrent: row.is_current === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at ?? undefined,
  };
}
